'use strict';

// Opt in with PULSARWIKI_TEST_PYTHON pointing to an environment containing JupyterLab and ipykernel.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');
const WebSocket = require('ws');
const { NotebookStore, blankNotebook } = require('../agent/notebook-store');
const { NotebookRuntime } = require('../agent/notebook-runtime');
const { NotebookService } = require('../agent/notebook-service');

test('live Jupyter embeds securely, saves versioned notebooks, executes Python over WebSocket and reruns a clean copy', { skip: !process.env.PULSARWIKI_TEST_PYTHON, timeout: 150000 }, async t => {
  const temp = path.join(__dirname, '..', '.tmp'); fs.mkdirSync(temp, { recursive: true });
  const rootDir = fs.mkdtempSync(path.join(temp, 'notebook-live-')); const dataDir = path.join(rootDir, '.pulsarwiki'); fs.mkdirSync(dataDir);
  const store = new NotebookStore({ rootDir, dataDir }); const runtime = new NotebookRuntime({ store });
  const service = new NotebookService({ store, runtime });
  t.after(async () => { await service.close(); fs.rmSync(rootDir, { recursive: true, force: true }); });
  await runtime.configure(path.resolve(process.env.PULSARWIKI_TEST_PYTHON));
  await runtime.start('http://127.0.0.1:3000'); await runtime.starting;
  assert.equal(runtime.state, 'running', runtime.error);
  const launch = runtime.launchTicket('http://127.0.0.1:3000');
  assert.equal((await fetch(`${launch.origin}/api/contents`)).status, 403);
  const bootstrap = await fetch(launch.url); assert.equal(bootstrap.status, 200); assert.equal(bootstrap.headers.get('content-security-policy').includes('frame-ancestors http://127.0.0.1:3000'), true);
  const authenticated = await fetch(`${launch.origin}/_bridge/auth`, { method: 'POST', headers: { origin: launch.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: launch.ticket }) });
  assert.equal(authenticated.status, 200); const cookie = authenticated.headers.get('set-cookie').split(';')[0];
  const replay = await fetch(`${launch.origin}/_bridge/auth`, { method: 'POST', headers: { origin: launch.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: launch.ticket }) }); assert.equal(replay.status, 403);
  const headers = { cookie, origin: launch.origin, 'Content-Type': 'application/json' };
  const api = async (suffix, method = 'GET', body) => {
    const response = await fetch(`${launch.origin}${suffix}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.text(); assert.ok(response.ok, `${suffix}: ${response.status} ${value.slice(0, 1500)}`); return value ? JSON.parse(value) : null;
  };
  const html = await fetch(`${launch.origin}/lab`, { headers }); const page = await html.text(); assert.equal(html.status, 200); assert.match(page, /pulsarwiki-notebook-bridge/); assert.ok(!page.includes(runtime.token));
  const foreign = await fetch(`${launch.origin}/api/contents`, { method: 'POST', headers: { ...headers, origin: 'http://evil.example' }, body: '{}' }); assert.equal(foreign.status, 403);
  // The launcher uses POST without content; initialise before its first save.
  const created = await api('/api/contents', 'POST', { type: 'notebook' });
  const initial = await api(`/api/contents/${created.path}`);
  assert.deepEqual(initial.content.cells.map(cell => [cell.cell_type, cell.source.split('\n')[0]]), [
    ['markdown', '# Title'], ['markdown', '## Objective'],
    ['markdown', '## Live notes'], ['markdown', '## Preliminary analysis'],
  ]);
  assert.equal(store.sync().find(book => book.path === created.path).revision, 1);
  initial.content.cells = [];
  await api(`/api/contents/${created.path}`, 'PUT', { type: 'notebook', format: 'json', content: initial.content });
  assert.deepEqual((await api(`/api/contents/${created.path}`)).content.cells, []);
  const copy = await api('/api/contents', 'POST', { copy_from: created.path });
  assert.deepEqual((await api(`/api/contents/${copy.path}`)).content.cells, []);
  const named = await api('/api/contents/named.ipynb', 'PUT', { type: 'notebook' });
  assert.equal((await api(`/api/contents/${named.path}`)).content.cells.length, 4);
  const notebook = blankNotebook(); notebook.cells[0].source = '# Small analysis\n\n$$y = x^2$$';
  notebook.cells.push({ id: 'code-one', cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: 'print(2 + 2)' });
  notebook.cells.push({ id: 'plot-one', cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: 'import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [1, 4, 9])\nplt.show()' });
  await api('/api/contents/live.ipynb', 'PUT', { type: 'notebook', format: 'json', content: notebook });
  const entry = store.sync().find(book => book.path === 'live.ipynb'); assert.ok(entry); assert.equal(entry.revision, 1);
  const content = await api('/api/contents/live.ipynb'); assert.equal(content.content.cells[1].source, 'print(2 + 2)');
  const session = await api('/api/sessions', 'POST', { path: 'live.ipynb', type: 'notebook', name: 'live.ipynb', kernel: { name: 'pulsarwiki-python' } });
  const ws = new WebSocket(`${launch.origin.replace('http:', 'ws:')}/api/kernels/${session.kernel.id}/channels?session_id=${crypto.randomUUID()}`, { headers: { cookie, origin: launch.origin } });
  t.after(() => ws.terminate());
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const messageId = crypto.randomUUID(); const output = [];
  const complete = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Python execution timed out')), 30000);
    ws.on('message', raw => {
      const event = JSON.parse(raw.toString()); if (event.parent_header?.msg_id !== messageId) return;
      if (event.header.msg_type === 'stream') output.push(event.content.text);
      if (event.header.msg_type === 'execute_reply') { clearTimeout(timeout); event.content.status === 'ok' ? resolve() : reject(Error(JSON.stringify(event.content))); }
    });
  });
  ws.send(JSON.stringify({ header: { msg_id: messageId, username: 'researcher', session: crypto.randomUUID(), msg_type: 'execute_request', version: '5.3', date: new Date().toISOString() }, parent_header: {}, metadata: {}, content: { code: 'print(2 + 2)', silent: false, store_history: true, user_expressions: {}, allow_stdin: false, stop_on_error: true }, channel: 'shell', buffers: [] }));
  await complete; assert.match(output.join(''), /4/);
  ws.close(); await api(`/api/sessions/${session.id}`, 'DELETE');
  const clean = await service.rerun(entry.id, { revision: entry.revision });
  let result;
  for (let i = 0; i < 180; i++) { result = store.load().runs.find(r => r.id === clean.id); if (result.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 250)); }
  assert.equal(result.status, 'completed', result.error); assert.ok(result.resultNotebookId); assert.notEqual(result.resultNotebookId, entry.id);
  const rerun = store.read(result.resultNotebookId); assert.match(rerun.notebook.cells[1].outputs[0].text.join ? rerun.notebook.cells[1].outputs[0].text.join('') : rerun.notebook.cells[1].outputs[0].text, /4/);
  assert.ok(rerun.notebook.cells[2].outputs.some(output => output.data?.['image/png']), 'the real plotting output should survive execution and history');
  assert.equal(store.entry(entry.id).revision, 1);
});
