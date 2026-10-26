'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function client(storage = new Map()) {
  function element() {
    return {
      children: [], handlers: {}, append(...items) { this.children.push(...items); },
      appendChild(item) { this.append(item); }, setAttribute() {},
      addEventListener(type, handler) { this.handlers[type] = handler; },
      remove() { this.removed = true; },
    };
  }
  const container = element();
  const selected = [], routes = [], panels = [], opened = [];
  const context = {
    document: { createElement: element }, $: () => container,
    workspaceId: 'workspace-a', state: {}, stripEmoji: String,
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    async selectThread(id) { selected.push(id); },
    showPanel(panel) { panels.push(panel); }, updateAppHistory(route) { routes.push(route); },
    refreshThreads: async () => {},
    async openRawFile(...args) { opened.push(args); },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function notifySourceAdded('), source.indexOf('function monitorSourceJob(')), context);
  return { context, container, selected, routes, panels, opened, notify: context.notifySourceJob };
}
const job = { id: 'job-1', status: 'completed', threadId: 'review-1', files: [{ name: '<paper>.pdf' }] };

test('source added notification opens the exact source in the reading workspace', async () => {
  const c = client();
  const file = { name: '<paper> & timing.pdf' };
  c.context.notifySourceAdded(file);
  const card = c.container.children[0], link = card.children[0];
  assert.equal(link.href, `/#file/${encodeURIComponent(file.name)}`);
  assert.equal(link.children[0].textContent, 'Source added');
  assert.equal(link.children[1].textContent, file.name);
  assert.match(link.children[2].textContent, /AI-assisted reading workspace/);
  await link.handlers.click({ preventDefault() {} });
  assert.deepEqual(c.opened, [[file.name, 'pdf', file]]);
  assert.equal(card.removed, true);
});

test('source added notifications support dismissal and modified link clicks', async () => {
  const c = client();
  c.context.notifySourceAdded({ name: 'one.pdf' });
  c.context.notifySourceAdded({ name: 'two.pdf' });
  const [first, second] = c.container.children;
  await first.children[0].handlers.click({ ctrlKey: true, preventDefault() { assert.fail('Keep native link behavior'); } });
  assert.equal(c.opened.length, 0);
  assert.ok(!first.removed);
  second.children[1].handlers.click();
  assert.equal(second.removed, true);
});

test('each completed review appears once and opens its exact chat', async () => {
  const c = client();
  c.notify({ ...job, status: 'running' });
  assert.equal(c.container.children.length, 0);
  c.notify(job);
  c.notify(job);
  c.notify({ ...job, id: 'job-2', threadId: 'review-2' });
  assert.equal(c.container.children.length, 2);
  const card = c.container.children[0], link = card.children[0];
  assert.equal(link.href, '/#chat/review-1');
  assert.equal(link.children[1].textContent, '<paper>.pdf');
  await link.handlers.click({ preventDefault() {} });
  assert.deepEqual(c.selected, ['review-1']);
  assert.deepEqual(c.panels, ['chat']);
  assert.deepEqual(c.routes, ['/#chat/review-1']);
  assert.equal(card.removed, true);
});

test('dismissals survive reconnects and reloads and are scoped to the workspace', () => {
  const storage = new Map(), c = client(storage);
  c.notify(job);
  const card = c.container.children[0];
  card.children[1].handlers.click();
  assert.equal(card.removed, true);
  const reloaded = client(storage);
  reloaded.notify(job);
  assert.equal(reloaded.container.children.length, 0);
  reloaded.context.workspaceId = 'workspace-b';
  reloaded.notify(job);
  assert.equal(reloaded.container.children.length, 1);
});

test('an active turn or a failed chat load keeps the notification available', async () => {
  const c = client();
  c.notify(job);
  const card = c.container.children[0], link = card.children[0];
  c.context.state.aiRunning = true;
  await link.handlers.click({ preventDefault() {} });
  assert.equal(c.selected.length, 0);
  assert.ok(!card.removed);
  c.context.state.aiRunning = false;
  c.context.selectThread = async () => { throw new Error('Unavailable'); };
  await link.handlers.click({ preventDefault() {} });
  assert.match(link.children[2].textContent, /Unavailable.*retry/);
  assert.ok(!card.removed);
});

test('ingest completion broadcasts only to clients in the source workspace', async () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const received = [], other = [], disconnected = [];
  const workspace = { agentService: { createThread: () => ({ id: 'review-1' }), runTurn: async () => {} } };
  const context = {
    chatgptAuth: { status: async () => ({ ready: true }) }, currentWorkspace: () => workspace,
    CHAT_TIMEOUT_MS: 1000, AbortSignal, WebSocket: { OPEN: 1 },
    wss: { clients: [
      { workspace, readyState: 1, send: payload => received.push(JSON.parse(payload)) },
      { workspace: {}, readyState: 1, send: payload => other.push(payload) },
      { workspace, readyState: 3, send: payload => disconnected.push(payload) },
    ] },
  };
  vm.createContext(context);
  vm.runInContext(server.slice(server.indexOf('function publicIngestJob('), server.indexOf('async function queueSourceIngest(')), context);
  await context.runIngestJob({ ...job, status: 'queued' });
  assert.equal(received[0].type, 'source-job');
  assert.equal(received[0].job.status, 'completed');
  assert.equal(received[0].job.threadId, 'review-1');
  assert.equal(other.length, 0);
  assert.equal(disconnected.length, 0);
});

test('reconnecting clients receive completed reviews but not running jobs or other workspaces', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const received = [];
  const start = server.indexOf('  // Replay finished reviews');
  const end = server.indexOf('\n  const stopActiveTurn', start);
  vm.runInNewContext(server.slice(start, end), {
    workspace: { ingestJobs: new Map([
      ['done', job], ['running', { ...job, id: 'running', status: 'running' }],
    ]) },
    publicIngestJob: value => value, send: value => received.push(value),
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].job.threadId, 'review-1');
});

test('background review events bypass the active-chat message filter', () => {
  const start = source.indexOf('  ws.onmessage = ({ data }) => {');
  const end = source.indexOf('\n  };', start) + '\n  };'.length;
  const received = [];
  const ws = {};
  vm.runInNewContext(source.slice(start, end), {
    ws, state: { ws, activeThreadId: 'another-chat' }, notifySourceJob: value => received.push(value),
  });
  ws.onmessage({ data: JSON.stringify({ type: 'source-job', threadId: job.threadId, job }) });
  assert.equal(received.length, 1);
  assert.equal(received[0].threadId, 'review-1');
});
