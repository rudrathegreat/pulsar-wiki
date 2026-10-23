'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const app = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
const paper = { id: 'one', title: '<Pulsar clocks>', authors: ['A', 'B', 'C', 'D'], publication: 'Timing journal', abstract: 'Timing & noise', keywords: ['Pulsars'], canImport: true };
function client(getRelatedSources = async () => ({ groups: [] })) {
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', hidden: false, disabled: false, focus() {}, classList: { toggle() {} } });
    return nodes.get(id);
  };
  const context = { workspaceId: 'workspace1', state: { sourceResults: [paper], sourcePapers: new Map([[paper.id, paper]]), sourcePaperHistory: [], sourceDetailRequest: 0, selectedSourceIds: new Set() },
    api: { getRelatedSources, async getSourceKeywords() { return { keywords: ['Timing'] }; } },
    stripEmoji: String, escHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), $: element,
    dom: { sourceResultsSection: element('results-section'), sourceResults: element('results'), sourceSelectedCount: element('count'), sourceImportSelected: element('import') },
  };
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('function formatPaperDate('), app.indexOf('async function runSourceSearch(')), context);
  vm.runInContext(app.slice(app.indexOf('async function importSelectedSources('), app.indexOf('function monitorSourceJob(')), context);
  context.dom.sourceJobStatus = element('job-status');
  context.loadFiles = async () => {};
  context.setSourceView = () => {};
  return { context, element };
}
test('paper cards show citation counts and distinguish missing counts from zero', () => {
  const c = client();
  for (const [citationCount, expected] of [[8, '8 citations'], [1, '1 citation'], [0, '0 citations'], [null, 'Citations unavailable'], [undefined, 'Citations unavailable']]) {
    const markup = c.context.resultPaperMarkup({ ...paper, citationCount });
    assert.ok(markup.includes(`<p class="source-result-citations">${expected}</p>`));
  }
});

test('direct import uses only the open paper and preserves other selections', async () => {
  const c = client();
  c.context.state.selectedSourceIds.add('other');
  await c.context.showSourceDetail('one');
  let importedIds;
  let finish;
  c.context.api.importSources = ids => {
    importedIds = [...ids];
    return new Promise(resolve => { finish = resolve; });
  };
  assert.equal(c.element('source-paper-import-current').disabled, false);
  const importing = c.context.importCurrentSource();
  assert.deepEqual(importedIds, ['one']);
  assert.equal(c.element('source-paper-import-current').disabled, true);
  assert.equal(c.element('source-paper-import').disabled, true);
  await c.context.importSelectedSources();
  assert.deepEqual(importedIds, ['one']);
  finish({ imported: [paper] });
  await importing;
  assert.equal(c.context.state.selectedSourceIds.has('other'), true);
  assert.equal(c.element('source-paper-import-current').disabled, false);
});
test('direct import follows nested navigation and rejects unavailable papers', async () => {
  const c = client();
  c.context.state.sourcePapers.set('two', { ...paper, id: 'two', canImport: false });
  await c.context.showSourceDetail('two');
  assert.equal(c.element('source-paper-import-current').disabled, true);
  c.context.api.importSources = () => { assert.fail('Unavailable paper must not import'); };
  await c.context.importCurrentSource();
  await c.context.showSourceDetail('one');
  let importedIds;
  c.context.api.importSources = async ids => { importedIds = [...ids]; throw new Error('Download failed'); };
  await c.context.importCurrentSource();
  assert.deepEqual(importedIds, ['one']);
  assert.equal(c.element('source-paper-import-current').disabled, false);
  assert.equal(c.element('job-status').textContent, 'Download failed');
});
test('paper details show full metadata and the same cards in references and cited in', async () => {
  const related = { ...paper, id: 'two', title: 'Referenced paper' };
  const c = client(async () => ({ groups: [{ key: 'references', results: [related] }, { key: 'citations', results: [] }] }));
  await c.context.showSourceDetail('one');
  assert.equal(c.element('source-search-page').hidden, true);
  assert.equal(c.element('source-paper-page').hidden, false);
  const metadata = c.element('source-paper-metadata').innerHTML;
  assert.match(metadata, /&lt;Pulsar clocks&gt;/);
  assert.match(metadata, /A, B, C, D/);
  assert.match(metadata, /Timing journal/);
  assert.match(metadata, /Timing &amp; noise/);
  assert.match(metadata, /<h3>Keywords<\/h3>/);
  const groups = c.element('source-paper-relations').innerHTML;
  assert.match(groups, /<h3>References<\/h3>/);
  assert.match(groups, /<h3>Cited in<\/h3>/);
  assert.match(groups, /class="source-result"/);
  assert.match(groups, /data-source-preview="two"/);
  assert.match(groups, /No records available/);
  assert.doesNotMatch(groups, /source-result-detail|Shared research topics/);
  await c.context.showSourceDetail('two');
  assert.equal(c.context.state.sourcePaperHistory[0], 'one');
  assert.match(c.element('source-paper-back').textContent, /previous paper/);
  c.context.state.selectedSourceIds.add('two');
  c.context.closeSourceDetail();
  assert.equal(c.element('source-search-page').hidden, false);
  assert.equal(c.element('source-paper-page').hidden, true);
  assert.equal(c.context.state.selectedSourceIds.has('two'), true);
  assert.equal(c.context.state.sourceResults[0].id, 'one');
});
test('paper details provide the displayed paper identifiers to citation lookup', async () => {
  const c = client(async (id, identity) => {
    assert.equal(id, paper.id);
    assert.equal(identity, paper);
    return { groups: [] };
  });
  await c.context.showSourceDetail(paper.id);
});
test('late relation success and failure cannot overwrite a newer paper or workspace', async () => {
  const pending = [];
  const c = client(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  c.context.state.sourcePapers.set('two', { ...paper, id: 'two' });
  const first = c.context.showSourceDetail('one');
  const second = c.context.showSourceDetail('two');
  pending[1].resolve({ groups: [{ key: 'references', results: [], error: 'Current paper status' }] });
  await second;
  const expected = c.element('source-paper-relations').innerHTML;
  pending[0].reject(new Error('Old paper failure'));
  await first;
  assert.equal(c.element('source-paper-relations').innerHTML, expected);
  const third = c.context.showSourceDetail('one');
  c.context.workspaceId = 'workspace2';
  pending[2].resolve({ groups: [{ key: 'references', results: [], error: 'Stale workspace' }] });
  await third;
  assert.doesNotMatch(c.element('source-paper-relations').innerHTML, /Stale workspace/);
});
test('failed relations provide an escaped retry action', async () => {
  const c = client(async () => { throw new Error('<Unavailable>'); });
  await c.context.showSourceDetail('one');
  assert.match(c.element('source-paper-relations').innerHTML, /&lt;Unavailable&gt;/);
  assert.match(c.element('source-paper-relations').innerHTML, /data-source-preview="one">Retry/);
});
