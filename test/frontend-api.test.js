'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function loadApi(fetch) {
  const apiSource = appSource.slice(0, appSource.indexOf('const state ='));
  const context = {
    fetch,
    XMLHttpRequest: class {},
    marked: { setOptions() {}, parse() { return ''; } },
  };
  vm.createContext(context);
  vm.runInContext(`${apiSource}\nglobalThis.__api = api;`, context);
  return context.__api;
}

function response(status, payload = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return status === 204 ? '' : JSON.stringify(payload); },
  };
}

test('frontend reads sanitized ChatGPT status and persists a catalog model slug', async () => {
  const requests = [];
  const api = loadApi(async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/chatgpt/status') return response(200, {
      connected: true,
      savedAccount: true,
      ready: true,
      account: { name: 'Pulsar Person', email: 'person@example.com' },
      models: [{ id: 'model-slug', name: 'Model Name' }],
      selectedModel: 'model-slug',
    });
    if (url === '/api/chatgpt/model') return response(200, { ready: true, selectedModel: 'model-slug' });
    throw new Error('unexpected request');
  });

  assert.equal((await api.getChatGPTStatus()).selectedModel, 'model-slug');
  assert.equal((await api.saveChatGPTModel('model-slug')).ready, true);
  assert.equal(requests[1].options.method, 'PUT');
  assert.deepEqual(JSON.parse(requests[1].options.body), { model: 'model-slug' });
  assert.equal(requests[1].options.body.includes('token'), false);
});

test('frontend disconnect and forget requests use their dedicated account routes', async () => {
  const requests = [];
  const api = loadApi(async (url, options = {}) => {
    requests.push({ url, options });
    return response(200, { connected: false, savedAccount: url.endsWith('/session') });
  });

  assert.equal((await api.disconnectChatGPT()).savedAccount, true);
  assert.equal((await api.forgetChatGPTAccount()).savedAccount, false);
  assert.deepEqual(requests.map(request => [request.url, request.options.method]), [
    ['/api/chatgpt/session', 'DELETE'],
    ['/api/chatgpt/account', 'DELETE'],
  ]);
});

test('frontend surfaces safe server failures', async () => {
  const api = loadApi(async () => response(403, { error: 'Reconnect ChatGPT and approve subscription use.' }));
  await assert.rejects(api.getChatGPTStatus(), /Reconnect ChatGPT/);
});

test('subscription UI covers connect, reconnect, selection, disconnect, and replacement states', () => {
  for (const id of [
    'chatgpt-settings-modal', 'chatgpt-connect', 'chatgpt-new-account', 'chatgpt-model',
    'chatgpt-model-save', 'chatgpt-disconnect', 'chatgpt-forget',
  ]) {
    assert.match(indexSource, new RegExp(`id="${id}"`));
  }
  assert.match(appSource, /Continue with ChatGPT/);
  assert.match(appSource, /Reconnect ChatGPT/);
  assert.match(appSource, /Use another account/);
  assert.match(appSource, /plan permission is missing/i);
  assert.match(appSource, /sign-in request expired/i);
  assert.match(appSource, /sign-in was declined/i);
  assert.doesNotMatch(indexSource, /API key|agent-provider|agent-model/);
  assert.doesNotMatch(appSource, /getAgentSettings|saveAgentSettings|FALLBACK_PROVIDERS/);
});
