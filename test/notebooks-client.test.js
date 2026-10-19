'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'notebooks.js'), 'utf8');
function client(handler) {
  const nodes = new Map(); const events = new Map(); const requests = []; const posts = [];
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  function element(id) {
    return { id, hidden: false, disabled: false, value: '', textContent: '', open: false, listeners: {},
      classList: { contains: () => true },
      set innerHTML(value) { this.html = value; for (const match of value.matchAll(/id="([^"]+)"/g)) ids.add(match[1]); }, get innerHTML() { return this.html || ''; },
      addEventListener(type, callback) { this.listeners[type] = callback; },
      querySelectorAll() { return []; }, showModal() { this.open = true; }, close() { this.open = false; }, removeAttribute(name) { delete this[name]; },
      contentWindow: { postMessage(data, origin) { posts.push({ data, origin }); } },
    };
  }
  const document = { documentElement: { dataset: { theme: 'dark' } }, activeElement: null,
    getElementById(id) { if (!ids.has(id)) return null; if (!nodes.has(id)) nodes.set(id, element(id)); return nodes.get(id); }, addEventListener() {},
  };
  const window = { ActiveReading: { sanitizeHtml: x => x, closeHelper() {} }, addEventListener(type, callback) { events.set(type, callback); } };
  const context = { window, document, crypto, URL, URLSearchParams, setTimeout, clearTimeout, setInterval: () => 1,
    location: { hash: '', origin: 'http://127.0.0.1:3000' }, history: { pushState() {} }, renderMd: x => x, typesetMath() {},
    readJsonResponse: async response => response,
    WorkspaceSession: { async fetch(url, options) { requests.push({ url, options }); return handler(url, options); } },
    showPanel() {},
  };
  vm.createContext(context);
  vm.runInContext(source.replace('window.ResearchNotebooks =', 'window.__test = { n, refresh, open, bridge, flush, preview, renderRecallTasks }; window.ResearchNotebooks ='), context);
  return { ...window.__test, context, nodes, events, requests, posts, api: window.ResearchNotebooks, node: id => document.getElementById(id) };
}
const book = { id: '00000000-0000-0000-0000-000000000001', path: 'scratch.ipynb', revision: 1, history: [{ revision: 1, savedAt: '2026-10-19T00:00:00Z' }], available: true };
const state = () => ({ notebooks: [book], runtime: { state: 'stopped', python: 'python' }, recalls: [], runs: [] });
const snapshot = () => ({ entry: book, notebookId: book.id, revision: 1, savedAt: '2026-10-19T00:00:00Z', notebook: { metadata: { pulsarwiki: {} }, cells: [{ id: 'original-cell', cell_type: 'code', source: '<script>unsafe()</script>', execution_count: 1, outputs: [{ output_type: 'stream', text: '<img src=x onerror=unsafe()>' }, { output_type: 'display_data', data: { 'text/html': '<script>unsafe()</script>', 'image/png': 'aGVsbG8=' } }] }] } });

test('simultaneous notebook opens wait for the same workspace fetch and retain historical cell identity', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const c = client(async url => { if (url === '/api/notebooks') { await gate; return state(); } return snapshot(); });
  const refreshing = c.refresh(); const opening = c.open(book.id, { revision: 1, cellId: 'original-cell', history: false }); release(); await Promise.all([refreshing, opening]);
  assert.equal(c.requests.filter(r => r.url === '/api/notebooks').length, 1);
  assert.equal(c.n.selected, book.id); assert.equal(c.n.historical.revision, 1); assert.equal(c.node('notebook-frame').hidden, true);
  assert.match(c.node('notebook-preview').innerHTML, /data-notebook-cell="original-cell"/);
});

test('historical previews escape code and text outputs and never render active HTML output', async () => {
  const c = client(async () => snapshot()); await c.preview(book.id, 1, 'original-cell'); const output = c.node('notebook-preview').innerHTML;
  assert.match(output, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/); assert.match(output, /&lt;img src=x onerror=unsafe\(\)&gt;/);
  assert.doesNotMatch(output, /<script>|<img src=x/); assert.match(output, /data:image\/png;base64,aGVsbG8=/);
});

test('embedded commands accept replies only from the current frame, exact origin and channel', async () => {
  const c = client(async () => state()); c.n.data = state(); c.n.ready = true; c.n.launch = { origin: 'http://127.0.0.1:9000', channel: 'session-channel' };
  const pending = c.bridge('save'); const requestId = c.posts[0].data.requestId;
  const event = { source: c.node('notebook-frame').contentWindow, origin: c.n.launch.origin, data: { type: 'pulsarwiki-reply', channel: 'session-channel', requestId, result: { path: 'scratch.ipynb', cellId: 'original-cell' } } };
  await c.events.get('message')({ ...event, origin: 'http://evil.example' }); assert.equal(c.n.pending.size, 1);
  await c.events.get('message')({ ...event, source: {} }); assert.equal(c.n.pending.size, 1);
  await c.events.get('message')({ ...event, data: { ...event.data, channel: 'wrong-workspace' } }); assert.equal(c.n.pending.size, 1);
  await c.events.get('message')(event); assert.equal((await pending).cellId, 'original-cell'); assert.equal(c.n.pending.size, 0);
  assert.deepEqual(c.posts.map(p => p.data.command), ['save']);
});

test('workspace departure waits for notebook saves before stopping Python and keeps the folder open on failure', async () => {
  const c = client(async () => ({ ok: true })); c.n.data = { ...state(), runtime: { state: 'running' } }; c.n.ready = true; c.n.launch = { origin: 'http://127.0.0.1:9000', channel: 'session-channel' };
  const leaving = c.api.prepareToLeave(); const requestId = c.posts[0].data.requestId;
  assert.equal(c.requests.length, 0, 'runtime must remain alive until dirty work has saved');
  await c.events.get('message')({ source: c.node('notebook-frame').contentWindow, origin: c.n.launch.origin, data: { type: 'pulsarwiki-reply', channel: 'session-channel', requestId, error: 'Save conflict' } });
  await assert.rejects(leaving, /Save conflict/); assert.equal(c.requests.length, 0); assert.equal(c.n.ready, true);
});

test('recall answers use supplied historical evidence links without inserting or executing cells', () => {
  const c = client(async () => state()); c.node('notebook-tray-body').innerHTML = '<div id="notebook-recall-tasks"></div>';
  c.n.data = { ...state(), recalls: [{ id: 'recall-1', query: 'What was assumed?', status: 'completed', response: 'Stable rotation was assumed [N:1].', createdAt: '2026-10-19T00:00:00Z', evidence: [{ reference: 'N:1', path: 'scratch.ipynb', revision: 1, url: `/#notebook/${book.id}?revision=1&cell=original-cell`, text: 'Assumption: stable rotation.' }] }] };
  c.renderRecallTasks(); const result = c.node('notebook-recall-tasks').innerHTML;
  assert.match(result, /revision=1&(?:amp;)?cell=original-cell/); assert.match(result, /Assumption: stable rotation/); assert.equal(c.posts.length, 0); assert.equal(c.requests.length, 0);
});
