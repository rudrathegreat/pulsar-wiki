'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PaperMetadata } = require('../agent/paper-metadata');
const { References } = require('../agent/references');
const { parse } = require('../public/bibtex');

function fixture(t, extract) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsarwiki-metadata-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const rawDir = path.join(rootDir, 'raw');
  fs.mkdirSync(rawDir);
  fs.writeFileSync(path.join(rawDir, 'paper.pdf'), '%PDF-immutable');
  return { rootDir, rawDir, refs: new References({ rootDir, rawDir, metadata: { extract } }) };
}

test('PDF is attached to the connected model and only validated fields are accepted', async t => {
  const { rawDir } = fixture(t);
  let request;
  const metadata = new PaperMetadata({ rawDir, authService: { inferenceConfig: async () => ({ accessToken: 'token', model: 'connected-model' }) }, providerFactory: ({ accessToken }) => {
    assert.equal(accessToken, 'token');
    return { async runTurn(input) {
      request = input;
      return { text: JSON.stringify({ title: 'Timing & clocks', author: ['Doe, Jane', null], year: 'unknown', doi: '10.1/test', url: 'javascript:bad', file: 'evil', note: 'invented' }) };
    } };
  } });
  const result = await metadata.extract('paper.pdf');
  assert.equal(request.model, 'connected-model');
  assert.equal(request.messages[0].content[1].type, 'input_file');
  assert.equal(request.messages[0].content[1].file_data, `data:application/pdf;base64,${Buffer.from('%PDF-immutable').toString('base64')}`);
  assert.deepEqual(result, { title: 'Timing & clocks', author: ['Doe, Jane'], doi: '10.1/test' });
  assert.deepEqual(request.tools, []);
  await assert.rejects(metadata.extract('../paper.pdf'));
});

test('new sources attempt extraction before creating a placeholder and keep partial results', async t => {
  const { refs, rawDir } = fixture(t, async () => {
    assert.equal(refs.read().content, '');
    return { title: 'Timing {clocks}', author: ['Doe, Jane'], volume: '12', pages: '1--9' };
  });
  await refs.syncEnriched();
  const result = parse(refs.read().content);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].fields.title, 'Timing \\{clocks\\}');
  assert.equal(result.entries[0].fields.volume, '12');
  assert.equal(result.entries[0].fields.note, undefined);
  assert.equal(fs.readFileSync(path.join(rawDir, 'paper.pdf'), 'utf8'), '%PDF-immutable');
});

test('existing placeholders retry after failure, preserve manual edits during inference and avoid duplicates', async t => {
  let calls = 0;
  const { refs } = fixture(t, async () => {
    if (++calls === 1) throw new Error('Disconnected');
    const current = refs.read();
    refs.save(`% My comment\n${current.content.replace('@misc{paper,', '@misc{customKey,').replace('title = {paper.pdf}', 'title = {My edited title}').replace('file =', 'doi = {10.manual/value},\n  file =')}`, current.revision);
    return { title: 'AI title', author: ['Author One'], year: '2026', doi: '10.ai/value' };
  });
  await refs.syncEnriched();
  assert.match(refs.read().content, /metadata needs completion/);
  await refs.syncEnriched();
  const result = parse(refs.read().content);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].key, 'customKey');
  assert.equal(result.entries[0].fields.title, 'My edited title');
  assert.equal(result.entries[0].fields.doi, '10.manual/value');
  assert.equal(result.entries[0].fields.author, 'Author One');
  assert.equal(result.entries[0].fields.note, undefined);
  assert.match(refs.read().content, /^% My comment/);
  await refs.syncEnriched();
  assert.equal(calls, 2);
});

test('empty extraction retains the fallback and complete import metadata needs no AI', async t => {
  let calls = 0;
  const { refs } = fixture(t, async () => { calls++; return {}; });
  await refs.enrich([{ name: 'paper.pdf' }]);
  assert.match(refs.read().content, /metadata needs completion/);
  await refs.enrich([{ name: 'complete.pdf', title: 'Complete title', authors: ['Author'], year: '2026' }]);
  assert.equal(calls, 1);
  assert.equal(parse(refs.read().content).entries.length, 2);
});

test('recovery preserves inline comments and custom notes with trailing commas', async t => {
  const { refs } = fixture(t, async () => ({ title: 'Recovered', author: ['Author'], year: '2026', journal: 'Journal' }));
  const original = '@misc{custom,\n  title = {paper.pdf} % keep title comment\n  , file = {raw/paper.pdf},\n  note = {My own note}, % keep last comment\n}\n';
  refs.save(original, refs.read().revision);
  await refs.syncEnriched();
  const content = refs.read().content;
  const result = parse(content);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.entries[0].fields.title, 'Recovered');
  assert.equal(result.entries[0].fields.note, 'My own note');
  assert.equal(result.entries[0].fields.journal, 'Journal');
  assert.match(content, /% keep title comment/);
  assert.match(content, /% keep last comment/);
});

test('discovery waits for asynchronous bibliography updates before finishing an import', async t => {
  const { SourceDiscoveryService } = require('../agent/source-discovery');
  const { rawDir } = fixture(t);
  let release;
  const service = new SourceDiscoveryService({ rawDir, onImport: () => new Promise(resolve => { release = resolve; }) });
  service.remember([{ id: 'one', title: 'One' }]);
  service.downloadPdf = async source => ({ name: 'paper.pdf', source });
  let done = false;
  const importing = service.import(['one']).then(result => { done = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(done, false);
  release();
  assert.equal((await importing).imported.length, 1);
});
