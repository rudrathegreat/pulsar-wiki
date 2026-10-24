'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'workspaces.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function client({ active = null, remembered = null, fetchHandler } = {}) {
  const nodes = new Map();
  const staticIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  function element() {
    const classes = new Set();
    return { children: [], listeners: {}, value: '', open: false, textContent: '', disabled: false,
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
      addEventListener(type, listener) { this.listeners[type] = listener; },
      append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
      setAttribute() {}, removeAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; },
    };
  }
  const document = { body: element(), createElement: element, getElementById(id) {
    assert.ok(staticIds.has(id), `Missing HTML element: ${id}`);
    if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id);
  } };
  document.body.classList.add('workspace-loading');
  const requests = []; const stored = new Map(remembered ? [['pw-workspace', remembered]] : []);
  const storage = { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) };
  const navigations = [];
  const context = { document, window: {}, sessionStorage: storage, localStorage: storage, workspaceId: remembered,
    location: { reload: () => navigations.push('reload'), assign: url => navigations.push(url) },
    async workspaceFetch(url, options) {
      requests.push({ url, options, id: context.workspaceId });
      return fetchHandler ? fetchHandler(url, options) : { active, recent: [], defaultPath: 'C:\\Included project' };
    },
    readJsonResponse: async response => response,
  };
  vm.createContext(context); vm.runInContext(source, context);
  return { context, document, nodes, requests, stored, navigations, initialize: context.window.initializeWorkspaceUi };
}

test('startup requires a workspace before connecting chat or loading project data', async () => {
  const c = client();
  assert.equal(await c.initialize(), false);
  assert.equal(c.document.body.classList.contains('workspace-ready'), false);
  assert.equal(c.document.body.classList.contains('workspace-loading'), false);
  assert.equal(c.stored.get('pw-workspace'), 'closed');
  assert.deepEqual(c.requests.map(request => request.url), ['/api/workspaces']);
  const bootstrap = appSource.slice(appSource.indexOf('(async function init()'));
  assert.ok(bootstrap.indexOf('if (!await initializeWorkspaceUi()) return;') < bootstrap.indexOf('connectDirectAgentWS()'));
  assert.ok(html.indexOf('src="/workspaces.js"') < html.indexOf('src="/app.js"'));
});

test('refresh and sign-in restoration reuse the selected workspace without browsing again', async () => {
  const active = { id: 'project-one', name: 'Timing study', path: 'E:\\Research\\Timing study' };
  const c = client({ active, remembered: active.id });
  assert.equal(await c.initialize(), true);
  assert.equal(c.requests[0].id, active.id);
  assert.equal(c.document.body.classList.contains('workspace-ready'), true);
  assert.equal(c.nodes.get('workspace-current-path').textContent, active.path);
  assert.equal(c.context.document.title, 'Timing study — PulsarWiki');
  assert.equal(c.stored.get('pw-workspace'), active.id);
  assert.equal(c.requests.length, 1);
});

test('opening a folder remembers its identity and recent path before reloading', async () => {
  const active = { id: 'new-project', name: 'New project', path: 'E:\\Research\\New project' };
  const c = client({ fetchHandler: async url => url.endsWith('/open') ? { active } : { active: null, recent: [], defaultPath: active.path } });
  await c.initialize();
  await c.nodes.get('workspace-path-form').listeners.submit({ preventDefault() {} });
  assert.equal(c.stored.get('pw-workspace'), active.id);
  assert.equal(JSON.parse(c.stored.get('pw-recent-workspaces'))[0].path, active.path);
  assert.deepEqual(c.navigations, ['reload']);
  assert.equal(JSON.parse(c.requests.at(-1).options.body).path, active.path);
  assert.equal(c.document.body.classList.contains('workspace-loading'), true, 'keep loading visible until navigation');
});

test('first folder opening shows loading while the request is pending and recovers on failure', async () => {
  let rejectOpen;
  const c = client({ fetchHandler: url => url.endsWith('/open')
    ? new Promise((resolve, reject) => { rejectOpen = reject; })
    : { active: null, recent: [], defaultPath: 'E:\\Research' } });
  await c.initialize();
  const opening = c.nodes.get('workspace-path-form').listeners.submit({ preventDefault() {} });
  assert.equal(c.document.body.classList.contains('workspace-loading'), true);
  assert.equal(c.nodes.get('app').inert, true);
  assert.equal(c.nodes.get('workspace-welcome').inert, true);
  rejectOpen(new Error('Cannot open this folder.'));
  await opening;
  assert.equal(c.document.body.classList.contains('workspace-loading'), false);
  assert.equal(c.nodes.get('workspace-welcome').inert, false);
  assert.equal(c.nodes.get('workspace-error').textContent, 'Cannot open this folder.');
  assert.equal(c.nodes.get('workspace-submit').disabled, false);
});

test('project loading lasts through initial data and clears on success or failure', async () => {
  for (const fail of [false, true]) {
    const active = { id: 'project', name: 'Project', path: 'E:\\Research' };
    const c = client({ active });
    let finishPages;
    const pages = new Promise(resolve => { finishPages = resolve; });
    Object.assign(c.context, {
      initializeWorkspaceUi: c.initialize,
      connectDirectAgentWS() {}, URLSearchParams,
      location: { search: '', hash: '' },
      refreshChatGPTStatus: async () => {}, refreshThreads: async () => {},
      api: { getWikiList: () => pages },
      buildSidebar() { if (fail) throw new Error('Could not load pages.'); },
      handleAppRoute: async () => false,
      openPage: async () => {
        assert.equal(c.document.body.classList.contains('workspace-loading'), true);
      },
      $: id => c.document.getElementById(id), stripEmoji: text => text,
    });
    const initialized = vm.runInContext(appSource.slice(appSource.indexOf('(async function init()')), c.context);
    // Let workspace discovery and the preceding startup requests finish.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(c.document.body.classList.contains('workspace-loading'), true);
    finishPages([]);
    await initialized;
    assert.equal(c.document.body.classList.contains('workspace-loading'), false);
    assert.equal(c.nodes.get('app').inert, false);
    if (fail) assert.match(c.nodes.get('workspace-status').textContent, /Could not load pages/);
  }
});

test('a failed folder open leaves the current selection intact and displays the error', async () => {
  const active = { id: 'current-project', name: 'Current project', path: 'E:\\Research' };
  const c = client({ active, remembered: active.id, fetchHandler: async url => {
    if (url.endsWith('/open')) throw new Error('The folder is unavailable.');
    return { active, recent: [], defaultPath: active.path };
  } });
  await c.initialize();
  c.document.getElementById('workspace-path').value = 'E:\\Missing folder';
  await c.nodes.get('workspace-path-form').listeners.submit({ preventDefault() {} });
  assert.equal(c.stored.get('pw-workspace'), active.id);
  assert.equal(c.nodes.get('workspace-status').textContent, 'The folder is unavailable.');
  assert.deepEqual(c.navigations, []);
});

test('all browser requests and document URLs pin the tab workspace', async () => {
  const requests = [];
  const context = { marked: { setOptions() {} }, sessionStorage: { getItem: () => 'tab-project' }, window: {},
    fetch: async (...args) => { requests.push(args); return { ok: true, text: async () => '[]' }; },
  };
  vm.createContext(context);
  vm.runInContext(appSource.slice(0, appSource.indexOf('const state =')) + '\nglobalThis.api = api;', context);
  await context.api.getWikiList();
  await context.api.createThread('New chat');
  await context.window.WorkspaceSession.fetch('/api/reading');
  for (const [, options] of requests) assert.equal(options.headers['X-PulsarWiki-Workspace'], 'tab-project');
  assert.equal(context.window.WorkspaceSession.url('/api/raw/paper.pdf'), '/api/raw/paper.pdf?workspace=tab-project');
  assert.equal(context.window.WorkspaceSession.url('/api/reading/export?format=json'), '/api/reading/export?format=json&workspace=tab-project');
});

test('Browse uses the system dialog and shows the chosen folder before opening it', async () => {
  const selected = 'E:\\Research\\Chosen folder';
  const c = client({ fetchHandler: async url => url.endsWith('/pick') ? { path: selected } : { active: null, recent: [], defaultPath: 'E:\\Research' } });
  await c.initialize();
  await c.nodes.get('workspace-open').listeners.click();
  assert.equal(c.nodes.get('workspace-path').value, selected);
  assert.equal(c.stored.get('pw-workspace'), 'closed');
  assert.equal(c.nodes.get('workspace-open').disabled, false);
  assert.deepEqual(c.requests.map(request => request.url), ['/api/workspaces', '/api/workspaces/pick']);
  assert.doesNotMatch(html, /id="workspace-picker"|id="workspace-folders"/);
});

test('cancelling Change folder preserves the active path and selected session', async () => {
  const active = { id: 'current', name: 'Current project', path: 'E:\\Research\\Current' };
  const c = client({ remembered: active.id, fetchHandler: async url => url.endsWith('/pick') ? { path: null } : { active, recent: [], defaultPath: active.path } });
  await c.initialize();
  await c.nodes.get('workspace-change').listeners.click();
  assert.equal(c.nodes.get('workspace-current-path').textContent, active.path);
  assert.equal(c.stored.get('pw-workspace'), active.id);
  assert.deepEqual(c.navigations, []);
});
