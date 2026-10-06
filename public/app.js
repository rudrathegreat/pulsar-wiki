// Markdown rendering
marked.setOptions({ breaks: true, gfm: true });

const EMOJI_PATTERN = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}(?:\p{Regional_Indicator})?|[#*0-9]\uFE0F?\u20E3)(?:\uFE0F|\u200D(?:\p{Extended_Pictographic}|\p{Regional_Indicator}))*/gu;

function stripEmoji(value) {
  return String(value ?? '')
    .replace(EMOJI_PATTERN, '')
    .replace(/[\uFE0F\u200D]/g, '')
    .replace(/ {2,}/g, ' ');
}

function normalizeWikiPageName(name) {
  return stripEmoji(name).trim().toLowerCase().replace(/\s+/g, '-');
}

function wikiPath(name) {
  return `/wiki/${encodeURIComponent(normalizeWikiPageName(name))}`;
}

function wikiPageFromPath(pathname) {
  const match = /^\/wiki\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    const name = normalizeWikiPageName(decodeURIComponent(match[1]));
    return name || null;
  } catch {
    return null;
  }
}

function preprocessMd(text) {
  return stripEmoji(text).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, page, label) => {
    const display = stripEmoji(label || page).trim();
    return `[${display}](WIKILINK:${normalizeWikiPageName(page)})`;
  });
}

function postProcessHtml(html) {
  return html.replace(
    /href="WIKILINK:([^"]+)"/g,
    (_, page) => `href="${wikiPath(page)}" class="wiki-link" data-page="${escHtml(normalizeWikiPageName(page))}"`
  );
}

function renderMd(content) {
  return postProcessHtml(marked.parse(preprocessMd(content)));
}

async function readJsonResponse(response, apiName) {
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(/^\s*</.test(body)
      ? `${apiName} API returned the app page instead of JSON. Restart PulsarWiki.`
      : `${apiName} API returned an invalid response.`);
  }
  if (!response.ok) throw new Error(data.error || `${apiName} request failed.`);
  return data;
}

// Local browser API. ChatGPT credentials never enter this client.
const api = {
  async getChatGPTStatus() {
    return readJsonResponse(await fetch('/api/chatgpt/status'), 'ChatGPT status');
  },
  async saveChatGPTModel(model) {
    return readJsonResponse(await fetch('/api/chatgpt/model', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    }), 'ChatGPT model');
  },
  async disconnectChatGPT() {
    return readJsonResponse(await fetch('/api/chatgpt/session', { method: 'DELETE' }), 'ChatGPT disconnect');
  },
  async forgetChatGPTAccount() {
    return readJsonResponse(await fetch('/api/chatgpt/account', { method: 'DELETE' }), 'ChatGPT account');
  },
  async listThreads() {
    return readJsonResponse(await fetch('/api/chat/threads'), 'Saved chats');
  },
  async createThread(title) {
    return readJsonResponse(await fetch('/api/chat/threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    }), 'Saved chat');
  },
  async getThread(id) {
    return readJsonResponse(await fetch(`/api/chat/threads/${encodeURIComponent(id)}`), 'Saved chat');
  },
  async renameThread(id, title) {
    return readJsonResponse(await fetch(`/api/chat/threads/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    }), 'Saved chat');
  },
  async deleteThread(id) {
    const response = await fetch(`/api/chat/threads/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) await readJsonResponse(response, 'Saved chat');
  },
  async getWikiList() { return readJsonResponse(await fetch('/api/wiki'), 'Wiki'); },
  async getWikiPage(name) { return readJsonResponse(await fetch(`/api/wiki/${encodeURIComponent(name)}`), 'Wiki page'); },
  async saveWikiPage(name, content) {
    return readJsonResponse(await fetch(`/api/wiki/${encodeURIComponent(name)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
    }), 'Wiki page');
  },
  async createWikiPage(name, content) {
    return readJsonResponse(await fetch('/api/wiki', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content }),
    }), 'Wiki page');
  },
  async getRawList() { return readJsonResponse(await fetch('/api/raw'), 'Source files'); },
  async getGraph() { return readJsonResponse(await fetch('/api/graph'), 'Wiki graph'); },
  async search(query) { return readJsonResponse(await fetch(`/api/search?q=${encodeURIComponent(query)}`), 'Search'); },
  async uploadFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = event => {
        if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
      };
      xhr.onload = () => {
        let result;
        try { result = xhr.responseText ? JSON.parse(xhr.responseText) : {}; }
        catch { reject(new Error('Upload returned an invalid response.')); return; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(result);
        else reject(new Error(result.error || `Upload failed with status ${xhr.status}.`));
      };
      xhr.onerror = () => reject(new Error('Upload failed because the local server could not be reached.'));
      xhr.onabort = () => reject(new Error('Upload was canceled.'));
      xhr.send(file);
    });
  },
};

const state = {
  panel: 'wiki',
  wikiPages: [],
  currentPage: null,
  rawFiles: [],
  graphData: null,
  graphInit: false,
  graph: { simulation: null, resizeObserver: null, svg: null, zoom: null, width: 0, height: 0 },
  ws: null,
  wsReady: false,
  backendReady: false,
  aiRunning: false,
  chatgpt: null,
  threads: [],
  activeThreadId: null,
  searchTimer: null,
  documentSession: 0,
  currentDocument: null,
  pdf: { lib: null, doc: null, page: 1, scale: 1, fitWidth: true, renderTask: null, renderId: 0, resizeTimer: null },
};

const $ = id => document.getElementById(id);
const dom = {
  get sidebarBody() { return $('sidebar-body'); },
  get wikiBody() { return $('wiki-body'); },
  get wikiBc() { return $('wiki-breadcrumb'); },
  get searchInput() { return $('search-input'); },
  get searchResults() { return $('search-results'); },
  get chatMessages() { return $('chat-messages'); },
  get chatInput() { return $('chat-input'); },
  get chatSend() { return $('chat-send'); },
  get chatAbort() { return $('chat-abort'); },
  get chatStatus() { return $('chat-status'); },
  get chatNewThread() { return $('chat-new-thread'); },
  get chatThreadList() { return $('chat-thread-list'); },
  get wsDot() { return $('ws-dot'); },
  get chatgptSettingsButton() { return $('chatgpt-settings-button'); },
  get chatgptSettingsLabel() { return $('chatgpt-settings-label'); },
  get chatgptSettingsModal() { return $('chatgpt-settings-modal'); },
  get chatgptAccount() { return $('chatgpt-account'); },
  get chatgptConnectionStatus() { return $('chatgpt-connection-status'); },
  get chatgptConnect() { return $('chatgpt-connect'); },
  get chatgptNewAccount() { return $('chatgpt-new-account'); },
  get chatgptModelField() { return $('chatgpt-model-field'); },
  get chatgptModel() { return $('chatgpt-model'); },
  get chatgptModelSave() { return $('chatgpt-model-save'); },
  get chatgptDisconnect() { return $('chatgpt-disconnect'); },
  get chatgptForget() { return $('chatgpt-forget'); },
  get chatgptClose() { return $('chatgpt-close'); },
  get chatgptError() { return $('chatgpt-error'); },
  get filesGrid() { return $('files-grid'); },
  get filesCount() { return $('files-count'); },
  get uploadModal() { return $('upload-modal'); },
  get newPageModal() { return $('new-page-modal'); },
  get dropzone() { return $('dropzone'); },
  get fileInput() { return $('file-input'); },
  get uploadProgress() { return $('upload-progress'); },
  get newPageName() { return $('new-page-name'); },
  get graphCanvas() { return $('graph-canvas'); },
  get graphLegend() { return $('graph-legend'); },
  get graphTooltip() { return $('graph-tooltip'); },
  get graphStatus() { return $('graph-status'); },
  get documentStage() { return $('document-stage'); },
  get documentStatus() { return $('document-status'); },
  get pdfToolbar() { return $('pdf-toolbar'); },
};

function showPanel(name) {
  state.panel = name;
  const navigationPanel = name === 'document' ? 'files' : name;
  $('sidebar').classList.toggle('chat-mode', name === 'chat');
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${name}`));
  document.querySelectorAll('.tab-btn').forEach(button => button.classList.toggle('active', button.dataset.panel === navigationPanel));
  document.querySelectorAll('.icon-btn[data-panel]').forEach(button => button.classList.toggle('active', button.dataset.panel === navigationPanel));
  if (name === 'graph') showGraph();
  if (name === 'files') loadFiles();
}

const PILLAR_LABELS = [
  'Other', 'Foundational Physics', 'Taxonomy & Evolution', 'Observational Methods', 'Facilities & Tools', 'Notable Objects',
];

function buildSidebar(pages) {
  state.wikiPages = pages;
  api.getGraph().then(data => {
    state.graphData = data;
    const groupMap = {};
    data.nodes.forEach(node => { groupMap[node.id] = node.group; });
    const grouped = {};
    pages.forEach(page => {
      const group = groupMap[page.name] || 0;
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push(page);
    });
    renderSidebarGroups(grouped);
  }).catch(() => renderSidebarGroups({ 0: pages }));
}

function renderSidebarGroups(grouped) {
  let html = '';
  Object.keys(grouped).sort((left, right) => +left - +right).forEach(key => {
    const label = PILLAR_LABELS[+key] || `Group ${key}`;
    if (+key > 0) html += `<div class="nav-section-title">${escHtml(label)}</div>`;
    grouped[key].sort((left, right) => left.name.localeCompare(right.name)).forEach(page => {
      html += `<button class="nav-item" type="button" data-page="${escHtml(page.name)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        ${escHtml(page.name)}
      </button>`;
    });
  });
  dom.sidebarBody.innerHTML = html;
  highlightSidebarItem(state.currentPage);
}

function highlightSidebarItem(name) {
  document.querySelectorAll('.nav-item[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === name));
}

dom.sidebarBody.addEventListener('click', event => {
  const item = event.target.closest('.nav-item[data-page]');
  if (item && dom.sidebarBody.contains(item)) openPage(item.dataset.page);
});

function updateWikiHistory(page, mode) {
  if (mode === 'none') return;
  const target = wikiPath(page);
  if (location.pathname === target && !location.hash) return;
  history[mode === 'replace' ? 'replaceState' : 'pushState'](null, '', target);
}

async function openPage(name, { historyMode = 'push' } = {}) {
  const page = normalizeWikiPageName(name);
  if (!page) return;
  updateWikiHistory(page, historyMode);
  showPanel('wiki');
  highlightSidebarItem(page);
  state.currentPage = page;
  dom.wikiBc.innerHTML = `<button class="breadcrumb-link" type="button" data-action="show-wiki">Wiki</button><span>/</span><span>${escHtml(page)}</span>`;
  dom.wikiBody.innerHTML = '<div class="wiki-loading">Loading...</div>';
  try {
    const data = await api.getWikiPage(page);
    dom.wikiBody.innerHTML = `<div class="md-body">${renderMd(data.content)}</div>`;
    dom.wikiBody.querySelectorAll('a.wiki-link').forEach(link => link.addEventListener('click', event => {
      event.preventDefault();
      openPage(link.dataset.page);
    }));
    $('panel-wiki').scrollTop = 0;
  } catch (error) {
    const message = error.message === 'Not found' ? `Page not found: ${page}` : error.message;
    dom.wikiBody.innerHTML = `<div class="wiki-empty"><p class="wiki-empty-copy">${escHtml(message)}</p></div>`;
  }
}

dom.wikiBc.addEventListener('click', event => {
  if (event.target.closest('[data-action="show-wiki"]')) showPanel('wiki');
});

dom.searchInput.addEventListener('input', () => {
  dom.searchInput.value = stripEmoji(dom.searchInput.value);
  clearTimeout(state.searchTimer);
  const query = dom.searchInput.value.trim();
  if (!query) { hideSearch(); return; }
  state.searchTimer = setTimeout(() => doSearch(query), 250);
});
dom.searchInput.addEventListener('keydown', event => { if (event.key === 'Escape') hideSearch(); });
document.addEventListener('click', event => {
  if (!dom.searchResults.contains(event.target) && event.target !== dom.searchInput) hideSearch();
});

async function doSearch(query) {
  const results = await api.search(query);
  dom.searchResults.innerHTML = results.length ? results.map(result => `
    <button class="search-result-item" type="button" data-page="${escHtml(result.page)}">
      <div class="search-result-page">${escHtml(result.page)}</div>
      ${result.matches.slice(0, 2).map(match => `<div class="search-result-match">${escHtml(match.text)}</div>`).join('')}
    </button>`).join('') : `<div class="search-no-results">No results for “<strong>${escHtml(query)}</strong>”</div>`;
  dom.searchResults.classList.add('visible');
}

function hideSearch() { dom.searchResults.classList.remove('visible'); }

dom.searchResults.addEventListener('click', event => {
  const result = event.target.closest('.search-result-item[data-page]');
  if (!result) return;
  openPage(result.dataset.page);
  hideSearch();
});

const GROUP_COLORS = ['#fff', '#222', '#1c1c1c', '#fff', '#222', '#1c1c1c'];
const GROUP_COLORS_LIGHT = ['#111', '#ccc', '#eee', '#111', '#ccc', '#eee'];

function setGraphStatus(message = '') {
  dom.graphStatus.textContent = stripEmoji(message);
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
        <div class="legend-dot" style="background:${colors[g] || colors[0]}"></div>
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
    .attr('stroke', isLight ? '#ccc' : '#222')
    .attr('stroke-width', 1.25);

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
      if (tooltip) { tooltip.textContent = stripEmoji(d.id); tooltip.classList.add('visible'); }
      d3.select(event.currentTarget).select('circle').attr('stroke', '#111');
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
      if (tooltip) tooltip.classList.remove('visible');
      d3.select(event.currentTarget).select('circle').attr('stroke', isLight ? '#111' : '#fff');
    });

  node.append('circle')
    .attr('r', nodeRadius)
    .attr('fill', d => colors[d.group] || colors[0])
    .attr('stroke', isLight ? '#111' : '#fff')
    .attr('stroke-width', 2);

  const label = node.append('text')
    .text(d => stripEmoji(d.id))
    .attr('y', '0.35em')
    .attr('font-size', '12px')
    .attr('font-family', 'Inter, system-ui, sans-serif')
    .attr('font-weight', '500')
    .attr('fill', isLight ? '#111' : '#fff')
    .attr('stroke', isLight ? '#fff' : '#111')
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
        <span class="file-card-ext">${escHtml(f.ext || 'file')}</span>
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
  $('document-title').textContent = stripEmoji(name);
  $('document-file-icon').innerHTML = fileIcon(normalizedExt);
  $('document-meta').innerHTML = `<span>${normalizedExt || 'FILE'}</span>${file.size != null ? `<span>${fmtSize(file.size)}</span>` : ''}`;
  $('document-download').href = url;
  $('document-download').setAttribute('download', name);
  dom.pdfToolbar.hidden = normalizedExt !== 'pdf';
  setDocumentStatus(`Opening ${normalizedExt ? normalizedExt.toUpperCase() : 'document'}...`);

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
        a.addEventListener('click', event => {
          event.preventDefault();
          openPage(a.dataset.page);
        });
      });
      return;
    }

    if (['txt', 'log', 'csv', 'json', 'xml', 'yaml', 'yml'].includes(normalizedExt)) {
      dom.documentStage.innerHTML = `<div class="document-reading-surface document-plain-text"><pre></pre></div>`;
      dom.documentStage.querySelector('pre').textContent = stripEmoji(content);
      return;
    }

    setDocumentStatus('Preview not available', `Download ${name} to open it in another application.`, true);
  } catch (error) {
    if (session !== state.documentSession) return;
    setDocumentStatus('Could not open this document', stripEmoji(error.message), true);
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
  dom.uploadProgress.textContent = `Uploading ${files.length} file(s)...`;
  for (const file of files) {
    dom.uploadProgress.textContent = `Uploading ${stripEmoji(file.name)}...`;
    await api.uploadFile(file, p => {
      dom.uploadProgress.textContent = `Uploading ${stripEmoji(file.name)} - ${Math.round(p * 100)}%`;
    });
  }
  dom.uploadProgress.textContent = 'Upload complete';
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
  const name = normalizeWikiPageName(dom.newPageName.value);
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
dom.newPageName.addEventListener('input', () => { dom.newPageName.value = stripEmoji(dom.newPageName.value); });

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
  if (state.currentPage) openPage(state.currentPage, { historyMode: 'none' });
}

// ── Utility ────────────────────────────────────────────────────────
function escHtml(s) {
  return stripEmoji(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) { return String(s).replace(/'/g,"\\'"); }

// ── Global expose ──────────────────────────────────────────────────
window.app = { showPanel };
window.openPage = openPage;
window.openRawFile = openRawFile;
window.hideSearch = hideSearch;

function handleWikiRoute({ migrateLegacyHash = false } = {}) {
  let page = wikiPageFromPath(location.pathname);
  if (page && location.pathname !== wikiPath(page)) history.replaceState(null, '', wikiPath(page));
  if (!page && location.hash.startsWith('#wiki/')) {
    try { page = normalizeWikiPageName(decodeURIComponent(location.hash.slice(6))); } catch { page = ''; }
    if (page && migrateLegacyHash) history.replaceState(null, '', wikiPath(page));
  }
  if (!page) return false;
  void openPage(page, { historyMode: 'none' });
  return true;
}

window.addEventListener('popstate', () => {
  if (!handleWikiRoute()) {
    state.currentPage = null;
    highlightSidebarItem(null);
    showPanel('wiki');
  }
});
window.addEventListener('hashchange', () => { handleWikiRoute({ migrateLegacyHash: true }); });

// ── ChatGPT subscription chat ─────────────────────────────────────
// OAuth credentials stay on the server; this client receives sanitized state.
let aiTarget = null;

function scrollChat() {
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function resizeTextarea() {
  dom.chatInput.style.height = 'auto';
  dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 180) + 'px';
}

function agentReady() {
  return Boolean(state.chatgpt?.ready && state.wsReady && state.backendReady && state.activeThreadId);
}

function updateAgentUi() {
  const status = state.chatgpt || {};
  const backendConnected = Boolean(state.wsReady && state.backendReady);
  dom.chatgptSettingsLabel.textContent = stripEmoji(status.ready
    ? `ChatGPT · ${status.selectedModel}`
    : (status.savedAccount ? 'Reconnect ChatGPT' : 'Connect ChatGPT'));
  dom.wsDot.classList.toggle('active', Boolean(status.ready && backendConnected));
  dom.wsDot.title = status.ready
    ? (backendConnected ? 'ChatGPT and agent service connected' : 'Agent service disconnected')
    : 'ChatGPT subscription not connected';
  dom.chatInput.disabled = !agentReady() || state.aiRunning;
  dom.chatSend.disabled = !agentReady() || state.aiRunning;
  if (!state.aiRunning) {
    if (!status.ready) {
      dom.chatStatus.textContent = status.planEnabled === false && status.connected
        ? 'Reconnect ChatGPT and allow subscription use to chat.'
        : (status.savedAccount ? 'Reconnect the saved ChatGPT account to chat.' : 'Connect an eligible ChatGPT subscription to chat.');
    } else if (!state.activeThreadId) {
      dom.chatStatus.textContent = 'Create or select a saved chat.';
    } else if (!backendConnected) {
      dom.chatStatus.textContent = 'Connecting to the agent service...';
    } else {
      dom.chatStatus.textContent = 'Press Enter to send · Shift+Enter for new line';
    }
  }
}

function renderThreads() {
  dom.chatThreadList.replaceChildren();
  if (!state.threads.length) {
    const empty = document.createElement('p');
    empty.className = 'chat-thread-empty';
    empty.textContent = 'No saved chats yet.';
    dom.chatThreadList.appendChild(empty);
    return;
  }
  for (const thread of state.threads) {
    const row = document.createElement('div');
    row.className = 'chat-thread' + (thread.id === state.activeThreadId ? ' active' : '');
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'chat-thread-select';
    select.textContent = stripEmoji(thread.title);
    select.title = stripEmoji(thread.title);
    select.addEventListener('click', () => { void selectThread(thread.id); });
    const menuWrap = document.createElement('div');
    menuWrap.className = 'chat-thread-menu-wrap';
    const actions = document.createElement('div');
    actions.className = 'chat-thread-actions';
    actions.hidden = true;
    actions.setAttribute('role', 'menu');

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.textContent = 'Rename';
    rename.setAttribute('role', 'menuitem');
    rename.addEventListener('click', event => {
      event.stopPropagation();
      closeThreadMenus();
      const title = window.prompt('New chat name:', thread.title);
      if (title?.trim()) void renameThread(thread.id, stripEmoji(title));
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'chat-thread-delete';
    remove.textContent = 'Delete';
    remove.setAttribute('role', 'menuitem');
    remove.addEventListener('click', event => {
      event.stopPropagation();
      closeThreadMenus();
      if (window.confirm('Delete this local saved chat?')) void deleteThread(thread.id);
    });
    actions.append(rename, remove);

    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'chat-thread-menu';
    menu.textContent = '\u22ef';
    menu.setAttribute('aria-label', `Chat options for ${stripEmoji(thread.title)}`);
    menu.setAttribute('aria-expanded', 'false');
    menu.title = 'Chat options';
    menu.addEventListener('click', event => {
      event.stopPropagation();
      const willOpen = actions.hidden;
      closeThreadMenus();
      actions.hidden = !willOpen;
      menu.setAttribute('aria-expanded', String(willOpen));
    });
    menuWrap.append(menu, actions);
    row.append(select, menuWrap);
    dom.chatThreadList.appendChild(row);
  }
}

function closeThreadMenus() {
  document.querySelectorAll('.chat-thread-actions:not([hidden])').forEach(actions => {
    actions.hidden = true;
    actions.previousElementSibling?.setAttribute('aria-expanded', 'false');
  });
}

function clearChatMessages() {
  dom.chatMessages.replaceChildren();
}

function renderThread(thread) {
  clearChatMessages();
  if (!thread.messages?.length) {
    appendChatMsg('ai', state.chatgpt?.ready
      ? '**A new saved chat is ready.**\n\nAsk a question about the PulsarWiki, or tell the agent what to update.'
      : '**Connect ChatGPT to get started.**\n\nYour conversations are saved locally.');
  } else {
    for (const message of thread.messages) appendChatMsg(message.role, message.text);
  }
  scrollChat();
}

async function refreshThreads({ createIfEmpty = false } = {}) {
  state.threads = await api.listThreads();
  if (createIfEmpty && !state.threads.length) {
    state.threads = [await api.createThread('New chat')];
  }
  renderThreads();
  if (!state.activeThreadId && state.threads[0]) await selectThread(state.threads[0].id, { refresh: false });
  updateAgentUi();
}

async function selectThread(id, { refresh = true } = {}) {
  if (state.aiRunning && id !== state.activeThreadId) return;
  const thread = await api.getThread(id);
  state.activeThreadId = id;
  renderThreads();
  renderThread(thread);
  if (refresh) await refreshThreads();
  updateAgentUi();
}

async function createThread() {
  if (state.aiRunning) return;
  const title = stripEmoji(window.prompt('Name this chat (optional):') || 'New chat');
  const thread = await api.createThread(title);
  state.activeThreadId = thread.id;
  await refreshThreads();
  await selectThread(thread.id, { refresh: false });
}

async function renameThread(id, title) {
  await api.renameThread(id, title);
  await refreshThreads();
}

async function deleteThread(id) {
  await api.deleteThread(id);
  if (state.activeThreadId === id) state.activeThreadId = null;
  await refreshThreads({ createIfEmpty: true });
}

const CHATGPT_CALLBACK_MESSAGES = {
  connected: 'ChatGPT connected successfully.',
  'plan-permission-required': 'Reconnect and allow ChatGPT plan usage for PulsarWiki.',
  'access-denied': 'ChatGPT sign-in was declined. You can try again when ready.',
  'authorization-expired': 'The sign-in request expired. Start a new connection.',
  'invalid-state': 'That sign-in request was invalid or had already been used. Start again.',
  'account-mismatch': 'That was not the saved ChatGPT account. Use “Use another account” to replace it.',
  'connection-failed': 'ChatGPT sign-in could not be completed. Please try again.',
};

function accountLabel(account) {
  if (!account) return 'No ChatGPT account saved.';
  if (account.name && account.email) return `${account.name} (${account.email})`;
  return account.name || account.email || 'Saved ChatGPT account';
}

function renderChatGPTSettings() {
  const status = state.chatgpt || {};
  dom.chatgptAccount.textContent = stripEmoji(accountLabel(status.account));
  dom.chatgptModel.replaceChildren();
  for (const model of status.models || []) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = stripEmoji(model.name);
    dom.chatgptModel.appendChild(option);
  }
  dom.chatgptModel.value = status.selectedModel || '';
  dom.chatgptModelField.hidden = !status.ready;
  dom.chatgptModelSave.hidden = !status.ready;
  dom.chatgptConnect.hidden = Boolean(status.connected && status.planEnabled);
  dom.chatgptConnect.textContent = status.savedAccount ? 'Reconnect ChatGPT' : 'Continue with ChatGPT';
  dom.chatgptNewAccount.hidden = !status.savedAccount;
  dom.chatgptDisconnect.hidden = !status.connected;
  dom.chatgptForget.hidden = !status.savedAccount;

  if (status.ready) {
    dom.chatgptConnectionStatus.textContent = 'Connected. Choose any model available to this subscription.';
  } else if (status.connected && !status.planEnabled) {
    dom.chatgptConnectionStatus.textContent = 'Plan permission is missing. Reconnect and approve subscription use.';
  } else if (status.reauthorizationRequired) {
    dom.chatgptConnectionStatus.textContent = 'The saved account needs to sign in again.';
  } else if (status.connected) {
    dom.chatgptConnectionStatus.textContent = 'Connected, but ChatGPT plan use is not currently available.';
  } else if (status.savedAccount) {
    dom.chatgptConnectionStatus.textContent = 'The saved account is disconnected.';
  } else {
    dom.chatgptConnectionStatus.textContent = 'Connect an eligible ChatGPT subscription.';
  }
  if (status.error) dom.chatgptError.textContent = stripEmoji(status.error.message || 'ChatGPT is temporarily unavailable.');
}

function openChatGPTSettings(message = '') {
  renderChatGPTSettings();
  dom.chatgptError.textContent = stripEmoji(message || state.chatgpt?.error?.message || '');
  dom.chatgptSettingsModal.style.display = 'flex';
}

function closeChatGPTSettings() {
  dom.chatgptSettingsModal.style.display = 'none';
}

async function refreshChatGPTStatus({ open = false, message = '' } = {}) {
  try {
    state.chatgpt = await api.getChatGPTStatus();
    updateAgentUi();
    if (open) openChatGPTSettings(message);
  } catch (error) {
    state.chatgpt = state.chatgpt || { connected: false, savedAccount: false, ready: false, models: [] };
    updateAgentUi();
    if (open) openChatGPTSettings(stripEmoji(error.message));
  }
}

async function saveChatGPTModel() {
  dom.chatgptModelSave.disabled = true;
  dom.chatgptError.textContent = '';
  try {
    state.chatgpt = await api.saveChatGPTModel(dom.chatgptModel.value);
    updateAgentUi();
    renderChatGPTSettings();
  } catch (error) {
    dom.chatgptError.textContent = stripEmoji(error.message);
  } finally {
    dom.chatgptModelSave.disabled = false;
  }
}

async function disconnectChatGPT() {
  dom.chatgptDisconnect.disabled = true;
  dom.chatgptError.textContent = '';
  try {
    state.chatgpt = await api.disconnectChatGPT();
    updateAgentUi();
    renderChatGPTSettings();
    if (state.chatgpt.revocationConfirmed === false) {
      dom.chatgptError.textContent = 'The local session was cleared, but OpenAI could not confirm remote revocation.';
    }
  } catch (error) {
    dom.chatgptError.textContent = stripEmoji(error.message);
  } finally {
    dom.chatgptDisconnect.disabled = false;
  }
}

async function forgetChatGPTAccount() {
  if (!window.confirm('Disconnect and forget the saved ChatGPT account on this computer?')) return;
  dom.chatgptForget.disabled = true;
  dom.chatgptError.textContent = '';
  try {
    state.chatgpt = await api.forgetChatGPTAccount();
    updateAgentUi();
    renderChatGPTSettings();
  } catch (error) {
    dom.chatgptError.textContent = stripEmoji(error.message);
  } finally {
    dom.chatgptForget.disabled = false;
  }
}

async function useAnotherChatGPTAccount() {
  dom.chatgptNewAccount.disabled = true;
  dom.chatgptError.textContent = '';
  try {
    await api.forgetChatGPTAccount();
    window.location.assign('/auth/chatgpt/start');
  } catch (error) {
    dom.chatgptError.textContent = stripEmoji(error.message);
    dom.chatgptNewAccount.disabled = false;
  }
}

function connectDirectAgentWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(proto + '://' + location.host);
  state.ws = ws;
  ws.onopen = () => {
    state.wsReady = true;
    state.backendReady = false;
    ws.send(JSON.stringify({ type: 'client-hello', protocol: 4 }));
    updateAgentUi();
  };
  ws.onclose = () => {
    if (state.ws !== ws) return;
    state.wsReady = false;
    state.backendReady = false;
    updateAgentUi();
    setTimeout(connectDirectAgentWS, 3000);
  };
  ws.onmessage = ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.type === 'server-hello') {
      state.backendReady = Number(message.protocol) === 4;
      updateAgentUi();
      return;
    }
    if (message.type === 'filechange') { void refreshWiki(); return; }
    if (message.threadId && message.threadId !== state.activeThreadId) return;
    if (message.type === 'chunk') handleAiChunk(message.text);
    if (message.type === 'tool-status') handleToolStatus(message);
    if (message.type === 'error') handleAiError(message);
    if (message.type === 'thread-updated') void refreshThreads();
    if (message.type === 'done') handleAiDone();
  };
}

function sendChat() {
  const text = stripEmoji(dom.chatInput.value).trim();
  if (!text || state.aiRunning || !agentReady()) return;
  dom.chatInput.value = '';
  resizeTextarea();
  appendChatMsg('user', text);
  state.aiRunning = true;
  dom.chatInput.disabled = true;
  dom.chatSend.disabled = true;
  dom.chatAbort.style.display = 'flex';
  dom.chatStatus.textContent = 'ChatGPT is thinking...';
  const message = document.createElement('div');
  message.className = 'chat-msg ai';
  message.innerHTML = '<div class="chat-avatar">AI</div><div class="chat-bubble"><div class="chat-response"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div><div class="chat-activity" hidden><details open><summary>Wiki activity</summary><pre></pre></details></div></div>';
  dom.chatMessages.appendChild(message);
  const activity = message.querySelector('.chat-activity');
  aiTarget = { el: message.querySelector('.chat-response'), buffer: '', activity, activityOutput: activity.querySelector('pre') };
  scrollChat();
  state.ws.send(JSON.stringify({ type: 'chat', threadId: state.activeThreadId, text }));
}

function handleAiChunk(text) {
  if (!aiTarget || typeof text !== 'string') return;
  aiTarget.buffer += text;
  aiTarget.el.innerHTML = '<div class="md-body" style="padding:0">' + renderMd(aiTarget.buffer) + '</div>';
  scrollChat();
}

function handleToolStatus(event) {
  if (!aiTarget) return;
  aiTarget.activity.hidden = false;
  const label = event.status === 'completed' ? 'completed' : (event.status === 'failed' ? 'failed' : 'running');
  const detail = event.status === 'failed' && event.detail ? ` (${stripEmoji(event.detail)})` : '';
  aiTarget.activityOutput.textContent += stripEmoji(event.name || 'wiki tool') + ': ' + label + detail + '\n';
  scrollChat();
}

function handleAiError(message) {
  const text = '> ' + stripEmoji(message.text || 'The agent request failed.');
  if (aiTarget) handleAiChunk('\n\n' + text);
  else appendChatMsg('ai', text);
  if (['reauthorization-required', 'plan-permission-required'].includes(message.code)) {
    void refreshChatGPTStatus();
    if (aiTarget && !aiTarget.recoveryShown) {
      aiTarget.recoveryShown = true;
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'btn chat-recovery';
      action.textContent = 'Reconnect ChatGPT';
      action.addEventListener('click', () => openChatGPTSettings(message.text || 'Sign in again to continue.'));
      aiTarget.el.appendChild(action);
    }
  }
}

function handleAiDone() {
  state.aiRunning = false;
  dom.chatAbort.style.display = 'none';
  aiTarget = null;
  updateAgentUi();
  void refreshThreads();
}

function appendChatMsg(role, text) {
  const el = document.createElement('div');
  el.className = 'chat-msg ' + role;
  el.innerHTML = '<div class="chat-avatar">' + (role === 'user' ? 'U' : 'AI') + '</div><div class="chat-bubble">' + (role === 'user' ? escHtml(text) : renderMd(text)) + '</div>';
  dom.chatMessages.appendChild(el);
  scrollChat();
}

document.addEventListener('click', event => {
  if (!event.target.closest('.chat-thread-menu-wrap')) closeThreadMenus();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeThreadMenus();
});

dom.chatgptSettingsButton.addEventListener('click', () => { void refreshChatGPTStatus({ open: true }); });
dom.chatgptClose.addEventListener('click', closeChatGPTSettings);
dom.chatgptModelSave.addEventListener('click', () => { void saveChatGPTModel(); });
dom.chatgptConnect.addEventListener('click', () => { window.location.assign('/auth/chatgpt/start'); });
dom.chatgptNewAccount.addEventListener('click', () => { void useAnotherChatGPTAccount(); });
dom.chatgptDisconnect.addEventListener('click', () => { void disconnectChatGPT(); });
dom.chatgptForget.addEventListener('click', () => { void forgetChatGPTAccount(); });
dom.chatgptSettingsModal.addEventListener('click', event => {
  if (event.target === dom.chatgptSettingsModal) closeChatGPTSettings();
});
dom.chatNewThread.addEventListener('click', () => { void createThread(); });
dom.chatInput.addEventListener('input', () => {
  dom.chatInput.value = stripEmoji(dom.chatInput.value);
  resizeTextarea();
});
dom.chatInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendChat();
  }
});
dom.chatSend.addEventListener('click', sendChat);
dom.chatAbort.addEventListener('click', () => {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'abort', threadId: state.activeThreadId }));
  }
});

// ── Bootstrap ──────────────────────────────────────────────────────
(async function init() {
  connectDirectAgentWS();

  const callbackCode = new URLSearchParams(location.search).get('chatgpt');
  const callbackMessage = callbackCode ? (CHATGPT_CALLBACK_MESSAGES[callbackCode] || 'ChatGPT connection status changed.') : '';
  await refreshChatGPTStatus({ open: Boolean(callbackCode), message: callbackMessage });
  if (callbackCode) history.replaceState(null, '', location.pathname + location.hash);

  try {
    await refreshThreads({ createIfEmpty: true });
  } catch (error) {
    dom.chatStatus.textContent = stripEmoji(error.message);
  }

  const pages = await api.getWikiList();
  buildSidebar(pages);
  const routedToWiki = handleWikiRoute({ migrateLegacyHash: true });
  const hash = location.hash;
  if (!routedToWiki && hash.startsWith('#file/')) {
    const name = decodeURIComponent(hash.slice(6));
    const files = await api.getRawList();
    const file = files.find(item => item.name === name);
    if (file) openRawFile(file.name, file.ext, file, false);
  }
})();
