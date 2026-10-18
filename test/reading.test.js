'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { ReadingStore, ReadingError, hash } = require('../agent/reading-store');
const { ReadingService, sourceCitations } = require('../agent/reading-service');
const { WikiTools } = require('../agent/wiki-tools');
const { createReadingRouter } = require('../agent/reading-router');
const { createChatGPTAdapter, ProviderError } = require('../agent/providers');

function fixture(t, overrides = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsar-reading-'));
  const rawDir = path.join(rootDir, 'raw'); const wikiDir = path.join(rootDir, 'wiki'); const dataDir = path.join(rootDir, '.pulsarwiki');
  fs.mkdirSync(rawDir); fs.mkdirSync(wikiDir);
  fs.writeFileSync(path.join(rawDir, 'paper.txt'), 'Pulsar timing residuals reveal noise. The method assumes stable rotation.');
  fs.writeFileSync(path.join(rawDir, 'other.txt'), 'An independent measurement challenges the stable rotation assumption.');
  fs.writeFileSync(path.join(wikiDir, 'index.md'), '# Wiki index\n\n- [[timing]]: Timing.\n');
  fs.writeFileSync(path.join(wikiDir, 'timing.md'), '# Timing\n\n**Summary**: Timing.\n\n**Sources**: paper.txt\n\n**Last updated**: 2026-10-15\n\n---\n\nExisting content.\n\n## Related pages\n\n- [[index]]\n');
  const store = new ReadingStore({ dataDir: path.join(dataDir, 'reading') });
  const wikiTools = new WikiTools({ rootDir, wikiDir, rawDir, dataDir });
  const calls = [];
  const service = new ReadingService({ store, wikiTools, instructions: 'Canonical instructions.', authService: { async inferenceConfig() { return { accessToken: 'secret-never-save', model: 'connected-model' }; } }, discovery: { async search(query) { return { query, results: [{ id: 'arxiv-test', title: 'Candidate', abstract: 'Abstract evidence.', recordUrl: 'https://arxiv.org/abs/2401.01234', canImport: true }], warnings: [] }; }, remember(results) { calls.push({ discovery: results }); }, async import() { return { imported: [] }; } }, providerFactory: () => ({ async runTurn(input) { calls.push(input); return { text: `Selected evidence [H:${store.read().highlights[0].id}]. (source: paper.txt)` }; } }), ...overrides });
  t.after(() => { service.close(); fs.rmSync(rootDir, { recursive: true, force: true }); });
  return { rootDir, rawDir, wikiDir, dataDir, store, wikiTools, service, calls };
}
async function highlight(f, name = 'paper.txt', exact = 'Pulsar timing residuals reveal noise.') {
  const { document } = await f.service.openDocument(name);
  return f.service.createHighlight({ documentId: document.id, kind: 'text', color: 'yellow', categories: ['method'], text: exact, anchors: [{ page: 1, label: '1', exact, start: 0, end: exact.length, prefix: '', suffix: '', rects: [[10, 20, 150, 40]] }] });
}
async function completed(service, id) {
  for (let count = 0; count < 100; count += 1) {
    const task = service.task(id);
    if (!['queued', 'running'].includes(task.status)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Task did not finish');
}

test('Add automatically creates a cited paper note using explicit agent instructions and only selected inputs', async t => {
  const f = fixture(t); const h = await highlight(f);
  const included = f.service.saveAnnotation({ highlightId: h.id, text: 'Selected interpretation' });
  f.service.saveAnnotation({ highlightId: h.id, text: 'Unchecked private comment' });
  f.service.providerFactory = () => ({ async runTurn(input) {
    f.calls.push(input);
    return { text: `### Timing noise\n\nTiming residuals reveal noise [H:${h.id}] (source: paper.txt).\n\nInterpretation: Selected interpretation needs verification.` };
  } });
  const rawBefore = fs.readFileSync(path.join(f.rawDir, 'paper.txt'));
  const task = await f.service.createTask({ action: 'wiki-note', targetPage: 'paper', createMissingPage: true, highlightIds: [h.id], annotationIds: [included.id] });
  assert.equal(fs.existsSync(path.join(f.wikiDir, 'paper.md')), false, 'no placeholder page before generation succeeds');
  const result = await completed(f.service, task.id);
  assert.equal(result.status, 'completed'); assert.equal(result.publication.page, 'paper');
  const content = fs.readFileSync(path.join(f.wikiDir, 'paper.md'), 'utf8');
  assert.match(content, /### Timing noise/); assert.match(content, /\*\*Sources\*\*: paper.txt/);
  assert.ok(content.includes(`### Timing noise\n\n> ${h.text}\n\n[paper.txt, page 1]`));
  assert.ok(content.indexOf(`> ${h.text}`) < content.indexOf('Timing residuals reveal noise'));
  assert.ok(content.includes(`[paper.txt, page 1](/#reading/${h.documentId}/${h.id}?revision=${h.revision})`));
  assert.match(content, /Selected interpretation/); assert.doesNotMatch(content, /Unchecked private comment|researcher reviewed before publication/);
  assert.doesNotMatch(content, /SHA-256|Reading provenance|Reading-note operation|model:|AI explanations|\[H:/);
  assert.match(f.calls[0].instructions, /Do not add declarations about AI use/);
  assert.match(f.calls[0].instructions, /short, topic-focused section/);
  assert.match(fs.readFileSync(path.join(f.wikiDir, 'index.md'), 'utf8'), /\[\[paper\]\]/);
  assert.match(fs.readFileSync(path.join(f.wikiDir, 'log.md'), 'utf8'), /Automatically added reading note to paper/);
  assert.match(f.calls[0].instructions, /AUTOMATIC WIKI NOTE/);
  assert.match(f.calls[0].instructions, /without a Markdown review/);
  assert.match(f.calls[0].instructions, /Existing page content and citations must remain intact/);
  assert.doesNotMatch(f.calls[0].messages[0].text, /Unchecked private comment/);
  assert.deepEqual(f.calls[0].tools, []);
  assert.equal(f.store.read().artifacts.length, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.rawDir, 'paper.txt')), rawBefore);
});

test('automatic notes quote every selected passage, preserving multiline text as literal Markdown', async t => {
  const f = fixture(t);
  const selected = 'Timing **noise** matters.\n\nCompare [measurements].';
  fs.writeFileSync(path.join(f.rawDir, 'paper.txt'), selected);
  const first = await highlight(f, 'paper.txt', selected);
  const second = await highlight(f, 'other.txt', 'An independent measurement challenges the stable rotation assumption.');
  f.service.providerFactory = () => ({ async runTurn() {
    return { text: `### Comparing measurements\n\nCompare these selections [H:${first.id}] [H:${second.id}] (source: paper.txt) (source: other.txt).` };
  } });
  const task = await f.service.createTask({ action: 'wiki-note', targetPage: 'paper', createMissingPage: true, highlightIds: [first.id, second.id] });
  assert.equal((await completed(f.service, task.id)).status, 'completed');
  const content = fs.readFileSync(path.join(f.wikiDir, 'paper.md'), 'utf8');
  assert.ok(content.includes('> Timing \\*\\*noise\\*\\* matters.\n> \n> Compare \\[measurements\\].'));
  assert.ok(content.includes(`> ${second.text}\n\n[other.txt, page 1]`));
  assert.ok(content.indexOf(`> ${second.text}`) < content.indexOf('Compare these selections'));
  assert.doesNotMatch(content, /SHA-256|Reading-note operation|model:|\[H:/);
});

test('automatic notes preserve the latest existing content, citations and concurrent edits', async t => {
  let finish; let received;
  const f = fixture(t, { providerFactory: () => ({ runTurn(input) { received = input; return new Promise(resolve => { finish = resolve; }); } }) });
  const h = await highlight(f, 'other.txt', 'An independent measurement challenges the stable rotation assumption.');
  const task = await f.service.createTask({ action: 'wiki-note', targetPage: 'timing', highlightIds: [h.id] });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
  assert.match(received.messages[0].text, /Existing content/);
  fs.appendFileSync(path.join(f.wikiDir, 'timing.md'), '\nConcurrent note (source: new-independent.pdf).\n');
  finish({ text: `### Rotation assumption\n\nAn independent measurement challenges the assumption [H:${h.id}] (source: other.txt).` });
  const result = await completed(f.service, task.id);
  assert.equal(result.status, 'completed');
  const content = fs.readFileSync(path.join(f.wikiDir, 'timing.md'), 'utf8');
  assert.match(content, /Existing content/); assert.match(content, /Concurrent note \(source: new-independent.pdf\)/);
  assert.match(content, /\*\*Sources\*\*: paper.txt, other.txt/);
  assert.ok(content.indexOf('### Rotation assumption') < content.indexOf('## Related pages'));
});

test('failed, invalid or cancelled automatic notes leave no new page, index entry or log', async t => {
  for (const failure of ['provider', 'citations', 'format', 'html', 'cancel']) await t.test(failure, async t => {
    const f = fixture(t); const h = await highlight(f);
    const index = fs.readFileSync(path.join(f.wikiDir, 'index.md'), 'utf8');
    f.service.providerFactory = () => ({ async runTurn() {
      if (failure === 'provider') throw new Error('Provider unavailable');
      if (failure === 'cancel') { f.service.cancelTask(f.store.read().tasks.at(-1).id); return { text: '' }; }
      if (failure === 'citations') return { text: '### Note\nClaim [H:invented].' };
      return { text: `${failure === 'format' ? '# Complete page' : '### Note\n<script>bad()</script>'}\nClaim [H:${h.id}] (source: paper.txt).` };
    } });
    const task = await f.service.createTask({ action: 'wiki-note', targetPage: 'paper', createMissingPage: true, highlightIds: [h.id] });
    assert.equal((await completed(f.service, task.id)).status, failure === 'cancel' ? 'cancelled' : 'failed');
    assert.equal(fs.existsSync(path.join(f.wikiDir, 'paper.md')), false);
    assert.equal(fs.readFileSync(path.join(f.wikiDir, 'index.md'), 'utf8'), index);
    assert.equal(fs.existsSync(path.join(f.wikiDir, 'log.md')), false);
  });
});

test('automatic note retries preserve destination and selected evidence and do not duplicate a saved operation', async t => {
  const f = fixture(t); const h = await highlight(f);
  f.service.providerFactory = () => ({ async runTurn() { throw new Error('Temporary failure'); } });
  const task = await f.service.createTask({ action: 'wiki-note', targetPage: 'paper', createMissingPage: true, highlightIds: [h.id] });
  assert.equal((await completed(f.service, task.id)).status, 'failed');
  f.service.providerFactory = () => ({ async runTurn() { return { text: `### Timing noise\nNoise [H:${h.id}] (source: paper.txt).` }; } });
  const retry = await f.service.retryTask(task.id);
  const result = await completed(f.service, retry.id);
  assert.equal(result.status, 'completed'); assert.equal(result.publication.page, 'paper');
  assert.equal(retry.operationId, task.id);
  const content = fs.readFileSync(path.join(f.wikiDir, 'paper.md'), 'utf8');
  assert.equal(f.service.saveWikiNote(result, result.response, result.model).alreadySaved, true);
  assert.equal(fs.readFileSync(path.join(f.wikiDir, 'paper.md'), 'utf8'), content);
});

test('automatic note wiki transactions roll back on write failure', async t => {
  const f = fixture(t); const h = await highlight(f);
  const index = fs.readFileSync(path.join(f.wikiDir, 'index.md'), 'utf8');
  const faulty = Object.create(fs); faulty.renameSync = () => { throw new Error('disk'); }; f.wikiTools.fs = faulty;
  f.service.providerFactory = () => ({ async runTurn() { return { text: `### Timing noise\nNoise [H:${h.id}] (source: paper.txt).` }; } });
  const task = await f.service.createTask({ action: 'wiki-note', targetPage: 'paper', createMissingPage: true, highlightIds: [h.id] });
  assert.equal((await completed(f.service, task.id)).errorCode, 'wiki-write-failed');
  assert.equal(fs.existsSync(path.join(f.wikiDir, 'paper.md')), false);
  assert.equal(fs.readFileSync(path.join(f.wikiDir, 'index.md'), 'utf8'), index);
});

test('reading records persist atomically, reject stale revisions, and preserve corrupt files', async t => {
  const f = fixture(t); const h = await highlight(f);
  const updated = await f.service.updateHighlight(h.id, { revision: h.revision, color: 'blue' });
  await assert.rejects(f.service.updateHighlight(h.id, { revision: h.revision, color: 'pink' }), e => e.code === 'reading-conflict');
  const reopened = new ReadingStore({ dataDir: path.join(f.dataDir, 'reading') });
  assert.equal(reopened.get('highlights', h.id).color, 'blue');
  const serialized = fs.readFileSync(f.store.file, 'utf8');
  const faulty = Object.create(fs); faulty.renameSync = () => { throw new Error('disk'); };
  const failing = new ReadingStore({ dataDir: path.join(f.dataDir, 'reading'), fsModule: faulty });
  assert.throws(() => failing.update('highlights', h.id, updated.revision, { color: 'pink' }), e => e.code === 'reading-write-failed');
  assert.equal(fs.readFileSync(f.store.file, 'utf8'), serialized);
  assert.equal(failing.get('highlights', h.id).color, 'blue');
  fs.writeFileSync(f.store.file, '{broken');
  assert.throws(() => new ReadingStore({ dataDir: path.join(f.dataDir, 'reading') }).read(), e => e.code === 'reading-store-unreadable');
  assert.equal(fs.readFileSync(f.store.file, 'utf8'), '{broken');
});

test('source identities follow content, flag changed files, and reject unmatched anchors', async t => {
  const f = fixture(t); const h = await highlight(f); const doc = f.store.get('documents', h.documentId);
  fs.copyFileSync(path.join(f.rawDir, 'paper.txt'), path.join(f.rawDir, 'renamed.txt'));
  assert.equal((await f.service.openDocument('renamed.txt')).document.id, doc.id);
  fs.writeFileSync(path.join(f.rawDir, 'paper.txt'), 'Replacement source');
  const replaced = await f.service.openDocument('paper.txt');
  assert.notEqual(replaced.document.id, doc.id); assert.deepEqual(replaced.changedDocuments, [doc.id]);
  await assert.rejects(f.service.createHighlight({ ...h, documentId: replaced.document.id }), e => e.code === 'anchor-mismatch');
  fs.unlinkSync(path.join(f.rawDir, 'renamed.txt'));
  assert.equal(f.service.state().documents.find(d => d.id === doc.id).available, false);
  assert.equal(f.store.get('highlights', h.id).text, h.text);
});

test('annotations, collection ordering, links, deletion and undo need no AI', async t => {
  const f = fixture(t); const h = await highlight(f); const h2 = await highlight(f, 'other.txt', 'An independent measurement challenges the stable rotation assumption.');
  const a = f.service.saveAnnotation({ highlightId: h.id, text: 'Private caveat' });
  const c = f.service.saveCollection({ name: 'Compare assumptions', notes: 'Research notes', highlightIds: [h2.id, h.id], groups: { [h.id]: 'Assumptions' } });
  assert.deepEqual(c.highlightIds, [h2.id, h.id]);
  assert.equal(f.service.saveRelationship({ from: h.id, target: 'timing', targetType: 'wiki' }).target, 'timing');
  assert.equal(f.service.saveRelationship({ from: h.id, target: h2.id, targetType: 'highlight', relation: 'competes' }).relation, 'competes');
  assert.throws(() => f.service.saveRelationship({ from: h.id, target: 'invented', targetType: 'wiki' }));
  const removed = f.service.deleteRecord('highlights', h.id, h.revision);
  assert.throws(() => f.store.get('highlights', h.id));
  const restored = await f.service.updateHighlight(h.id, { revision: removed.revision, deletedAt: null });
  assert.equal(restored.deletedAt, null); assert.equal(f.store.get('annotations', a.id).text, 'Private caveat');
  assert.equal(f.calls.length, 0);
});

test('assistance receives only selected snapshots, never source tools or unchecked private comments', async t => {
  const f = fixture(t); const h = await highlight(f);
  const a = f.service.saveAnnotation({ highlightId: h.id, text: 'Never include unchecked note' });
  const task = await f.service.createTask({ highlightIds: [h.id], action: 'summary', question: 'Summarise this selection.' });
  const result = await completed(f.service, task.id);
  assert.equal(result.status, 'completed'); assert.equal(result.model, 'connected-model');
  assert.deepEqual(f.calls[0].tools, []);
  const prompt = f.calls[0].messages[0].text;
  assert.ok(prompt.includes(h.text)); assert.ok(!prompt.includes('The method assumes stable rotation.'));
  assert.ok(!prompt.includes(a.text)); assert.equal(result.snapshot.annotations.length, 0);
  assert.ok(!fs.readFileSync(f.store.file, 'utf8').includes('secret-never-save'));
  const edited = f.service.saveAnnotation({ highlightId: h.id, revision: a.revision, text: 'Revised interpretation' }, a.id);
  const selected = await f.service.createTask({ highlightIds: [h.id], annotationIds: [edited.id], action: 'equation' });
  await completed(f.service, selected.id);
  assert.ok(f.calls[1].messages[0].text.includes('Revised interpretation'));
  assert.equal(f.store.get('tasks', task.id).snapshot.highlights[0].color, 'yellow');
  await f.service.updateHighlight(h.id, { revision: h.revision, color: 'pink' });
  assert.equal(f.store.get('tasks', task.id).snapshot.highlights[0].color, 'yellow');
});

test('invalid citations and unsupported image requests fail safely without changing notes', async t => {
  const f = fixture(t, { providerFactory: () => ({ async runTurn() { return { text: 'Fabricated evidence [H:not-selected]' }; } }) });
  const h = await highlight(f);
  const task = await f.service.createTask({ highlightIds: [h.id], action: 'explain' });
  assert.equal((await completed(f.service, task.id)).errorCode, 'invalid-citations');
  f.service.providerFactory = () => ({ async runTurn() { throw new ProviderError('No images', 'unsupported-capability'); } });
  const imageTask = await f.service.createTask({ highlightIds: [h.id], action: 'equation', includeImages: true });
  const result = await completed(f.service, imageTask.id);
  assert.equal(result.status, 'failed'); assert.match(result.error, /transcription/);
  assert.equal(f.store.get('highlights', h.id).text, h.text);
});

test('cancellation, server restart and explicit retry preserve original request snapshots', async t => {
  const f = fixture(t, { providerFactory: () => ({ runTurn(input) { return new Promise((resolve, reject) => { input.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }); }); } }) });
  const h = await highlight(f);
  const task = await f.service.createTask({ highlightIds: [h.id], action: 'explain' });
  await new Promise(resolve => setTimeout(resolve, 10));
  f.service.cancelTask(task.id);
  assert.equal((await completed(f.service, task.id)).status, 'cancelled');
  f.service.providerFactory = () => ({ async runTurn() { return { text: `Explanation [H:${h.id}].` }; } });
  await f.service.updateHighlight(h.id, { revision: h.revision, color: 'blue' });
  const retried = await f.service.retryTask(task.id);
  assert.equal((await completed(f.service, retried.id)).status, 'completed');
  assert.equal(retried.snapshot.highlights[0].color, 'yellow');
  const orphan = f.store.create('tasks', { status: 'running', snapshot: retried.snapshot, response: '' });
  f.store.recoverTasks();
  assert.equal(f.store.get('tasks', orphan.id).status, 'interrupted');
});

test('all artifact types have immutable inputs and reviewed publication is atomic and conflict checked', async t => {
  const f = fixture(t); const h = await highlight(f); const annotation = f.service.saveAnnotation({ highlightId: h.id, text: 'Publish this interpretation' });
  f.service.saveAnnotation({ highlightId: h.id, text: 'Keep this note private' });
  const artifacts = [];
  for (const type of ['summary', 'synthesis', 'evidence', 'concept']) artifacts.push(await f.service.createArtifact({ type, title: `Reading ${type}`, targetPage: 'timing', highlightIds: [h.id], annotationIds: [annotation.id] }));
  const a = artifacts[0];
  assert.throws(() => f.service.publishArtifact(a.id, { revision: a.revision, pageName: 'reading-summary' }), e => e.code === 'review-required');
  const updated = await f.service.updateHighlight(h.id, { revision: h.revision, color: 'blue' });
  assert.equal(f.service.state().artifacts[0].outdated, true);
  assert.throws(() => f.service.publishArtifact(a.id, { revision: a.revision, reviewed: true, pageName: 'reading-summary' }), e => e.code === 'outdated-draft');
  const beforeRaw = fs.readFileSync(path.join(f.rawDir, 'paper.txt'));
  const result = f.service.publishArtifact(a.id, { revision: a.revision, reviewed: true, acceptOutdated: true, pageName: 'reading-summary' });
  assert.equal(result.page, 'reading-summary');
  const content = fs.readFileSync(path.join(f.wikiDir, 'reading-summary.md'), 'utf8');
  assert.match(content, /Source passages/); assert.ok(content.includes(`[paper.txt, page 1]`));
  assert.doesNotMatch(content, /SHA-256|model:|AI generation|\[H:|\[A:/); assert.ok(content.includes(`/#reading/${h.documentId}/${h.id}`));
  assert.ok(content.includes('Publish this interpretation')); assert.ok(!content.includes('Keep this note private'));
  assert.ok(fs.readFileSync(path.join(f.wikiDir, 'index.md'), 'utf8').includes('[[reading-summary]]'));
  assert.match(fs.readFileSync(path.join(f.wikiDir, 'log.md'), 'utf8'), /active-reading summary/);
  assert.deepEqual(fs.readFileSync(path.join(f.rawDir, 'paper.txt')), beforeRaw);
  const concept = artifacts[3];
  fs.appendFileSync(path.join(f.wikiDir, 'timing.md'), '\nConcurrent researcher edit.');
  assert.throws(() => f.service.publishArtifact(concept.id, { revision: concept.revision, reviewed: true, acceptOutdated: true }), e => e.code === 'wiki-conflict');
  const deleted = f.service.deleteRecord('highlights', h.id, updated.revision);
  assert.ok(deleted.deletedAt); assert.equal(f.store.get('artifacts', a.id).snapshot.highlights[0].color, 'yellow');
});

test('artifact generation uses its captured inputs and never overwrites a concurrently edited draft', async t => {
  let finish;
  const f = fixture(t, { providerFactory: () => ({ runTurn() { return new Promise(resolve => { finish = resolve; }); } }) });
  const h = await highlight(f); const artifact = await f.service.createArtifact({ type: 'summary', title: 'Selected reading', highlightIds: [h.id] });
  const task = await f.service.createTask({ action: 'artifact', artifactId: artifact.id, artifactRevision: artifact.revision });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
  const manual = f.service.saveArtifact(artifact.id, { revision: artifact.revision, content: `${artifact.content}\nMy concurrent edit.` });
  finish({ text: `AI draft [H:${h.id}]` });
  assert.equal((await completed(f.service, task.id)).status, 'completed');
  assert.equal(f.store.get('artifacts', artifact.id).content, manual.content);
});

test('workspace search includes sources, wiki, notes and deep links without inference', async t => {
  const f = fixture(t); const h = await highlight(f); f.service.saveAnnotation({ highlightId: h.id, text: 'Rotation stability caveat' });
  const result = await f.service.search('rotation');
  assert.ok(result.results.some(r => r.kind === 'source' && r.page === 1));
  assert.ok(result.results.some(r => r.kind === 'annotation' && r.url.includes(h.id)));
  assert.equal(f.calls.length, 0);
});

test('discovery metadata survives expired previews and stays labelled abstract-only', async t => {
  const f = fixture(t); const result = await f.service.discover('pulsar noise');
  assert.equal(result.records[0].evidenceLevel, 'abstract-only');
  assert.deepEqual(f.service.restoreDiscoveries([result.records[0].id]), ['arxiv-test']);
  assert.equal(f.calls[0].discovery[0].title, 'Candidate');
});

test('related knowledge prefers relevant wiki prose and never calls external discovery for a wiki match', async t => {
  let searches = 0;
  const f = fixture(t, { discovery: { async search() { searches += 1; throw new Error('Wiki match must remain local'); } } });
  const h = await highlight(f);
  const file = path.join(f.wikiDir, 'timing.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Existing content.', 'Pulsar timing residuals help characterise noise in rotation.'));
  const result = await f.service.relatedKnowledge(h.id, h.revision);
  assert.equal(result.wiki[0].name, 'timing'); assert.equal(result.wiki[0].url, '/wiki/timing');
  assert.match(result.wiki[0].text, /timing residuals/); assert.equal(result.papers.length, 0);
  assert.equal(searches, 0); assert.equal(f.calls.length, 0);
});

test('related knowledge falls back to relevant papers and excludes generic matches and private comments', async t => {
  const queries = [];
  const f = fixture(t, { discovery: { async search(query) {
    queries.push(query);
    return { results: [
      { id: 'arxiv-relevant', title: 'Pulsar timing residuals and noise', abstract: 'Timing noise in pulsar residuals.', recordUrl: 'https://arxiv.org/abs/2401.01234' },
      { id: 'arxiv-unrelated', title: 'A pulsar survey', abstract: 'Radio instrumentation and telescope construction.', recordUrl: 'https://arxiv.org/abs/2401.01235' }
    ], warnings: ['NASA ADS is unavailable; arXiv results are shown.'] };
  } } });
  const h = await highlight(f); f.service.saveAnnotation({ highlightId: h.id, text: 'secret personal interpretation never send' });
  const result = await f.service.relatedKnowledge(h.id, h.revision);
  assert.equal(result.wiki.length, 0); assert.equal(result.papers.length, 1);
  assert.equal(result.papers[0].source.id, 'arxiv-relevant'); assert.equal(result.papers[0].evidenceLevel, 'abstract-only');
  assert.equal(queries.length, 1); assert.match(queries[0], /pulsar timing residual noise/);
  assert.doesNotMatch(queries[0], /secret|personal|interpretation/); assert.equal(result.warnings.length, 1);
  assert.equal(f.calls.length, 0, 'connecting references must not invoke an AI request');
});

test('wiki bibliography and related-page lists cannot suppress the external fallback', async t => {
  let searches = 0;
  const f = fixture(t, { discovery: { async search() { searches += 1; return { results: [], warnings: [] }; } } });
  const h = await highlight(f);
  fs.writeFileSync(path.join(f.wikiDir, 'unrelated.md'), '# Unrelated\n\n**Sources**: pulsar-timing-residual-noise.pdf\n\nUnrelated information.\n\n## Related pages\n\nPulsar timing residuals reveal noise.\n');
  const result = await f.service.relatedKnowledge(h.id);
  assert.equal(result.wiki.length, 0); assert.equal(result.papers.length, 0); assert.equal(searches, 1);
});

test('related knowledge rejects stale, deleted and untranscribed selections before searching', async t => {
  let searches = 0;
  const f = fixture(t, { discovery: { async search() { searches += 1; return { results: [], warnings: [] }; } } });
  const h = await highlight(f);
  await f.service.updateHighlight(h.id, { revision: h.revision, color: 'green' });
  await assert.rejects(f.service.relatedKnowledge(h.id, h.revision), e => e.code === 'reading-conflict');
  const visual = await f.service.createHighlight({ documentId: h.documentId, kind: 'region', text: '', color: 'yellow', anchors: [{ page: 1, rects: [[10, 20, 40, 30]] }] });
  await assert.rejects(f.service.relatedKnowledge(visual.id), /transcription/);
  f.service.deleteRecord('highlights', h.id, h.revision + 1);
  await assert.rejects(f.service.relatedKnowledge(h.id), e => e.code === 'reading-not-found');
  assert.equal(searches, 0);
});

test('backup merge never overwrites records or discards conflicting snapshots', async t => {
  const f = fixture(t); const h = await highlight(f); const backup = f.store.read();
  assert.equal(f.store.importBackup(backup, backup.revision).added, 0);
  await f.service.updateHighlight(h.id, { revision: h.revision, color: 'green' });
  assert.throws(() => f.store.importBackup(backup, f.store.read().revision), e => e.code === 'reading-conflict');
  assert.equal(f.store.get('highlights', h.id).color, 'green');
});

test('reading routes require session and origin guards for private reads and mutations', async t => {
  const f = fixture(t); const app = express(); app.use(express.json());
  const session = (req, res, next) => req.headers['x-session'] === 'yes' ? next() : res.sendStatus(403);
  const mutation = (req, res, next) => req.headers.origin === 'http://local.test' ? session(req, res, next) : res.sendStatus(403);
  app.use('/api/reading', createReadingRouter({ service: f.service, requireLocalSession: session, requireLocalMutation: mutation, onImport() {} }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/reading`;
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(url, { headers: { 'x-session': 'yes' } })).status, 200);
  assert.equal((await fetch(url + '/documents', { method: 'POST', headers: { 'x-session': 'yes', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'paper.txt' }) })).status, 403);
  const allowed = await fetch(url + '/documents', { method: 'POST', headers: { 'x-session': 'yes', Origin: 'http://local.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'paper.txt' }) });
  assert.equal(allowed.status, 200); assert.match(allowed.headers.get('cache-control'), /no-store/);
  const h = await highlight(f);
  assert.equal((await fetch(url + '/tasks', { method: 'POST', headers: { 'x-session': 'yes', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'wiki-note', targetPage: 'paper', createMissingPage: true, highlightIds: [h.id] }) })).status, 403);
  f.service.providerFactory = () => ({ async runTurn() { return { text: `### Timing noise\nNoise [H:${h.id}] (source: paper.txt).` }; } });
  const noteRequest = await fetch(url + '/tasks', { method: 'POST', headers: { 'x-session': 'yes', Origin: 'http://local.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'wiki-note', targetPage: 'paper', createMissingPage: true, highlightIds: [h.id] }) });
  assert.equal(noteRequest.status, 202);
  assert.equal((await completed(f.service, (await noteRequest.json()).id)).publication.page, 'paper');
  assert.equal((await fetch(url + `/documents/${h.documentId}/text`)).status, 403);
  const fullText = await fetch(url + `/documents/${h.documentId}/text`, { headers: { 'x-session': 'yes' } });
  assert.equal(fullText.status, 200); assert.match(fullText.headers.get('cache-control'), /no-store/);
  assert.equal((await fullText.json()).pages[0].text, fs.readFileSync(path.join(f.rawDir, 'paper.txt'), 'utf8'));
  assert.equal((await fetch(url + '/connections', { method: 'POST', headers: { 'x-session': 'yes', 'Content-Type': 'application/json' }, body: JSON.stringify({ highlightId: h.id }) })).status, 403);
  const connected = await fetch(url + '/connections', { method: 'POST', headers: { 'x-session': 'yes', Origin: 'http://local.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ highlightId: h.id, revision: h.revision }) });
  assert.equal(connected.status, 200); assert.equal((await connected.json()).highlightId, h.id);
});

test('provider forwards selected visual content while preserving plain text conversations', async () => {
  let input;
  const adapter = createChatGPTAdapter({ client: { responses: { async create(request) { input = request.input; return (async function* () { yield { type: 'response.completed', response: { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Image explanation.' }] }] } }; })(); } } } });
  const content = [{ type: 'input_text', text: 'Explain equation' }, { type: 'input_image', image_url: 'data:image/png;base64,example', detail: 'high' }];
  await adapter.runTurn({ model: 'connected', instructions: 'Test', messages: [{ role: 'user', content }], tools: [], executeTool() {} });
  assert.deepEqual(input[0].content, content);
});

test('preserved passage URLs resolve the original coordinates after reattachment and deletion', async t => {
  const f = fixture(t); const original = await highlight(f);
  const other = await highlight(f, 'other.txt', 'An independent measurement challenges the stable rotation assumption.');
  const artifact = await f.service.createArtifact({ type: 'summary', title: 'Original evidence', highlightIds: [original.id] });
  const moved = await f.service.updateHighlight(original.id, { revision: original.revision, documentId: other.documentId, anchors: other.anchors, kind: other.kind, text: other.text });
  assert.equal(f.service.passage(original.id).highlight.documentId, other.documentId);
  const preserved = f.service.passage(original.id, { documentId: original.documentId, revision: original.revision });
  assert.equal(preserved.highlight.text, original.text); assert.deepEqual(preserved.highlight.anchors, original.anchors); assert.equal(preserved.historical, true);
  f.service.deleteRecord('highlights', original.id, moved.revision);
  assert.equal(f.service.passage(original.id, { revision: original.revision }).document.id, original.documentId);
  assert.equal(f.store.get('artifacts', artifact.id).snapshot.highlights[0].history, undefined);
});

test('filename citations support parentheses and concept updates retain existing citations', async t => {
  const f = fixture(t); const h = await highlight(f);
  assert.deepEqual(sourceCitations('Claim (source: s41550-019-0880-2 (1).pdf). Another (source: paper.txt).'), ['s41550-019-0880-2 (1).pdf', 'paper.txt']);
  fs.appendFileSync(path.join(f.wikiDir, 'timing.md'), '\nExisting fact (source: previously-ingested.pdf).\n');
  const artifact = await f.service.createArtifact({ type: 'concept', title: 'Timing', targetPage: 'timing', highlightIds: [h.id] });
  const updated = f.service.saveArtifact(artifact.id, { revision: artifact.revision, content: artifact.content + `\nNew finding [H:${h.id}] (source: paper.txt).\n` });
  assert.equal(f.service.publishArtifact(artifact.id, { revision: updated.revision, reviewed: true }).page, 'timing');
});

test('real PDF extraction preserves page inventory and anchors across zoom and rotation', async t => {
  const f = fixture(t);
  fs.copyFileSync(path.join(__dirname, '..', 'raw', 'psrchive.pdf'), path.join(f.rawDir, 'real.pdf'));
  const opened = await f.service.openDocument('real.pdf');
  assert.ok(opened.document.pageCount > 1); assert.equal(opened.document.labels.length, opened.document.pageCount);
  const cached = f.service.extractions.get(opened.document.hash);
  assert.equal(cached.pages.filter(Boolean).length, 0, 'opening must read metadata without extracting page text');
  const pageText = await f.service.pageText(opened.document.id, 1);
  assert.ok(pageText.text.length > 100);
  assert.equal(cached.pages.filter(Boolean).length, 1, 'only the requested page is extracted');
  const exact = pageText.text.slice(0, 80);
  const h = await f.service.createHighlight({ documentId: opened.document.id, kind: 'text', color: 'green', categories: [], anchors: [{ page: 1, label: '1', exact, start: 0, end: exact.length, rects: [[10, 20, 150, 40]] }] });
  assert.equal(h.text, exact);
  assert.equal(cached.pages.filter(Boolean).length, 1, 'saving a highlight reuses that page without scanning the paper');
  const [last, sameLast] = await Promise.all([f.service.pageText(opened.document.id, opened.document.pageCount), f.service.pageText(opened.document.id, opened.document.pageCount)]);
  assert.equal(last.text, sameLast.text);
  assert.equal(cached.pages.filter(Boolean).length, 2);
  const full = await f.service.documentText(opened.document.id);
  assert.equal(full.pages.length, opened.document.pageCount);
  assert.ok(full.pages.every(Boolean), 'explicit full-document search fills the remaining pages');
  assert.equal(full.pages[0].text, pageText.text);
  await assert.rejects(f.service.pageText(opened.document.id, opened.document.pageCount + 1), e => e.code === 'page-not-found');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: new Uint8Array(fs.readFileSync(path.join(f.rawDir, 'real.pdf'))) }).promise;
  try {
    const page = await pdf.getPage(1);
    for (const scale of [.5, 1, 2.5]) for (const rotation of [0, 90, 180, 270]) {
      const viewport = page.getViewport({ scale, rotation });
      const point = viewport.convertToViewportPoint(10, 20); const restored = viewport.convertToPdfPoint(...point);
      assert.ok(Math.abs(restored[0] - 10) < .0001); assert.ok(Math.abs(restored[1] - 20) < .0001);
    }
  } finally { await pdf.destroy(); }
});

test('visual selections use images only when explicitly included and reject malformed backups', async t => {
  const f = fixture(t); const { document } = await f.service.openDocument('paper.txt');
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=';
  const h = await f.service.createHighlight({ documentId: document.id, kind: 'region', color: 'pink', image, text: '', anchors: [{ page: 1, rects: [[10, 20, 150, 40]] }] });
  await assert.rejects(f.service.createTask({ action: 'equation', highlightIds: [h.id] }), e => e.code === 'visual-input-required');
  const task = await f.service.createTask({ action: 'equation', highlightIds: [h.id], includeImages: true });
  await completed(f.service, task.id);
  assert.equal(f.calls[0].messages[0].content[1].image_url, image);
  const backup = f.store.read(); backup.tasks[0].snapshot.highlights[0].image = '" onerror="alert(1)';
  assert.throws(() => f.store.importBackup(backup, f.store.read().revision), ReadingError);
  assert.equal(f.store.get('highlights', h.id).image, image);
});

test('selected input revision checks reject changes between request preview and submission', async t => {
  const f = fixture(t); const h = await highlight(f);
  const annotation = f.service.saveAnnotation({ highlightId: h.id, text: 'Original interpretation' });
  f.service.saveAnnotation({ highlightId: h.id, revision: annotation.revision, text: 'Concurrent change' }, annotation.id);
  await assert.rejects(f.service.createTask({ action: 'summary', highlightIds: [h.id], annotationIds: [annotation.id], highlightRevisions: { [h.id]: h.revision }, annotationRevisions: { [annotation.id]: annotation.revision } }), e => e.code === 'reading-conflict');
  assert.equal(f.calls.length, 0);
});

test('a failed wiki transaction rolls back artifact, index, and log without touching reading history', async t => {
  const f = fixture(t); const h = await highlight(f);
  const artifact = await f.service.createArtifact({ type: 'summary', title: 'Rollback case', highlightIds: [h.id] });
  const indexBefore = fs.readFileSync(path.join(f.wikiDir, 'index.md'), 'utf8');
  const faulty = Object.create(fs); let writes = 0;
  faulty.renameSync = (from, to) => { writes += 1; if (writes === 2) throw new Error('disk failure'); fs.renameSync(from, to); };
  f.wikiTools.fs = faulty;
  assert.throws(() => f.service.publishArtifact(artifact.id, { revision: artifact.revision, pageName: 'rollback-case', reviewed: true }), e => e.code === 'wiki-write-failed');
  assert.equal(fs.existsSync(path.join(f.wikiDir, 'rollback-case.md')), false);
  assert.equal(fs.readFileSync(path.join(f.wikiDir, 'index.md'), 'utf8'), indexBefore);
  assert.equal(fs.existsSync(path.join(f.wikiDir, 'log.md')), false);
  assert.equal(f.store.get('artifacts', artifact.id).publications.length, 0);
});

test('damaged private reading data does not prevent constructing the rest of the app', async t => {
  const f = fixture(t); await highlight(f); fs.writeFileSync(f.store.file, '{bad');
  const broken = new ReadingService({ store: new ReadingStore({ dataDir: path.join(f.dataDir, 'reading') }), wikiTools: f.wikiTools });
  assert.equal(broken.startupError.code, 'reading-store-unreadable');
  assert.throws(() => broken.state(), e => e.code === 'reading-store-unreadable');
  assert.equal(f.wikiTools.readWikiPage({ name: 'timing' }).exists, true);
});

test('later concept updates preserve previously published provenance from other selections', async t => {
  const f = fixture(t); const first = await highlight(f);
  const summary = await f.service.createArtifact({ type: 'summary', title: 'Reading summary', highlightIds: [first.id] });
  f.service.publishArtifact(summary.id, { revision: summary.revision, reviewed: true, pageName: 'reading-summary' });
  const second = await highlight(f, 'other.txt', 'An independent measurement challenges the stable rotation assumption.');
  const update = await f.service.createArtifact({ type: 'concept', title: 'Reading summary', targetPage: 'reading-summary', highlightIds: [second.id] });
  assert.equal(f.service.publishArtifact(update.id, { revision: update.revision, reviewed: true }).page, 'reading-summary');
  const published = fs.readFileSync(path.join(f.wikiDir, 'reading-summary.md'), 'utf8');
  assert.ok(published.includes(`/#reading/${first.documentId}/${first.id}?revision=1`)); assert.ok(published.includes(`/#reading/${second.documentId}/${second.id}?revision=1`));
  assert.match(published, /\*\*Sources\*\*: paper.txt, other.txt/);
});
