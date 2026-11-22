'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { PaperRanking } = require('../agent/paper-ranking');

test('AI ranking uses the question and abstracts and validates the returned order', async () => {
  let output = '[1,0]';
  let input;
  const ranking = new PaperRanking({ authService: { async inferenceConfig() { return { accessToken: 'token', model: 'model' }; } }, providerFactory: () => ({ async runTurn(args) { input = args; return { text: output }; } }) });
  const papers = [{ title: 'Timing', abstract: 'Timing package' }, { title: 'Review', abstract: 'Pulsar overview' }];
  assert.deepEqual(await ranking.rank('what is a pulsar?', papers), [papers[1], papers[0]]);
  assert.deepEqual(JSON.parse(input.messages[0].text), { question: 'what is a pulsar?', papers: papers.map((paper, index) => ({ index, ...paper })) });
  for (const invalid of ['[1,1]', '[0]', '[0,2]', 'invalid']) {
    output = invalid;
    await assert.rejects(ranking.rank('question', papers));
  }
});

test('search planning selects one route and rejects unsupported syntax', async () => {
  let output = '{"type":"reviews","phrase":"pulsar"}';
  const ranking = new PaperRanking({ authService: { async inferenceConfig() { return { accessToken: 'token', model: 'model' }; } }, providerFactory: () => ({ async runTurn() { return { text: output }; } }) });
  assert.deepEqual(await ranking.plan('what is a pulsar?'), { type: 'reviews', phrase: 'pulsar' });
  for (const invalid of ['[]', '{"type":"similar","phrase":"pulsar"}', '{"type":"research","phrase":"pulsar:evil"}', 'null']) {
    output = invalid;
    await assert.rejects(ranking.plan('question'));
  }
});
