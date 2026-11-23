'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const WebSocket = require('ws');
const { initializeWorkspace, createWorkspace, validateWorkspace } = require('../agent/workspaces');

function createFolder(root, name) { const folder = path.join(root, name); fs.mkdirSync(folder); return folder; }

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsarwiki-workspaces-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('new projects create an independent base template in a named child folder', t => {
  const parent = temporaryDirectory(t);
  const workspace = createWorkspace(parent, 'Timing study');
  assert.equal(workspace.rootDir, path.join(parent, 'Timing study'));
  for (const folder of ['raw', 'wiki', 'notebooks', '.pulsarwiki']) assert.ok(fs.statSync(path.join(workspace.rootDir, folder)).isDirectory());
  for (const file of ['GEMINI.md', 'AGENTS.md', 'CLAUDE.md', 'references.bib', '.gitignore', 'wiki/index.md', 'wiki/log.md']) assert.ok(fs.statSync(path.join(workspace.rootDir, file)).isFile());
  assert.equal(fs.readFileSync(path.join(workspace.rootDir, 'references.bib'), 'utf8'), '');
  assert.deepEqual(fs.readdirSync(workspace.rawDir), []);
  assert.match(fs.readFileSync(path.join(workspace.wikiDir, 'index.md'), 'utf8'), /^# Timing study/);
  assert.doesNotMatch(workspace.instructions, /pulsar astronomy/);
  fs.writeFileSync(path.join(workspace.rootDir, 'keep.txt'), 'keep');
  assert.throws(() => createWorkspace(parent, 'Timing study'), /already exists/);
  assert.equal(fs.readFileSync(path.join(workspace.rootDir, 'keep.txt'), 'utf8'), 'keep');
});

test('opening requires the project template and never repairs incompatible folders', t => {
  const parent = temporaryDirectory(t);
  const unrelated = createFolder(parent, 'Unrelated');
  fs.writeFileSync(path.join(unrelated, 'keep.txt'), 'keep');
  const message = 'this project is not compatible. Please select a different project';
  assert.throws(() => validateWorkspace(unrelated), { message });
  assert.deepEqual(fs.readdirSync(unrelated), ['keep.txt']);
  const workspace = createWorkspace(parent, 'Valid');
  assert.equal(validateWorkspace(workspace.rootDir), fs.realpathSync(workspace.rootDir));
  for (const name of ['wiki', 'raw', 'notebooks', 'GEMINI.md', 'AGENTS.md', 'CLAUDE.md', 'references.bib', '.gitignore', 'wiki/index.md', 'wiki/log.md']) {
    const target = path.join(workspace.rootDir, name);
    const backup = path.join(parent, 'backup');
    fs.renameSync(target, backup);
    assert.throws(() => validateWorkspace(workspace.rootDir), { message }, `missing ${name}`);
    assert.equal(fs.existsSync(target), false);
    const directory = fs.statSync(backup).isDirectory();
    if (directory) fs.writeFileSync(target, 'wrong type');
    else fs.mkdirSync(target);
    assert.throws(() => validateWorkspace(workspace.rootDir), { message }, `wrong type ${name}`);
    if (directory) fs.unlinkSync(target);
    else fs.rmdirSync(target);
    fs.renameSync(backup, target);
  }
  fs.rmdirSync(workspace.dataDir);
  assert.equal(validateWorkspace(workspace.rootDir), fs.realpathSync(workspace.rootDir));
});

test('new projects reject invalid names and missing parent folders before writing', t => {
  const parent = temporaryDirectory(t);
  for (const name of ['', '..', '../escape', 'nested/folder', 'nested\\folder', 'CON', 'nul.txt', 'trailing.', 'bad:name', 'x'.repeat(121)]) assert.throws(() => createWorkspace(parent, name), /valid project name/);
  assert.throws(() => createWorkspace(path.join(parent, 'missing'), 'Study'));
  assert.deepEqual(fs.readdirSync(parent), []);
});

test('workspace initialization preserves existing instructions, pages and source bytes', t => {
  const root = temporaryDirectory(t);
  fs.mkdirSync(path.join(root, 'raw'));
  fs.mkdirSync(path.join(root, 'wiki'));
  fs.writeFileSync(path.join(root, 'raw', 'source.txt'), 'original source');
  fs.writeFileSync(path.join(root, 'wiki', 'index.md'), '# Existing index');
  fs.writeFileSync(path.join(root, 'GEMINI.md'), 'Project-specific instructions');
  const workspace = initializeWorkspace(root);
  assert.equal(workspace.instructions, 'Project-specific instructions');
  assert.equal(fs.readFileSync(path.join(root, 'wiki', 'index.md'), 'utf8'), '# Existing index');
  assert.equal(fs.readFileSync(path.join(root, 'raw', 'source.txt'), 'utf8'), 'original source');
  assert.ok(fs.existsSync(path.join(root, 'wiki', 'log.md')));
  const empty = createFolder(root, 'Independent project');
  const other = initializeWorkspace(empty);
  assert.doesNotMatch(other.instructions, /pulsar astronomy|original source|Project-specific/);
  assert.match(other.instructions, /Selecting Add to wiki authorises/);
  assert.deepEqual(fs.readdirSync(other.rawDir), []);
});

test('workspace initialization rejects invalid paths and conflicting layouts', t => {
  const root = temporaryDirectory(t);
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'keep');
  assert.throws(() => initializeWorkspace('relative/path'));
  assert.throws(() => initializeWorkspace(path.join(root, 'unrelated.txt')));
  fs.writeFileSync(path.join(root, 'wiki'), 'not a directory');
  assert.throws(() => initializeWorkspace(root), /wiki must be a folder/);
  assert.equal(fs.existsSync(path.join(root, 'GEMINI.md')), false);
});

async function startServer(t) {
  const child = spawn(process.execPath, ['scripts/server-runner.js', '0'], { cwd: path.join(__dirname, '..'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null) child.kill('SIGTERM'); await exited; });
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0]);
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('exit', () => reject(new Error(output)));
  });
}

test('server remembers selections and isolates simultaneous projects across APIs, uploads and sockets', async t => {
  const root = temporaryDirectory(t);
  const firstPath = createWorkspace(root, 'Project one').rootDir;
  const secondPath = createWorkspace(root, 'Project two').rootDir;
  const url = await startServer(t);
  const page = await fetch(url);
  const cookie = page.headers.getSetCookie()[0].split(';')[0];
  const request = (route, { id, method = 'GET', body, workspaceCookie, origin = url } = {}) => fetch(url + route, {
    method,
    headers: { Cookie: cookie + (workspaceCookie ? `; ${workspaceCookie}` : ''), Origin: origin, ...(id ? { 'X-PulsarWiki-Workspace': id } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal((await (await request('/api/workspaces')).json()).active, null);
  assert.equal((await request('/api/wiki')).status, 409);
  assert.equal((await fetch(url + '/api/workspaces')).status, 403);
  assert.equal((await request('/api/workspaces/open', { method: 'POST', body: { path: firstPath }, origin: 'http://example.com' })).status, 403);
  assert.equal((await request('/api/workspaces/create', { method: 'POST', body: { parentPath: root, name: 'New study' }, origin: 'http://example.com' })).status, 403);
  const createdResponse = await request('/api/workspaces/create', { id: 'closed', method: 'POST', body: { parentPath: root, name: 'New study' } });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).active;
  assert.equal(created.path, path.join(fs.realpathSync(root), 'New study'));
  assert.ok(createdResponse.headers.getSetCookie().some(value => value.startsWith(`pulsarwiki_workspace=${created.id};`)));
  assert.equal((await (await request('/api/workspaces', { id: created.id })).json()).active.id, created.id);
  assert.equal((await request('/api/wiki', { id: created.id })).status, 200);
  assert.equal((await request('/api/workspaces/create', { method: 'POST', body: { parentPath: root, name: 'New study' } })).status, 400);

  const unrelated = createFolder(root, 'Unrelated');
  const rejected = await request('/api/workspaces/open', { method: 'POST', body: { path: unrelated } });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, 'this project is not compatible. Please select a different project');
  assert.deepEqual(fs.readdirSync(unrelated), []);
  assert.ok(!rejected.headers.getSetCookie().some(value => value.startsWith('pulsarwiki_workspace=')));
  assert.equal((await (await request('/api/workspaces', { id: created.id })).json()).active.id, created.id);

  const openResponse = await request('/api/workspaces/open', { method: 'POST', body: { path: firstPath } });
  assert.equal(openResponse.status, 200);
  const first = (await openResponse.json()).active;
  const workspaceCookie = openResponse.headers.getSetCookie().find(value => value.startsWith('pulsarwiki_workspace=')).split(';')[0];
  assert.doesNotMatch(workspaceCookie, /Max-Age|Expires/);
  assert.equal((await (await request('/api/workspaces', { workspaceCookie })).json()).active.path, first.path);
  const second = (await (await request('/api/workspaces/open', { method: 'POST', body: { path: secondPath } })).json()).active;
  assert.notEqual(first.id, second.id);
  assert.equal((await (await request('/api/workspaces', { id: first.id })).json()).active.path, first.path);
  assert.equal((await (await request('/api/workspaces/open', { method: 'POST', body: { path: firstPath } })).json()).active.id, first.id);

  const explorerFile = 'notebooks/Field data/run +1 #2.txt';
  fs.mkdirSync(path.join(firstPath, 'Field data'));
  fs.mkdirSync(path.join(firstPath, 'notebooks', 'Field data'));
  fs.writeFileSync(path.join(firstPath, explorerFile), 'sample data');
  fs.writeFileSync(path.join(firstPath, 'Field data', 'outside.txt'), 'outside the explorer');
  fs.writeFileSync(path.join(firstPath, 'notebooks', 'Field data', 'gemini.md'), 'Nested instructions');
  fs.symlinkSync(secondPath, path.join(firstPath, 'notebooks', 'linked-project'), 'junction');
  const explorer = (suffix = '', id = first.id) => request('/api/workspaces/explorer' + suffix, { id });
  const rootEntries = (await (await explorer()).json()).entries;
  assert.deepEqual(rootEntries, ['notebooks', 'raw', 'wiki'].map(name => ({ name, directory: true })));
  assert.deepEqual((await (await explorer('?path=notebooks')).json()).entries, [{ name: 'Field data', directory: true }]);
  assert.deepEqual((await (await explorer('?path=notebooks%2FField%20data')).json()).entries, [{ name: 'run +1 #2.txt', directory: false }]);
  const download = `/download?${new URLSearchParams({ path: explorerFile })}`;
  const attachment = await explorer(download);
  assert.match(attachment.headers.get('content-disposition'), /^attachment/);
  assert.equal(await attachment.text(), 'sample data');
  assert.equal((await explorer(download, second.id)).status, 404);
  for (const name of ['Field data', 'notebooks/../../Project two', '.pulsarwiki', 'notebooks/linked-project']) {
    assert.equal((await explorer(`?${new URLSearchParams({ path: name })}`)).status, 404);
  }
  assert.equal((await explorer('/download?path=Field%20data%2Foutside.txt')).status, 404);
  assert.equal((await explorer('/download?path=references.bib')).status, 404);
  assert.equal((await explorer('/download?path=notebooks%2Flinked-project%2FGEMINI.md')).status, 404);

  const thread = await (await request('/api/chat/threads', { id: first.id, method: 'POST', body: { title: 'Only project one' } })).json();
  assert.match(JSON.parse(fs.readFileSync(path.join(firstPath, '.pulsarwiki', 'chat', 'threads.json'), 'utf8')).threads[0].instructionSnapshot, /Maintain a source-backed research/);
  assert.equal((await (await request('/api/chat/threads', { id: second.id })).json()).length, 0);
  assert.equal((await request(`/api/chat/threads/${thread.id}`, { id: second.id })).status, 404);
  await request('/api/wiki/project-one', { id: first.id, method: 'PUT', body: { content: '# Only one\n\n[[index]]' } });
  assert.equal((await request('/api/wiki/project-one', { id: second.id })).status, 404);
  assert.equal((await (await request('/api/search?q=Only', { id: first.id })).json()).length, 1);
  assert.equal((await (await request('/api/search?q=Only', { id: second.id })).json()).length, 0);
  const raw = path.join(firstPath, 'raw');
  fs.writeFileSync(path.join(raw, 'multiline source.txt'), 'PSR\nB1913+16');
  fs.writeFileSync(path.join(raw, 'catalogue.md'), 'An observing catalogue.');
  fs.copyFileSync(path.join(__dirname, '..', 'raw', '1011.0718.pdf'), path.join(raw, 'binary pulsar.pdf'));
  const notebook = path.join(firstPath, 'notebooks', 'analyses', 'pulsar study.ipynb');
  fs.mkdirSync(path.dirname(notebook));
  const notebookContents = JSON.stringify({ nbformat: 4, metadata: {}, cells: [
    { cell_type: 'code', id: 'timing', source: ['target = "PSR B1913+16"'], outputs: [{ text: 'Calculated residual' }] },
    { cell_type: 'markdown', source: ['**Legacy notebook** cell'] },
  ] });
  fs.writeFileSync(notebook, notebookContents);
  const firstMeasurement = 'Measurements of PSR B1913+16 (source: [PSR B1913+16](/#file/catalogue.md))';
  const wikiText = [
    '# Results',
    '',
    '**Summary**: Timing observations.',
    '**Sources**: [PSR B1913+16 catalogue.md](/#file/catalogue.md)',
    '- [[citation-only]]',
    '**Last updated**: 2026-11-23',
    '',
    firstMeasurement,
    'Second occurrence: PSR B1913+16',
  ].join('\r\n');
  fs.writeFileSync(path.join(firstPath, 'wiki', 'timing-result.md'), wikiText);
  fs.writeFileSync(path.join(firstPath, 'wiki', 'references-only.md'), '# References\n\n**Sources**: [PSR B1913+16 catalogue.md](/#file/catalogue.md)');
  fs.writeFileSync(path.join(firstPath, 'wiki', 'background.md'), [
    '# Background',
    'See [PSR B1913+16](/#file/catalogue.md?search=citation-query) for details.',
    'Additional context is in [citation-passage](/#reading/document/highlight).',
    'The archived file is catalogue.md.',
  ].join('\n\n'));
  const find = (query, id = first.id) => request(`/api/workspaces/search?q=${encodeURIComponent(query)}`, { id }).then(response => response.json());
  const found = await find('psr b1913+16');
  assert.equal(found.unavailable, 0);
  assert.deepEqual(found.results.map(result => result.type), ['Wiki', 'Source', 'Source', 'Notebook']);
  assert.equal(found.results[0].url, '/wiki/timing-result');
  assert.equal(found.results[0].name, 'timing-result.md');
  assert.equal(found.results[0].matches[0].markdown, true);
  assert.equal(found.results[0].matches[0].text, `${firstMeasurement}\r\nSecond occurrence: PSR B1913+16`);
  assert.deepEqual(found.results[0].matches.map(match => match.location), ['Line 8', 'Line 9']);
  const bodyStart = wikiText.indexOf('Measurements');
  const offsets = [wikiText.indexOf('PSR B1913+16', bodyStart), wikiText.lastIndexOf('PSR B1913+16')];
  assert.deepEqual(found.results[0].matches.map(match => match.url), offsets.map(start => `/wiki/timing-result?start=${start}&end=${start + 'PSR B1913+16'.length}`));
  assert.deepEqual((await find('catalogue')).results.map(({ type, name }) => ({ type, name })), [{ type: 'Source', name: 'catalogue.md' }]);
  assert.deepEqual(await find('citat'), { results: [], unavailable: 0 });
  assert.match(found.results[1].matches[0].url, /^\/#file\/binary%20pulsar\.pdf\?page=\d+&start=\d+&end=\d+$/);
  assert.equal(found.results[2].matches[0].text, 'PSR B1913+16');
  assert.equal(found.results[2].matches[0].markdown, undefined);
  assert.equal(found.results[2].matches[0].url, '/#file/multiline%20source.txt?start=0&end=12');
  assert.equal(found.results[3].matches[0].url, '/#notebook/?path=analyses%2Fpulsar%20study.ipynb&cell=timing');
  assert.equal(found.results[3].matches[0].markdown, undefined);
  assert.equal((await find('calculated residual')).results[0].matches[0].location, 'Cell 1 output');
  const legacyMatch = (await find('legacy notebook')).results[0].matches[0];
  assert.match(legacyMatch.url, /&cellIndex=1$/);
  assert.equal(legacyMatch.markdown, true);
  assert.equal(legacyMatch.text, '**Legacy notebook** cell');
  assert.ok((await find('measur')).suggestions.includes('Measurements'));
  assert.deepEqual(await find('psr b1913+16', second.id), { results: [], unavailable: 0 });
  assert.equal(fs.readFileSync(notebook, 'utf8'), notebookContents);
  assert.equal(fs.existsSync(path.join(firstPath, '.pulsarwiki', 'notebooks', 'catalog.json')), false);
  assert.ok((await (await request('/api/graph', { id: first.id })).json()).nodes.some(node => node.id === 'project-one'));
  assert.ok(!(await (await request('/api/graph', { id: second.id })).json()).nodes.some(node => node.id === 'project-one'));

  const uploaded = await fetch(url + '/api/upload', { method: 'POST', headers: { Cookie: cookie, Origin: url, 'X-PulsarWiki-Workspace': first.id, 'X-Filename': 'evidence.txt' }, body: 'immutable evidence' });
  assert.equal(uploaded.status, 200);
  const upload = await uploaded.json();
  assert.equal(fs.readFileSync(path.join(firstPath, 'raw', 'evidence.txt'), 'utf8'), 'immutable evidence');
  assert.match(fs.readFileSync(path.join(firstPath, 'references.bib'), 'utf8'), /file = \{raw\/evidence.txt\}/);
  const references = await (await request('/api/references', { id: first.id })).json();
  const editedReferences = `${references.content}\n% Edited from the References tab\n`;
  assert.equal((await request('/api/references', { id: first.id, method: 'PUT', body: { content: editedReferences, revision: references.revision } })).status, 200);
  assert.equal(fs.readFileSync(path.join(firstPath, 'references.bib'), 'utf8'), editedReferences);
  assert.equal((await request('/api/references', { id: first.id, method: 'PUT', body: { content: 'stale', revision: references.revision } })).status, 409);
  assert.equal((await (await request('/api/references', { id: second.id })).json()).content, '');
  assert.equal((await request('/api/references', { id: first.id, method: 'PUT', origin: 'http://example.com', body: { content: 'blocked', revision: references.revision } })).status, 403);
  assert.equal((await (await request('/api/raw', { id: second.id })).json()).length, 0);
  assert.equal((await request(`/api/sources/jobs/${upload.ingestJob.id}`, { id: second.id })).status, 404);
  assert.equal(await (await request(`/api/raw/evidence.txt?workspace=${first.id}`)).text(), 'immutable evidence');
  assert.equal((await request(`/api/raw/evidence.txt?workspace=${second.id}`)).status, 404);
  const collection = await (await request('/api/reading/collections', { id: first.id, method: 'POST', body: { name: 'Private project one' } })).json();
  assert.ok(collection.id);
  assert.equal((await (await request('/api/reading', { id: second.id })).json()).collections.length, 0);
  assert.equal((await (await request(`/api/reading/export?workspace=${first.id}`)).json()).collections.length, 1);
  assert.equal((await (await request(`/api/reading/export?workspace=${second.id}`)).json()).collections.length, 0);

  // Project downloads use the requesting tab and include saved data without machine-local settings.
  fs.writeFileSync(path.join(firstPath, '.pulsarwiki', 'source-settings.json'), '{"test":"credential"}');
  const outside = createFolder(root, 'Outside project');
  fs.writeFileSync(path.join(outside, 'external.txt'), 'outside the selected workspace');
  fs.symlinkSync(outside, path.join(firstPath, 'raw', 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await fetch(url + `/api/workspaces/export?workspace=${first.id}`)).status, 403);
  assert.equal((await request('/api/workspaces/export')).status, 409);
  const exported = await request(`/api/workspaces/export?workspace=${first.id}`, { workspaceCookie: `pulsarwiki_workspace=${second.id}` });
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get('content-type'), 'application/zip');
  assert.equal(exported.headers.get('content-disposition'), 'attachment; filename="Project one.zip"');
  assert.equal(exported.headers.get('cache-control'), 'no-store');
  const firstZip = Buffer.from(await exported.arrayBuffer());
  assert.equal(firstZip.readUInt32LE(0), 0x04034b50);
  for (const entry of ['raw/evidence.txt', 'wiki/project-one.md', 'notebooks/', '.pulsarwiki/chat/threads.json', '.pulsarwiki/reading/reading.json']) {
    assert.ok(firstZip.includes(entry), `Expected ${entry} in the archive`);
  }
  assert.ok(!firstZip.includes('source-settings.json'));
  assert.ok(!firstZip.includes('external.txt'));
  const secondZip = Buffer.from(await (await request(`/api/workspaces/export?workspace=${second.id}`)).arrayBuffer());
  assert.ok(!secondZip.includes('raw/evidence.txt'));

  // Socket selection is fixed at connection time, independently of the latest cookie.
  const socket = new WebSocket(url.replace('http', 'ws') + `/?workspace=${second.id}`, { headers: { Cookie: cookie + '; ' + workspaceCookie, Origin: url } });
  const result = await new Promise((resolve, reject) => {
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'server-hello') socket.send(JSON.stringify({ type: 'chat', threadId: thread.id, text: 'Must not access the other project' }));
      if (message.type === 'error') { socket.close(); resolve(message); }
    });
    socket.once('error', reject);
  });
  assert.equal(result.code, 'thread-not-found');
  assert.equal((await request('/api/workspaces/open', { method: 'POST', body: { path: path.join(root, 'missing') } })).status, 400);
  assert.equal((await (await request('/api/workspaces', { id: first.id })).json()).active.id, first.id);
  assert.equal((await (await request('/api/workspaces', { id: 'stale-server-session', workspaceCookie })).json()).active, null);
  await request('/api/workspaces/close', { method: 'POST' });
  assert.equal((await (await request('/api/workspaces', { id: first.id })).json()).active.id, first.id);
});
