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

test('wiki tools extract notebook code, Markdown, and plain-text outputs for handovers', async t => {
  const { raw, tools } = fixture(t);
  fs.writeFileSync(path.join(raw, 'analysis.ipynb'), JSON.stringify({
    cells: [
      { cell_type: 'markdown', source: ['# Method\n', 'Barycentre the observations.'], outputs: [] },
      { cell_type: 'code', source: ['fit_timing_model(data)'], outputs: [{ text: ['RMS: 1.2 us'] }] },
    ],
  }));
  const notebook = await tools.readSource({ name: 'analysis.ipynb' });
  assert.match(notebook.content, /Cell 1 \(markdown\)/);
  assert.match(notebook.content, /fit_timing_model\(data\)/);
  assert.match(notebook.content, /RMS: 1\.2 us/);
});

test('PDF source extraction loads standard fonts without warnings and preserves the source', async t => {
  const { raw, tools } = fixture(t);
  const stream = 'BT /F1 12 Tf 72 720 Td (Standard font paper) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = Buffer.from(source);
  const file = path.join(raw, 'standard-font.pdf');
  fs.writeFileSync(file, bytes);
  const warnings = [];
  t.mock.method(console, 'log', (...args) => warnings.push(args.join(' ')));
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));

  const extracted = await tools.readSource({ name: 'standard-font.pdf' });
  assert.match(extracted.content, /Standard font paper/);
  assert.deepEqual(warnings, [], 'PDF extraction must load bundled font data without warnings');
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal((await tools.readSource({ name: 'standard-font.pdf' })).content, extracted.content);
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
