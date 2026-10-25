'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const WebSocket = require('ws');
const { initializeWorkspace, createWorkspace } = require('../agent/workspaces');

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
  const firstPath = createFolder(root, 'Project one');
  const secondPath = createFolder(root, 'Project two');
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

  const thread = await (await request('/api/chat/threads', { id: first.id, method: 'POST', body: { title: 'Only project one' } })).json();
  assert.match(JSON.parse(fs.readFileSync(path.join(firstPath, '.pulsarwiki', 'chat', 'threads.json'), 'utf8')).threads[0].instructionSnapshot, /Maintain a source-backed research/);
  assert.equal((await (await request('/api/chat/threads', { id: second.id })).json()).length, 0);
  assert.equal((await request(`/api/chat/threads/${thread.id}`, { id: second.id })).status, 404);
  await request('/api/wiki/project-one', { id: first.id, method: 'PUT', body: { content: '# Only one\n\n[[index]]' } });
  assert.equal((await request('/api/wiki/project-one', { id: second.id })).status, 404);
  assert.equal((await (await request('/api/search?q=Only', { id: first.id })).json()).length, 1);
  assert.equal((await (await request('/api/search?q=Only', { id: second.id })).json()).length, 0);
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
