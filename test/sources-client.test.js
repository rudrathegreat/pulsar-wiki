'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function client() {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const nodes = new Map();
  const opened = [];
  const timers = new Map();
  const sockets = [];
  let wikiRefreshes = 0;
  let referenceRefreshes = 0;
  let wikiFailure = null;
  let files = [{ name: 'timing.pdf', ext: 'pdf', size: 1024 }, { name: 'notes & "ideas".md', ext: 'md', size: 20 }];
  let failure = null;
  function element(id) {
    assert.ok(ids.has(id), `Missing HTML element: ${id}`);
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        innerHTML: '', textContent: '', hidden: false, handlers: {}, attributes: {},
        classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
        addEventListener(type, handler) { this.handlers[type] = handler; },
        setAttribute(name, value) { this.attributes[name] = value; },
        querySelectorAll() { return []; }, contains() { return true; },
      });
    }
    return nodes.get(id);
  }
  const context = {
    document: { getElementById: element, querySelectorAll() { return []; }, body: { classList: { toggle() {} } } },
    api: { async getRawList() { if (failure) throw failure; return files; } },
    window: { ReferencesEditor: { async open() { referenceRefreshes++; } }, ActiveReading: { close() {}, closeHelper() {}, async open(pdf, name, session) { opened.push({ pdf, name, session }); } } },
    WebSocket: class { constructor() { sockets.push(this); } send() {} },
    setTimeout(callback) { const id = {}; timers.set(id, callback); return id; },
    updateAgentUi() {},
    async refreshWiki() { wikiRefreshes++; if (wikiFailure) throw wikiFailure; },
    location: { pathname: '/', search: '', hash: '' },
    wikiPath: name => `/wiki/${name}`,
    history: { pushState(_state, _title, url) { context.hash = url; Object.assign(context.location, { pathname: new URL(url, 'http://localhost').pathname, hash: new URL(url, 'http://localhost').hash }); } },
    workspaceUrl: url => `${url}?workspace=test-project`,
    stripEmoji: value => String(value),
    escHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  };
  vm.createContext(context);
  const sourceViewStart = source.indexOf('function setSourceView(');
  const sourceView = source.slice(sourceViewStart, source.indexOf('\n}', sourceViewStart) + 2);
  vm.runInContext(`
    ${source.slice(source.indexOf('const state ='), source.indexOf('const PILLAR_LABELS'))}
    ${source.slice(source.indexOf('function fileIcon('), source.indexOf('// Project handover'))}
    ${sourceView}
    ${source.slice(source.indexOf('function setDocumentStatus('), source.indexOf('function clampPdfScale('))}
    ${source.slice(source.indexOf('let workspaceRefreshTimer ='), source.indexOf('\nfunction sendChat('))}
    getPdfLibrary = async () => ({ getDocument: () => ({ promise: Promise.resolve({ numPages: 3 }) }) });
    globalThis.client = { state, showPanel, loadFiles, openRawFile, connectDirectAgentWS };
  `, context);
  return { ...context.client, element, opened, context, sockets,
    get wikiRefreshes() { return wikiRefreshes; }, get referenceRefreshes() { return referenceRefreshes; },
    failWiki(value) { wikiFailure = value; },
    async flushRefresh() { const callbacks = [...timers.values()]; timers.clear(); await Promise.all(callbacks.map(callback => callback())); },
    setFiles(value) { files = value; }, fail(value) { failure = value; } };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('Sources loads saved workspace files into its own sidebar and restores other sidebar modes', async () => {
  const c = client();
  c.showPanel('files');
  assert.equal(c.element('sidebar').classList.contains('sources-mode'), true);
  assert.match(c.element('source-sidebar-status').textContent, /Loading/);
  await settle();
  assert.equal(c.element('source-sidebar-count').textContent, 2);
  assert.match(c.element('source-sidebar-list').innerHTML, /data-source-file="timing.pdf"/);
  assert.match(c.element('source-sidebar-list').innerHTML, /notes &amp; &quot;ideas&quot;.md/);
  c.showPanel('chat');
  assert.equal(c.element('sidebar').classList.contains('sources-mode'), false);
  assert.equal(c.element('sidebar').classList.contains('chat-mode'), true);
  c.showPanel('wiki');
  assert.equal(c.element('sidebar').classList.contains('chat-mode'), false);
});

test('clicking a sidebar PDF opens the AI-assisted reader and keeps the source list with its current file marked', async () => {
  const c = client();
  c.showPanel('files');
  await settle();
  const item = { dataset: { sourceFile: 'timing.pdf' } };
  c.element('source-sidebar-list').handlers.click({ target: { closest() { return item; } } });
  await settle();
  assert.equal(c.state.panel, 'document');
  assert.equal(c.element('sidebar').classList.contains('sources-mode'), true);
  assert.equal(c.opened.length, 1);
  assert.equal(c.opened[0].name, 'timing.pdf');
  assert.equal(c.context.hash, '/#file/timing.pdf');
  assert.match(c.element('source-sidebar-list').innerHTML, /data-source-file="timing.pdf"[^>]*aria-current="true"/);
  assert.match(c.state.currentDocument.url, /workspace=test-project/);
  c.element('source-sidebar-add').handlers.click();
  assert.equal(c.state.panel, 'files');
  assert.equal(c.state.sourceView, 'add');
  await settle();
});

test('opening a document directly populates the source sidebar and newly saved files appear on refresh', async () => {
  const c = client();
  await c.openRawFile('timing.pdf', 'pdf', {}, false);
  assert.match(c.element('source-sidebar-list').innerHTML, /data-source-file="timing.pdf"/);
  c.setFiles([{ name: 'new-paper.pdf', ext: 'pdf', size: 40 }]);
  await c.loadFiles();
  assert.equal(c.element('source-sidebar-count').textContent, 1);
  assert.match(c.element('source-sidebar-list').innerHTML, /new-paper.pdf/);
  assert.doesNotMatch(c.element('source-sidebar-list').innerHTML, /timing.pdf/);
});

test('the sidebar explains empty and failed loads and recovers when Sources is reopened', async () => {
  const c = client();
  c.setFiles([]);
  await c.loadFiles();
  assert.match(c.element('source-sidebar-status').textContent, /No saved sources yet/);
  c.fail(new Error('Server unavailable'));
  c.showPanel('files');
  await settle();
  assert.match(c.element('source-sidebar-status').textContent, /Could not load saved sources: Server unavailable/);
  c.fail(null);
  c.setFiles([{ name: 'recovered.pdf', ext: 'pdf', size: 30 }]);
  c.showPanel('files');
  await settle();
  assert.equal(c.element('source-sidebar-status').textContent, '');
  assert.match(c.element('source-sidebar-list').innerHTML, /recovered.pdf/);
});

test('live file events refresh saved sources in every panel and coalesce import bursts', async () => {
  const c = client();
  await c.loadFiles();
  c.state.panel = 'chat';
  c.connectDirectAgentWS();
  c.setFiles([{ name: 'imported.pdf', ext: 'pdf', size: 40 }]);
  const event = { data: JSON.stringify({ type: 'filechange', event: 'add', path: 'raw/imported.pdf' }) };
  for (let i = 0; i < 5; i++) c.sockets[0].onmessage(event);
  await c.flushRefresh();
  assert.equal(c.wikiRefreshes, 1);
  assert.equal(c.element('source-sidebar-count').textContent, 1);
  assert.match(c.element('source-sidebar-list').innerHTML, /imported.pdf/);
  assert.equal(c.state.panel, 'chat');
  c.setFiles([]);
  c.sockets[0].onmessage({ data: JSON.stringify({ type: 'filechange', event: 'unlink' }) });
  await c.flushRefresh();
  assert.equal(c.element('source-sidebar-count').textContent, 0);
});

test('socket reconnection catches up sources and references even if the wiki refresh fails', async () => {
  const c = client();
  c.state.panel = 'files';
  c.state.sourceView = 'references';
  c.connectDirectAgentWS();
  c.sockets[0].onopen();
  await c.flushRefresh();
  c.sockets[0].onclose();
  await c.flushRefresh(); // reconnect timer
  c.setFiles([{ name: 'added-while-offline.pdf', ext: 'pdf', size: 50 }]);
  c.failWiki(new Error('Wiki unavailable'));
  c.sockets[1].onopen();
  await c.flushRefresh();
  assert.match(c.element('source-sidebar-list').innerHTML, /added-while-offline.pdf/);
  assert.equal(c.referenceRefreshes, 2);
  assert.equal(c.state.sourceView, 'references');
});
