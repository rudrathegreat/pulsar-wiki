'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const chokidar = require('chokidar');
const { AgentService, AgentServiceError } = require('./agent/agent-service');
const { ChatGPTAuthError, ChatGPTAuthService } = require('./agent/chatgpt-auth');
const { ThreadStore, ThreadStoreError } = require('./agent/thread-store');
const { WikiTools, WikiToolError } = require('./agent/wiki-tools');
const { ProviderError } = require('./agent/providers');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const ROOT_DIR = __dirname;
const WIKI_DIR = path.join(ROOT_DIR, 'wiki');
const RAW_DIR = path.join(ROOT_DIR, 'raw');
const PUB_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, '.pulsarwiki');
const INSTRUCTIONS_PATH = path.join(ROOT_DIR, 'GEMINI.md');
const CHAT_PROTOCOL_VERSION = 4;
const SESSION_COOKIE_NAME = 'pulsarwiki_session';
const SESSION_TOKEN = crypto.randomBytes(32).toString('hex');
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const CHAT_TIMEOUT_MS = 120000;
let boundPort = null;

function loadInstructions() {
  try {
    return fs.readFileSync(INSTRUCTIONS_PATH, 'utf8');
  } catch {
    throw new Error('GEMINI.md is required to start the PulsarWiki agent.');
  }
}

const threadStore = new ThreadStore({ dataDir: path.join(DATA_DIR, 'chat') });
const chatgptAuth = new ChatGPTAuthService();
const wikiTools = new WikiTools({ rootDir: ROOT_DIR, wikiDir: WIKI_DIR, rawDir: RAW_DIR, dataDir: DATA_DIR });
const agentService = new AgentService({
  threadStore,
  authService: chatgptAuth,
  wikiTools,
  instructions: loadInstructions(),
});

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
app.use('/vendor/pdfjs', express.static(path.join(ROOT_DIR, 'node_modules', 'pdfjs-dist')));

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
  try { res.json(agentService.listThreads()); } catch (error) { res.status(500).json({ error: asPublicError(error).text }); }
});

app.post('/api/chat/threads', (req, res) => {
  try { res.status(201).json(agentService.createThread(req.body?.title)); } catch (error) { res.status(400).json({ error: asPublicError(error).text }); }
});

app.get('/api/chat/threads/:id', (req, res) => {
  try { res.json(agentService.getThread(req.params.id)); } catch (error) { res.status(404).json({ error: asPublicError(error).text }); }
});

app.patch('/api/chat/threads/:id', (req, res) => {
  try { res.json(agentService.renameThread(req.params.id, req.body?.title)); } catch (error) { res.status(400).json({ error: asPublicError(error).text }); }
});

app.delete('/api/chat/threads/:id', (req, res) => {
  try { agentService.deleteThread(req.params.id); res.status(204).end(); } catch (error) { res.status(404).json({ error: asPublicError(error).text }); }
});

// --- Wiki API ---
app.get('/api/wiki', (_req, res) => {
  const files = fs.readdirSync(WIKI_DIR).filter(file => file.endsWith('.md'));
  res.json(files.map(file => {
    const stat = fs.statSync(path.join(WIKI_DIR, file));
    return { name: file.replace('.md', ''), size: stat.size, modified: stat.mtime };
  }));
});

app.get('/api/wiki/:page', (req, res) => {
  const filePath = path.join(WIKI_DIR, `${safeBase(req.params.page)}.md`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  return res.json({ content: fs.readFileSync(filePath, 'utf8') });
});

app.put('/api/wiki/:page', (req, res) => {
  const filePath = path.join(WIKI_DIR, `${safeBase(req.params.page)}.md`);
  fs.writeFileSync(filePath, req.body.content || '', 'utf8');
  res.json({ ok: true });
});

app.post('/api/wiki', (req, res) => {
  const { name, content } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const filePath = path.join(WIKI_DIR, `${safeBase(name)}.md`);
  if (fs.existsSync(filePath)) return res.status(409).json({ error: 'Already exists' });
  fs.writeFileSync(filePath, content || `# ${name}\n\n**Summary**: \n\n**Sources**: \n\n**Last updated**: ${new Date().toISOString().slice(0, 10)}\n\n---\n\n`, 'utf8');
  return res.json({ ok: true });
});

app.delete('/api/wiki/:page', (req, res) => {
  const filePath = path.join(WIKI_DIR, `${safeBase(req.params.page)}.md`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(filePath);
  return res.json({ ok: true });
});

// --- Raw file API ---
app.get('/api/raw', (_req, res) => {
  const files = fs.readdirSync(RAW_DIR);
  res.json(files.map(file => {
    const stat = fs.statSync(path.join(RAW_DIR, file));
    return { name: file, size: stat.size, modified: stat.mtime, ext: path.extname(file).slice(1).toLowerCase() };
  }));
});

app.get('/api/raw/:file', (req, res) => {
  const filePath = path.join(RAW_DIR, safeBase(req.params.file));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  return res.sendFile(filePath);
});

app.post('/api/upload', (req, res) => {
  const name = safeBase(req.headers['x-filename'] || 'upload.bin');
  const filePath = path.join(RAW_DIR, name);
  const writeStream = fs.createWriteStream(filePath);
  req.pipe(writeStream);
  writeStream.on('finish', () => res.json({ ok: true, name }));
  writeStream.on('error', error => res.status(500).json({ error: error.message }));
});

// --- Graph and search API ---
app.get('/api/graph', (_req, res) => {
  const files = fs.readdirSync(WIKI_DIR).filter(file => file.endsWith('.md'));
  const pageSet = new Set(files.map(file => file.replace('.md', '')));
  const indexPath = path.join(WIKI_DIR, 'index.md');
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
    const links = parseWikiLinks(fs.readFileSync(path.join(WIKI_DIR, file), 'utf8'));
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
  fs.readdirSync(WIKI_DIR).filter(file => file.endsWith('.md')).forEach(file => {
    const name = file.replace('.md', '');
    const matches = [];
    fs.readFileSync(path.join(WIKI_DIR, file), 'utf8').split('\n').forEach((line, index) => {
      if (line.toLowerCase().includes(query)) matches.push({ line: index + 1, text: line.trim().slice(0, 120) });
    });
    if (matches.length || name.includes(query)) results.push({ page: name, matches: matches.slice(0, 3) });
  });
  return res.json(results);
});

// --- WebSocket: ChatGPT subscription threaded chat ---
wss.on('connection', ws => {
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
      const thread = await agentService.runTurn({
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

  ws.on('message', raw => { void handleMessage(raw); });
  ws.on('close', () => stopActiveTurn());
});

server.on('upgrade', (request, socket, head) => {
  const reject = status => {
    try { socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); } catch { /* ignored */ }
    socket.destroy();
  };
  if (request.url !== '/') return reject('404 Not Found');
  if (!sessionMatches(parseCookies(request.headers.cookie)[SESSION_COOKIE_NAME])) return reject('401 Unauthorized');
  if (!isAllowedLoopbackOrigin(request.headers.origin)) return reject('403 Forbidden');
  return wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
});

const watcher = chokidar.watch([WIKI_DIR, RAW_DIR], { ignoreInitial: true }).on('all', (event, filePath) => {
  const payload = JSON.stringify({ type: 'filechange', event, path: filePath });
  wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(payload); });
});

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
server.listen(PORT, HOST, () => {
  const address = server.address();
  boundPort = typeof address === 'object' && address ? address.port : PORT;
  console.log(`\n🔭 PulsarWiki → http://${HOST}:${boundPort}\n`);
});

async function shutdown() {
  await watcher.close();
  for (const client of wss.clients) client.close();
  await new Promise(resolve => server.close(resolve));
}

process.once('SIGINT', () => { shutdown().finally(() => process.exit(0)); });
process.once('SIGTERM', () => { shutdown().finally(() => process.exit(0)); });

module.exports = { isAllowedLoopbackOrigin, parseCookies, sessionMatches, asPublicError };
