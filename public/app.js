// ── Markdown config ────────────────────────────────────────────────
marked.setOptions({ breaks: true, gfm: true });

function preprocessMd(text) {
  // Convert [[wikilinks]] → markdown links with WIKILINK: prefix
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, page, label) => {
    const display = label || page;
    const safePage = page.toLowerCase().trim();
    return `[${display}](WIKILINK:${safePage})`;
  });
}

function postProcessHtml(html) {
  // Turn WIKILINK: hrefs into data-page wiki links
  return html.replace(
    /href="WIKILINK:([^"]+)"/g,
    (_, page) => `href="javascript:void(0)" class="wiki-link" data-page="${page}"`
  );
}

function renderMd(content) {
  return postProcessHtml(marked.parse(preprocessMd(content)));
}


// ── API helpers ────────────────────────────────────────────────────
const api = {
  async getConfig() {
    const storedCli = getStoredCli();

    try {
      const response = await fetch('/api/config');
      const data = await readJsonResponse(response, 'Setup');
      const cli = storedCli || data.cli;
      const tools = data.tools?.length ? data.tools : CLI_CHOICES;
      return {
        ...data,
        configured: Boolean(cli),
        cli: cli || null,
        tool: tools.find(tool => tool.id === cli) || null,
        tools,
      };
    } catch (error) {
      const tool = CLI_CHOICES.find(choice => choice.id === storedCli) || null;
      return {
        configured: Boolean(tool),
        cli: tool?.id || null,
        tool,
        tools: CLI_CHOICES,
        localOnly: true,
        warning: 'Server setup API unavailable; CLI choices will be stored in this browser.',
      };
    }
  },
  async saveConfig(cli) {
    const tool = CLI_CHOICES.find(choice => choice.id === cli);
    if (!tool) throw new Error('Choose a supported CLI tool.');
    storeCli(cli);

    try {
      const response = await fetch('/api/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cli })
      });
      return await readJsonResponse(response, 'Setup');
    } catch (error) {
      return {
        ok: true,
        cli,
        tool,
        localOnly: true,
        warning: 'Choice saved in this browser. Restart the PulsarWiki server if chat cannot connect to it.',
      };
    }
  },
  async getWikiList()        { return fetch('/api/wiki').then(r => r.json()); },
  async getWikiPage(name)    { return fetch(`/api/wiki/${encodeURIComponent(name)}`).then(r => r.json()); },
  async saveWikiPage(name, content) {
    return fetch(`/api/wiki/${encodeURIComponent(name)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    }).then(r => r.json());
  },
  async createWikiPage(name, content) {
    return fetch('/api/wiki', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content })
    }).then(r => r.json());
  },
  async getRawList()         { return fetch('/api/raw').then(r => r.json()); },
  async getGraph()           { return fetch('/api/graph').then(r => r.json()); },
  async search(q)            { return fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json()); },
  async uploadFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload  = () => resolve(JSON.parse(xhr.responseText));
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(file);
    });
  }
};

// Setup choices are intentionally defined in the client so availability
// detection can never hide or disable a supported CLI.
const CLI_CHOICES = [
  { id: 'claude', name: 'Claude Code', command: 'claude', description: 'Anthropic\'s agentic coding CLI.' },
  { id: 'antigravity', name: 'Antigravity CLI', command: 'agy', description: 'Google Antigravity\'s terminal agent.' },
  { id: 'codex', name: 'Codex CLI', command: 'codex', description: 'OpenAI\'s coding agent for the terminal.' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', description: 'The open-source AI coding agent.' },
];

const CLI_INITIALS = {
  claude: 'CC',
  antigravity: 'AG',
  codex: 'CX',
  opencode: 'OC',
};

const CLI_STORAGE_KEY = 'pw-cli';

async function readJsonResponse(response, apiName) {
  const body = await response.text();
  let data;

  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    const returnedHtml = /^\s*</.test(body);
    throw new Error(returnedHtml
      ? `${apiName} API returned the app page instead of JSON. Restart the PulsarWiki server.`
      : `${apiName} API returned an invalid response.`);
  }

  if (!response.ok) throw new Error(data.error || `${apiName} request failed.`);
  return data;
}

function getStoredCli() {
  try {
    const cli = localStorage.getItem(CLI_STORAGE_KEY);
    return CLI_CHOICES.some(choice => choice.id === cli) ? cli : null;
  } catch {
    return null;
  }
}

function storeCli(cli) {
  try {
    localStorage.setItem(CLI_STORAGE_KEY, cli);
  } catch {
    // The in-memory selection still works for this page session.
  }
}

// ── State ──────────────────────────────────────────────────────────
const state = {
  panel:      'wiki',
  wikiPages:  [],
  currentPage: null,
  rawFiles:   [],
  graphData:  null,
  graphInit:  false,
  graph: {
    simulation: null,
    resizeObserver: null,
    svg: null,
    zoom: null,
    width: 0,
    height: 0,
  },
  ws:         null,
  wsReady:    false,
  backendReady: false,
  backendOutdated: false,
  backendHandshakeTimer: null,
  aiRunning:  false,
  config:     null,
  cliTools:   CLI_CHOICES,
  selectedCli: null,
  setupRequired: false,
  chatHistory: [],     // { role, text }
  searchTimer: null,
  documentSession: 0,
  currentDocument: null,
  pdf: {
    lib: null,
    doc: null,
    page: 1,
    scale: 1,
    fitWidth: true,
    renderTask: null,
    renderId: 0,
    resizeTimer: null,
  },
};

// ── DOM Refs ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const dom = {
  get sidebarBody()    { return $('sidebar-body'); },
  get wikiBody()       { return $('wiki-body'); },
  get wikiBc()         { return $('wiki-breadcrumb'); },
  get searchInput()    { return $('search-input'); },
  get searchResults()  { return $('search-results'); },
  get chatMessages()   { return $('chat-messages'); },
  get chatInput()      { return $('chat-input'); },
  get chatSend()       { return $('chat-send'); },
  get chatAbort()      { return $('chat-abort'); },
  get chatStatus()     { return $('chat-status'); },
  get wsDot()          { return $('ws-dot'); },
  get cliStatusButton(){ return $('cli-status-button'); },
  get cliStatusLabel() { return $('cli-status-label'); },
  get setupModal()     { return $('setup-modal'); },
  get setupTitle()     { return $('setup-title'); },
  get cliOptions()     { return $('cli-options'); },
  get setupError()     { return $('setup-error'); },
  get setupCancel()    { return $('setup-cancel'); },
  get setupSave()      { return $('setup-save'); },
  get filesGrid()      { return $('files-grid'); },
  get filesCount()     { return $('files-count'); },
  get uploadModal()    { return $('upload-modal'); },
  get newPageModal()   { return $('new-page-modal'); },
  get dropzone()       { return $('dropzone'); },
  get fileInput()      { return $('file-input'); },
  get uploadProgress() { return $('upload-progress'); },
  get newPageName()    { return $('new-page-name'); },
  get graphCanvas()    { return $('graph-canvas'); },
  get graphLegend()    { return $('graph-legend'); },
  get graphTooltip()   { return $('graph-tooltip'); },
  get graphStatus()    { return $('graph-status'); },
  get documentStage()  { return $('document-stage'); },
  get documentStatus() { return $('document-status'); },
  get pdfToolbar()     { return $('pdf-toolbar'); },
};

// ── Panel switching ────────────────────────────────────────────────
function showPanel(name) {
  console.log('Switching to panel:', name);
  state.panel = name;
  const navigationPanel = name === 'document' ? 'files' : name;
  
  // Re-query panels to ensure we have the latest set
  const panels = document.querySelectorAll('.panel');
  panels.forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.panel === navigationPanel));
  
  const iconBtns = document.querySelectorAll('.icon-btn[data-panel]');
  iconBtns.forEach(b => b.classList.toggle('active', b.dataset.panel === navigationPanel));

  if (name === 'graph') {
    showGraph();
  }
  if (name === 'files') loadFiles();
}

// ── Sidebar ────────────────────────────────────────────────────────
const PILLAR_LABELS = [
  'Other',
  'Foundational Physics',
  'Taxonomy & Evolution',
  'Observational Methods',
  'Facilities & Tools',
  'Notable Objects'
];

function buildSidebar(pages) {
  state.wikiPages = pages;
  const groups = {};
  pages.forEach(p => {
    // Try to assign group from index categories (we'll match later); default 0
    const g = p.group || 0;
    if (!groups[g]) groups[g] = [];
    groups[g].push(p);
  });

  // Also load graph for group info
  api.getGraph().then(data => {
    state.graphData = data;
    // Build a map of name→group
    const groupMap = {};
    data.nodes.forEach(n => { groupMap[n.id] = n.group; });
    // Re-render sidebar with groups
    const grouped = {};
    pages.forEach(p => {
      const g = groupMap[p.name] || 0;
      if (!grouped[g]) grouped[g] = [];
      grouped[g].push(p);
    });
    renderSidebarGroups(grouped);
  }).catch(() => {
    const grouped = { 0: pages };
    renderSidebarGroups(grouped);
  });
}

function renderSidebarGroups(grouped) {
  const keys = Object.keys(grouped).sort((a, b) => +a - +b);
  let html = '';
  keys.forEach(k => {
    const label = PILLAR_LABELS[+k] || `Group ${k}`;
    const items = grouped[k];
    if (+k > 0) html += `<div class="nav-section-title">${label}</div>`;
    items.sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
      html += `<div class="nav-item" data-page="${p.name}" onclick="openPage('${p.name}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        ${p.name}
      </div>`;
    });
  });
  dom.sidebarBody.innerHTML = html;
  // Mark active
  highlightSidebarItem(state.currentPage);
}

function highlightSidebarItem(name) {
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === name);
  });
}

// ── Wiki page view ─────────────────────────────────────────────────
async function openPage(name) {
  showPanel('wiki');
  highlightSidebarItem(name);
  state.currentPage = name;

  const wikiPanel = $('panel-wiki');

  // Breadcrumb
  dom.wikiBc.innerHTML = `
    <a onclick="app.showPanel('wiki')">Wiki</a>
    <span>›</span>
    <span>${name}</span>`;

  dom.wikiBody.innerHTML = `<div style="color:var(--text-3);padding:40px 0;text-align:center;font-size:13px">Loading…</div>`;

  let data;
  try {
    data = await api.getWikiPage(name);
  } catch(e) {
    dom.wikiBody.innerHTML = `<div class="wiki-empty"><p style="color:var(--text-3)">Failed to load page: ${e.message}</p></div>`;
    return;
  }

  if (data.error) {
    dom.wikiBody.innerHTML = `<div class="wiki-empty"><p style="color:var(--text-3)">${data.error}</p></div>`;
    return;
  }

  const html = renderMd(data.content);
  dom.wikiBody.innerHTML = `<div class="md-body">${html}</div>`;

  // Wire up wiki-link clicks
  dom.wikiBody.querySelectorAll('a.wiki-link').forEach(a => {
    a.addEventListener('click', () => openPage(a.dataset.page));
  });

  // Scroll to top
  wikiPanel.scrollTop = 0;
}

// ── Search ─────────────────────────────────────────────────────────
dom.searchInput.addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  const q = dom.searchInput.value.trim();
  if (!q) { hideSearch(); return; }
  state.searchTimer = setTimeout(() => doSearch(q), 250);
});

dom.searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') hideSearch();
});

document.addEventListener('click', e => {
  if (!dom.searchResults.contains(e.target) && e.target !== dom.searchInput) hideSearch();
});

async function doSearch(q) {
  const results = await api.search(q);
  if (!results.length) {
    dom.searchResults.innerHTML = `<div class="search-no-results">No results for "<strong>${q}</strong>"</div>`;
  } else {
    dom.searchResults.innerHTML = results.map(r => `
      <div class="search-result-item" onclick="openPage('${r.page}');hideSearch()">
        <div class="search-result-page">${r.page}</div>
        ${r.matches.slice(0,2).map(m => `<div class="search-result-match">${escHtml(m.text)}</div>`).join('')}
      </div>`).join('');
  }
  dom.searchResults.classList.add('visible');
}

function hideSearch() {
  dom.searchResults.classList.remove('visible');
}

// ── CLI setup ─────────────────────────────────────────────────────
function currentCliTool() {
  return state.cliTools.find(tool => tool.id === state.config?.cli) || state.config?.tool || null;
}

function renderCliOptions() {
  dom.cliOptions.innerHTML = state.cliTools.map(tool => {
    const selected = tool.id === state.selectedCli;
    return `
      <label class="cli-option${selected ? ' selected' : ''}" data-cli="${escHtml(tool.id)}">
        <input type="radio" name="cli-tool" value="${escHtml(tool.id)}" ${selected ? 'checked' : ''}>
        <span class="cli-option-mark" aria-hidden="true">${CLI_INITIALS[tool.id] || 'AI'}</span>
        <span class="cli-option-copy">
          <strong>${escHtml(tool.name)}</strong>
          <small>${escHtml(tool.description)}</small>
          <code>${escHtml(tool.command)}</code>
        </span>
        <span class="cli-option-check" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 8 3 3 7-7"/></svg>
        </span>
      </label>`;
  }).join('');

  dom.cliOptions.querySelectorAll('input[name="cli-tool"]').forEach(input => {
    input.addEventListener('change', () => selectCli(input.value));
  });
}

function selectCli(id) {
  state.selectedCli = id;
  dom.setupSave.disabled = false;
  dom.setupError.textContent = '';
  dom.cliOptions.querySelectorAll('.cli-option').forEach(option => {
    option.classList.toggle('selected', option.dataset.cli === id);
  });
}

function applyCliConfig(config) {
  state.config = { ...state.config, ...config, configured: Boolean(config.cli) };
  if (config.tools) {
    const serverTools = new Map(config.tools.map(tool => [tool.id, tool]));
    state.cliTools = CLI_CHOICES.map(choice => ({ ...choice, ...serverTools.get(choice.id) }));
  }

  const tool = currentCliTool();
  const configured = Boolean(tool);
  const canChat = configured && state.wsReady && state.backendReady;
  const name = tool?.name || 'Choose CLI';
  const initials = tool ? (CLI_INITIALS[tool.id] || 'AI') : 'AI';

  dom.cliStatusLabel.textContent = name;
  dom.cliStatusButton.title = configured ? `Change CLI tool (currently ${name})` : 'Choose CLI tool';
  dom.wsDot.title = state.backendReady
    ? `${configured ? `${name} selected · ` : ''}backend ready`
    : (state.backendOutdated
      ? 'Outdated PulsarWiki backend'
      : (state.wsReady ? 'Checking backend version' : 'Server disconnected'));

  const welcomeAvatar = $('chat-welcome-avatar');
  const welcomeTitle = $('chat-welcome-title');
  if (welcomeAvatar) welcomeAvatar.textContent = initials;
  if (welcomeTitle) welcomeTitle.textContent = configured ? `${name} selected.` : 'Choose your CLI to get started.';

  dom.chatInput.disabled = !canChat;
  dom.chatSend.disabled = !canChat || state.aiRunning;
  if (!state.aiRunning) {
    dom.chatStatus.textContent = !configured
      ? 'Complete setup to enable chat'
      : (state.backendReady
        ? 'Press Enter to send · Shift+Enter for new line'
        : (state.backendOutdated
          ? 'The server is outdated. Restart npm start, then refresh this page.'
          : 'Connecting to the chat backend…'));
  }
}

function openCliSetup(required = false) {
  state.setupRequired = required || !state.config?.configured;
  state.selectedCli = state.config?.cli || null;
  dom.setupTitle.textContent = state.setupRequired ? 'Choose your CLI' : 'Change your CLI';
  dom.setupCancel.style.display = state.setupRequired ? 'none' : 'inline-flex';
  dom.setupSave.textContent = state.setupRequired ? 'Continue' : 'Save choice';
  dom.setupSave.disabled = !state.selectedCli;
  dom.setupError.textContent = '';
  renderCliOptions();
  dom.setupModal.style.display = 'flex';

  requestAnimationFrame(() => {
    const target = dom.cliOptions.querySelector('input:checked') || dom.cliOptions.querySelector('input');
    target?.focus();
  });
}

function closeCliSetup() {
  if (state.setupRequired) return;
  dom.setupModal.style.display = 'none';
}

async function saveCliSelection() {
  if (!state.selectedCli) return;
  dom.setupSave.disabled = true;
  dom.setupSave.textContent = 'Saving…';
  dom.setupError.textContent = '';

  try {
    const result = await api.saveConfig(state.selectedCli);
    applyCliConfig({ ...result, configured: true });
    state.setupRequired = false;
    dom.setupModal.style.display = 'none';
    if (result.warning) dom.chatStatus.textContent = result.warning;
  } catch (error) {
    dom.setupError.textContent = error.message;
    dom.setupSave.disabled = false;
    dom.setupSave.textContent = state.setupRequired ? 'Continue' : 'Save choice';
  }
}

dom.cliStatusButton.addEventListener('click', () => openCliSetup(false));
dom.setupCancel.addEventListener('click', closeCliSetup);
dom.setupSave.addEventListener('click', saveCliSelection);
dom.setupModal.addEventListener('click', event => {
  if (event.target === dom.setupModal) closeCliSetup();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && dom.setupModal.style.display !== 'none') closeCliSetup();
});

// ── WebSocket / Chat ───────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  state.ws = ws;

  ws.onopen = () => {
    state.wsReady = true;
    state.backendReady = false;
    state.backendOutdated = false;
    applyCliConfig(state.config || { cli: null });
    ws.send(JSON.stringify({ type: 'client-hello', protocol: 2 }));
    clearTimeout(state.backendHandshakeTimer);
    state.backendHandshakeTimer = setTimeout(() => {
      if (state.ws !== ws || state.backendReady) return;
      state.backendOutdated = true;
      dom.wsDot.classList.remove('active');
      dom.wsDot.title = 'Outdated PulsarWiki backend';
      dom.chatInput.disabled = true;
      dom.chatSend.disabled = true;
      dom.chatStatus.textContent = 'The server is outdated. Restart npm start, then refresh this page.';
    }, 1500);
  };

  ws.onclose = () => {
    clearTimeout(state.backendHandshakeTimer);
    state.wsReady = false;
    state.backendReady = false;
    state.backendOutdated = false;
    dom.wsDot.classList.remove('active');
    dom.wsDot.title = 'Server disconnected';
    // Reconnect after 3s
    setTimeout(connectWS, 3000);
  };

  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.type === 'server-hello') {
      clearTimeout(state.backendHandshakeTimer);
      state.backendReady = Number(msg.protocol) >= 2;
      state.backendOutdated = !state.backendReady;
      dom.wsDot.classList.toggle('active', state.backendReady);
      applyCliConfig(state.config || { cli: null });
      return;
    }
    if (msg.type === 'filechange') { refreshWiki(); return; }
    if (msg.type === 'chunk')  handleAiChunk(msg.text);
    if (msg.type === 'error')  handleAiChunk(`\n⚠ ${msg.text}`);
    if (msg.type === 'done')   handleAiDone();
  };
}

// Current AI response buffer
let aiTarget = null;

function sendChat() {
  const text = dom.chatInput.value.trim();
  const tool = currentCliTool();
  if (!text || state.aiRunning || !tool || !state.backendReady) return;
  dom.chatInput.value = '';
  resizeTextarea();

  appendChatMsg('user', text);
  state.aiRunning = true;
  dom.chatSend.disabled = true;
  dom.chatAbort.style.display = 'flex';
  dom.chatStatus.textContent = `${tool.name} is thinking…`;

  // Create AI bubble
  const id = `ai-msg-${Date.now()}`;
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg ai';
  msgEl.id = id;
  msgEl.innerHTML = `
    <div class="chat-avatar">${CLI_INITIALS[tool.id] || 'AI'}</div>
    <div class="chat-bubble">
      <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
    </div>`;
  dom.chatMessages.appendChild(msgEl);
  aiTarget = { el: msgEl.querySelector('.chat-bubble'), buffer: '' };
  scrollChat();

  if (state.ws && state.wsReady) {
    state.ws.send(JSON.stringify({ type: 'chat', text, cli: tool.id }));
  } else {
    handleAiChunk('⚠ Not connected to server. Make sure the server is running.');
    handleAiDone();
  }
}

function handleAiChunk(text) {
  if (!aiTarget) return;
  aiTarget.buffer += text;
  // Render as markdown
  aiTarget.el.innerHTML = `<div class="md-body" style="padding:0">${renderMd(aiTarget.buffer)}</div>`;
  scrollChat();
}

function handleAiDone() {
  state.aiRunning = false;
  dom.chatSend.disabled = !currentCliTool() || !state.backendReady;
  dom.chatAbort.style.display = 'none';
  dom.chatStatus.textContent = currentCliTool()
    ? 'Press Enter to send · Shift+Enter for new line'
    : 'Complete setup to enable chat';
  aiTarget = null;
  scrollChat();
}

function appendChatMsg(role, text) {
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  const tool = currentCliTool();
  const initial = role === 'user' ? 'U' : (CLI_INITIALS[tool?.id] || 'AI');
  el.innerHTML = `
    <div class="chat-avatar">${initial}</div>
    <div class="chat-bubble">${role === 'user' ? escHtml(text) : renderMd(text)}</div>`;
  dom.chatMessages.appendChild(el);
  scrollChat();
}

function scrollChat() {
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

// Auto-resize textarea
function resizeTextarea() {
  dom.chatInput.style.height = 'auto';
  dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 180) + 'px';
}

dom.chatInput.addEventListener('input', resizeTextarea);
dom.chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
dom.chatSend.addEventListener('click', sendChat);
dom.chatAbort.addEventListener('click', () => {
  if (state.ws && state.wsReady) state.ws.send(JSON.stringify({ type: 'abort' }));
  handleAiDone();
});

// ── Graph view ─────────────────────────────────────────────────────
const GROUP_COLORS = ['#888','#f0f0f0','#c0c0c0','#909090','#606060','#404040'];
const GROUP_COLORS_LIGHT = ['#888','#111','#333','#555','#777','#999'];

function setGraphStatus(message = '') {
  dom.graphStatus.textContent = message;
  dom.graphStatus.classList.toggle('visible', Boolean(message));
}

async function showGraph() {
  setGraphStatus('Loading graph\u2026');

  try {
    const data = state.graphData || await api.getGraph();
    if (state.panel !== 'graph') return;
    state.graphData = data;
    state.graphInit = true;

    // Wait for the active panel layout to be painted before measuring.
    requestAnimationFrame(() => requestAnimationFrame(() => drawGraph(data)));
  } catch (error) {
    console.error('Unable to load graph:', error);
    setGraphStatus('The graph could not be loaded. Please try again.');
  }
}

function drawGraph(data) {
  if (!window.d3) {
    setGraphStatus('The graph renderer could not be loaded.');
    return;
  }
  if (!data || !Array.isArray(data.nodes)) {
    setGraphStatus('No graph data is available.');
    return;
  }
  const nodes = data.nodes.map(d => ({...d}));
  const links = (data.edges || []).map(d => ({...d}));
  
  const svg = d3.select('#graph-canvas');
  const panel = document.getElementById('panel-graph');
  const rect = panel.getBoundingClientRect();
  const W = Math.round(rect.width);
  const H = Math.round(rect.height);

  if (!W || !H) {
    requestAnimationFrame(() => {
      if (state.panel === 'graph') drawGraph(data);
    });
    return;
  }

  console.log(`Drawing graph: ${nodes.length} nodes, ${links.length} links, dim: ${W}x${H}`);

  state.graph.simulation?.stop();
  state.graph.resizeObserver?.disconnect();
  svg.selectAll('*').remove();
  svg.attr('width', '100%').attr('height', '100%').attr('viewBox', `0 0 ${W} ${H}`);
  setGraphStatus(nodes.length ? '' : 'There are no pages to display yet.');
  if (!nodes.length) return;

  const isLight = document.documentElement.dataset.theme === 'light';
  const colors = isLight ? GROUP_COLORS_LIGHT : GROUP_COLORS;

  // Legend
  const usedGroups = [...new Set(nodes.map(n => n.group))].sort((a,b)=>a-b);
  const legend = document.getElementById('graph-legend');
  if (legend) {
    legend.innerHTML = usedGroups.map(g => `
      <div class="legend-item">
        <div class="legend-dot" style="background:${colors[g] || '#888'}"></div>
        <span>${PILLAR_LABELS[g] || `Group ${g}`}</span>
      </div>`).join('');
  }

  const linkCount = {};
  links.forEach(e => {
    linkCount[e.source] = (linkCount[e.source] || 0) + 1;
    linkCount[e.target] = (linkCount[e.target] || 0) + 1;
  });

  const rScale = d3.scaleSqrt().domain([0, d3.max(Object.values(linkCount)) || 1]).range([6, 18]);
  const labelWidth = d => Math.min(160, Math.max(26, d.id.length * 6.8));
  const nodeRadius = d => rScale(linkCount[d.id] || 0);
  const collisionRadius = d => nodeRadius(d) + 14 + labelWidth(d) / 2;
  const isConnected = d => (linkCount[d.id] || 0) > 0;

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(145).strength(0.42))
    .force('charge', d3.forceManyBody().strength(d => isConnected(d) ? -750 : -120))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('x', d3.forceX(W / 2).strength(d => isConnected(d) ? 0.014 : 0.3))
    .force('y', d3.forceY(H / 2).strength(d => isConnected(d) ? 0.014 : 0.3))
    .force('collision', d3.forceCollide(collisionRadius).strength(1).iterations(2));

  const zoom = d3.zoom().scaleExtent([0.2, 6]).on('zoom', e => g.attr('transform', e.transform));
  svg.call(zoom);

  const g = svg.append('g');

  const link = g.append('g').selectAll('line').data(links).join('line')
    .attr('stroke', isLight ? '#ccc' : '#333')
    .attr('stroke-width', 1.25)
    .attr('stroke-opacity', 0.48);

  const node = g.append('g').selectAll('g').data(nodes).join('g')
    .style('cursor', 'pointer')
    .call(d3.drag()
      .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
      .on('drag',  (event, d) => { d.fx=event.x; d.fy=event.y; })
      .on('end',   (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx=null; d.fy=null; })
    )
    .on('click', (event, d) => {
      if (event.defaultPrevented) return;
      openPage(d.id);
    })
    .on('mouseover', (event, d) => {
      const tooltip = document.getElementById('graph-tooltip');
      if (tooltip) { tooltip.textContent = d.id; tooltip.style.opacity = '1'; }
      d3.select(event.currentTarget).select('circle').attr('stroke', isLight ? '#000' : '#fff');
    })
    .on('mousemove', event => {
      const tooltip = document.getElementById('graph-tooltip');
      if (tooltip) {
        tooltip.style.left = (event.offsetX + 14) + 'px';
        tooltip.style.top  = (event.offsetY - 10) + 'px';
      }
    })
    .on('mouseout', (event) => { 
      const tooltip = document.getElementById('graph-tooltip');
      if (tooltip) tooltip.style.opacity = '0'; 
      d3.select(event.currentTarget).select('circle').attr('stroke', isLight ? '#fff' : '#0c0c0c');
    });

  node.append('circle')
    .attr('r', nodeRadius)
    .attr('fill', d => colors[d.group] || colors[0])
    .attr('fill-opacity', 0.9)
    .attr('stroke', isLight ? '#fff' : '#0c0c0c')
    .attr('stroke-width', 2);

  const label = node.append('text')
    .text(d => d.id)
    .attr('y', '0.35em')
    .attr('font-size', '12px')
    .attr('font-family', 'Inter, system-ui, sans-serif')
    .attr('font-weight', '500')
    .attr('fill', isLight ? '#333' : '#bbb')
    .attr('stroke', isLight ? '#f5f5f5' : '#0c0c0c')
    .attr('stroke-width', 3)
    .attr('stroke-linejoin', 'round')
    .attr('paint-order', 'stroke')
    .attr('pointer-events', 'none');

  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
    label
      .attr('x', d => (d.x < W / 2 ? -1 : 1) * (nodeRadius(d) + 7))
      .attr('text-anchor', d => d.x < W / 2 ? 'end' : 'start');
  });

  function fitGraph(animate = true) {
    const width = state.graph.width;
    const height = state.graph.height;
    const positionedNodes = nodes.filter(d => Number.isFinite(d.x) && Number.isFinite(d.y));
    if (!positionedNodes.length || !width || !height) return;

    const minX = d3.min(positionedNodes, d => d.x - (d.x < W / 2 ? labelWidth(d) + nodeRadius(d) + 7 : nodeRadius(d)));
    const maxX = d3.max(positionedNodes, d => d.x + (d.x < W / 2 ? nodeRadius(d) : labelWidth(d) + nodeRadius(d) + 7));
    const minY = d3.min(positionedNodes, d => d.y - Math.max(nodeRadius(d), 8));
    const maxY = d3.max(positionedNodes, d => d.y + Math.max(nodeRadius(d), 8));
    const graphWidth = Math.max(1, maxX - minX);
    const graphHeight = Math.max(1, maxY - minY);
    const scale = Math.min(1.8, 0.9 / Math.max(graphWidth / width, graphHeight / height));
    const transform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
    const target = animate ? svg.transition().duration(350) : svg;
    target.call(zoom.transform, transform);
  }

  let initialFitPending = true;
  simulation.on('end', () => {
    if (!initialFitPending) return;
    initialFitPending = false;
    fitGraph(false);
  });

  const resizeObserver = new ResizeObserver(entries => {
    const size = entries[0]?.contentRect;
    const nextWidth = Math.round(size?.width || 0);
    const nextHeight = Math.round(size?.height || 0);
    if (!nextWidth || !nextHeight || (nextWidth === state.graph.width && nextHeight === state.graph.height)) return;

    state.graph.width = nextWidth;
    state.graph.height = nextHeight;
    svg.attr('viewBox', `0 0 ${nextWidth} ${nextHeight}`);
    // Keep the settled force layout stable and fit it into the new viewport.
    // Restarting the simulation here makes the graph drift after every resize.
    fitGraph(false);
  });

  state.graph = { simulation, resizeObserver, svg, zoom, width: W, height: H };
  resizeObserver.observe(panel);

  // Graph control buttons
  $('graph-zoom-in').onclick  = () => svg.transition().call(zoom.scaleBy, 1.4);
  $('graph-zoom-out').onclick = () => svg.transition().call(zoom.scaleBy, 0.7);
  $('graph-reset').onclick    = () => fitGraph();
}

// ── Files panel ────────────────────────────────────────────────────
function fileIcon(ext) {
  if (ext === 'pdf') return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
  if (['txt', 'md', 'markdown', 'log'].includes(ext)) return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function loadFiles() {
  const files = await api.getRawList();
  state.rawFiles = files;
  dom.filesCount.textContent = files.length;

  dom.filesGrid.innerHTML = files.map((f, index) => `
    <button class="file-card" type="button" data-file-index="${index}" aria-label="Open ${escHtml(f.name)}">
      <div class="file-card-topline">
        <div class="file-card-icon">${fileIcon(f.ext)}</div>
        <span class="file-card-ext">${f.ext || 'file'}</span>
      </div>
      <div class="file-card-name">${escHtml(f.name)}</div>
      <div class="file-card-meta">${fmtSize(f.size)} · View document</div>
    </button>`).join('');

  dom.filesGrid.querySelectorAll('[data-file-index]').forEach(card => {
    card.addEventListener('click', () => {
      const file = state.rawFiles[Number(card.dataset.fileIndex)];
      if (file) openRawFile(file.name, file.ext, file);
    });
  });
}

function setDocumentStatus(message, detail = '', isError = false) {
  dom.documentStage.innerHTML = `
    <div class="document-status${isError ? ' error' : ''}">
      ${isError ? fileIcon('file') : '<span class="document-spinner"></span>'}
      <strong>${escHtml(message)}</strong>
      ${detail ? `<span>${escHtml(detail)}</span>` : ''}
    </div>`;
}

async function openRawFile(name, ext, file = {}, updateHash = true) {
  const normalizedExt = String(ext || '').toLowerCase();
  const url = `/api/raw/${encodeURIComponent(name)}`;
  const session = ++state.documentSession;
  state.currentDocument = { name, ext: normalizedExt, url };
  state.pdf.doc = null;
  state.pdf.page = 1;
  state.pdf.scale = 1;
  state.pdf.fitWidth = true;
  if (state.pdf.renderTask) state.pdf.renderTask.cancel();

  showPanel('document');
  if (updateHash) history.replaceState(null, '', `#file/${encodeURIComponent(name)}`);
  $('document-title').textContent = name;
  $('document-file-icon').innerHTML = fileIcon(normalizedExt);
  $('document-meta').innerHTML = `<span>${normalizedExt || 'FILE'}</span>${file.size != null ? `<span>${fmtSize(file.size)}</span>` : ''}`;
  $('document-download').href = url;
  $('document-download').setAttribute('download', name);
  dom.pdfToolbar.hidden = normalizedExt !== 'pdf';
  setDocumentStatus(`Opening ${normalizedExt ? normalizedExt.toUpperCase() : 'document'}…`);

  try {
    if (normalizedExt === 'pdf') {
      await openPdf(url, session);
      return;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`The server returned ${response.status}.`);
    const content = await response.text();
    if (session !== state.documentSession) return;

    if (['md', 'markdown'].includes(normalizedExt)) {
      dom.documentStage.innerHTML = `<article class="document-reading-surface md-body">${renderMd(content)}</article>`;
      dom.documentStage.querySelectorAll('a.wiki-link').forEach(a => {
        a.addEventListener('click', () => openPage(a.dataset.page));
      });
      return;
    }

    if (['txt', 'log', 'csv', 'json', 'xml', 'yaml', 'yml'].includes(normalizedExt)) {
      dom.documentStage.innerHTML = `<div class="document-reading-surface document-plain-text"><pre></pre></div>`;
      dom.documentStage.querySelector('pre').textContent = content;
      return;
    }

    setDocumentStatus('Preview not available', `Download ${name} to open it in another application.`, true);
  } catch (error) {
    if (session !== state.documentSession) return;
    setDocumentStatus('Could not open this document', error.message, true);
  }
}

async function getPdfLibrary() {
  if (!state.pdf.lib) {
    state.pdf.lib = await import('/vendor/pdfjs/build/pdf.min.mjs');
    state.pdf.lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.min.mjs';
  }
  return state.pdf.lib;
}

async function openPdf(url, session) {
  const pdfjsLib = await getPdfLibrary();
  const loadingTask = pdfjsLib.getDocument({
    url,
    cMapUrl: '/vendor/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
    wasmUrl: '/vendor/pdfjs/wasm/',
  });
  const pdf = await loadingTask.promise;
  if (session !== state.documentSession) {
    pdf.destroy();
    return;
  }
  state.pdf.doc = pdf;
  $('pdf-page-input').max = pdf.numPages;
  $('pdf-page-count').textContent = `/ ${pdf.numPages}`;
  await renderPdfPage(1, true);
}

function clampPdfScale(value) {
  return Math.min(3, Math.max(0.5, value));
}

async function renderPdfPage(pageNumber, fitWidth = state.pdf.fitWidth) {
  const pdf = state.pdf.doc;
  if (!pdf) return;
  const renderId = ++state.pdf.renderId;
  const session = state.documentSession;
  const page = await pdf.getPage(Math.min(pdf.numPages, Math.max(1, pageNumber)));
  if (session !== state.documentSession || renderId !== state.pdf.renderId) return;

  state.pdf.page = page.pageNumber;
  state.pdf.fitWidth = fitWidth;
  const baseViewport = page.getViewport({ scale: 1 });
  if (fitWidth) {
    const availableWidth = Math.max(320, dom.documentStage.clientWidth - 96);
    state.pdf.scale = clampPdfScale(availableWidth / baseViewport.width);
  }

  const viewport = page.getViewport({ scale: state.pdf.scale });
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  if (state.pdf.renderTask) state.pdf.renderTask.cancel();

  dom.documentStage.innerHTML = `
    <div class="pdf-page-wrap" aria-label="Page ${page.pageNumber} of ${pdf.numPages}">
      <canvas id="pdf-canvas"></canvas>
    </div>`;
  const canvas = $('pdf-canvas');
  const context = canvas.getContext('2d');
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  $('pdf-page-input').value = page.pageNumber;
  $('pdf-zoom-value').textContent = `${Math.round(state.pdf.scale * 100)}%`;
  $('pdf-prev').disabled = page.pageNumber <= 1;
  $('pdf-next').disabled = page.pageNumber >= pdf.numPages;
  $('pdf-fit').classList.toggle('active', fitWidth);

  const renderTask = page.render({
    canvasContext: context,
    viewport,
    transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
  });
  state.pdf.renderTask = renderTask;

  try {
    await renderTask.promise;
  } catch (error) {
    if (error?.name !== 'RenderingCancelledException') throw error;
  } finally {
    if (state.pdf.renderTask === renderTask) state.pdf.renderTask = null;
  }
}

$('document-back').addEventListener('click', () => {
  history.replaceState(null, '', location.pathname);
  showPanel('files');
});
$('pdf-prev').addEventListener('click', () => renderPdfPage(state.pdf.page - 1, state.pdf.fitWidth));
$('pdf-next').addEventListener('click', () => renderPdfPage(state.pdf.page + 1, state.pdf.fitWidth));
$('pdf-zoom-out').addEventListener('click', () => {
  state.pdf.scale = clampPdfScale(state.pdf.scale - 0.15);
  renderPdfPage(state.pdf.page, false);
});
$('pdf-zoom-in').addEventListener('click', () => {
  state.pdf.scale = clampPdfScale(state.pdf.scale + 0.15);
  renderPdfPage(state.pdf.page, false);
});
$('pdf-fit').addEventListener('click', () => renderPdfPage(state.pdf.page, true));
$('pdf-page-input').addEventListener('change', event => {
  const page = Math.min(state.pdf.doc?.numPages || 1, Math.max(1, Number(event.target.value) || 1));
  renderPdfPage(page, state.pdf.fitWidth);
});

window.addEventListener('resize', () => {
  clearTimeout(state.pdf.resizeTimer);
  if (state.panel !== 'document' || !state.pdf.doc || !state.pdf.fitWidth) return;
  state.pdf.resizeTimer = setTimeout(() => renderPdfPage(state.pdf.page, true), 120);
});

// ── Upload modal ───────────────────────────────────────────────────
function openUploadModal() {
  dom.uploadModal.style.display = 'flex';
  dom.uploadProgress.textContent = '';
}
function closeUploadModal() { dom.uploadModal.style.display = 'none'; }

$('btn-upload').onclick = openUploadModal;
$('files-upload-btn').onclick = openUploadModal;
$('modal-cancel').onclick = closeUploadModal;
dom.uploadModal.addEventListener('click', e => { if (e.target === dom.uploadModal) closeUploadModal(); });

dom.dropzone.addEventListener('click', () => dom.fileInput.click());
dom.dropzone.addEventListener('dragover', e => { e.preventDefault(); dom.dropzone.classList.add('drag-over'); });
dom.dropzone.addEventListener('dragleave', () => dom.dropzone.classList.remove('drag-over'));
dom.dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dom.dropzone.classList.remove('drag-over');
  uploadFiles(Array.from(e.dataTransfer.files));
});
dom.fileInput.addEventListener('change', () => uploadFiles(Array.from(dom.fileInput.files)));

async function uploadFiles(files) {
  dom.uploadProgress.textContent = `Uploading ${files.length} file(s)…`;
  for (const file of files) {
    dom.uploadProgress.textContent = `Uploading ${file.name}…`;
    await api.uploadFile(file, p => {
      dom.uploadProgress.textContent = `Uploading ${file.name} — ${Math.round(p*100)}%`;
    });
  }
  dom.uploadProgress.textContent = '✓ Upload complete';
  setTimeout(() => { closeUploadModal(); loadFiles(); }, 1200);
}

// ── New page modal ─────────────────────────────────────────────────
$('btn-new-page').onclick = () => {
  dom.newPageModal.style.display = 'flex';
  dom.newPageName.value = '';
  dom.newPageName.focus();
};
$('new-page-cancel').onclick = () => { dom.newPageModal.style.display = 'none'; };
dom.newPageModal.addEventListener('click', e => { if (e.target === dom.newPageModal) dom.newPageModal.style.display = 'none'; });

$('new-page-create').onclick = async () => {
  const name = dom.newPageName.value.trim().toLowerCase().replace(/\s+/g, '-');
  if (!name) return;
  const res = await api.createWikiPage(name);
  if (res.error) { alert(res.error); return; }
  dom.newPageModal.style.display = 'none';
  await refreshWiki();
  openPage(name);
};

dom.newPageName.addEventListener('keydown', e => {
  if (e.key === 'Enter') $('new-page-create').click();
});

// ── Theme toggle ───────────────────────────────────────────────────
let theme = localStorage.getItem('pw-theme') || 'dark';
applyTheme(theme);

$('ib-theme').addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('pw-theme', theme);
  applyTheme(theme);
  // Redraw graph if active
  if (state.panel === 'graph' && state.graphData) {
    drawGraph(state.graphData);
  }
});

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('theme-icon-dark').style.display = t === 'dark' ? 'block' : 'none';
  $('theme-icon-light').style.display = t === 'light' ? 'block' : 'none';
}

// ── Sidebar panel tabs ─────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => showPanel(b.dataset.panel)));
document.querySelectorAll('.icon-btn[data-panel]').forEach(b => b.addEventListener('click', () => showPanel(b.dataset.panel)));

// ── Wiki refresh ───────────────────────────────────────────────────
async function refreshWiki() {
  const pages = await api.getWikiList();
  buildSidebar(pages);
  // Refresh current page if open
  if (state.currentPage) openPage(state.currentPage);
}

// ── Utility ────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) { return String(s).replace(/'/g,"\\'"); }

// ── Global expose ──────────────────────────────────────────────────
window.app = { showPanel };
window.openPage = openPage;
window.openRawFile = openRawFile;
window.hideSearch = hideSearch;

// ── Bootstrap ──────────────────────────────────────────────────────
(async function init() {
  connectWS();

  try {
    const config = await api.getConfig();
    applyCliConfig(config);
    if (!config.configured) openCliSetup(true);
    if (config.configured && config.warning) dom.chatStatus.textContent = config.warning;
  } catch (error) {
    applyCliConfig({ cli: null, configured: false });
    openCliSetup(true);
    dom.setupError.textContent = error.message;
  }

  const pages = await api.getWikiList();
  buildSidebar(pages);
  // If hash present, open that page
  const hash = location.hash;
  if (hash.startsWith('#wiki/')) openPage(decodeURIComponent(hash.slice(6)));
  if (hash.startsWith('#file/')) {
    const name = decodeURIComponent(hash.slice(6));
    const files = await api.getRawList();
    const file = files.find(item => item.name === name);
    if (file) openRawFile(file.name, file.ext, file, false);
  }
})();
