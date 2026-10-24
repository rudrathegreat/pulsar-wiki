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
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', innerHTML: '', disabled: false, handlers: {}, setAttribute(name, value) { this[name] = value; }, addEventListener(type, handler) { this.handlers[type] = handler; } });
    return nodes.get(id);
  };
  let data = { content: '@misc{old, title={Original}}', revision: '1' };
  let fail = false;
  const requests = [];
  const context = {
    BibTeX: require('../public/bibtex'), URL,
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

test('existing References links positional ORCID IDs and requests missing profiles', async () => {
  const c = editorClient();
  const lookups = [];
  c.context.window.AuthorOrcids = { ...require('../public/orcid'), hydrate: (_container, papers) => { lookups.push(papers); } };
  await c.context.window.ReferencesEditor.open();
  c.node('references-editor').value = '@article{paper, title={Timing}, author={Doe, Jane and Smith, Sam}, doi={10.1234/timing}, orcid={- and 0000-0002-1825-0097}}';
  c.node('references-preview-toggle').handlers.click();
  const markup = c.node('references-tree').innerHTML;
  assert.match(markup, /href="https:\/\/orcid.org\/0000-0002-1825-0097"[^>]*>Smith, Sam<\/a>/);
  assert.match(markup, /<li data-orcid-index="0">Doe, Jane<\/li>/);
  const paper = lookups.at(-1)[0];
  assert.equal(paper.doi, '10.1234/timing');
  assert.equal(paper.authors[0], 'Doe, Jane');
});

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

test('preview preserves entry and property order, nested authors and unsaved BibTeX', async () => {
  const c = editorClient(); await c.context.window.ReferencesEditor.open();
  const source = '@misc{old, title={Earlier source}, year={2020}}\n@article{new, title={A {Pulsar} study}, author={A and B and C and D}, year={2024}, keywords={timing; gravity}, doi={10.1/example}, url={javascript:alert(1)}, custom={keep me}}';
  c.node('references-source-toggle').handlers.click();
  assert.equal(c.node('references-editor').hidden, false);
  c.node('references-editor').value = source;
  c.node('references-editor').handlers.input();
  c.node('references-preview-toggle').handlers.click();
  const markup = c.node('references-tree').innerHTML;
  assert.match(markup, /A Pulsar study/);
  assert.match(markup, /4 authors/);
  assert.match(markup, /<ol class="reference-values"><li>A<\/li><li>B<\/li><li>C<\/li><li>D<\/li><\/ol>/);
  assert.ok(markup.indexOf('2020') < markup.indexOf('2024'), 'source order survives rendering');
  assert.ok(markup.indexOf('<dt>title</dt>') < markup.indexOf('<dt>year</dt>'));
  assert.match(markup, /class="reference-entry" data-path="1">/);
  assert.match(markup, /<dt>custom<\/dt><dd>keep me<\/dd>/);
  assert.doesNotMatch(markup, /reference-card|reference-year|All properties/);
  assert.match(markup, /gravity/);
  assert.match(markup, /keep me/);
  assert.match(markup, /https:\/\/doi.org\/10.1\/example/);
  assert.doesNotMatch(markup, /href="javascript:/);
  assert.equal(c.node('references-editor').value, source);
  assert.equal(c.node('references-save').disabled, false);
  c.node('references-search').value = 'gravity';
  c.node('references-search').handlers.input();
  assert.equal(c.node('references-count').textContent, '1 of 2 references');
  assert.doesNotMatch(c.node('references-tree').innerHTML, /Earlier source/);
  c.node('references-type').value = 'misc';
  c.node('references-type').handlers.change();
  assert.match(c.node('references-tree').innerHTML, /No matching references/);
});

test('preview escapes imported metadata and warns about incomplete drafts', async () => {
  const c = editorClient(); await c.context.window.ReferencesEditor.open();
  c.node('references-editor').value = '@misc{x, title={<img src=x onerror=alert(1)>}, note={A & B}}\n@article{unfinished, title={';
  c.node('references-preview-toggle').handlers.click();
  assert.match(c.node('references-tree').innerHTML, /&lt;img/);
  assert.doesNotMatch(c.node('references-tree').innerHTML, /<img/);
  assert.equal(c.node('references-warning').hidden, false);
  assert.match(c.node('references-warning').textContent, /source is preserved/);
});

test('file fields open workspace sources in the document reader and preserve modified clicks', async () => {
  const c = editorClient(); await c.context.window.ReferencesEditor.open();
  const name = 'Timing & "results" #1.PDF';
  c.node('references-editor').value = `@article{paper, file={raw/${name}}}\n@misc{notes, file={raw/notes.txt}}\n@misc{unsafe, file={../outside.pdf}}\n@misc{external, file={javascript:alert(1)}}`;
  c.node('references-preview-toggle').handlers.click();
  const tree = c.node('references-tree');
  assert.ok(tree.innerHTML.includes(`href="#file/${encodeURIComponent(name)}"`));
  assert.match(tree.innerHTML, /data-reference-file="Timing &amp; &quot;results&quot; #1.PDF"/);
  assert.match(tree.innerHTML, /href="#file\/notes.txt"/);
  assert.equal((tree.innerHTML.match(/data-reference-file=/g) || []).length, 2);
  const opened = [];
  c.context.window.openRawFile = (...args) => opened.push(args);
  let prevented = false;
  const event = { target: { closest: () => ({ dataset: { referenceFile: name } }) }, button: 0, preventDefault() { prevented = true; } };
  tree.handlers.click(event);
  assert.equal(prevented, true);
  assert.deepEqual(opened, [[name, 'PDF']]);
  prevented = false;
  tree.handlers.click({ ...event, ctrlKey: true });
  assert.equal(prevented, false);
  assert.equal(opened.length, 1);
});

test('entry and author branches fold independently and keep their state through filtering', async () => {
  const c = editorClient(); await c.context.window.ReferencesEditor.open();
  c.node('references-editor').value = '@article{paper, title={Pulsars}, author={First and Second}}';
  c.node('references-preview-toggle').handlers.click();
  const tree = c.node('references-tree');
  tree.handlers.toggle({ target: { dataset: { path: '0/author' }, open: false } });
  tree.handlers.toggle({ target: { dataset: { path: '0' }, open: true } });
  c.node('references-search').value = 'Pulsars';
  c.node('references-search').handlers.input();
  assert.match(tree.innerHTML, /reference-entry" data-path="0" open/);
  assert.match(tree.innerHTML, /<details data-path="0\/author">/);
  c.node('references-collapse').handlers.click();
  assert.doesNotMatch(tree.innerHTML, / open/);
  c.node('references-expand').handlers.click();
  assert.match(tree.innerHTML, /reference-entry" data-path="0" open/);
  assert.match(tree.innerHTML, /<details data-path="0\/author" open>/);
  assert.equal(c.node('references-editor').value, '@article{paper, title={Pulsars}, author={First and Second}}');
});
