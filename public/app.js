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

// ── State ──────────────────────────────────────────────────────────
const state = {
  panel:      'wiki',
  wikiPages:  [],
  currentPage: null,
  rawFiles:   [],
  graphData:  null,
  graphInit:  false,
  ws:         null,
  wsReady:    false,
  aiRunning:  false,
  chatHistory: [],     // { role, text }
  searchTimer: null,
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
};

// ── Panel switching ────────────────────────────────────────────────
function showPanel(name) {
  console.log('Switching to panel:', name);
  state.panel = name;
  
  // Re-query panels to ensure we have the latest set
  const panels = document.querySelectorAll('.panel');
  panels.forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  
  const iconBtns = document.querySelectorAll('.icon-btn[data-panel]');
  iconBtns.forEach(b => b.classList.toggle('active', b.dataset.panel === name));

  if (name === 'graph') {
    // Small timeout to ensure display:block has updated dimensions
    setTimeout(() => {
      if (!state.graphData) {
        api.getGraph().then(data => { 
          state.graphData = data; 
          state.graphInit = true;
          drawGraph(data); 
        });
      } else {
        state.graphInit = true;
        drawGraph(state.graphData);
      }
    }, 50);
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

// ── WebSocket / Chat ───────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  state.ws = ws;

  ws.onopen = () => {
    state.wsReady = true;
    dom.wsDot.classList.add('active');
    dom.wsDot.title = 'Gemini CLI ready';
  };

  ws.onclose = () => {
    state.wsReady = false;
    dom.wsDot.classList.remove('active');
    // Reconnect after 3s
    setTimeout(connectWS, 3000);
  };

  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
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
  if (!text || state.aiRunning) return;
  dom.chatInput.value = '';
  resizeTextarea();

  appendChatMsg('user', text);
  state.aiRunning = true;
  dom.chatSend.disabled = true;
  dom.chatAbort.style.display = 'flex';
  dom.chatStatus.textContent = 'Gemini is thinking…';

  // Create AI bubble
  const id = `ai-msg-${Date.now()}`;
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg ai';
  msgEl.id = id;
  msgEl.innerHTML = `
    <div class="chat-avatar">G</div>
    <div class="chat-bubble">
      <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
    </div>`;
  dom.chatMessages.appendChild(msgEl);
  aiTarget = { el: msgEl.querySelector('.chat-bubble'), buffer: '' };
  scrollChat();

  if (state.ws && state.wsReady) {
    state.ws.send(JSON.stringify({ type: 'chat', text }));
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
  dom.chatSend.disabled = false;
  dom.chatAbort.style.display = 'none';
  dom.chatStatus.textContent = 'Press Enter to send · Shift+Enter for new line';
  aiTarget = null;
  scrollChat();
}

function appendChatMsg(role, text) {
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  const initial = role === 'user' ? 'U' : 'G';
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

function drawGraph(data) {
  if (!data || !data.nodes) return;
  const nodes = data.nodes.map(d => ({...d}));
  const links = data.edges.map(d => ({...d}));
  
  const svg = d3.select('#graph-canvas');
  const panel = document.getElementById('panel-graph');
  const rect = panel.getBoundingClientRect();
  const W = rect.width || 800;
  const H = rect.height || 600;

  console.log(`Drawing graph: ${nodes.length} nodes, ${links.length} links, dim: ${W}x${H}`);

  svg.selectAll('*').remove();
  svg.attr('width', W).attr('height', H);

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

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(100).strength(0.5))
    .force('charge', d3.forceManyBody().strength(-400))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide(d => rScale(linkCount[d.id] || 0) + 15));

  const zoom = d3.zoom().scaleExtent([0.1, 5]).on('zoom', e => g.attr('transform', e.transform));
  svg.call(zoom);

  const g = svg.append('g');

  const link = g.append('g').selectAll('line').data(links).join('line')
    .attr('stroke', isLight ? '#ccc' : '#333')
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.6);

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
    .attr('r', d => rScale(linkCount[d.id] || 0))
    .attr('fill', d => colors[d.group] || colors[0])
    .attr('fill-opacity', 0.9)
    .attr('stroke', isLight ? '#fff' : '#0c0c0c')
    .attr('stroke-width', 2);

  node.append('text')
    .text(d => d.id)
    .attr('x', d => rScale(linkCount[d.id] || 0) + 5)
    .attr('y', '0.35em')
    .attr('font-size', '10px')
    .attr('font-family', 'Inter, system-ui, sans-serif')
    .attr('fill', isLight ? '#333' : '#bbb')
    .attr('pointer-events', 'none');

  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  // Graph control buttons
  $('graph-zoom-in').onclick  = () => svg.transition().call(zoom.scaleBy, 1.4);
  $('graph-zoom-out').onclick = () => svg.transition().call(zoom.scaleBy, 0.7);
  $('graph-reset').onclick    = () => svg.transition().call(zoom.transform, d3.zoomIdentity.translate(W/2, H/2).scale(1).translate(-W/2,-H/2));
}

// ── Files panel ────────────────────────────────────────────────────
async function loadFiles() {
  const files = await api.getRawList();
  state.rawFiles = files;
  dom.filesCount.textContent = files.length;

  const extIcon = ext => {
    if (ext === 'pdf') return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
    if (ext === 'txt' || ext === 'md') return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;
  };

  const fmtSize = bytes => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1024/1024).toFixed(1) + ' MB';
  };

  dom.filesGrid.innerHTML = files.map(f => `
    <div class="file-card" onclick="openRawFile('${escAttr(f.name)}', '${f.ext}')">
      <div class="file-card-icon">${extIcon(f.ext)}</div>
      <div>
        <span class="file-card-ext">${f.ext || 'file'}</span>
      </div>
      <div class="file-card-name">${escHtml(f.name)}</div>
      <div class="file-card-meta">${fmtSize(f.size)}</div>
    </div>`).join('');
}

function openRawFile(name, ext) {
  const url = `/api/raw/${encodeURIComponent(name)}`;
  if (ext === 'pdf') {
    window.open(url, '_blank');
  } else {
    // Open text files in a new tab or preview
    window.open(url, '_blank');
  }
}

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
  const pages = await api.getWikiList();
  buildSidebar(pages);
  // If hash present, open that page
  const hash = location.hash;
  if (hash.startsWith('#wiki/')) openPage(decodeURIComponent(hash.slice(6)));
})();
