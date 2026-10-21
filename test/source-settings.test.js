'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { SourceSettings } = require('../agent/source-settings');
const { SourceDiscoveryService } = require('../agent/source-discovery');

function settingsDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsarwiki-source-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('ADS settings persist privately, report no secret, and restore the environment fallback on removal', t => {
  const dataDir = settingsDirectory(t);
  const settings = new SourceSettings({ dataDir, envToken: 'environment-secret' });
  assert.deepEqual(settings.status(), { configured: true, saved: false, fromEnvironment: true });
  const status = settings.save('  saved-secret  ');
  assert.deepEqual(status, { configured: true, saved: true, fromEnvironment: false });
  assert.doesNotMatch(JSON.stringify(status), /secret/);
  const restored = new SourceSettings({ dataDir, envToken: 'environment-secret' });
  assert.equal(restored.token, 'saved-secret');
  assert.deepEqual(restored.remove(), { configured: true, saved: false, fromEnvironment: true });
  assert.equal(restored.token, 'environment-secret');
  assert.equal(fs.existsSync(restored.file), false);
});

test('invalid token input preserves the saved credential', t => {
  const settings = new SourceSettings({ dataDir: settingsDirectory(t), envToken: '' });
  assert.equal(settings.status().configured, false);
  settings.save('original-secret');
  for (const token of [undefined, null, 123, '', '  ', 'two words', 'line\nbreak', 'x'.repeat(4097)]) {
    assert.throws(() => settings.save(token), TypeError);
    assert.equal(settings.token, 'original-secret');
  }
  assert.equal(settings.remove().configured, false);
});

test('searches use updated ADS credentials without recreating the discovery service', async t => {
  const calls = [];
  const service = new SourceDiscoveryService({ rawDir: settingsDirectory(t), adsToken: '', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, text: async () => JSON.stringify({ response: { docs: [] } }) };
  } });
  await service.search('pulsar source:ads');
  assert.equal(calls.length, 0);
  service.adsToken = 'new-secret';
  await service.search('pulsar source:ads');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer new-secret');
  service.adsToken = '';
  await service.search('pulsar source:ads');
  assert.equal(calls.length, 1);
});

test('settings controls clear submitted secrets, show saved status, and recover after a save failure', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const elements = Object.fromEntries(['ads-token', 'ads-token-save', 'ads-token-remove', 'ads-token-status'].map(id => [id, { value: '', disabled: false }]));
  const requests = [];
  let failure = false;
  const context = {
    $: id => elements[id],
    workspaceFetch: async (url, options) => {
      requests.push({ url, options });
      if (failure) throw new Error('Could not save');
      return { configured: options.method !== 'DELETE', saved: options.method !== 'DELETE', fromEnvironment: false };
    },
    readJsonResponse: async response => response,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function readAdsSettingsResponse('), source.indexOf('async function refreshChatGPTStatus(')), context);
  for (const status of [404, 409]) {
    await assert.rejects(context.readAdsSettingsResponse({ status }), /Restart the PulsarWiki server/);
  }
  elements['ads-token'].value = 'test-secret';
  await context.updateAdsSettings();
  assert.deepEqual(JSON.parse(requests[0].options.body), { token: 'test-secret' });
  assert.equal(elements['ads-token'].value, '');
  assert.match(elements['ads-token-status'].textContent, /Token saved/);
  assert.equal(elements['ads-token-remove'].disabled, false);
  failure = true;
  await context.updateAdsSettings();
  assert.equal(elements['ads-token-save'].disabled, false);
  assert.equal(elements['ads-token-remove'].disabled, false);
  assert.equal(elements['ads-token-status'].textContent, 'Could not save');
  failure = false;
  await context.updateAdsSettings(true);
  assert.equal(requests.at(-1).options.method, 'DELETE');
  assert.equal(elements['ads-token-remove'].disabled, true);
  assert.match(elements['ads-token-status'].textContent, /No token configured/);
});
