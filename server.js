const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const chokidar = require('chokidar');
const { buildCliInvocation, getCliTool, listCliTools } = require('./cli-tools');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const ROOT_DIR = __dirname;
const WIKI_DIR = path.join(ROOT_DIR, 'wiki');
const RAW_DIR  = path.join(ROOT_DIR, 'raw');
const PUB_DIR  = path.join(ROOT_DIR, 'public');
const CONFIG_PATH = path.join(ROOT_DIR, '.pulsarwiki.json');
const CHAT_PROTOCOL_VERSION = 2;

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return getCliTool(saved.cli) ? { cli: saved.cli } : { cli: null };
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Unable to read ${path.basename(CONFIG_PATH)}: ${error.message}`);
    return { cli: null };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

let appConfig = loadConfig();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUB_DIR));
// Keep browser libraries local so the UI does not depend on public CDNs.
app.use('/vendor/d3', express.static(path.join(ROOT_DIR, 'node_modules', 'd3', 'dist')));
app.use('/vendor/marked', express.static(path.join(ROOT_DIR, 'node_modules', 'marked', 'lib')));
// Keep the PDF renderer local so documents still work without a CDN connection.
app.use('/vendor/pdfjs', express.static(path.join(ROOT_DIR, 'node_modules', 'pdfjs-dist')));

// --- Utility ---
function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');
}

function parseWikiLinks(content) {
  const links = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(content)) !== null) links.push(m[1].toLowerCase().trim());
  return [...new Set(links)];
}

function safeBase(name) {
  return path.basename(name).replace(/\.\./g, '');
}

// --- App setup/config API ---
app.get('/api/config', (_req, res) => {
  const selectedTool = getCliTool(appConfig.cli);
  res.json({
    configured: Boolean(selectedTool),
    cli: selectedTool?.id || null,
    tool: selectedTool ? { id: selectedTool.id, name: selectedTool.name } : null,
    tools: listCliTools(),
  });
});

app.put('/api/config', (req, res) => {
  const tool = getCliTool(req.body?.cli);
  if (!tool) return res.status(400).json({ error: 'Choose a supported CLI tool.' });

  try {
    appConfig = { cli: tool.id };
    saveConfig(appConfig);
    res.json({ ok: true, cli: tool.id, tool: { id: tool.id, name: tool.name } });
  } catch (error) {
    res.status(500).json({ error: `Unable to save setup: ${error.message}` });
  }
});

// --- Wiki API ---
app.get('/api/wiki', (_req, res) => {
  const files = fs.readdirSync(WIKI_DIR).filter(f => f.endsWith('.md'));
  res.json(files.map(f => {
    const st = fs.statSync(path.join(WIKI_DIR, f));
    return { name: f.replace('.md', ''), size: st.size, modified: st.mtime };
  }));
});

app.get('/api/wiki/:page', (req, res) => {
  const fp = path.join(WIKI_DIR, safeBase(req.params.page) + '.md');
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  res.json({ content: fs.readFileSync(fp, 'utf-8') });
});

app.put('/api/wiki/:page', (req, res) => {
  const fp = path.join(WIKI_DIR, safeBase(req.params.page) + '.md');
  fs.writeFileSync(fp, req.body.content || '', 'utf-8');
  res.json({ ok: true });
});

app.post('/api/wiki', (req, res) => {
  const { name, content } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const fp = path.join(WIKI_DIR, safeBase(name) + '.md');
  if (fs.existsSync(fp)) return res.status(409).json({ error: 'Already exists' });
  fs.writeFileSync(fp, content || `# ${name}\n\n**Summary**: \n\n**Sources**: \n\n**Last updated**: ${new Date().toISOString().slice(0,10)}\n\n---\n\n`, 'utf-8');
  res.json({ ok: true });
});

app.delete('/api/wiki/:page', (req, res) => {
  const fp = path.join(WIKI_DIR, safeBase(req.params.page) + '.md');
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(fp);
  res.json({ ok: true });
});

// --- Raw files API ---
app.get('/api/raw', (_req, res) => {
  const files = fs.readdirSync(RAW_DIR);
  res.json(files.map(f => {
    const st = fs.statSync(path.join(RAW_DIR, f));
    return { name: f, size: st.size, modified: st.mtime, ext: path.extname(f).slice(1).toLowerCase() };
  }));
});

app.get('/api/raw/:file', (req, res) => {
  const fp = path.join(RAW_DIR, safeBase(req.params.file));
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(fp);
});

// Upload: client sends raw binary, filename in X-Filename header
app.post('/api/upload', (req, res) => {
  const name = safeBase(req.headers['x-filename'] || 'upload.bin');
  const fp = path.join(RAW_DIR, name);
  const ws = fs.createWriteStream(fp);
  req.pipe(ws);
  ws.on('finish', () => res.json({ ok: true, name }));
  ws.on('error', err => res.status(500).json({ error: err.message }));
});

// --- Graph API ---
app.get('/api/graph', (_req, res) => {
  const files = fs.readdirSync(WIKI_DIR).filter(f => f.endsWith('.md'));
  const pageSet = new Set(files.map(f => f.replace('.md', '')));

  // Parse categories from index.md
  const indexPath = path.join(WIKI_DIR, 'index.md');
  const categories = {};
  if (fs.existsSync(indexPath)) {
    const lines = fs.readFileSync(indexPath, 'utf-8').split('\n');
    let currentGroup = 0;
    lines.forEach(line => {
      if (line.startsWith('## ')) currentGroup++;
      const m = line.match(/\[\[([^\]]+)\]\]/);
      if (m) categories[m[1].toLowerCase()] = currentGroup;
    });
  }

  const nodes = [];
  const edges = [];
  const linkCounts = {};

  files.forEach(f => {
    const name = f.replace('.md', '');
    const content = fs.readFileSync(path.join(WIKI_DIR, f), 'utf-8');
    const links = parseWikiLinks(content);
    linkCounts[name] = (linkCounts[name] || 0);
    links.forEach(lk => {
      if (pageSet.has(lk) && lk !== name) {
        edges.push({ source: name, target: lk });
        linkCounts[lk] = (linkCounts[lk] || 0) + 1;
      }
    });
  });

  files.forEach(f => {
    const name = f.replace('.md', '');
    nodes.push({ id: name, group: categories[name] || 0, links: linkCounts[name] || 0 });
  });

  res.json({ nodes, edges });
});

// --- Search API ---
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);
  const results = [];
  const files = fs.readdirSync(WIKI_DIR).filter(f => f.endsWith('.md'));
  files.forEach(f => {
    const name = f.replace('.md', '');
    const content = fs.readFileSync(path.join(WIKI_DIR, f), 'utf-8');
    const matches = [];
    content.split('\n').forEach((line, i) => {
      if (line.toLowerCase().includes(q)) matches.push({ line: i + 1, text: line.trim().slice(0, 120) });
    });
    if (matches.length > 0 || name.includes(q)) results.push({ page: name, matches: matches.slice(0, 3) });
  });
  res.json(results);
});

// --- WebSocket: selected agent CLI ---
wss.on('connection', ws => {
  let proc = null;
  let requestId = 0;

  const send = obj => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); };
  send({ type: 'server-hello', protocol: CHAT_PROTOCOL_VERSION });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'client-hello') {
      send({ type: 'server-hello', protocol: CHAT_PROTOCOL_VERSION });
      return;
    }

    if (msg.type === 'chat') {
      // A valid browser-level preference can override the project default. This
      // keeps chat usable when a deployment rewrites or blocks /api/config.
      const tool = getCliTool(msg.cli) || getCliTool(appConfig.cli);
      if (!tool) {
        send({ type: 'error', text: 'Setup is incomplete. Choose a CLI tool before starting a chat.' });
        send({ type: 'done', code: 1 });
        return;
      }

      let invocation;
      try {
        invocation = buildCliInvocation(tool.id, msg.text);
      } catch (error) {
        send({ type: 'error', text: error.message });
        send({ type: 'done', code: 1 });
        return;
      }

      // Fire a one-shot process per message. Arguments are passed without a shell.
      requestId += 1;
      const activeRequest = requestId;
      if (proc) proc.kill();

      const child = spawn(invocation.command, invocation.args, {
        cwd: ROOT_DIR,
        shell: false,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb' }
      });
      proc = child;

      let buffer = '';
      let stderr = '';
      let hasOutput = false;
      let failedToStart = false;
      const flush = () => {
        if (activeRequest !== requestId) return;
        if (buffer) {
          hasOutput = true;
          send({ type: 'chunk', text: buffer });
          buffer = '';
        }
      };

      child.stdout.on('data', chunk => {
        buffer += stripAnsi(chunk.toString());
        flush();
      });
      child.stderr.on('data', chunk => {
        // Agent CLIs commonly write progress diagnostics to stderr, so buffer
        // it and surface useful details only if the command fails.
        stderr = (stderr + stripAnsi(chunk.toString())).slice(-20000);
      });
      child.on('close', code => {
        if (activeRequest !== requestId || failedToStart) return;
        flush();
        if (code !== 0) {
          const detail = hasOutput
            ? `${tool.name} stopped before completing (exit code ${code}).`
            : (stderr.trim() || `${tool.name} exited with code ${code}.`);
          send({ type: 'error', text: detail });
        }
        send({ type: 'done', code });
        if (proc === child) proc = null;
      });
      child.on('error', err => {
        if (activeRequest !== requestId) return;
        failedToStart = true;
        const hint = err.code === 'ENOENT'
          ? ` Your ${tool.name} choice is saved, but the server could not start \`${tool.command}\`. Install it or add it to PATH before using chat.`
          : '';
        send({ type: 'error', text: `Failed to start ${tool.name}: ${err.message}.${hint}` });
        send({ type: 'done', code: 1 });
        if (proc === child) proc = null;
      });
    }

    if (msg.type === 'abort' && proc) {
      requestId += 1;
      proc.kill();
      proc = null;
      send({ type: 'done', code: -1 });
    }
  });

  ws.on('close', () => {
    requestId += 1;
    if (proc) proc.kill();
  });
});

// --- File watcher for live reload ---
chokidar.watch([WIKI_DIR, RAW_DIR], { ignoreInitial: true }).on('all', (event, fp) => {
  const payload = JSON.stringify({ type: 'filechange', event, path: fp });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n🔭 PulsarWiki → http://localhost:${PORT}\n`));
