'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const WebSocket = require('ws');
const { NotebookError, MAX_NOTEBOOK_BYTES, safePath } = require('./notebook-store');

const run = promisify(execFile);
const SCRIPT = path.join(__dirname, '..', 'integrations', 'jupyter', 'runtime.py');
const secret = () => crypto.randomBytes(32).toString('hex');
const equal = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const probe = net.createServer(); await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port;
}
async function jsonBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_NOTEBOOK_BYTES + 1024 * 1024) throw new NotebookError('Notebook request is too large.', 'notebook-too-large', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new NotebookError('Invalid notebook request.'); }
}
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }

class NotebookRuntime {
  constructor({ store }) {
    this.store = store; this.state = 'stopped'; this.error = ''; this.gateway = null; this.child = null; this.tickets = new Map(); this.sockets = new Set(); this.cookieName = `pw_notebook_${crypto.randomUUID().replaceAll('-', '')}`;
    this.settingsFile = safePath(store.dataDir, 'python.json');
  }
  settings() { try { return JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')); } catch { return { python: 'python' }; } }
  status() { return { state: this.state, error: this.error, python: this.settings().python, environment: this.environment || null, origin: this.state === 'running' ? this.origin : null }; }
  async probe(python = this.settings().python) {
    if (typeof python !== 'string' || !python.trim() || python.length > 2000) throw new NotebookError('Enter a Python interpreter path.');
    try {
      const { stdout } = await run(python.trim(), [SCRIPT, '--probe'], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
      return JSON.parse(stdout.trim());
    } catch { throw new NotebookError('Python could not be inspected. Select a working interpreter with JupyterLab, ipykernel, nbformat and nbclient installed.', 'python-unavailable', 503); }
  }
  async configure(python) {
    if (this.state === 'starting' || this.state === 'running') throw new NotebookError('Stop the notebook runtime before changing Python.', 'runtime-busy', 409);
    const environment = await this.probe(python); this.store.atomic(this.settingsFile, JSON.stringify({ python: python.trim() })); this.environment = environment; return this.status();
  }
  async start(parentOrigin) {
    if (['starting', 'running'].includes(this.state)) return this.status();
    if (this.state === 'stopping') throw new NotebookError('Wait for the notebook runtime to stop.', 'runtime-busy', 409);
    if (this.state === 'failed') await this.dispose();
    this.state = 'starting'; this.error = ''; this.parentOrigin = parentOrigin;
    this.starting = this.launch().catch(async error => { this.error = error.message; await this.dispose(); this.state = 'failed'; });
    return this.status();
  }
  async launch() {
    const environment = await this.probe();
    if (this.state !== 'starting') return;
    if (!environment.ready) throw new NotebookError(`The selected Python environment needs: ${(environment.missing || []).join(', ') || environment.error || 'Jupyter dependencies'}. Install them, then start again.`, 'python-not-ready', 503);
    const extension = path.join(__dirname, '..', 'integrations', 'jupyterlab', 'extensions', 'pulsarwiki-notebook-bridge', 'package.json');
    if (!fs.existsSync(extension)) throw new NotebookError('The JupyterLab bridge is missing. Run npm run build:notebooks, then start again.', 'bridge-missing', 503);
    this.environment = { ...environment, capturedAt: new Date().toISOString() }; this.internalKey = secret(); this.token = secret(); this.cookie = secret(); this.channel = secret();
    this.upstreamPort = await freePort(); this.upstream = `http://127.0.0.1:${this.upstreamPort}`;
    if (this.state !== 'starting') return;
    this.gateway = http.createServer((req, res) => { void this.handle(req, res).catch(error => { if (!res.headersSent) send(res, error.status || 500, { error: error.message }); else res.destroy(); }); });
    this.gateway.on('connection', socket => { this.sockets.add(socket); socket.once('close', () => this.sockets.delete(socket)); });
    this.gateway.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
    await new Promise((resolve, reject) => { this.gateway.once('error', reject); this.gateway.listen(0, '127.0.0.1', resolve); });
    // Match the parent's loopback hostname so SameSite cookies work in frames
    // opened from either localhost or 127.0.0.1.
    const browserHost = new URL(this.parentOrigin).hostname === 'localhost' ? 'localhost' : '127.0.0.1';
    this.origin = `http://${browserHost}:${this.gateway.address().port}`;
    const runtimeDir = safePath(this.store.dataDir, 'runtime');
    fs.mkdirSync(path.join(runtimeDir, 'share', 'kernels', 'pulsarwiki-python'), { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'share', 'kernels', 'pulsarwiki-python', 'kernel.json'), JSON.stringify({ argv: [environment.executable, '-m', 'ipykernel_launcher', '-f', '{connection_file}'], display_name: 'Workspace Python', language: 'python' }));
    this.env = { ...process.env, JUPYTER_CONFIG_DIR: path.join(runtimeDir, 'config'), JUPYTER_RUNTIME_DIR: path.join(runtimeDir, 'sessions'), JUPYTER_DATA_DIR: path.join(runtimeDir, 'data'), JUPYTER_PATH: [path.join(runtimeDir, 'share'), process.env.JUPYTER_PATH].filter(Boolean).join(path.delimiter), PULSARWIKI_CALLBACK: this.origin, PULSARWIKI_INTERNAL_KEY: this.internalKey, PULSARWIKI_JUPYTER_TOKEN: this.token, PULSARWIKI_JUPYTER_PORT: String(this.upstreamPort), PULSARWIKI_NOTEBOOK_DIR: this.store.dir };
    this.child = spawn(environment.executable, [SCRIPT], { env: this.env, cwd: this.store.dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let launchError = ''; const clean = value => String(value).replaceAll(this.token, '[redacted]').replaceAll(this.internalKey, '[redacted]').replace(/([?&]token=)[^&\s]+/gi, '$1[redacted]');
    this.child.stdout.on('data', () => {});
    this.child.stderr.on('data', data => { launchError = (launchError + clean(data)).slice(-2000); });
    this.child.once('error', () => { launchError = 'Python could not be started.'; });
    this.child.once('exit', () => { if (this.state === 'running') { this.state = 'failed'; this.error = 'Jupyter stopped. Saved notebooks and history are preserved; start again to reconnect.'; } });
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (this.state !== 'starting') return;
      if (this.child.exitCode !== null || this.child.killed) throw new NotebookError(`Jupyter could not start. ${launchError}`, 'jupyter-start-failed', 503);
      try {
        const response = await fetch(`${this.upstream}/api`, { headers: { Authorization: `token ${this.token}` }, signal: AbortSignal.timeout(750) });
        if (response.ok) { this.state = 'running'; return; }
        this.lastHealth = `HTTP ${response.status}`;
      } catch (error) { this.lastHealth = error.cause?.code || error.message; }
      await delay(250);
    }
    throw new NotebookError(`Jupyter did not become ready within 60 seconds (${this.lastHealth || 'no response'}). ${launchError || 'Check the Python environment and retry.'}`, 'jupyter-timeout', 503);
  }
  launchTicket(parentOrigin) {
    if (this.state !== 'running') throw new NotebookError('Start the notebook runtime first.', 'runtime-stopped', 409);
    if (parentOrigin !== this.parentOrigin) throw new NotebookError('Use the same PulsarWiki address as the running notebook session.', 'runtime-origin', 409);
    const ticket = secret(); for (const [key, expiry] of this.tickets) if (expiry < Date.now()) this.tickets.delete(key);
    this.tickets.set(ticket, Date.now() + 30000);
    return { origin: this.origin, url: `${this.origin}/_bridge/bootstrap`, ticket, channel: this.channel };
  }
  authenticated(req) {
    const cookies = String(req.headers.cookie || '').split(';').map(s => s.trim());
    return cookies.some(value => value.startsWith(`${this.cookieName}=`) && equal(value.slice(this.cookieName.length + 1), this.cookie));
  }
  validHost(req) { return req.headers.host === new URL(this.origin).host; }
  async handle(req, res) {
    if (!this.validHost(req)) return send(res, 403, { error: 'Invalid notebook host.' });
    const url = new URL(req.url, this.origin);
    res.setHeader('Content-Security-Policy', `frame-ancestors ${this.parentOrigin}`);
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (url.pathname === '/_bridge/content') {
      if (req.method !== 'POST' || !equal(req.headers.authorization, `Bearer ${this.internalKey}`)) return send(res, 403, { error: 'Invalid notebook save session.' });
      const body = await jsonBody(req); const entry = this.store.savePath(body.path, body.notebook); return send(res, 200, entry);
    }
    if (url.pathname === '/_bridge/bootstrap' && req.method === 'GET') {
      const parent = JSON.stringify(this.parentOrigin);
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors ${this.parentOrigin}` });
      return res.end(`<!doctype html><html><body><p>Connecting notebook…</p><script>const parentOrigin=${parent}; window.addEventListener('message', async e => { if(e.source!==parent || e.origin!==parentOrigin || e.data?.type!=='pulsarwiki-auth')return; try {const r=await fetch('/_bridge/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:e.data.ticket})});if(!r.ok)throw Error('Notebook session expired. Reconnect.');location.replace('/lab');}catch(error){document.querySelector('p').textContent=error.message;}});parent.postMessage({type:'pulsarwiki-bootstrap'},parentOrigin);</script></body></html>`);
    }
    if (url.pathname === '/_bridge/auth' && req.method === 'POST') {
      if (req.headers.origin !== this.origin) return send(res, 403, { error: 'Invalid notebook origin.' });
      const { ticket } = await jsonBody(req); const expiry = this.tickets.get(ticket); this.tickets.delete(ticket);
      if (!expiry || expiry < Date.now()) return send(res, 403, { error: 'Notebook launch expired. Reconnect.' });
      res.setHeader('Set-Cookie', `${this.cookieName}=${this.cookie}; HttpOnly; SameSite=Strict; Path=/`); return send(res, 200, { ok: true });
    }
    if (!this.authenticated(req)) return send(res, 403, { error: 'Open notebooks through PulsarWiki.' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== this.origin) return send(res, 403, { error: 'Invalid notebook origin.' });
    if (url.pathname === '/_bridge/config' && req.method === 'GET') return send(res, 200, { parentOrigin: this.parentOrigin, channel: this.channel });
    if (url.pathname.startsWith('/_bridge/')) return send(res, 404, { error: 'Unknown notebook operation.' });
    const upstream = http.request({ hostname: '127.0.0.1', port: this.upstreamPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${this.upstreamPort}`, authorization: `token ${this.token}`, origin: this.upstream, cookie: '' } }, response => {
      const headers = { ...response.headers, 'content-security-policy': `frame-ancestors ${this.parentOrigin}`, 'referrer-policy': 'no-referrer' };
      delete headers['x-frame-options']; delete headers['set-cookie']; delete headers['access-control-allow-origin'];
      if (headers.location?.startsWith(this.upstream)) headers.location = headers.location.replace(this.upstream, this.origin);
      res.writeHead(response.statusCode, headers); response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) send(res, 503, { error: 'Jupyter disconnected. Reconnect from PulsarWiki.' }); else res.destroy(); });
    req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
  }
  upgrade(req, socket, head) {
    if (!this.validHost(req) || !this.authenticated(req) || req.headers.origin !== this.origin || this.state !== 'running') return socket.destroy();
    const protocols = String(req.headers['sec-websocket-protocol'] || '').split(',').map(p => p.trim()).filter(Boolean);
    const upstream = new WebSocket(`ws://127.0.0.1:${this.upstreamPort}${req.url}`, protocols, { headers: { Authorization: `token ${this.token}`, Origin: this.upstream }, maxPayload: MAX_NOTEBOOK_BYTES });
    let downstream; const queue = []; let size = 0;
    upstream.on('message', (data, binary) => { if (downstream?.readyState === WebSocket.OPEN) downstream.send(data, { binary }); else { size += data.length; if (size > MAX_NOTEBOOK_BYTES) upstream.close(); else queue.push([data, binary]); } });
    upstream.once('open', () => {
      const server = new WebSocket.Server({ noServer: true, maxPayload: MAX_NOTEBOOK_BYTES });
      server.handleUpgrade(req, socket, head, ws => {
        downstream = ws; for (const [data, binary] of queue) ws.send(data, { binary }); queue.length = 0;
        ws.on('message', (data, binary) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary }); });
        ws.once('close', () => upstream.close()); ws.on('error', () => upstream.close());
      });
    });
    upstream.on('error', () => { socket.destroy(); downstream?.terminate(); });
    upstream.once('close', () => { downstream?.close(); if (!downstream) socket.destroy(); });
    socket.once('close', () => upstream.close());
  }
  async dispose() {
    this.tickets.clear();
    if (this.child && this.child.exitCode === null) {
      try { await fetch(`${this.upstream}/api/shutdown`, { method: 'POST', headers: { Authorization: `token ${this.token}` }, signal: AbortSignal.timeout(1500) }); } catch { /* may already have stopped */ }
      const child = this.child;
      if (child.exitCode === null) { await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(2000)]); if (child.exitCode === null) child.kill(); }
    }
    for (const socket of this.sockets) socket.destroy();
    if (this.gateway) await new Promise(resolve => this.gateway.close(resolve));
    this.gateway = null; this.child = null;
  }
  async stop() { this.state = 'stopping'; if (this.starting) await this.starting; await this.dispose(); this.state = 'stopped'; return this.status(); }
}

module.exports = { NotebookRuntime, jsonBody, equal, freePort };
