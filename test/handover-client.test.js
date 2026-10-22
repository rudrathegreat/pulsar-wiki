'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

function client() {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const nodes = new Map();
  function node(id) {
    assert.ok(ids.has(id), `Missing element ${id}`);
    if (!nodes.has(id)) nodes.set(id, {
      value: '', checked: false, hidden: false, disabled: false, textContent: '', attributes: {}, handlers: {},
      classList: { toggle() {} }, focus() {},
      setAttribute(k, v) { this.attributes[k] = v; },
      removeAttribute(k) { delete this.attributes[k]; },
      addEventListener(k, v) { this.handlers[k] = v; },
    });
    return nodes.get(id);
  }
  const toggles = ['wiki', 'raw', 'notebook'].map(type => ({ ...node('handover-next'), dataset: { handoverToggle: type }, handlers: {} }));
  const stages = [1, 2, 3, 4].map(n => ({ dataset: { handoverStage: String(n) }, hidden: n !== 1 }));
  let generate = async () => ({ draft: '# Handover\nEvidence and next steps.' });
  let publish = async () => {};
  const state = { handover: { materials: { wiki: [], raw: [], notebook: [] }, step: 1, selectedPages: new Set(), selectedSources: new Set(), selectedNotebooks: new Set(), generatedInput: '', draft: '', generating: false, publishing: false }, chatgpt: { ready: true } };
  const context = {
    $, state, document: {
      querySelectorAll(selector) {
        if (selector === '[data-handover-toggle]') return toggles;
        if (selector === '[data-handover-stage]') return stages;
        return [];
      }, querySelector(selector) { return toggles.find(button => selector === `[data-handover-toggle="${button.dataset.handoverToggle}"]`) || null; },
    },
    api: { getHandoverNotebooks: async () => ({ notebooks: [{ id: 'book-1', path: 'timing.ipynb', available: true }, { id: 'missing', path: 'missing.ipynb', available: false }] }), getRawList: async () => [], generateHandover: data => generate(data), publishHandover: data => publish(data), getWikiList: async () => [] },
    stripEmoji: String, escHtml: String, renderMd: String, typesetMath() {}, buildSidebar() {},
  };
  function $(id) { return node(id); }
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('// Project handover'), source.indexOf('const SOURCE_FILTERS')), context);
  return { ...context, node, stages, toggles, setGenerate(fn) { generate = fn; }, setPublish(fn) { publish = fn; } };
}

function select(c) {
  c.node('handover-project-name').value = 'Timing campaign';
  c.node('handover-description').value = 'Measure pulsar timing residuals';
  c.node('handover-context').value = 'Finish the analysis';
  c.state.handover.selectedPages.add('pulsar-timing');
  c.advanceHandover();
}

test('handover validates selection and shows one stage at a time while retaining form state', () => {
  const c = client();
  c.advanceHandover();
  assert.equal(c.state.handover.step, 1);
  assert.match(c.node('handover-status').textContent, /project name/);
  c.node('handover-project-name').value = 'Timing campaign';
  c.advanceHandover();
  assert.equal(c.state.handover.step, 1);
  assert.match(c.node('handover-status').textContent, /project description/);
  select(c);
  assert.deepEqual(c.stages.map(s => s.hidden), [true, false, true, true]);
  assert.equal(c.node('handover-back').hidden, false);
  assert.equal(c.node('handover-next').disabled, false);
  c.node('handover-back').handlers.click();
  assert.equal(c.state.handover.step, 1);
  assert.equal(c.node('handover-back').disabled, true);
  assert.equal(c.node('handover-back').hidden, true);
  assert.equal(c.node('handover-context').value, 'Finish the analysis');
  assert.ok(c.state.handover.selectedPages.has('pulsar-timing'));
});

test('generation, review, editing and publication are separate, review-gated stages', async () => {
  const c = client();
  select(c);
  let release;
  c.setGenerate(() => new Promise(resolve => { release = resolve; }));
  const pending = c.advanceHandover();
  assert.equal(c.node('handover-back').disabled, true);
  assert.equal(c.node('handover-drafting').hidden, false);
  assert.equal(c.node('handover-form').hidden, true);
  c.node('handover-back').handlers.click();
  assert.equal(c.state.handover.step, 2);
  release({ draft: '# Reviewed guide' });
  await pending;
  assert.equal(c.state.handover.step, 3);
  assert.equal(c.node('handover-drafting').hidden, true);
  assert.equal(c.node('handover-form').hidden, false);
  assert.deepEqual(c.stages.map(s => s.hidden), [true, true, false, true]);
  assert.equal(c.node('handover-next').disabled, true);
  c.node('handover-reviewed').checked = true;
  c.node('handover-reviewed').handlers.change();
  c.advanceHandover();
  assert.equal(c.state.handover.step, 4);
  assert.equal(c.node('handover-next').hidden, true);
  c.node('handover-back').handlers.click();
  c.node('handover-editor').value = '# Edited guide';
  c.node('handover-editor').handlers.input();
  assert.equal(c.node('handover-reviewed').checked, false);
  assert.equal(c.node('handover-next').disabled, true);
  let published;
  c.setPublish(async content => { published = content; });
  await c.publishHandover();
  assert.equal(published, undefined);
  c.node('handover-reviewed').checked = true;
  c.node('handover-reviewed').handlers.change();
  c.advanceHandover();
  await c.publishHandover();
  assert.equal(published, '# Edited guide');
  assert.equal(c.node('handover-publish').disabled, true);
  assert.match(c.node('handover-status').textContent, /Published/);
});

test('generation failures retain selection and allow retry or Back', async () => {
  const c = client();
  select(c);
  c.setGenerate(async () => { throw new Error('Connection interrupted'); });
  await c.advanceHandover();
  assert.equal(c.state.handover.step, 2);
  assert.equal(c.node('handover-back').disabled, false);
  assert.equal(c.node('handover-next').disabled, false);
  assert.match(c.node('handover-status').textContent, /Connection interrupted/);
  assert.equal(c.node('handover-drafting').hidden, true);
  assert.equal(c.node('handover-status').hidden, false);
  assert.ok(c.state.handover.selectedPages.has('pulsar-timing'));
});


test('notebooks load separately and notebook-only selection generates a draft with project details', async () => {
  const c = client();
  await c.loadHandoverWorkspace();
  assert.match(c.node('handover-notebook-options').innerHTML, /timing.ipynb/);
  assert.doesNotMatch(c.node('handover-notebook-options').innerHTML, /missing.ipynb/);
  select(c);
  c.state.handover.selectedPages.clear();
  c.state.handover.selectedNotebooks.add('book-1');
  let sent;
  let count = 0;
  c.setGenerate(async input => { sent = input; count++; return { draft: '# Notebook handover' }; });
  await c.advanceHandover();
  assert.equal(c.state.handover.step, 3);
  assert.equal(sent.description, 'Measure pulsar timing residuals');
  assert.equal(sent.context, 'Finish the analysis');
  assert.equal(sent.notebooks[0], 'book-1');
  c.node('handover-editor').value = '# My edited notebook guide';
  c.node('handover-editor').handlers.input();
  c.node('handover-back').handlers.click();
  await c.advanceHandover();
  assert.equal(count, 1);
  assert.equal(c.node('handover-editor').value, '# My edited notebook guide');
  c.node('handover-back').handlers.click();
  c.node('handover-back').handlers.click();
  c.node('handover-context').value = 'New deadline';
  await c.advanceHandover();
  await c.advanceHandover();
  assert.equal(count, 2);
  assert.equal(sent.context, 'New deadline');
});

test('empty material selection stays on step 2', async () => {
  const c = client();
  select(c);
  c.state.handover.selectedPages.clear();
  await c.advanceHandover();
  assert.equal(c.state.handover.step, 2);
  assert.match(c.node('handover-status').textContent, /at least one/);
});


test('autocomplete selects matching names, prevents unknown entries, removes selections and selects all beyond 30 pages', () => {
  const c = client();
  c.state.handover.materials.wiki = Array.from({ length: 65 }, (_, i) => ({ name: `page-${i}`, label: `page-${i}` }));
  c.state.handover.materials.raw = [{ name: 'timing.pdf', label: 'timing.pdf' }];
  c.updateHandoverSelection();
  const input = c.node('handover-wiki-input');
  input.value = 'PAGE-3';
  input.handlers.keydown({ key: 'Enter', preventDefault() {} });
  assert.ok(c.state.handover.selectedPages.has('page-3'));
  assert.equal(input.value, '');
  assert.match(c.node('handover-wiki-selected').innerHTML, /Remove page-3/);
  assert.doesNotMatch(c.node('handover-wiki-options').innerHTML, /value="page-3"/);
  input.value = 'unavailable-page';
  c.addHandoverMaterial('wiki', true);
  assert.equal(c.state.handover.selectedPages.size, 1);
  assert.match(c.node('handover-status').textContent, /matching item/);
  c.node('handover-wiki-selected').handlers.click({ target: { closest: () => ({ dataset: { handoverRemove: 'page-3' } }) } });
  assert.equal(c.state.handover.selectedPages.size, 0);
  c.toggles[0].handlers.click();
  assert.equal(c.state.handover.selectedPages.size, 65);
  assert.equal(c.toggles[0].textContent, 'Clear all');
  c.toggles[0].handlers.click();
  assert.equal(c.state.handover.selectedPages.size, 0);
  c.node('handover-file-input').value = 'timing.pdf';
  c.node('handover-file-input').handlers.change();
  assert.ok(c.state.handover.selectedSources.has('timing.pdf'));
});

test('generation opens rendered Markdown for review with editing still available', async () => {
  const c = client();
  select(c);
  await c.advanceHandover();
  assert.equal(c.node('handover-preview').hidden, false);
  assert.equal(c.node('handover-editor').hidden, true);
  assert.match(c.node('handover-preview').innerHTML, /Handover/);
  assert.equal(c.node('handover-status').textContent, '');
  c.node('handover-edit-tab').handlers.click();
  assert.equal(c.node('handover-editor').hidden, false);
  assert.equal(c.node('handover-preview').hidden, true);
});
