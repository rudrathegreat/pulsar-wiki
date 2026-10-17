'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const pages = [{ name: 'timing' }, { name: 'magnetar' }, { name: 'telescope' }];
const graph = {
  nodes: [{ id: 'timing', group: 3 }, { id: 'magnetar', group: 1 }, { id: 'telescope', group: 4 }],
  edges: [{ source: 'timing', target: 'telescope' }, { source: 'timing', target: 'magnetar' }],
};

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function loadClient(search = async () => []) {
  const elements = new Map();
  const timers = new Map();
  const graphDraws = [];
  let timerId = 0;
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', innerHTML: '', textContent: '', handlers: {}, attributes: {},
      addEventListener(type, handler) { this.handlers[type] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
      contains() { return true; },
      querySelectorAll() { return []; },
    });
    return elements.get(id);
  }
  const context = {
    api: { search, getGraph: async () => graph, getWikiList: async () => pages,
      getWikiPage: async () => ({ content: '# Timing' }) },
    document: { getElementById: element, querySelectorAll: () => [] },
    window: {}, location: { pathname: '/wiki/timing', hash: '' }, history: { pushState() {} },
    stripEmoji: value => String(value),
    normalizeWikiPageName: value => value,
    wikiPath: value => `/wiki/${value}`,
    escHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    renderMd: value => value, typesetMath() {},
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    graphDraws,
  };
  vm.createContext(context);
  const refreshStart = source.indexOf('async function refreshWiki()');
  const refreshSource = source.slice(refreshStart, source.indexOf('\n}', refreshStart) + 2);
  vm.runInContext(`${source.slice(source.indexOf('const state ='), source.indexOf('const GROUP_COLORS'))}
    ${refreshSource}
    showPanel = name => { state.panel = name; };
    function drawGraph(data) { graphDraws.push(filteredWikiGraph(data)); }
    globalThis.client = { state, buildSidebar, renderSidebar, filteredWikiGraph, openPage, refreshWiki };
  `, context);
  const client = context.client;
  client.state.wikiPages = pages;
  client.state.graphData = graph;
  client.renderSidebar();
  return {
    ...client, context, graphDraws, element,
    input(value) {
      element('search-input').value = value;
      element('search-input').handlers.input();
    },
    flushSearch() {
      const callbacks = [...timers.values()];
      timers.clear();
      return Promise.all(callbacks.map(callback => callback()));
    },
    visiblePages() {
      return [...element('sidebar-body').innerHTML.matchAll(/data-page="([^"]+)"/g)].map(match => match[1]);
    },
  };
}

test('wiki search filters the grouped sidebar using content matches as well as names', async () => {
  const requests = [];
  const client = loadClient(async query => {
    requests.push(query);
    return [{ page: 'telescope', matches: [{ text: 'Precise pulse measurement' }] }];
  });
  client.input('  pulse measurement  ');
  assert.equal(client.element('wiki-search-status').textContent, 'Searching wiki...');
  assert.equal(client.element('sidebar-body').attributes['aria-busy'], 'true');
  await client.flushSearch();
  assert.deepEqual(requests, ['pulse measurement']);
  assert.deepEqual(client.visiblePages(), ['telescope']);
  assert.match(client.element('sidebar-body').innerHTML, /Facilities &amp; Tools/);
  assert.doesNotMatch(client.element('sidebar-body').innerHTML, /Foundational Physics|Observational Methods/);
  assert.equal(client.element('sidebar-body').attributes['aria-busy'], 'false');
  assert.equal(client.graphDraws.length, 0);
});

test('the open all-pages graph keeps matching nodes and links between visible endpoints', async () => {
  const client = loadClient(async () => [{ page: 'timing' }, { page: 'telescope' }]);
  client.state.panel = 'graph';
  const original = JSON.stringify(graph);
  client.input('pulse');
  await client.flushSearch();
  const filtered = client.graphDraws.at(-1);
  assert.deepEqual(Array.from(filtered.nodes, node => node.id), ['timing', 'telescope']);
  assert.deepEqual(Array.from(filtered.edges, edge => `${edge.source}:${edge.target}`), ['timing:telescope']);
  assert.equal(JSON.stringify(graph), original);

  client.input('');
  assert.deepEqual(client.visiblePages().sort(), pages.map(page => page.name).sort());
  assert.equal(client.graphDraws.at(-1), graph);
  assert.equal(client.element('wiki-search-status').textContent, '');
});

test('Escape cancels pending work and restores all pages even after an in-flight response', async () => {
  const request = deferred();
  const client = loadClient(() => request.promise);
  client.input('timing');
  const pending = client.flushSearch();
  client.element('search-input').handlers.keydown({ key: 'Escape' });
  request.resolve([{ page: 'timing' }]);
  await pending;
  assert.equal(client.element('search-input').value, '');
  assert.equal(client.state.wikiSearch.pages, null);
  assert.equal(client.visiblePages().length, 3);
});

test('rapid typing debounces requests and older responses cannot replace newer matches', async () => {
  const first = deferred();
  const second = deferred();
  const requests = [];
  const client = loadClient(query => {
    requests.push(query);
    return requests.length === 1 ? first.promise : second.promise;
  });
  client.input('ti');
  client.input('timing');
  const pendingFirst = client.flushSearch();
  client.input('magnetar');
  const pendingSecond = client.flushSearch();
  second.resolve([{ page: 'magnetar' }]);
  await pendingSecond;
  first.resolve([{ page: 'timing' }]);
  await pendingFirst;
  assert.deepEqual(requests, ['timing', 'magnetar']);
  assert.deepEqual(client.visiblePages(), ['magnetar']);
});

test('no matches and failed searches have inline status and allow recovery', async () => {
  const client = loadClient(async query => {
    if (query === 'failure') throw new Error('Unavailable');
    return [];
  });
  client.state.panel = 'graph';
  client.input('missing');
  await client.flushSearch();
  assert.match(client.element('wiki-search-status').textContent, /No pages match/);
  assert.deepEqual(client.visiblePages(), []);
  assert.equal(client.graphDraws.at(-1).nodes.length, 0);
  client.input('failure');
  await client.flushSearch();
  assert.match(client.element('wiki-search-status').textContent, /Search could not be completed.*Unavailable/);
  assert.equal(client.state.wikiSearch.pending, false);
  client.input('   ');
  assert.equal(client.visiblePages().length, 3);
  assert.equal(client.element('wiki-search-status').textContent, '');
});

test('opening a matching sidebar page retains the search and its filtered pages', async () => {
  const client = loadClient(async () => [{ page: 'timing' }]);
  client.input('timing');
  await client.flushSearch();
  await client.openPage('timing');
  assert.equal(client.state.currentPage, 'timing');
  assert.equal(client.element('search-input').value, 'timing');
  assert.deepEqual(client.visiblePages(), ['timing']);
});

test('wiki refresh preserves the open graph and reapplies the active search', async () => {
  let searches = 0;
  const client = loadClient(async () => { searches++; return [{ page: 'timing' }]; });
  client.state.currentPage = 'magnetar';
  client.state.panel = 'graph';
  client.input('timing');
  await client.flushSearch();
  await client.refreshWiki();
  await client.flushSearch();
  assert.equal(searches, 2);
  assert.equal(client.state.panel, 'graph');
  assert.equal(client.state.currentPage, 'magnetar');
  assert.deepEqual(client.visiblePages(), ['timing']);
  assert.deepEqual(Array.from(client.graphDraws.at(-1).nodes, node => node.id), ['timing']);
});
