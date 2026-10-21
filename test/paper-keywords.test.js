'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { PaperKeywords } = require('../agent/paper-keywords');

const paper = { id: 'paper1', title: 'Pulsar clocks', abstract: 'We measure millisecond pulsar timing noise.', pdfUrl: 'https://arxiv.org/pdf/1234.56789' };

test('keywords use only the abstract and reuse concurrent and repeated requests', async () => {
  let calls = 0;
  const service = new PaperKeywords({
    authService: { async inferenceConfig() { return { accessToken: 'test', model: 'selected-model' }; } },
    providerFactory: () => ({ async runTurn(request) {
      calls++;
      assert.equal(request.model, 'selected-model');
      assert.deepEqual(JSON.parse(request.messages[0].text), { title: paper.title, abstract: calls === 1 ? paper.abstract : 'An updated abstract.' });
      assert.deepEqual(request.tools, []);
      return { text: '["Pulsar timing", "pulsar timing", "Timing noise", "Millisecond pulsars"]' };
    } }),
  });
  const [first, second] = await Promise.all([service.generate(paper), service.generate(paper)]);
  assert.deepEqual(first, { keywords: ['pulsar timing', 'Timing noise', 'Millisecond pulsars'], keywordBasis: 'abstract' });
  assert.deepEqual(second, first);
  assert.deepEqual(await service.generate({ ...paper, id: 'other-provider' }), first);
  assert.equal(calls, 1);
  await service.generate({ ...paper, abstract: 'An updated abstract.' });
  assert.equal(calls, 2);
});

test('missing abstracts skip inference; provider failures and invalid output remain retryable', async () => {
  let calls = 0;
  const service = new PaperKeywords({
    authService: { async inferenceConfig() { return { accessToken: 'test', model: 'selected' }; } },
    providerFactory: () => ({ async runTurn() {
      calls++;
      if (calls === 1) throw new Error('Connect ChatGPT');
      return { text: calls === 2 ? '{}' : '["Pulsar timing"]' };
    } }),
  });
  await assert.rejects(service.generate({ ...paper, abstract: '' }), /No abstract/);
  assert.equal(calls, 0);
  await assert.rejects(service.generate(paper), /Connect ChatGPT/);
  await assert.rejects(service.generate(paper), /could not be generated/);
  assert.deepEqual((await service.generate(paper)).keywords, ['Pulsar timing']);
});

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
function client(results, api) {
  const nodes = new Map(results.map(paper => [`source-keywords-${paper.id}`, { innerHTML: '' }]));
  const context = { workspaceId: 'one', state: { sourceResults: results }, api, stripEmoji: String,
    escHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    $: id => nodes.get(id),
  };
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('function sourceTopicTags('), app.indexOf('function resultPaperMarkup(')), context);
  return { context, nodes };
}

test('keyword updates escape text and preserve the rest of each result', async () => {
  const results = [{ ...paper }, { ...paper, id: 'missing', abstract: '' }];
  const { context, nodes } = client(results, { async getSourceKeywords(id) {
    assert.equal(id, paper.id);
    return { keywords: ['<script>alert(1)</script>'], keywordBasis: 'abstract' };
  } });
  assert.match(context.sourceKeywordMarkup(results[0]), /Generating keywords/);
  assert.match(context.sourceKeywordMarkup(results[1]), /No abstract/);
  await context.loadSourceKeywords(results);
  assert.match(nodes.get('source-keywords-paper1').innerHTML, /AI keywords · abstract/);
  assert.match(nodes.get('source-keywords-paper1').innerHTML, /&lt;script&gt;/);
});

test('stale keyword responses cannot update another workspace or launch more requests', async () => {
  const results = Array.from({ length: 7 }, (_, i) => ({ ...paper, id: String(i) }));
  const pending = [];
  const { context, nodes } = client(results, { getSourceKeywords() { return new Promise(resolve => pending.push(resolve)); } });
  const work = context.loadSourceKeywords(results);
  assert.equal(pending.length, 3);
  context.workspaceId = 'two';
  pending.forEach(resolve => resolve({ keywords: ['Timing'] }));
  await work;
  assert.equal(pending.length, 3);
  assert.ok([...nodes.values()].every(node => node.innerHTML === ''));
});
