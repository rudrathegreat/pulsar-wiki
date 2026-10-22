'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const chokidar = require('chokidar');
const { AsyncLocalStorage } = require('node:async_hooks');
const { initializeWorkspace, describe } = require('./agent/workspaces');
const { pickFolder } = require('./agent/folder-picker');
const { AgentService, AgentServiceError } = require('./agent/agent-service');
const { ChatGPTAuthError, ChatGPTAuthService } = require('./agent/chatgpt-auth');
const { ThreadStore, ThreadStoreError } = require('./agent/thread-store');
const { WikiTools, WikiToolError } = require('./agent/wiki-tools');
const { ProviderError } = require('./agent/providers');
const { FILTERS: SOURCE_FILTERS, SourceDiscoveryService } = require('./agent/source-discovery');
const { SourceSettings } = require('./agent/source-settings');
const { PaperKeywords } = require('./agent/paper-keywords');
const { ReadingStore } = require('./agent/reading-store');
const { ReadingService } = require('./agent/reading-service');
const { createReadingRouter } = require('./agent/reading-router');
const { NotebookStore } = require('./agent/notebook-store');
const { NotebookRuntime } = require('./agent/notebook-runtime');
const { NotebookService } = require('./agent/notebook-service');
const { createNotebookRouter } = require('./agent/notebook-router');
const { HandoverService } = require('./agent/handover-service');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const ROOT_DIR = __dirname;
const PUB_DIR = path.join(ROOT_DIR, 'public');
const workspaceScope = new AsyncLocalStorage();
const workspaces = new Map();
const WORKSPACE_COOKIE = 'pulsarwiki_workspace';
const currentWorkspace = () => workspaceScope.getStore();
const CHAT_PROTOCOL_VERSION = 4;
const SESSION_COOKIE_NAME = 'pulsarwiki_session';
const SESSION_TOKEN = crypto.randomBytes(32).toString('hex');
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const CHAT_TIMEOUT_MS = 120000;
let boundPort = null;

const chatgptAuth = new ChatGPTAuthService();
const sourceSettings = new SourceSettings({ dataDir: path.join(ROOT_DIR, '.pulsarwiki') });

function openWorkspace(folder) {
  if (typeof folder !== 'string' || !folder.trim() || !path.isAbsolute(folder.trim())) throw new Error('Enter an absolute folder path.');
  folder = folder.trim();
  const root = fs.realpathSync(folder);
  const cached = [...workspaces.values()].find(workspace => workspace.rootDir === root);
  if (cached) return cached;
  const workspace = initializeWorkspace(folder);
  const { rootDir, wikiDir, rawDir, dataDir, instructions } = workspace;
  workspace.wikiTools = new WikiTools({ rootDir, wikiDir, rawDir, dataDir });
  workspace.agentService = new AgentService({ threadStore: new ThreadStore({ dataDir: path.join(dataDir, 'chat') }), authService: chatgptAuth, wikiTools: workspace.wikiTools, instructions });
  workspace.sourceDiscovery = new SourceDiscoveryService({ rawDir, adsToken: sourceSettings.token });
  workspace.paperKeywords = new PaperKeywords({ authService: chatgptAuth });
  workspace.readingService = new ReadingService({ store: new ReadingStore({ dataDir: path.join(dataDir, 'reading') }), wikiTools: workspace.wikiTools, authService: chatgptAuth, discovery: workspace.sourceDiscovery, instructions });
  workspace.ingestJobs = new Map();
  workspace.readingRouter = createReadingRouter({ service: workspace.readingService, requireLocalSession, requireLocalMutation, onImport: queueSourceIngest });
  const notebookStore = new NotebookStore({ rootDir, dataDir });
  workspace.notebookService = new NotebookService({ store: notebookStore, runtime: new NotebookRuntime({ store: notebookStore }), wikiTools: workspace.wikiTools, readingService: workspace.readingService, authService: chatgptAuth });
  workspace.handoverService = new HandoverService({ wikiTools: workspace.wikiTools, notebookService: workspace.notebookService, authService: chatgptAuth });
  workspace.notebookRouter = createNotebookRouter({ service: workspace.notebookService, requireLocalSession, requireLocalMutation });
  workspace.watcher = chokidar.watch([wikiDir, rawDir], { ignoreInitial: true }).on('all', (event, filePath) => {
    const payload = JSON.stringify({ type: 'filechange', event, path: filePath });
    wss.clients.forEach(client => { if (client.workspace === workspace && client.readyState === WebSocket.OPEN) client.send(payload); });
  });
  workspaces.set(workspace.id, workspace);
  return workspace;
}

function requestWorkspace(request) {
  const url = new URL(request.url, 'http://localhost');
  const id = request.headers['x-pulsarwiki-workspace'] || url.searchParams.get('workspace') || parseCookies(request.headers.cookie)[WORKSPACE_COOKIE];
  return workspaces.get(id) || null;
}

function publicIngestJob(job) {
  return {
    id: job.id,
    status: job.status,
    files: job.files,
    threadId: job.threadId || null,
    error: job.error || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

async function runIngestJob(job) {
  if (!job || ['running', 'completed'].includes(job.status)) return;
  let status;
  try { status = await chatgptAuth.status(); } catch { status = null; }
  if (!status?.ready) {
    job.status = 'awaiting-connection';
    job.updatedAt = new Date().toISOString();
    return;
  }
  job.status = 'running';
  job.updatedAt = new Date().toISOString();
  try {
    const names = job.files.map(file => file.name);
    const thread = currentWorkspace().agentService.createThread(`Ingest ${names.length === 1 ? names[0] : `${names.length} sources`}`);
    job.threadId = thread.id;
    const descriptions = job.files.map(file => {
      const details = [file.name];
      if (file.title) details.push(`title: ${file.title}`);
      if (file.doi) details.push(`DOI: ${file.doi}`);
      if (file.arxivId) details.push(`arXiv: ${file.arxivId}`);
      return `- ${details.join('; ')}`;
    }).join('\n');
    await currentWorkspace().agentService.runTurn({
      threadId: thread.id,
      text: `New research sources were imported into raw/:\n${descriptions}\n\nBegin the canonical ingest workflow for these sources and update the research workspace as allowed by GEMINI.md. Read every source in full and preserve source citations. If the workflow requires user review before edits, present the key takeaways in this saved chat and clearly state what confirmation is needed.`,
      onDelta() {}, onTool() {}, signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    job.status = 'completed';
  } catch (error) {
    job.status = 'failed';
    job.error = asPublicError(error).text;
  }
  job.updatedAt = new Date().toISOString();
}

function queueSourceIngest(files) {
  const normalized = (files || []).filter(file => file?.name).map(file => ({
    name: safeBase(file.name),
    title: typeof file.title === 'string' ? file.title.slice(0, 500) : null,
    doi: typeof file.doi === 'string' ? file.doi.slice(0, 200) : null,
    arxivId: typeof file.arxivId === 'string' ? file.arxivId.slice(0, 100) : null,
  }));
  if (!normalized.length) return null;
  const timestamp = new Date().toISOString();
  const job = { id: crypto.randomUUID(), status: 'queued', files: normalized, threadId: null, error: null, createdAt: timestamp, updatedAt: timestamp };
  currentWorkspace().ingestJobs.set(job.id, job);
  setImmediate(() => { void runIngestJob(job); });
  return publicIngestJob(job);
}

function resumePendingIngestJobs() {
  for (const workspace of workspaces.values()) workspaceScope.run(workspace, () => {
    for (const job of workspace.ingestJobs.values()) {
      if (['queued', 'awaiting-connection'].includes(job.status)) setImmediate(() => { void runIngestJob(job); });
    }
  });
}

app.use('/api/reading/import', express.json({ limit: '110mb' }));
app.use('/api/notebooks', express.json({ limit: '28mb' }));
app.use(express.json({ limit: '10mb' }));
app.use((_req, res, next) => {
  // The browser never sees this per-launch secret, but automatically includes
  // it in the loopback WebSocket upgrade.
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Strict`);
  next();
});
app.use(express.static(PUB_DIR));
app.use('/vendor/d3', express.static(path.join(ROOT_DIR, 'node_modules', 'd3', 'dist')));
app.use('/vendor/marked', express.static(path.join(ROOT_DIR, 'node_modules', 'marked', 'lib')));
app.use('/vendor/katex', express.static(path.join(ROOT_DIR, 'node_modules', 'katex', 'dist')));
app.use('/vendor/pdfjs', express.static(path.join(ROOT_DIR, 'node_modules', 'pdfjs-dist')));
app.get('/wiki/:page', (_req, res) => res.sendFile(path.join(PUB_DIR, 'index.html')));

function parseCookies(header) {
  return Object.fromEntries(String(header || '').split(';').map(part => {
    const index = part.indexOf('=');
    return index === -1 ? [part.trim(), ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter(([name]) => name));
}

function sessionMatches(value) {
  if (typeof value !== 'string' || value.length !== SESSION_TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(SESSION_TOKEN));
}

function isAllowedLoopbackOrigin(value) {
  if (!boundPort || typeof value !== 'string') return false;
  try {
    const origin = new URL(value);
    const port = Number(origin.port || 80);
    return origin.protocol === 'http:' && LOOPBACK_HOSTS.has(origin.hostname) && port === boundPort;
  } catch {
    return false;
  }
}

function hasLocalSession(request) {
  const cookies = parseCookies(request.headers.cookie);
  if (!sessionMatches(cookies[SESSION_COOKIE_NAME])) return false;
  try {
    const requestUrl = new URL(`http://${request.headers.host}`);
    const port = Number(requestUrl.port || 80);
    return LOOPBACK_HOSTS.has(requestUrl.hostname) && port === boundPort;
  } catch {
    return false;
  }
}

function requireLocalSession(request, response, next) {
  if (!hasLocalSession(request)) return response.status(403).json({ error: 'This request is not from the active PulsarWiki session.' });
  return next();
}

function requireLocalMutation(request, response, next) {
  if (!hasLocalSession(request) || !isAllowedLoopbackOrigin(request.headers.origin)) {
    return response.status(403).json({ error: 'This request is not from the active PulsarWiki page.' });
  }
  return next();
}

function safeBase(name) {
  return path.basename(name).replace(/\.\./g, '');
}

function indexWithProjectHandover(content, date) {
  let next = String(content || '').replace(/\*Last updated:\s*[^*]+\*/i, `*Last updated: ${date}*`);
  if (next.includes('[[project-handover]]')) return next;
  const section = '## Project Continuity\n- [[project-handover]]: A reviewed guide to project context, evidence, methods, decisions, open questions, and next steps.\n\n';
  const footer = next.lastIndexOf('\n---\n');
  if (footer >= 0) return `${next.slice(0, footer + 1)}\n${section}${next.slice(footer + 1)}`;
  return `${next.replace(/\s*$/, '\n\n')}${section}`;
}

function parseWikiLinks(content) {
  const links = [];
  const expression = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let match;
  while ((match = expression.exec(content)) !== null) links.push(match[1].toLowerCase().trim());
  return [...new Set(links)];
}

function asPublicError(error) {
  if (error instanceof AgentServiceError || error instanceof ChatGPTAuthError || error instanceof ThreadStoreError || error instanceof WikiToolError || error instanceof ProviderError) {
    return { code: error.code || 'chat-error', text: error.message };
  }
  return { code: 'chat-error', text: 'PulsarWiki could not complete this chat request.' };
}

// Workspace selection is a local, explicit action. Choices live for this server session.
app.get('/api/workspaces', requireLocalSession, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ active: describe(requestWorkspace(req)), recent: [...workspaces.values()].map(describe).reverse(), defaultPath: ROOT_DIR });
});
let folderPickerPending = false;
app.post('/api/workspaces/pick', requireLocalMutation, async (req, res) => {
  if (folderPickerPending) return res.status(409).json({ error: 'The folder picker is already open. Select a folder or cancel it.' });
  folderPickerPending = true;
  try {
    const initialPath = typeof req.body?.path === 'string' ? req.body.path : requestWorkspace(req)?.rootDir || ROOT_DIR;
    res.json({ path: await pickFolder({ initialPath }) });
  } catch (error) { res.status(503).json({ error: error.message }); }
  finally { folderPickerPending = false; }
});
app.post('/api/workspaces/open', requireLocalMutation, (req, res) => {
  try {
    const workspace = openWorkspace(req.body?.path);
    res.append('Set-Cookie', `${WORKSPACE_COOKIE}=${workspace.id}; Path=/; HttpOnly; SameSite=Strict`);
    res.json({ active: describe(workspace) });
  } catch (error) {
    res.status(400).json({ error: error.code ? 'This folder could not be opened. Check that it exists and is writable.' : error.message });
  }
});
app.post('/api/workspaces/close', requireLocalMutation, (_req, res) => {
  res.append('Set-Cookie', `${WORKSPACE_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/settings/ads', requireLocalSession, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(sourceSettings.status());
});
app.put('/api/settings/ads', requireLocalMutation, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const status = sourceSettings.save(req.body?.token);
    for (const workspace of workspaces.values()) workspace.sourceDiscovery.adsToken = sourceSettings.token;
    res.json(status);
  } catch (error) {
    res.status(error instanceof TypeError ? 400 : 500).json({ error: error instanceof TypeError ? error.message : 'The NASA ADS token could not be saved.' });
  }
});
app.delete('/api/settings/ads', requireLocalMutation, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const status = sourceSettings.remove();
    for (const workspace of workspaces.values()) workspace.sourceDiscovery.adsToken = sourceSettings.token;
    res.json(status);
  } catch {
    res.status(500).json({ error: 'The NASA ADS token could not be removed.' });
  }
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/chatgpt/')) return next();
  return requireLocalSession(req, res, () => {
    const workspace = requestWorkspace(req);
    if (!workspace) return res.status(409).json({ error: 'Open a research workspace folder to continue.', code: 'workspace-required' });
    res.setHeader('Cache-Control', 'no-store');
    return workspaceScope.run(workspace, next);
  });
});

// --- ChatGPT subscription connection and saved chats ---
app.get('/api/chatgpt/status', requireLocalSession, async (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await chatgptAuth.status());
  } catch (error) {
    res.status(503).json({ error: asPublicError(error).text });
  }
});

app.get('/auth/chatgpt/start', requireLocalSession, (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const authorizationUrl = chatgptAuth.startAuthorization({ port: boundPort });
    res.redirect(302, authorizationUrl);
  } catch (error) {
    res.redirect(302, `/?chatgpt=${encodeURIComponent(asPublicError(error).code)}`);
  }
});

app.get('/auth/chatgpt/callback', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const status = await chatgptAuth.handleCallback(req.query);
    const result = status.planEnabled ? 'connected' : 'plan-permission-required';
    if (status.planEnabled) resumePendingIngestJobs();
    res.redirect(302, `/?chatgpt=${result}`);
  } catch (error) {
    const code = asPublicError(error).code;
    const safeCode = ['access-denied', 'authorization-expired', 'invalid-state', 'account-mismatch'].includes(code) ? code : 'connection-failed';
    res.redirect(302, `/?chatgpt=${safeCode}`);
  }
});

app.put('/api/chatgpt/model', requireLocalMutation, async (req, res) => {
  try { res.json(await chatgptAuth.selectModel(req.body?.model)); } catch (error) {
    const publicError = asPublicError(error);
    res.status(400).json({ error: publicError.text, code: publicError.code });
  }
});

app.delete('/api/chatgpt/session', requireLocalMutation, async (_req, res) => {
  try { res.json(await chatgptAuth.disconnect()); } catch (error) {
    const publicError = asPublicError(error);
    res.status(503).json({ error: publicError.text, code: publicError.code });
  }
});

app.delete('/api/chatgpt/account', requireLocalMutation, async (_req, res) => {
  try { res.json(await chatgptAuth.forgetAccount()); } catch (error) {
    const publicError = asPublicError(error);
    res.status(503).json({ error: publicError.text, code: publicError.code });
  }
});

app.get('/api/chat/threads', (_req, res) => {
  try { res.json(currentWorkspace().agentService.listThreads()); } catch (error) { res.status(500).json({ error: asPublicError(error).text }); }
});

app.post('/api/chat/threads', (req, res) => {
  try { res.status(201).json(currentWorkspace().agentService.createThread(req.body?.title)); } catch (error) { res.status(400).json({ error: asPublicError(error).text }); }
});

app.get('/api/chat/threads/:id', (req, res) => {
  try { res.json(currentWorkspace().agentService.getThread(req.params.id)); } catch (error) { res.status(404).json({ error: asPublicError(error).text }); }
});

app.patch('/api/chat/threads/:id', (req, res) => {
  try { res.json(currentWorkspace().agentService.renameThread(req.params.id, req.body?.title)); } catch (error) { res.status(400).json({ error: asPublicError(error).text }); }
});

app.delete('/api/chat/threads/:id', (req, res) => {
  try { currentWorkspace().agentService.deleteThread(req.params.id); res.status(204).end(); } catch (error) { res.status(404).json({ error: asPublicError(error).text }); }
});

// --- Wiki API ---
app.get('/api/wiki', (_req, res) => {
  const files = fs.readdirSync(currentWorkspace().wikiDir).filter(file => file.endsWith('.md'));
  res.json(files.map(file => {
    const stat = fs.statSync(path.join(currentWorkspace().wikiDir, file));
    return { name: file.replace('.md', ''), size: stat.size, modified: stat.mtime };
  }));
});

app.get('/api/wiki/:page', (req, res) => {
  const filePath = path.join(currentWorkspace().wikiDir, `${safeBase(req.params.page)}.md`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  return res.json({ content: fs.readFileSync(filePath, 'utf8') });
});

app.put('/api/wiki/:page', (req, res) => {
  const filePath = path.join(currentWorkspace().wikiDir, `${safeBase(req.params.page)}.md`);
  fs.writeFileSync(filePath, req.body.content || '', 'utf8');
  res.json({ ok: true });
});

app.post('/api/wiki', (req, res) => {
  const { name, content } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const filePath = path.join(currentWorkspace().wikiDir, `${safeBase(name)}.md`);
  if (fs.existsSync(filePath)) return res.status(409).json({ error: 'Already exists' });
  fs.writeFileSync(filePath, content || `# ${name}\n\n**Summary**: \n\n**Sources**: \n\n**Last updated**: ${new Date().toISOString().slice(0, 10)}\n\n---\n\n`, 'utf8');
  return res.json({ ok: true });
});

app.delete('/api/wiki/:page', (req, res) => {
  const filePath = path.join(currentWorkspace().wikiDir, `${safeBase(req.params.page)}.md`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(filePath);
  return res.json({ ok: true });
});

// --- Raw file API ---
app.get('/api/raw', (_req, res) => {
  const files = fs.readdirSync(currentWorkspace().rawDir);
  res.json(files.map(file => {
    const stat = fs.statSync(path.join(currentWorkspace().rawDir, file));
    return { name: file, size: stat.size, modified: stat.mtime, ext: path.extname(file).slice(1).toLowerCase() };
  }));
});

app.get('/api/raw/:file', (req, res) => {
  const filePath = path.join(currentWorkspace().rawDir, safeBase(req.params.file));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  return res.sendFile(filePath);
});

app.post('/api/upload', requireLocalMutation, async (req, res) => {
  let name;
  try { name = safeBase(decodeURIComponent(req.headers['x-filename'] || 'upload.bin')); }
  catch { return res.status(400).json({ error: 'Invalid filename.' }); }
  const filePath = path.join(currentWorkspace().rawDir, name);
  if (fs.existsSync(filePath)) return res.status(409).json({ error: 'A source with this filename already exists. Rename the new file; original sources cannot be overwritten.' });
  const uploadDir = path.join(currentWorkspace().dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const temporary = path.join(uploadDir, `${crypto.randomUUID()}.upload`);
  try {
    await pipeline(req, fs.createWriteStream(temporary, { flags: 'wx' }));
    // Publish a completed upload exclusively; interruption cannot leave a partial immutable source.
    fs.linkSync(temporary, filePath);
    return res.json({ ok: true, name, ingestJob: queueSourceIngest([{ name }]) });
  } catch (error) {
    if (!res.headersSent && !res.destroyed) res.status(error.code === 'EEXIST' ? 409 : 500).json({ error: 'The source could not be saved without overwriting an existing file.' });
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* a failed temporary file can be removed on the next maintenance pass */ }
  }
});

app.use('/api/reading', (req, res, next) => currentWorkspace().readingRouter(req, res, next));
app.use('/api/notebooks', (req, res, next) => currentWorkspace().notebookRouter(req, res, next));

// --- Research source discovery and import ---
app.get('/api/sources/filters', requireLocalSession, (_req, res) => {
  res.json({ filters: SOURCE_FILTERS, adsConfigured: Boolean(currentWorkspace().sourceDiscovery.adsToken) });
});

app.post('/api/sources/search', requireLocalSession, async (req, res) => {
  const query = String(req.body?.query || '').trim();
  if (!query) return res.status(400).json({ error: 'Enter a research question, keywords, title, DOI, or paper link.' });
  try {
    return res.json(await currentWorkspace().sourceDiscovery.search(query, { limit: req.body?.limit }));
  } catch (error) {
    return res.status(502).json({ error: error.message || 'The paper search could not be completed.' });
  }
});

app.post('/api/sources/:id/keywords', requireLocalMutation, async (req, res) => {
  const paper = currentWorkspace().sourceDiscovery.cached(req.params.id);
  if (!paper) return res.status(404).json({ error: 'This paper preview expired. Search for it again.' });
  try { return res.json(await currentWorkspace().paperKeywords.generate(paper)); }
  catch (error) { return res.status(502).json({ error: error.message || 'Paper keywords could not be generated.' }); }
});

app.get('/api/sources/:id/related', requireLocalSession, async (req, res) => {
  try { return res.json(await currentWorkspace().sourceDiscovery.related(req.params.id)); }
  catch (error) { return res.status(400).json({ error: error.message || 'Related papers could not be loaded.' }); }
});

app.post('/api/sources/import', requireLocalMutation, async (req, res) => {
  try {
    const result = await currentWorkspace().sourceDiscovery.import(req.body?.ids);
    const files = result.imported.map(item => ({
      name: item.name,
      title: item.source.title,
      doi: item.source.doi,
      arxivId: item.source.arxivId,
    }));
    const ingestJob = files.length ? queueSourceIngest(files) : null;
    return res.status(result.imported.length ? 201 : 422).json({ ...result, ingestJob });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'The selected papers could not be imported.' });
  }
});

app.get('/api/sources/jobs/:id', requireLocalSession, (req, res) => {
  const job = currentWorkspace().ingestJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Ingest job not found.' });
  return res.json(publicIngestJob(job));
});

// --- Project handover ---
app.post('/api/handover/generate', requireLocalMutation, async (req, res) => {
  try {
    const result = await currentWorkspace().handoverService.generate(req.body || {});
    return res.json(result);
  } catch (error) {
    const publicError = asPublicError(error);
    const status = ['handover-selection-too-large', 'handover-selection-stale', 'handover-unreadable-file', 'invalid-message'].includes(publicError.code) ? 400 : 503;
    return res.status(status).json({ error: publicError.text, code: publicError.code });
  }
});

app.post('/api/handover/publish', requireLocalMutation, (req, res) => {
  try {
    if (req.body?.reviewed !== true) return res.status(400).json({ error: 'Researcher review is required before publishing.' });
    const content = String(req.body?.content || '').trim();
    if (!content || content.length > 1024 * 1024) return res.status(400).json({ error: 'Provide a handover draft smaller than 1 MB.' });
    const required = ['# Project Handover', '**Summary**:', '**Sources**:', '**Last updated**:', '## Related pages'];
    const missing = required.filter(marker => !content.includes(marker));
    if (missing.length) return res.status(400).json({ error: `The reviewed draft is missing required page structure: ${missing.join(', ')}` });

    const date = new Date().toISOString().slice(0, 10);
    const indexPath = path.join(currentWorkspace().wikiDir, 'index.md');
    const index = indexWithProjectHandover(fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '# LLM Wiki Index\n', date);
    const result = currentWorkspace().wikiTools.applyWikiChanges({
      changes: [{ name: 'project-handover', content: `${content}\n` }, { name: 'index', content: index }],
      logSummary: 'Published the researcher-reviewed Project Handover guide and updated the wiki index.',
    });
    return res.json({ ...result, page: 'project-handover' });
  } catch (error) {
    const publicError = asPublicError(error);
    return res.status(400).json({ error: publicError.text, code: publicError.code });
  }
});

// --- Graph and search API ---
app.get('/api/graph', (_req, res) => {
  const files = fs.readdirSync(currentWorkspace().wikiDir).filter(file => file.endsWith('.md'));
  const pageSet = new Set(files.map(file => file.replace('.md', '')));
  const indexPath = path.join(currentWorkspace().wikiDir, 'index.md');
  const categories = {};
  if (fs.existsSync(indexPath)) {
    let currentGroup = 0;
    fs.readFileSync(indexPath, 'utf8').split('\n').forEach(line => {
      if (line.startsWith('## ')) currentGroup += 1;
      const match = line.match(/\[\[([^\]]+)\]\]/);
      if (match) categories[match[1].toLowerCase()] = currentGroup;
    });
  }
  const nodes = [];
  const edges = [];
  const linkCounts = {};
  files.forEach(file => {
    const name = file.replace('.md', '');
    const links = parseWikiLinks(fs.readFileSync(path.join(currentWorkspace().wikiDir, file), 'utf8'));
    linkCounts[name] = linkCounts[name] || 0;
    links.forEach(link => {
      if (pageSet.has(link) && link !== name) {
        edges.push({ source: name, target: link });
        linkCounts[link] = (linkCounts[link] || 0) + 1;
      }
    });
  });
  files.forEach(file => {
    const name = file.replace('.md', '');
    nodes.push({ id: name, group: categories[name] || 0, links: linkCounts[name] || 0 });
  });
  res.json({ nodes, edges });
});

app.get('/api/search', (req, res) => {
  const query = String(req.query.q || '').toLowerCase().trim();
  if (!query) return res.json([]);
  const results = [];
  fs.readdirSync(currentWorkspace().wikiDir).filter(file => file.endsWith('.md')).forEach(file => {
    const name = file.replace('.md', '');
    const matches = [];
    fs.readFileSync(path.join(currentWorkspace().wikiDir, file), 'utf8').split('\n').forEach((line, index) => {
      if (line.toLowerCase().includes(query)) matches.push({ line: index + 1, text: line.trim().slice(0, 120) });
    });
    if (matches.length || name.includes(query)) results.push({ page: name, matches: matches.slice(0, 3) });
  });
  return res.json(results);
});

// --- WebSocket: ChatGPT subscription threaded chat ---
wss.on('connection', (ws, request) => {
  const workspace = requestWorkspace(request);
  ws.workspace = workspace;
  let activeTurn = null;
  let requestId = 0;
  const send = object => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(object));
  };
  send({ type: 'server-hello', protocol: CHAT_PROTOCOL_VERSION, capabilities: ['agent-chat', 'threaded-chat', 'session-cookie'] });

  const stopActiveTurn = () => {
    if (!activeTurn) return;
    activeTurn.controller.abort();
    clearTimeout(activeTurn.timeout);
    activeTurn = null;
  };

  const handleMessage = async raw => {
    if (raw.length > 128 * 1024) {
      send({ type: 'error', code: 'message-too-large', text: 'That message is too large.' });
      return;
    }
    let message;
    try { message = JSON.parse(raw.toString()); } catch {
      send({ type: 'error', code: 'invalid-message', text: 'Invalid WebSocket message.' });
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      send({ type: 'error', code: 'invalid-message', text: 'Invalid WebSocket message.' });
      return;
    }
    if (message.type === 'client-hello') {
      if (message.protocol !== CHAT_PROTOCOL_VERSION) {
        send({ type: 'error', code: 'protocol-mismatch', text: 'Restart the PulsarWiki server, then refresh this page.' });
        ws.close(1002, 'Protocol mismatch');
        return;
      }
      send({ type: 'server-hello', protocol: CHAT_PROTOCOL_VERSION, ready: true });
      return;
    }
    if (message.type === 'abort') {
      stopActiveTurn();
      send({ type: 'done', code: -1, threadId: message.threadId || null });
      return;
    }
    if (!workspace) {
      send({ type: 'error', code: 'workspace-required', text: 'Open a research workspace folder to continue.' });
      return;
    }
    if (message.type !== 'chat') {
      send({ type: 'error', code: 'unsupported-message', text: 'Unsupported WebSocket message.' });
      return;
    }
    if (typeof message.threadId !== 'string' || typeof message.text !== 'string') {
      send({ type: 'error', code: 'invalid-message', text: 'A chat thread and message are required.' });
      return;
    }

    stopActiveTurn();
    const id = ++requestId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    activeTurn = { id, controller, timeout, threadId: message.threadId };
    try {
      const thread = await currentWorkspace().agentService.runTurn({
        threadId: message.threadId,
        text: message.text,
        signal: controller.signal,
        onDelta: text => {
          if (activeTurn?.id === id) send({ type: 'chunk', threadId: message.threadId, text });
        },
        onTool: event => {
          if (activeTurn?.id === id) send({ type: 'tool-status', threadId: message.threadId, ...event });
        },
      });
      if (activeTurn?.id === id) send({ type: 'thread-updated', threadId: message.threadId, thread: { id: thread.id, title: thread.title, updatedAt: thread.updatedAt } });
      if (activeTurn?.id === id) send({ type: 'done', code: 0, threadId: message.threadId });
    } catch (error) {
      if (activeTurn?.id === id) send({ type: 'error', threadId: message.threadId, ...asPublicError(error) });
      if (activeTurn?.id === id) send({ type: 'done', code: 1, threadId: message.threadId });
    } finally {
      if (activeTurn?.id === id) {
        clearTimeout(timeout);
        activeTurn = null;
      }
    }
  };

  ws.on('message', raw => { void workspaceScope.run(workspace, () => handleMessage(raw)); });
  ws.on('close', () => stopActiveTurn());
});

server.on('upgrade', (request, socket, head) => {
  const reject = status => {
    try { socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); } catch { /* ignored */ }
    socket.destroy();
  };
  if (new URL(request.url, 'http://localhost').pathname !== '/') return reject('404 Not Found');
  if (!sessionMatches(parseCookies(request.headers.cookie)[SESSION_COOKIE_NAME])) return reject('401 Unauthorized');
  if (!isAllowedLoopbackOrigin(request.headers.origin)) return reject('403 Forbidden');
  return wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
});

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
server.listen(PORT, HOST, () => {
  const address = server.address();
  boundPort = typeof address === 'object' && address ? address.port : PORT;
  console.log(`\nPulsarWiki -> http://${HOST}:${boundPort}\n`);
});

async function shutdown() {
  for (const workspace of workspaces.values()) workspace.readingService.close();
  await Promise.all([...workspaces.values()].map(workspace => workspace.notebookService.close()));
  await Promise.all([...workspaces.values()].map(workspace => workspace.watcher.close()));
  for (const client of wss.clients) client.close();
  await new Promise(resolve => server.close(resolve));
}

process.once('SIGINT', () => { shutdown().finally(() => process.exit(0)); });
process.once('SIGTERM', () => { shutdown().finally(() => process.exit(0)); });

module.exports = { isAllowedLoopbackOrigin, parseCookies, sessionMatches, asPublicError };
