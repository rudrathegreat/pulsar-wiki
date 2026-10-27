'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function client(searchSources) {
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: false, innerHTML: '', classList: { remove() {} }, reportValidity: () => true });
    return nodes.get(id);
  };
  for (const [id, value] of Object.entries({ 'source-search-input': 'pulsar', 'source-sort': 'default', 'source-refereed': 'refereed', 'source-collection': 'all' })) element(id).value = value;
  const context = { $: element, workspaceId: 'one', state: { selectedSourceIds: new Set(), sourcePapers: new Map() }, api: { searchSources }, SOURCE_FILTERS: [],
    dom: { sourceSearchInput: element('source-search-input'), sourceFilterSuggestions: element('suggestions'), sourceSearchStatus: element('status'), sourceResults: element('results') },
    closeSourceDetail() {}, loadSourceKeywords() {}, stripEmoji: String,
    renderSourceResults(results) { context.rendered = results; context.state.sourceResults = results; },
  };
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('async function runSourceSearch('), app.indexOf('function updateFilterSuggestions(')), context);
  return { context, element };
}

test('search sends default and changed controls to the API', async () => {
  const requests = [];
  const c = client(async (...args) => { requests.push(args); return { results: [] }; });
  await c.context.runSourceSearch();
  assert.equal(requests[0][2].sort, 'default');
  assert.equal(requests[0][2].filters.refereed, 'refereed');
  c.element('source-sort').value = 'citations';
  c.element('source-refereed').value = 'all';
  c.element('source-year').value = '2024';
  c.element('source-min-citations').value = '10';
  await c.context.runSourceSearch();
  assert.equal(requests[1][2].sort, 'citations');
  assert.equal(requests[1][2].filters.year, '2024');
  assert.equal(requests[1][2].filters.minCitations, '10');
});

test('late searches cannot replace newer filtered results or errors', async () => {
  const pending = [];
  const c = client(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const first = c.context.runSourceSearch();
  const second = c.context.runSourceSearch();
  pending[1].resolve({ results: ['new'] });
  await second;
  pending[0].resolve({ results: ['old'] });
  await first;
  assert.equal(c.context.rendered[0], 'new');
  const third = c.context.runSourceSearch();
  const fourth = c.context.runSourceSearch();
  pending[3].resolve({ results: ['newest'] });
  await fourth;
  pending[2].reject(new Error('Stale error'));
  await third;
  assert.equal(c.context.rendered[0], 'newest');
  assert.doesNotMatch(c.element('status').textContent, /Stale error/);
});

 test('downloaded filter updates visible results without losing search results', () => {
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: false, textContent: '' });
    return nodes.get(id);
  };
  const results = [{ id: 'saved', downloaded: true }, { id: 'new', downloaded: false }];
  const context = { $: element, state: { selectedSourceIds: new Set(), sourcePapers: new Map() },
    dom: { sourceResultsSection: {}, sourceResults: {} }, window: {},
    resultPaperMarkup: paper => paper.id, updateSourceSelection() {} };
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('function renderSourceResults('), app.indexOf('function updateSourceSelection(')), context);
  element('source-downloaded-filter').value = 'hide';
  context.renderSourceResults(results);
  assert.equal(context.dom.sourceResults.innerHTML, 'new');
  assert.equal(element('source-results-title').textContent, '1 paper found');
  assert.equal(context.state.sourceResults.length, 2);
  context.renderSourceResults([results[0]]);
  assert.match(context.dom.sourceResults.innerHTML, /All results are already downloaded/);
  element('source-downloaded-filter').value = 'all';
  context.renderSourceResults(context.state.sourceResults);
  assert.equal(context.dom.sourceResults.innerHTML, 'saved');
 });
