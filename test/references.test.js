'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { References } = require('../agent/references');
const { SourceDiscoveryService } = require('../agent/source-discovery');

function fixture(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsarwiki-references-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const rawDir = path.join(rootDir, 'raw'); fs.mkdirSync(rawDir);
  return { rootDir, rawDir, refs: new References({ rootDir, rawDir }) };
}

test('references retain paper metadata, manual edits and unique keys without duplicate imports', t => {
  const { refs } = fixture(t);
  const source = { name: 'paper.pdf', title: 'Timing {results} & evidence', authors: ['Doe, Jane', 'Smith, John'], published: '2025-01-01', publication: 'ApJ', doi: '10.1234/test', arxivId: '2501.12345', recordUrl: 'https://example.com/paper' };
  const first = refs.add([source]);
  assert.match(first.content, /@article\{paper,/);
  assert.ok(first.content.includes('title = {Timing \\{results\\} \\& evidence}'));
  assert.match(first.content, /author = \{Doe, Jane and Smith, John\}/);
  assert.match(first.content, /year = \{2025\}/);
  assert.match(first.content, /doi = \{10.1234\/test\}/);
  assert.match(first.content, /archivePrefix = \{arXiv\}/);
  const edited = `% Keep my comment\n${first.content.replace('@article{paper,', '@article{myKey,').replace('file = {raw/paper.pdf}', 'file  =  { raw/paper.pdf }')}`;
  refs.save(edited, first.revision);
  assert.equal(refs.add([source]).content, edited);
  refs.add([{ name: 'myKey.txt' }]);
  assert.match(refs.read().content, /@misc\{myKey-2,/);
});

test('existing sources get editable placeholders without source changes, isolated by workspace', t => {
  const { refs, rawDir } = fixture(t);
  fs.writeFileSync(path.join(rawDir, 'notes.txt'), 'immutable');
  fs.mkdirSync(path.join(rawDir, 'folder'));
  const first = refs.sync();
  assert.match(first.content, /file = \{raw\/notes.txt\}/);
  assert.match(first.content, /metadata needs completion/);
  assert.doesNotMatch(first.content, /folder/);
  assert.equal(refs.sync().revision, first.revision);
  assert.equal(fs.readFileSync(path.join(rawDir, 'notes.txt'), 'utf8'), 'immutable');
  assert.equal(fixture(t).refs.sync().content, '');
});

test('saving rejects stale revisions and invalid content without losing the latest bibliography', t => {
  const { refs } = fixture(t);
  const initial = refs.sync();
  refs.add([{ name: 'new.pdf' }]);
  assert.throws(() => refs.save('% stale edit', initial.revision), error => error.status === 409);
  assert.match(refs.read().content, /new.pdf/);
  const current = refs.read();
  assert.throws(() => refs.save(null, current.revision), error => error.status === 400);
  assert.equal(refs.save('% personal bibliography\n', current.revision).content, '% personal bibliography\n');
});

test('batch imports save full citation metadata before the next download can expose a placeholder', async t => {
  const { refs, rawDir } = fixture(t);
  const service = new SourceDiscoveryService({ rawDir, onImport: item => refs.add([{ ...item.source, name: item.name }]) });
  const papers = [{ id: 'first', title: 'First paper', authors: ['First, Author'], published: '2024' }, { id: 'second', title: 'Second paper' }];
  service.remember(papers);
  service.downloadPdf = async source => {
    if (source.id === 'second') {
      assert.match(refs.sync().content, /author = \{First, Author\}/);
      assert.doesNotMatch(refs.read().content, /metadata needs completion/);
    }
    const name = `${source.id}.pdf`;
    fs.writeFileSync(path.join(rawDir, name), '%PDF-test');
    return { name, source };
  };
  const result = await service.import(papers.map(paper => paper.id));
  assert.equal(result.imported.length, 2);
  assert.equal(result.failed.length, 0);
  assert.equal((refs.read().content.match(/@misc/g) || []).length, 2);
});

function editorClient() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', disabled: false, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } });
    return nodes.get(id);
  };
  let data = { content: '@misc{old, title={Original}}', revision: '1' };
  let fail = false;
  const requests = [];
  const context = {
    document: { getElementById: node },
    window: { addEventListener() {}, confirm: () => false },
    readJsonResponse: async response => response,
    workspaceFetch: async (url, options) => {
      requests.push({ url, options });
      if (fail) throw new Error('References changed. Copy edits and reload.');
      if (options) data = { content: JSON.parse(options.body).content, revision: '2' };
      return data;
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/references.js'), 'utf8'), context);
  return { node, context, requests, fail: () => { fail = true; } };
}

test('editor preserves unsaved text across tab changes, confirms reload and saves edits', async () => {
  const c = editorClient();
  await c.context.window.ReferencesEditor.open();
  const editor = c.node('references-editor');
  editor.value = '% my edited bibliography'; editor.handlers.input();
  assert.equal(c.node('references-save').disabled, false);
  await c.context.window.ReferencesEditor.open();
  c.node('references-reload').handlers.click();
  assert.equal(c.requests.length, 1);
  assert.equal(editor.value, '% my edited bibliography');
  await c.node('references-save').handlers.click();
  assert.equal(JSON.parse(c.requests[1].options.body).revision, '1');
  assert.equal(c.node('references-save').disabled, true);
  assert.equal(c.node('references-status').textContent, 'Saved references.bib');
});

test('editor keeps changes available after save conflicts', async () => {
  const c = editorClient(); await c.context.window.ReferencesEditor.open();
  c.node('references-editor').value = '% keep this draft';
  c.fail(); await c.node('references-save').handlers.click();
  assert.equal(c.node('references-editor').value, '% keep this draft');
  assert.equal(c.node('references-editor').disabled, false);
  assert.equal(c.node('references-save').disabled, false);
  assert.match(c.node('references-status').textContent, /Copy edits/);
});
