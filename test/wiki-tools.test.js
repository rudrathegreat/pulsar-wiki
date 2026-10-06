'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WikiTools, WikiToolError } = require('../agent/wiki-tools');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsarwiki-tools-'));
  const wiki = path.join(root, 'wiki');
  const raw = path.join(root, 'raw');
  const data = path.join(root, 'data');
  fs.mkdirSync(wiki);
  fs.mkdirSync(raw);
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(wiki, 'index.md'), '# Index\n');
  fs.writeFileSync(path.join(wiki, 'log.md'), '# Wiki log\n');
  fs.writeFileSync(path.join(wiki, 'timing.md'), '# Timing\nThe timing residual is useful.\n');
  fs.writeFileSync(path.join(raw, 'paper.txt'), 'A source document about timing residuals.');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, wiki, raw, data, tools: new WikiTools({ rootDir: root, wikiDir: wiki, rawDir: raw, dataDir: data }) };
}

test('wiki tools provide bounded reads and reject traversal', async t => {
  const { tools } = fixture(t);
  const page = tools.readWikiPage({ name: 'timing', offset: 2, maxChars: 8 });
  assert.equal(page.content, 'Timing\nT');
  assert.equal(page.hasMore, true);
  assert.deepEqual(tools.searchWiki({ query: 'residual' }).results[0].page, 'timing');
  assert.equal((await tools.readSource({ name: 'paper.txt', maxChars: 7 })).content, 'A sourc');
  assert.throws(() => tools.readWikiPage({ name: '../raw/paper' }), error => error instanceof WikiToolError && error.code === 'invalid-page-name');
  await assert.rejects(
    tools.readSource({ name: '../paper.txt' }),
    error => error instanceof WikiToolError && error.code === 'invalid-name'
  );
});

test('wiki tools tolerate common provider argument aliases and treat a missing page as an absence check', t => {
  const { tools } = fixture(t);
  const missing = tools.readWikiPage({ pageName: 'hellings-downs-function' });
  assert.deepEqual(missing, {
    name: 'hellings-downs-function', exists: false, offset: 0, content: '', hasMore: false, totalChars: 0,
  });
  assert.equal(tools.readWikiPage({ filename: 'timing.md' }).exists, true);
  assert.equal(tools.searchWiki({ q: 'residual' }).results[0].page, 'timing');
  assert.equal(tools.searchWiki({ searchQuery: 'residual' }).results[0].page, 'timing');
});

test('wiki writes require an index update, preserve raw, append log, and roll back a failed batch', t => {
  const { wiki, raw, tools } = fixture(t);
  assert.throws(
    () => tools.applyWikiChanges({ changes: [{ name: 'new-page', content: '# New' }], logSummary: 'new page' }),
    error => error instanceof WikiToolError && error.code === 'index-update-required'
  );
  assert.equal(fs.existsSync(path.join(raw, 'new-page.md')), false);

  const result = tools.applyWikiChanges({
    changes: [
      { name: 'new-page', content: '# New\n' },
      { name: 'index', content: '# Index\n- [[new-page]]\n' },
    ],
    logSummary: 'Added the new page.',
  });
  assert.deepEqual(result.changedPages, ['new-page', 'index']);
  assert.match(fs.readFileSync(path.join(wiki, 'log.md'), 'utf8'), /Added the new page/);
  assert.throws(
    () => tools.applyWikiChanges({
      changes: [{ name: 'raw-write', content: '# no' }, { name: 'index', content: '# Index' }, { name: 'log', content: 'no' }],
      logSummary: 'bad write',
    }),
    error => error instanceof WikiToolError && error.code === 'invalid-page-name'
  );
  assert.equal(fs.existsSync(path.join(raw, 'raw-write.md')), false);
});
