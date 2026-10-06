'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const marked = require('marked');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const styleSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

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

function loadClientHelpers() {
  const helperSource = appSource.slice(0, appSource.indexOf('const state ='));
  const context = {
    fetch: async () => response(200),
    XMLHttpRequest: class {},
    marked,
    escHtml(value) {
      return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
  };
  vm.createContext(context);
  vm.runInContext(`${helperSource}\nglobalThis.__helpers = { stripEmoji, normalizeWikiPageName, wikiPath, wikiPageFromPath, preprocessMd, renderMd, wikiLinkForInAppNavigation };`, context);
  return context.__helpers;
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

test('wiki page names produce canonical direct routes and legacy names normalize safely', () => {
  const helpers = loadClientHelpers();
  assert.equal(helpers.normalizeWikiPageName(' Pulsar Timing '), 'pulsar-timing');
  assert.equal(helpers.normalizeWikiPageName('Pulsar 🔭'), 'pulsar');
  assert.equal(helpers.wikiPath('Pulsar Timing'), '/wiki/pulsar-timing');
  assert.equal(helpers.wikiPageFromPath('/wiki/Pulsar%20Timing'), 'pulsar-timing');
  assert.equal(helpers.wikiPageFromPath('/wiki/pulsar/extra'), null);
});

test('a plain app launch opens the wiki index after explicit routes are considered', () => {
  const bootstrap = appSource.slice(appSource.indexOf('(async function init()'));
  const directRoute = bootstrap.indexOf('handleWikiRoute({ migrateLegacyHash: true })');
  const fileRoute = bootstrap.indexOf("hash.startsWith('#file/')");
  const defaultRoute = bootstrap.indexOf("openPage('index', { historyMode: 'replace' })");
  assert.ok(directRoute !== -1 && directRoute < defaultRoute);
  assert.ok(fileRoute !== -1 && fileRoute < defaultRoute);
  assert.match(bootstrap, /if \(!routedToWiki\) await openPage\('index', \{ historyMode: 'replace' \}\)/);
});

test('emoji sanitizer removes emojis from plain text and Markdown before rendering', () => {
  const helpers = loadClientHelpers();
  assert.equal(helpers.stripEmoji('Pulsar 🔭 timing'), 'Pulsar timing');
  assert.equal(helpers.preprocessMd('[[Pulsar 🔭|Pulsar 🔭]]'), '[Pulsar](WIKILINK:pulsar)');
});

test('chat wiki links render canonical routes and only plain primary clicks navigate in-app', () => {
  const helpers = loadClientHelpers();
  const html = helpers.renderMd('Here\u2019s the wiki page: [[psr-j0437-4715|PSR J0437\u22124715]].');
  assert.match(html, /href="\/wiki\/psr-j0437-4715"/);
  assert.match(html, /class="wiki-link"/);
  assert.match(html, /data-page="psr-j0437-4715"/);

  const wikiLink = { dataset: { page: 'psr-j0437-4715' } };
  const plainClick = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: { closest: selector => selector === 'a.wiki-link[data-page]' ? wikiLink : null },
  };
  assert.equal(helpers.wikiLinkForInAppNavigation(plainClick), wikiLink);
  assert.equal(helpers.wikiLinkForInAppNavigation({ ...plainClick, ctrlKey: true }), null);
  assert.equal(helpers.wikiLinkForInAppNavigation({ ...plainClick, button: 1 }), null);
  assert.equal(helpers.wikiLinkForInAppNavigation({ ...plainClick, target: { closest: () => null } }), null);

  assert.match(appSource, /handleAiChunk[\s\S]*renderMd\(aiTarget\.buffer\)/);
  assert.match(appSource, /appendChatMsg[\s\S]*renderMd\(text\)/);
  assert.match(appSource, /dom\.chatMessages\.addEventListener\('click', handleChatWikiLink\)/);
});

test('UI source uses only approved palettes and contains no built-in emojis', () => {
  const allowed = new Set(['#111', '#1c1c1c', '#222', '#fff', '#eee', '#ccc']);
  const colorSources = `${styleSource}\n${appSource}`;
  for (const color of colorSources.match(/#[0-9a-f]{3,8}\b/gi) || []) {
    assert.ok(allowed.has(color.toLowerCase()), `Unexpected color literal: ${color}`);
  }
  assert.doesNotMatch(colorSources, /rgba\(/i);
  assert.doesNotMatch(`${indexSource}\n${appSource}\n${serverSource}`, /\p{Extended_Pictographic}/u);
  assert.match(indexSource, /href="\/style\.css"/);
  assert.match(indexSource, /src="\/app\.js"/);
});

test('sidebar owns page and source upload controls, with ChatGPT settings in the icon bar', () => {
  assert.match(indexSource, /class="sidebar-actions"/);
  assert.match(indexSource, /New Page/);
  assert.match(indexSource, /Upload Sources/);
  assert.match(indexSource, /id="chatgpt-settings-button"/);
  assert.match(indexSource, /class="icon-btn chatgpt-settings-icon"/);
  assert.doesNotMatch(indexSource, /id="topbar"/);
  assert.match(styleSource, /#iconbar\s*\{[\s\S]*background: var\(--surface\)/);
  assert.match(styleSource, /#sidebar\s*\{[\s\S]*background: var\(--surface\)/);
});

test('chat switches the existing sidebar instead of rendering a third chat sidebar', () => {
  assert.match(indexSource, /id="sidebar-chat" class="chat-sidebar sidebar-pane"/);
  const chatPanel = indexSource.split('<!-- Chat panel -->')[1].split('<!-- Graph panel -->')[0];
  assert.doesNotMatch(chatPanel, /<aside class="chat-sidebar"/);
  assert.match(appSource, /classList\.toggle\('chat-mode', name === 'chat'\)/);
  assert.match(styleSource, /#sidebar\.chat-mode #sidebar-chat\s*\{\s*display: flex/);
  assert.doesNotMatch(styleSource, /\.chat-sidebar\s*\{[^}]*max-height:\s*132px/s);
});
