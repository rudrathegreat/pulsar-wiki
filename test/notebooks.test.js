'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { NotebookStore, blankNotebook } = require('../agent/notebook-store');
const { NotebookRuntime } = require('../agent/notebook-runtime');
const { NotebookService } = require('../agent/notebook-service');
const { createNotebookRouter } = require('../agent/notebook-router');
const { WikiTools } = require('../agent/wiki-tools');
const { ReadingStore } = require('../agent/reading-store');
const { ReadingService } = require('../agent/reading-service');

function fixture(t, overrides = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsar-notebooks-'));
  const dataDir = path.join(rootDir, '.pulsarwiki'); const rawDir = path.join(rootDir, 'raw'); const wikiDir = path.join(rootDir, 'wiki');
  for (const dir of [dataDir, rawDir, wikiDir]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(rawDir, 'data.csv'), 'time,residual\n1,2\n');
  fs.writeFileSync(path.join(rawDir, 'paper.txt'), 'The method assumes stable rotation.');
  fs.writeFileSync(path.join(wikiDir, 'timing.md'), '# Timing\n\nA recorded assumption.');
  const wikiTools = new WikiTools({ rootDir, dataDir, rawDir, wikiDir });
  const readingService = new ReadingService({ store: new ReadingStore({ dataDir: path.join(dataDir, 'reading') }), wikiTools });
  const store = new NotebookStore({ rootDir, dataDir }); const runtime = new NotebookRuntime({ store });
  const calls = [];
  const service = new NotebookService({ store, runtime, wikiTools, readingService, authService: { async inferenceConfig() { return { accessToken: 'never-persist-this-token', model: 'mock-model' }; } }, providerFactory: () => ({ async runTurn(input) { calls.push(input); return { text: 'The analysis explicitly assumed stable rotation [N:1].' }; } }), ...overrides });
  t.after(async () => { await service.close(); readingService.close(); fs.rmSync(rootDir, { recursive: true, force: true }); });
  return { rootDir, dataDir, rawDir, wikiDir, wikiTools, readingService, store, runtime, service, calls };
}
function analysis() { const book = blankNotebook(); book.cells[0].source = 'Assumption: stable rotation. Excluded observations have calibration drift.'; book.cells.push({ id: 'fit-code', cell_type: 'code', metadata: {}, source: 'print(2 + 2)', outputs: [{ output_type: 'stream', name: 'stdout', text: '4\n' }], execution_count: 1 }); return book; }
async function waitRecall(service, id) { for (let i = 0; i < 100; i++) { const task = service.task(id); if (!['queued', 'running'].includes(task.status)) return task; await new Promise(resolve => setTimeout(resolve, 5)); } throw Error('Recall did not finish'); }

test('new notebooks receive editable observation sections once, while imports and existing files retain their cells', t => {
  const f = fixture(t);
  const entry = f.service.create({ name: 'observations.ipynb' });
  const notebook = f.store.read(entry.id).notebook;
  assert.deepEqual(notebook.cells.map(cell => [cell.cell_type, cell.source.trim()]), [
    ['markdown', '# Title'], ['markdown', '## Objective'],
    ['markdown', '## Live notes'], ['markdown', '## Preliminary analysis'],
  ]);
  assert.equal(new Set(notebook.cells.map(cell => cell.id)).size, 4);
  const another = f.store.create('another.ipynb');
  assert.ok(f.store.read(another.id).notebook.cells.every(cell => !notebook.cells.some(old => old.id === cell.id)));
  notebook.cells = [];
  f.store.savePath(entry.path, notebook, 1);
  f.store.sync();
  assert.deepEqual(f.store.read(entry.id).notebook.cells, [], 'deleting the template is permanent');
  const imported = f.store.create('imported.ipynb', blankNotebook());
  assert.equal(f.store.read(imported.id).notebook.cells.length, 1);
  fs.writeFileSync(f.store.path('external.ipynb'), JSON.stringify(blankNotebook()));
  const external = f.store.sync().find(book => book.path === 'external.ipynb');
  assert.equal(f.store.read(external.id).notebook.cells.length, 1);
});

test('notebooks round-trip standard cells and outputs, deduplicate saves, and retain immutable history', t => {
  const f = fixture(t); const entry = f.store.create('scratch.ipynb', analysis());
  const first = f.store.read(entry.id); const unchanged = f.store.savePath(entry.path, first.notebook, 1);
  assert.equal(unchanged.revision, 1);
  first.notebook.cells[0].source = 'Updated assumption.';
  const updated = f.store.savePath(entry.path, first.notebook, 1);
  assert.equal(updated.revision, 2); assert.match(f.store.read(entry.id, 1).notebook.cells[0].source, /stable rotation/);
  assert.equal(f.store.read(entry.id, 2).notebook.cells[1].outputs[0].text, '4\n');
  const reopened = new NotebookStore({ rootDir: f.rootDir, dataDir: f.dataDir });
  assert.equal(reopened.read(entry.id).revision, 2);
});

test('notebook writes reject path traversal, malformed files, stale revisions and external changes', t => {
  const f = fixture(t); const entry = f.store.create('analysis.ipynb', analysis());
  for (const name of ['../raw/paper.ipynb', '/absolute.ipynb', 'folder/../../escape.ipynb', 'C:/escape.ipynb', 'folder\\escape.ipynb']) assert.throws(() => f.store.create(name), /path/i);
  assert.throws(() => f.store.create('bad.ipynb', { cells: [] }), /valid/);
  assert.throws(() => f.store.savePath(entry.path, analysis(), 0), /changed/);
  const disk = f.store.read(entry.id).notebook; disk.cells[0].source = 'Outside edit'; fs.writeFileSync(f.store.path(entry.path), JSON.stringify(disk));
  assert.throws(() => f.store.savePath(entry.path, analysis(), 1), /outside/);
  f.store.sync(); assert.equal(f.store.entry(entry.id).revision, 2); assert.equal(f.store.read(entry.id).notebook.cells[0].source, 'Outside edit');
});

test('failed history commit rolls back the notebook and does not create a revision', t => {
  const f = fixture(t); const entry = f.store.create('analysis.ipynb', analysis()); const before = fs.readFileSync(f.store.path(entry.path));
  let fail = true; f.store.fs = { ...fs, renameSync(from, to) { if (to === f.store.file && fail) { fail = false; throw Error('disk full'); } return fs.renameSync(from, to); } };
  const changed = f.store.read(entry.id).notebook; changed.cells[0].source = 'Do not commit';
  assert.throws(() => f.store.savePath(entry.path, changed, 1), /could not be saved/);
  assert.deepEqual(fs.readFileSync(f.store.path(entry.path)), before); assert.equal(f.store.entry(entry.id).revision, 1); assert.equal(fs.existsSync(f.store.snapshotPath(entry.id, 2)), false);
});

test('renaming, deleting cells and restoring preserve historical evidence and create a new revision', t => {
  const f = fixture(t); const entry = f.store.create('before.ipynb', analysis()); const originalCell = f.store.read(entry.id).notebook.cells[0].id;
  f.store.rename(entry.id, 'after.ipynb', 1);
  const book = f.store.read(entry.id).notebook; book.cells = []; f.store.savePath('after.ipynb', book, 1);
  assert.equal(f.store.read(entry.id, 1).notebook.cells[0].id, originalCell);
  f.store.restore(entry.id, 1, 2); assert.equal(f.store.entry(entry.id).revision, 3); assert.equal(f.store.read(entry.id).notebook.cells[0].id, originalCell);
  f.store.checkpoint(entry.id, 3, 'Before the next fit'); assert.equal(f.store.entry(entry.id).history.at(-1).label, 'Before the next fit');
  fs.renameSync(f.store.path('after.ipynb'), f.store.path('external-rename.ipynb')); f.store.sync(); assert.equal(f.store.entry(entry.id).path, 'external-rename.ipynb');
  fs.unlinkSync(f.store.path('external-rename.ipynb')); assert.equal(f.store.list()[0].available, false); assert.equal(f.store.read(entry.id, 1).revision, 1);
});

test('importing raw notebooks creates an independent editable copy and never writes the source', t => {
  const f = fixture(t); const input = JSON.stringify(analysis()); fs.writeFileSync(path.join(f.rawDir, 'source.ipynb'), input);
  const copy = f.service.create({ name: 'editable.ipynb', source: 'source.ipynb' }); f.store.checkpoint(copy.id, 1, 'Editable copy');
  assert.equal(fs.readFileSync(path.join(f.rawDir, 'source.ipynb'), 'utf8'), input); assert.equal(f.store.read(copy.id).revision, 2);
});

test('passage transfer preserves exact text, source revisions and only explicitly selected comments', async t => {
  const f = fixture(t); const { document } = await f.readingService.openDocument('paper.txt'); const exact = 'The method assumes stable rotation.';
  const highlight = await f.readingService.createHighlight({ documentId: document.id, kind: 'text', color: 'yellow', text: exact, categories: [], anchors: [{ page: 1, label: '1', exact, start: 0, end: exact.length, rects: [[0, 0, 10, 10]] }] });
  const checked = f.readingService.saveAnnotation({ highlightId: highlight.id, text: 'Included interpretation' }); f.readingService.saveAnnotation({ highlightId: highlight.id, text: 'Private unchecked comment' });
  const book = f.store.create('analysis.ipynb', analysis()); const afterCellId = f.store.read(book.id).notebook.cells[0].id;
  const result = await f.service.transfer(book.id, { kind: 'passages', revision: 1, afterCellId, highlightIds: [highlight.id], highlightRevisions: { [highlight.id]: 1 }, annotationIds: [checked.id] });
  const cells = f.store.read(book.id).notebook.cells; const inserted = cells[1];
  assert.equal(result.revision, 2); assert.equal(inserted.id, result.insertedCellIds[0]); assert.ok(inserted.source.includes(`> ${exact}`)); assert.ok(inserted.source.includes(`/#reading/${document.id}/${highlight.id}?revision=1`));
  assert.match(inserted.source, /Included interpretation/); assert.doesNotMatch(JSON.stringify(inserted), /Private unchecked/);
  await assert.rejects(f.service.transfer(book.id, { kind: 'passages', revision: 1, highlightIds: [highlight.id] }), /changed/);
  assert.equal(fs.readFileSync(path.join(f.rawDir, 'paper.txt'), 'utf8'), exact);
});

test('wiki references and dataset associations carry immutable source context without publishing', async t => {
  const f = fixture(t); const book = f.store.create('analysis.ipynb', analysis()); const before = fs.readFileSync(path.join(f.wikiDir, 'timing.md'));
  await f.service.transfer(book.id, { kind: 'wiki', page: 'timing', revision: 1, text: 'A recorded assumption.' });
  const cell = f.store.read(book.id).notebook.cells.at(-1); assert.match(cell.source, /\/wiki\/timing/); assert.equal(cell.metadata.pulsarwiki.content, before.toString());
  await f.service.associate(book.id, { revision: 2, name: 'data.csv' }); const source = f.store.read(book.id).notebook.metadata.pulsarwiki.sources[0]; assert.equal(source.hash.length, 64);
  assert.deepEqual(fs.readFileSync(path.join(f.wikiDir, 'timing.md')), before); assert.equal(f.store.entry(book.id).revision, 3);
});

test('recall finds deleted historical cells, isolates workspaces, and returns exact evidence references', async t => {
  const f = fixture(t); const book = f.store.create('analysis.ipynb', analysis()); const prior = f.store.read(book.id).notebook; const originalCell = prior.cells[0].id;
  prior.cells = []; f.store.savePath(book.path, prior, 1); f.store.rename(book.id, 'renamed.ipynb', 2);
  const task = await f.service.recall({ query: 'stable rotation' }); const completed = await waitRecall(f.service, task.id);
  assert.equal(completed.status, 'completed'); assert.equal(completed.evidence[0].revision, 1); assert.ok(completed.evidence[0].url.includes(`revision=1&cell=${originalCell}`));
  assert.equal(f.calls[0].tools.length, 0); assert.match(f.calls[0].instructions, /inferences/); assert.doesNotMatch(fs.readFileSync(f.store.file, 'utf8'), /never-persist-this-token/);
  const separate = fixture(t); assert.equal(separate.service.search('stable rotation').length, 0);
});

test('recall rejects invented references, supports original-evidence retry and does not execute code', async t => {
  const f = fixture(t); const book = f.store.create('analysis.ipynb', analysis()); const before = fs.readFileSync(f.store.path(book.path));
  f.service.providerFactory = () => ({ async runTurn() { return { text: 'Unsupported evidence [N:999].' }; } });
  const task = await f.service.recall({ query: 'stable rotation' }); const failed = await waitRecall(f.service, task.id); assert.equal(failed.status, 'failed');
  const original = failed.evidence; const modified = f.store.read(book.id).notebook; modified.cells[0].source = 'A different assumption.'; f.store.savePath(book.path, modified, 1);
  f.service.providerFactory = () => ({ async runTurn() { return { text: 'An earlier cell recorded stable rotation [N:1].' }; } });
  const retried = await f.service.retryRecall(task.id); const completed = await waitRecall(f.service, retried.id); assert.deepEqual(completed.evidence, original); assert.equal(completed.status, 'completed');
  assert.equal(f.store.read(book.id, 1).notebook.cells[1].execution_count, 1); assert.notDeepEqual(fs.readFileSync(f.store.path(book.path)), before);
});

test('cancelled and interrupted recalls preserve their evidence, and no matches require no AI connection', async t => {
  const f = fixture(t); f.store.create('analysis.ipynb', analysis());
  f.service.providerFactory = () => ({ async runTurn({ signal }) { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); throw Error('stopped'); } });
  const task = await f.service.recall({ query: 'stable rotation' }); await new Promise(resolve => setImmediate(resolve)); f.service.cancelRecall(task.id);
  const cancelled = await waitRecall(f.service, task.id); assert.equal(cancelled.status, 'cancelled'); assert.ok(cancelled.evidence.length);
  f.service.authService = { inferenceConfig() { throw Error('No connection'); } };
  const empty = await f.service.recall({ query: 'unrecorded-phenomenon' }); assert.equal(empty.status, 'completed'); assert.equal(empty.evidence.length, 0);
});

test('history export includes outputs, provenance and run records but source bytes only by explicit selection', async t => {
  const f = fixture(t); const book = f.store.create('analysis.ipynb', analysis()); await f.service.associate(book.id, { name: 'data.csv', revision: 1 });
  const bundle = f.service.export(book.id); assert.equal(bundle.snapshots.length, 2); assert.equal(bundle.sources.length, 0); assert.equal(bundle.snapshots[0].notebook.cells[1].outputs[0].text, '4\n');
  const withSource = f.service.export(book.id, ['data.csv']); assert.equal(Buffer.from(withSource.sources[0].content, 'base64').toString(), 'time,residual\n1,2\n');
  assert.throws(() => f.service.export(book.id, ['paper.txt']), /associated/);
});

test('notebook routes enforce read sessions, mutation origins, and revision conflicts', async t => {
  const f = fixture(t); const app = express(); app.use(express.json());
  app.use('/api/notebooks', createNotebookRouter({ service: f.service, requireLocalSession(req, res, next) { req.headers['x-test-session'] ? next() : res.sendStatus(403); }, requireLocalMutation(req, res, next) { req.headers['x-test-session'] && req.headers.origin === 'http://localhost' ? next() : res.sendStatus(403); } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/notebooks`;
  assert.equal((await fetch(base)).status, 403);
  assert.equal((await fetch(base, { method: 'POST', headers: { 'x-test-session': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'test.ipynb' }) })).status, 403);
  const response = await fetch(base, { method: 'POST', headers: { 'x-test-session': '1', origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'test.ipynb' }) }); assert.equal(response.status, 201); const book = await response.json();
  const stale = await fetch(`${base}/${book.id}/checkpoints`, { method: 'POST', headers: { 'x-test-session': '1', origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0 }) }); assert.equal(stale.status, 409);
  assert.equal((await fetch(`${base}/${book.id}?revision=1`, { headers: { 'x-test-session': '1' } })).status, 200);
});
