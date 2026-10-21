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
  const steps = [1, 2, 3, 4].map(n => ({ ...node('handover-stage-count'), dataset: { handoverStep: String(n) }, attributes: {} }));
  const stages = [1, 2, 3, 4].map(n => ({ dataset: { handoverStage: String(n) }, hidden: n !== 1 }));
  let generate = async () => ({ draft: '# Handover\nEvidence and next steps.' });
  let publish = async () => {};
  const state = { handover: { step: 1, selectedPages: new Set(), selectedSources: new Set(), draft: '', generating: false, publishing: false }, chatgpt: { ready: true } };
  const context = {
    $, state, document: {
      querySelectorAll(selector) {
        if (selector === '[data-handover-step]') return steps;
        if (selector === '[data-handover-stage]') return stages;
        return [];
      }, querySelector() { return null; },
    },
    api: { generateHandover: data => generate(data), publishHandover: data => publish(data), getWikiList: async () => [] },
    stripEmoji: String, renderMd: String, typesetMath() {}, buildSidebar() {},
  };
  function $(id) { return node(id); }
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('// Project handover'), source.indexOf('const SOURCE_FILTERS')), context);
  return { ...context, node, stages, steps, setGenerate(fn) { generate = fn; }, setPublish(fn) { publish = fn; } };
}

function select(c) {
  c.node('handover-project-name').value = 'Timing campaign';
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
  assert.match(c.node('handover-status').textContent, /at least one/);
  select(c);
  assert.deepEqual(c.stages.map(s => s.hidden), [true, false, true, true]);
  assert.equal(c.steps[1].attributes['aria-current'], 'step');
  assert.equal(c.node('handover-next').disabled, true);
  c.advanceHandover();
  assert.equal(c.state.handover.step, 2);
  c.node('handover-back').handlers.click();
  assert.equal(c.state.handover.step, 1);
  assert.equal(c.node('handover-back').disabled, true);
  assert.equal(c.node('handover-context').value, 'Finish the analysis');
  assert.ok(c.state.handover.selectedPages.has('pulsar-timing'));
});

test('generation, review, editing and publication are separate, review-gated stages', async () => {
  const c = client();
  select(c);
  let release;
  c.setGenerate(() => new Promise(resolve => { release = resolve; }));
  const pending = c.generateHandover();
  assert.equal(c.node('handover-back').disabled, true);
  c.node('handover-back').handlers.click();
  assert.equal(c.state.handover.step, 2);
  release({ draft: '# Reviewed guide' });
  await pending;
  assert.equal(c.state.handover.step, 2);
  assert.equal(c.node('handover-next').disabled, false);
  c.advanceHandover();
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
  await c.generateHandover();
  assert.equal(c.state.handover.step, 2);
  assert.equal(c.node('handover-back').disabled, false);
  assert.equal(c.node('handover-next').disabled, true);
  assert.equal(c.node('handover-generate').disabled, false);
  assert.match(c.node('handover-status').textContent, /Connection interrupted/);
  assert.ok(c.state.handover.selectedPages.has('pulsar-timing'));
});
