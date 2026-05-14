const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const chokidar = require('chokidar');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const ROOT_DIR = __dirname;
const WIKI_DIR = path.join(ROOT_DIR, 'wiki');
const RAW_DIR  = path.join(ROOT_DIR, 'raw');
const PUB_DIR  = path.join(ROOT_DIR, 'public');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUB_DIR));

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

// --- WebSocket: Gemini CLI ---
wss.on('connection', ws => {
  let proc = null;

  const send = obj => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); };

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'chat') {
      // Fire a one-shot gemini process per message
      if (proc) { proc.kill(); proc = null; }

      const escapedText = msg.text.replace(/"/g, '""');
      const cmdLine = `npx -y gemini --prompt "${escapedText}"`;
      proc = spawn(cmdLine, [], {
        cwd: ROOT_DIR,
        shell: true,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb' }
      });

      let buffer = '';
      const flush = () => {
        if (buffer) { send({ type: 'chunk', text: buffer }); buffer = ''; }
      };

      proc.stdout.on('data', chunk => {
        buffer += stripAnsi(chunk.toString());
        flush();
      });
      proc.stderr.on('data', chunk => {
        const t = stripAnsi(chunk.toString());
        // Filter out noisy warnings
        if (t.includes('256-color support not detected')) return;
        if (t.includes('Attempt') && t.includes('failed')) return;
        if (t.includes('Need to install')) return;
        if (t.includes('npx: installed')) return;
        if (t.trim()) send({ type: 'error', text: t });
      });
      proc.on('close', code => {
        flush();
        send({ type: 'done', code });
        proc = null;
      });
      proc.on('error', err => {
        send({ type: 'error', text: `Failed to start gemini: ${err.message}` });
        proc = null;
      });
    }

    if (msg.type === 'abort' && proc) { proc.kill(); proc = null; send({ type: 'done', code: -1 }); }
  });

  ws.on('close', () => { if (proc) proc.kill(); });
});

// --- File watcher for live reload ---
chokidar.watch([WIKI_DIR, RAW_DIR], { ignoreInitial: true }).on('all', (event, fp) => {
  const payload = JSON.stringify({ type: 'filechange', event, path: fp });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n🔭 PulsarWiki → http://localhost:${PORT}\n`));
