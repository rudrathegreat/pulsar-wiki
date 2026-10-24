'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function client(initial = '/wiki/timing') {
  const location = {};
  const entries = [initial];
  let position = 0;
  const handlers = {};
  const opened = [];
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { classList: { toggle() {} }, setAttribute() {} });
    return nodes.get(id);
  };
  function visit(url) {
    const parsed = new URL(url, 'http://localhost');
    Object.assign(location, { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash });
  }
  visit(initial);
  const context = {
    location,
    document: { body: element('body'), getElementById: element, querySelectorAll: () => [] },
    window: { addEventListener: (type, listener) => { handlers[type] = listener; },
      ResearchNotebooks: { show() {}, async route(hash) { if (!hash.startsWith('#notebook/')) return false; opened.push(hash); return true; } },
      ActiveReading: { closeHelper() {}, async route(hash) { if (!hash.startsWith('#reading/')) return false; opened.push(hash); return true; } },
      ReferencesEditor: { open() { opened.push('references'); } },
    },
    history: {
      pushState(_state, _title, url) { entries.splice(++position); entries.push(url); visit(url); },
      replaceState(_state, _title, url) { entries[position] = url; visit(url); },
    },
    api: { getRawList: async () => [{ name: 'paper ?#.md', ext: 'md' }] },
    renderSourceSidebar() {}, loadFiles: async () => {}, showGraph() {}, loadHandoverWorkspace() {}, highlightSidebarItem() {},
    async openPage(page, options = {}) {
      opened.push(page);
      context.client.state.currentPage = page;
      context.client.updateAppHistory(`/wiki/${page}`, options.historyMode);
      context.client.showPanel('wiki', { historyMode: 'none' });
    },
    async openRawFile(name) { opened.push(name); context.client.showPanel('document'); },
  };
  vm.createContext(context);
  const helperStart = source.indexOf('const EMOJI_PATTERN');
  const helperEnd = source.indexOf('function preprocessMd');
  const stateStart = source.indexOf('const state =');
  const stateEnd = source.indexOf('const PILLAR_LABELS');
  const viewStart = source.indexOf('function setSourceView(');
  const viewEnd = source.indexOf('function formatPaperDate');
  const routeStart = source.indexOf('function handleWikiRoute(');
  const routeEnd = source.indexOf("window.addEventListener('hashchange', restoreAppRoute);") + "window.addEventListener('hashchange', restoreAppRoute);".length;
  vm.runInContext(`${source.slice(helperStart, helperEnd)}
    ${source.slice(stateStart, stateEnd)}
    ${source.slice(viewStart, viewEnd)}
    ${source.slice(routeStart, routeEnd)}
    globalThis.client = { state, showPanel, setSourceView, handleAppRoute, updateAppHistory };
  `, context);
  return { ...context.client, location, entries, opened, async travel(delta) {
    position += delta; visit(entries[position]);
    await handlers.popstate({ type: 'popstate' }); await handlers.hashchange({ type: 'hashchange' });
  } };
}

for (const panel of ['chat', 'graph', 'handover', 'notebooks']) {
  test(`${panel} has a URL and reload restores that tab`, async () => {
    const c = client(); c.showPanel(panel);
    assert.equal(c.entries.at(-1), `/#${panel}`);
    const reloaded = client(c.entries.at(-1));
    assert.equal(await reloaded.handleAppRoute(), true);
    assert.equal(reloaded.state.panel, panel);
    assert.equal(reloaded.entries.length, 1);
  });
}

for (const view of ['add', 'upload', 'saved', 'references']) {
  test(`Sources ${view} survives reload even with an older wiki pathname`, async () => {
    const c = client(); c.showPanel('files'); c.setSourceView(view);
    assert.equal(c.entries.at(-1), `/#sources/${view}`);
    for (const url of [c.entries.at(-1), `/wiki/timing#sources/${view}`]) {
      const reloaded = client(url);
      assert.equal(await reloaded.handleAppRoute(), true);
      assert.equal(reloaded.state.panel, 'files');
      assert.equal(reloaded.state.sourceView, view);
      assert.equal(reloaded.opened.includes('timing'), false);
      assert.equal(reloaded.entries.length, 1);
    }
  });
}

test('Back and Forward restore tabs once without adding history entries', async () => {
  const c = client(); c.showPanel('chat'); c.showPanel('files'); c.setSourceView('references'); c.showPanel('graph');
  const count = c.entries.length;
  await c.travel(-1);
  assert.equal(c.state.panel, 'files'); assert.equal(c.state.sourceView, 'references');
  assert.equal(c.opened.filter(value => value === 'references').length, 2);
  await c.travel(-1); assert.equal(c.state.sourceView, 'add');
  await c.travel(-1); assert.equal(c.state.panel, 'chat');
  await c.travel(-1); assert.equal(c.state.panel, 'wiki'); assert.equal(c.state.currentPage, 'timing');
  await c.travel(1); assert.equal(c.state.panel, 'chat');
  assert.equal(c.entries.length, count);
});

test('reselecting a tab does not add duplicate history entries', () => {
  const c = client(); c.showPanel('chat'); c.showPanel('chat');
  assert.equal(c.entries.length, 2);
});

test('explicit documents, reading passages and notebooks take priority over wiki paths', async () => {
  for (const hash of ['#file/paper%20%3F%23.md', '#reading/document/passage', '#notebook/book']) {
    const c = client(`/wiki/timing${hash}`);
    assert.equal(await c.handleAppRoute(), true);
    assert.equal(c.opened.includes('timing'), false);
    assert.equal(c.opened.length, 1);
    assert.equal(c.entries.length, 1);
  }
});

test('legacy wiki and source links remain supported and malformed filenames are safe', async () => {
  const wiki = client('/#wiki/Pulsar%20Timing');
  assert.equal(await wiki.handleAppRoute(), true);
  assert.equal(wiki.location.pathname, '/wiki/pulsar-timing');
  for (const hash of ['#sources', '#files']) {
    const c = client(`/${hash}`); assert.equal(await c.handleAppRoute(), true);
    assert.equal(c.state.panel, 'files'); assert.equal(c.state.sourceView, 'add');
  }
  assert.equal(await client('/#file/%ZZ').handleAppRoute(), false);
});

test('Back restores a previously visited URL after a new programmatic navigation', async () => {
  const c = client(); c.showPanel('chat'); c.showPanel('graph');
  await c.travel(-1); assert.equal(c.state.panel, 'chat');
  c.showPanel('handover');
  await c.travel(-1); assert.equal(c.state.panel, 'chat');
});
