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

function protectLatex(text) {
  const expressions = [];
  const pattern = /(```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~|`+[^`\n]*`+)|(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|(?<!\\)\$(?!\s)(?:\\.|[^$\n\\])+(?<!\s)(?<!\\)\$)/g;
  const protectedText = text.replace(pattern, (match, code, math) => {
    if (code) return match;
    const token = `PULSARWIKIMATH${expressions.length}TOKEN`;
    expressions.push(math);
    return token;
  });
  return { text: protectedText, expressions };
}

function postProcessHtml(html, expressions = []) {
  let processed = html.replace(
    /href="WIKILINK:([^"]+)"/g,
    (_, page) => `href="${wikiPath(page)}" class="wiki-link" data-page="${escHtml(normalizeWikiPageName(page))}"`
  );
  expressions.forEach((expression, index) => {
    const safeExpression = expression.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    processed = processed.replaceAll(`PULSARWIKIMATH${index}TOKEN`, safeExpression);
  });
  return typeof window !== 'undefined' && window.ActiveReading ? window.ActiveReading.sanitizeHtml(processed) : processed;
}

function renderMd(content) {
  const protectedContent = protectLatex(preprocessMd(content));
  return postProcessHtml(marked.parse(protectedContent.text), protectedContent.expressions);
}

function typesetMath(root) {
  if (!root || typeof renderMathInElement !== 'function') return;
  renderMathInElement(root, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
  });
}

function wikiLinkForInAppNavigation(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  return event.target?.closest?.('a.wiki-link[data-page]') || null;
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

// A tab pins its workspace so another tab can open a different project safely.
let workspaceId = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pw-workspace') : null;
function workspaceFetch(url, options = {}) {
  return fetch(url, { ...options, headers: { ...options.headers, ...(workspaceId ? { 'X-PulsarWiki-Workspace': workspaceId } : {}) } });
}
function workspaceUrl(url) {
  return workspaceId ? `${url}${url.includes('?') ? '&' : '?'}workspace=${encodeURIComponent(workspaceId)}` : url;
}
if (typeof window !== 'undefined') window.WorkspaceSession = { fetch: workspaceFetch, url: workspaceUrl };

// Local browser API. ChatGPT credentials never enter this client.
const api = {
  async getChatGPTStatus() {
    return readJsonResponse(await workspaceFetch('/api/chatgpt/status'), 'ChatGPT status');
  },
  async saveChatGPTModel(model) {
    return readJsonResponse(await workspaceFetch('/api/chatgpt/model', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    }), 'ChatGPT model');
  },
  async disconnectChatGPT() {
    return readJsonResponse(await workspaceFetch('/api/chatgpt/session', { method: 'DELETE' }), 'ChatGPT disconnect');
  },
  async forgetChatGPTAccount() {
    return readJsonResponse(await workspaceFetch('/api/chatgpt/account', { method: 'DELETE' }), 'ChatGPT account');
  },
  async listThreads() {
    return readJsonResponse(await workspaceFetch('/api/chat/threads'), 'Saved chats');
  },
  async createThread(title) {
    return readJsonResponse(await workspaceFetch('/api/chat/threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    }), 'Saved chat');
  },
  async getThread(id) {
    return readJsonResponse(await workspaceFetch(`/api/chat/threads/${encodeURIComponent(id)}`), 'Saved chat');
  },
  async renameThread(id, title) {
    return readJsonResponse(await workspaceFetch(`/api/chat/threads/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    }), 'Saved chat');
  },
  async deleteThread(id) {
    const response = await workspaceFetch(`/api/chat/threads/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) await readJsonResponse(response, 'Saved chat');
  },
  async getWikiList() { return readJsonResponse(await workspaceFetch('/api/wiki'), 'Wiki'); },
  async getWikiPage(name) { return readJsonResponse(await workspaceFetch(`/api/wiki/${encodeURIComponent(name)}`), 'Wiki page'); },
  async saveWikiPage(name, content) {
    return readJsonResponse(await workspaceFetch(`/api/wiki/${encodeURIComponent(name)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
    }), 'Wiki page');
  },
  async createWikiPage(name, content) {
    return readJsonResponse(await workspaceFetch('/api/wiki', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content }),
    }), 'Wiki page');
  },
  async getRawList() { return readJsonResponse(await workspaceFetch('/api/raw'), 'Source files'); },
  async searchSources(query, limit = 20, options = {}) {
    return readJsonResponse(await workspaceFetch('/api/sources/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, limit, ...options }),
    }), 'Paper search');
  },
  async getRelatedSources(id, paper = {}) {
    const identity = new URLSearchParams();
    for (const key of ['provider', 'bibcode', 'doi', 'arxivId']) {
      if (paper[key]) identity.set(key, paper[key]);
    }
    return readJsonResponse(await workspaceFetch(`/api/sources/${encodeURIComponent(id)}/related?${identity}`), 'Related papers');
  },
  async getSourceKeywords(id) {
    return readJsonResponse(await workspaceFetch(`/api/sources/${encodeURIComponent(id)}/keywords`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }), 'Paper keywords');
  },
  async importSources(ids) {
    return readJsonResponse(await workspaceFetch('/api/sources/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    }), 'Paper import');
  },
  async getSourceJob(id) {
    return readJsonResponse(await workspaceFetch(`/api/sources/jobs/${encodeURIComponent(id)}`), 'Wiki update');
  },
  async getHandoverNotebooks() {
    return readJsonResponse(await workspaceFetch('/api/notebooks'), 'Research notebooks');
  },
  async generateHandover(payload) {
    return readJsonResponse(await workspaceFetch('/api/handover/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }), 'Project handover');
  },
  async publishHandover(content) {
    return readJsonResponse(await workspaceFetch('/api/handover/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, reviewed: true }),
    }), 'Project handover');
  },
  async getGraph() { return readJsonResponse(await workspaceFetch('/api/graph'), 'Wiki graph'); },
  async search(query) { return readJsonResponse(await workspaceFetch(`/api/search?q=${encodeURIComponent(query)}`), 'Search'); },
  async uploadFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      if (workspaceId) xhr.setRequestHeader('X-PulsarWiki-Workspace', workspaceId);
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
  rawFilesLoaded: false,
  rawFilesError: '',
  sourceView: 'add',
  sourceResults: [],
  selectedSourceIds: new Set(),
  sourceImportRunning: false,
  activeSourceId: null,
  sourcePaperHistory: [],
  sourcePapers: new Map(),
  sourceDetailRequest: 0,
  sourceFilters: [],
  sourceJobTimer: null,
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
  wikiSearch: { query: '', pages: null, pending: false, error: '', revision: 0 },
  documentSession: 0,
  currentDocument: null,
  pdf: { lib: null, doc: null, page: 1, scale: 1, fitWidth: true, renderTask: null, renderId: 0, resizeTimer: null },
  handover: { materials: { wiki: [], raw: [], notebook: [] }, step: 1, loaded: false, generating: false, publishing: false, selectedPages: new Set(), selectedSources: new Set(), selectedNotebooks: new Set(), generatedInput: '', draft: '' },
};

const $ = id => document.getElementById(id);
const dom = {
  get sidebarBody() { return $('sidebar-body'); },
  get wikiBody() { return $('wiki-body'); },
  get wikiBc() { return $('wiki-breadcrumb'); },
  get searchInput() { return $('search-input'); },
  get wikiSearchStatus() { return $('wiki-search-status'); },
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
  get sourceSearchForm() { return $('source-search-form'); },
  get sourceSearchInput() { return $('source-search-input'); },
  get sourceFilterSuggestions() { return $('source-filter-suggestions'); },
  get sourceSearchStatus() { return $('source-search-status'); },
  get sourceResultsSection() { return $('source-results-section'); },
  get sourceResults() { return $('source-results'); },
  get sourceSelectedCount() { return $('source-selected-count'); },
  get sourceImportSelected() { return $('source-import-selected'); },
  get sourceJobStatus() { return $('source-job-status'); },
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
  if (name !== state.panel) window.ActiveReading?.closeHelper();
  state.panel = name;
  document.body.classList.toggle('notebook-mode', name === 'notebooks');
  const navigationPanel = name === 'document' ? 'files' : name;
  $('sidebar').classList.toggle('chat-mode', name === 'chat');
  $('sidebar').classList.toggle('sources-mode', navigationPanel === 'files');
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${name}`));
  document.querySelectorAll('.tab-btn').forEach(button => button.classList.toggle('active', button.dataset.panel === navigationPanel));
  document.querySelectorAll('.icon-btn[data-panel]').forEach(button => button.classList.toggle('active', button.dataset.panel === navigationPanel));
  if (name === 'graph') showGraph();
  if (navigationPanel === 'files') {
    renderSourceSidebar();
    void loadFiles().catch(() => {});
  }
  if (name === 'handover') loadHandoverWorkspace();
  if (name === 'notebooks') window.ResearchNotebooks?.show();
}

const PILLAR_LABELS = [
  'Other', 'Foundational Physics', 'Taxonomy & Evolution', 'Observational Methods', 'Facilities & Tools', 'Notable Objects', 'Project Continuity',
];

function buildSidebar(pages) {
  state.wikiPages = pages;
  renderSidebar();
  if (state.wikiSearch.query) updateWikiSearch();
  api.getGraph().then(data => {
    if (state.wikiPages !== pages) return;
    state.graphData = data;
    renderWikiSearchViews();
  }).catch(() => {
    if (state.wikiPages === pages) renderSidebar();
  });
}

function renderSidebar() {
  const groupMap = new Map((state.graphData?.nodes || []).map(node => [node.id, node.group]));
  const grouped = {};
  state.wikiPages.forEach(page => {
    if (state.wikiSearch.pages && !state.wikiSearch.pages.has(page.name)) return;
    const group = groupMap.get(page.name) || 0;
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(page);
  });
  renderSidebarGroups(grouped);
  dom.wikiSearchStatus.textContent = wikiSearchMessage();
  dom.sidebarBody.setAttribute('aria-busy', String(state.wikiSearch.pending));
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
    typesetMath(dom.wikiBody);
    const notebookAction = document.createElement('button');
    notebookAction.type = 'button'; notebookAction.className = 'btn wiki-notebook-action'; notebookAction.textContent = 'Add page reference to notebook';
    notebookAction.addEventListener('click', () => window.ResearchNotebooks?.transfer({ kind: 'wiki', page }));
    dom.wikiBc.append(notebookAction);
    window.ActiveReading?.backlinks(page, dom.wikiBody);
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
  updateWikiSearch();
});
dom.searchInput.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    dom.searchInput.value = '';
    updateWikiSearch();
  }
});

function updateWikiSearch() {
  clearTimeout(state.searchTimer);
  const query = dom.searchInput.value.trim();
  const revision = state.wikiSearch.revision + 1;
  state.wikiSearch = { query, pages: query ? new Set() : null, pending: Boolean(query), error: '', revision };
  renderWikiSearchViews();
  if (query) state.searchTimer = setTimeout(() => doSearch(query, revision), 250);
}

async function doSearch(query, revision) {
  try {
    const results = await api.search(query);
    if (revision !== state.wikiSearch.revision) return;
    state.wikiSearch.pages = new Set(results.map(result => result.page));
  } catch (error) {
    if (revision !== state.wikiSearch.revision) return;
    state.wikiSearch.error = `Search could not be completed. ${error.message}`;
  }
  state.wikiSearch.pending = false;
  renderWikiSearchViews();
}

function wikiSearchMessage() {
  const search = state.wikiSearch;
  if (search.pending) return 'Searching wiki...';
  if (search.error) return search.error;
  if (search.query && !search.pages?.size) return `No pages match “${search.query}”.`;
  return '';
}

function renderWikiSearchViews() {
  renderSidebar();
  // Only the all-pages graph panel participates in wiki search.
  if (state.panel === 'graph' && state.graphData) drawGraph(state.graphData);
}

function filteredWikiGraph(data) {
  const pages = state.wikiSearch.pages;
  if (!pages) return data;
  const nodes = data.nodes.filter(node => pages.has(node.id));
  const visible = new Set(nodes.map(node => node.id));
  return {
    nodes,
    edges: (data.edges || []).filter(edge => visible.has(edge.source) && visible.has(edge.target)),
  };
}

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
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (state.panel === 'graph') drawGraph(state.graphData);
    }));
  } catch (error) {
    console.error('Unable to load graph:', error);
    setGraphStatus('The graph could not be loaded. Please try again.');
  }
}

function highlightGraphConnections(node, link, pageId = null) {
  const neighbours = new Set([pageId]);
  const endpointId = endpoint => endpoint.id ?? endpoint;
  if (pageId !== null) {
    link.each(edge => {
      const source = endpointId(edge.source);
      const target = endpointId(edge.target);
      if (source === pageId) neighbours.add(target);
      if (target === pageId) neighbours.add(source);
    });
  }
  node.attr('opacity', page => pageId === null || neighbours.has(page.id) ? 1 : 0.15);
  link.attr('opacity', edge => pageId === null
    || endpointId(edge.source) === pageId || endpointId(edge.target) === pageId ? 1 : 0.08);
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
  const filtered = filteredWikiGraph(data);
  const nodes = filtered.nodes.map(d => ({...d}));
  const links = (filtered.edges || []).map(d => ({...d}));
  
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
  dom.graphLegend.innerHTML = '';
  dom.graphTooltip.classList.remove('visible');
  setGraphStatus(nodes.length ? '' : wikiSearchMessage() || 'There are no pages to display yet.');
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
    .on('mouseenter', (event, d) => {
      highlightGraphConnections(node, link, d.id);
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
    .on('mouseleave', (event) => {
      highlightGraphConnections(node, link);
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

function renderSourceSidebar() {
  $('source-sidebar-count').textContent = state.rawFiles.length;
  $('source-sidebar-status').textContent = state.rawFilesError || (!state.rawFilesLoaded
    ? 'Loading saved sources...'
    : state.rawFiles.length ? '' : 'No saved sources yet. Add a source to start reading.');
  $('source-sidebar-list').innerHTML = state.rawFiles.map(file => {
    const active = state.currentDocument?.name === file.name;
    return `<button class="nav-item${active ? ' active' : ''}" type="button" data-source-file="${escHtml(file.name)}" title="${escHtml(file.name)}" aria-label="Open ${escHtml(file.name)}"${active ? ' aria-current="true"' : ''}>
      ${fileIcon(file.ext)}<span class="source-sidebar-name">${escHtml(file.name)}</span>
    </button>`;
  }).join('');
}

$('source-sidebar-list').addEventListener('click', event => {
  const item = event.target.closest('[data-source-file]');
  if (!item || !$('source-sidebar-list').contains(item)) return;
  const file = state.rawFiles.find(source => source.name === item.dataset.sourceFile);
  if (file) void openRawFile(file.name, file.ext, file);
});

$('source-sidebar-add').addEventListener('click', () => {
  showPanel('files');
  setSourceView('add');
});

for (const id of ['wiki-sidebar-references', 'source-sidebar-references']) {
  $(id).addEventListener('click', () => {
    showPanel('files');
    setSourceView('references');
  });
}

async function loadFiles() {
  let files;
  try {
    files = await api.getRawList();
  } catch (error) {
    state.rawFilesError = `Could not load saved sources: ${stripEmoji(error.message)}`;
    renderSourceSidebar();
    throw error;
  }
  state.rawFiles = files;
  state.rawFilesLoaded = true;
  state.rawFilesError = '';
  renderSourceSidebar();
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

// Project handover
const HANDOVER_SELECTORS = { wiki: 'wiki', raw: 'file', notebook: 'notebook' };

function renderHandoverSelector(type) {
  const prefix = `handover-${HANDOVER_SELECTORS[type]}`;
  const items = state.handover.materials[type];
  const selected = handoverSelectedSet(type);
  $(prefix + '-options').innerHTML = items.filter(item => !selected.has(item.name))
    .map(item => `<option value="${escHtml(item.label)}"></option>`).join('');
  $(prefix + '-selected').innerHTML = items.filter(item => selected.has(item.name))
    .map(item => `<button class="handover-chip" type="button" data-handover-remove="${escHtml(item.name)}" aria-label="Remove ${escHtml(item.label)}">${escHtml(item.label)}<span aria-hidden="true"> &times;</span></button>`).join('');
  const toggle = document.querySelector(`[data-handover-toggle="${type}"]`);
  if (toggle) {
    toggle.textContent = items.length && selected.size === items.length ? 'Clear all' : 'Select all';
    toggle.disabled = !items.length || state.handover.generating;
  }
}

function addHandoverMaterial(type, showError = false) {
  const input = $(`handover-${HANDOVER_SELECTORS[type]}-input`);
  const query = input.value.trim();
  if (!query || state.handover.generating) return;
  const items = state.handover.materials[type];
  const item = items.find(item => item.label === query)
    || items.find(item => item.label.toLowerCase() === query.toLowerCase());
  if (!item) {
    if (showError) setHandoverStatus('Choose a matching item from the suggestions.', true);
    return;
  }
  handoverSelectedSet(type).add(item.name);
  input.value = '';
  setHandoverStatus();
  updateHandoverSelection();
}

function updateHandoverNavigation() {
  const { step, generating, publishing } = state.handover;
  const busy = generating || publishing;
  const hasDraft = !!$('handover-editor').value.trim();
  $('handover-back').hidden = step === 1;
  $('handover-back').disabled = step === 1 || busy;
  $('handover-next').hidden = step === 4;
  $('handover-next').textContent = generating ? 'Drafting...' : 'Next';
  $('handover-next').disabled = busy
    || (step === 3 && (!hasDraft || !$('handover-reviewed').checked));
  $('handover-stage-count').textContent = `Step ${step} of 4`;
  $('handover-drafting').hidden = !generating;
  $('handover-form').hidden = generating;
  $('handover-navigation').hidden = generating;
  $('handover-status').hidden = generating;
  $('handover-form').setAttribute('aria-busy', String(generating));
}

function setHandoverStep(step) {
  state.handover.step = step;
  document.querySelectorAll('[data-handover-stage]').forEach(stage => {
    stage.hidden = Number(stage.dataset.handoverStage) !== step;
  });
  updateHandoverNavigation();
  const heading = document.querySelector(`[data-handover-stage="${step}"] h3`);
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  $('panel-handover').scrollTop = 0;
}

async function advanceHandover() {
  if (state.handover.generating || state.handover.publishing) return;
  const step = state.handover.step;
  if (step === 1) {
    if (!$('handover-project-name').value.trim()) {
      setHandoverStatus('Add a project name before continuing.', true);
      $('handover-project-name').focus();
      return;
    }
    if (!$('handover-description').value.trim()) {
      setHandoverStatus('Add a project description before continuing.', true);
      $('handover-description').focus();
      return;
    }
  }
  if (step === 2) {
    if (!handoverSelectionCount()) {
      setHandoverStatus('Select at least one wiki page, source or notebook.', true);
      return;
    }
    if (state.handover.generatedInput === JSON.stringify(handoverInput()) && $('handover-editor').value.trim()) {
      setHandoverStatus();
      setHandoverStep(3);
    } else await generateHandover();
    return;
  }
  if (step === 3 && (!$('handover-editor').value.trim() || !$('handover-reviewed').checked)) return;
  if (step >= 4) return;
  setHandoverStatus();
  setHandoverStep(step + 1);
}

function setHandoverStatus(message = '', error = false) {
  const status = $('handover-status');
  status.textContent = stripEmoji(message);
  status.classList.toggle('error', error);
}

function handoverSelectionCount() {
  return state.handover.selectedPages.size + state.handover.selectedSources.size + state.handover.selectedNotebooks.size;
}

function handoverSelectedSet(type) {
  return type === 'wiki' ? state.handover.selectedPages : type === 'notebook' ? state.handover.selectedNotebooks : state.handover.selectedSources;
}

function handoverInput() {
  return {
    projectName: $('handover-project-name').value.trim(),
    description: $('handover-description').value.trim(),
    context: $('handover-context').value.trim(),
    pages: [...state.handover.selectedPages].sort(),
    sources: [...state.handover.selectedSources].sort(),
    notebooks: [...state.handover.selectedNotebooks].sort(),
  };
}

function updateHandoverSelection() {
  const total = handoverSelectionCount();
  $('handover-selection-count').textContent = `${total} selected`;
  updateHandoverNavigation();
  for (const type of Object.keys(HANDOVER_SELECTORS)) renderHandoverSelector(type);
}

async function loadHandoverWorkspace(force = false) {
  if (state.handover.loaded && !force) return;
  state.handover.loaded = true;
  try {
    const [pages, files, notebookData] = await Promise.all([api.getWikiList(), api.getRawList(), api.getHandoverNotebooks()]);
    const notebooks = notebookData.notebooks.filter(book => book.available);
    const availableNotebookIds = new Set(notebooks.map(book => book.id));
    state.handover.selectedNotebooks = new Set([...state.handover.selectedNotebooks].filter(id => availableNotebookIds.has(id)));
    const selectablePages = pages.filter(page => !['log', 'project-handover'].includes(page.name));
    const availablePageNames = new Set(selectablePages.map(page => page.name));
    const availableSourceNames = new Set(files.map(file => file.name));
    state.handover.selectedPages = new Set([...state.handover.selectedPages].filter(name => availablePageNames.has(name)));
    state.handover.selectedSources = new Set([...state.handover.selectedSources].filter(name => availableSourceNames.has(name)));

    state.handover.materials = {
      wiki: selectablePages.map(page => ({ name: page.name, label: page.name })),
      raw: files.map(file => ({ name: file.name, label: file.name })),
      notebook: notebooks.map(book => ({ name: book.id, label: book.path })),
    };
    for (const [type, short] of Object.entries(HANDOVER_SELECTORS)) {
      state.handover.materials[type].sort((a, b) => a.label.localeCompare(b.label));
      $(`handover-${short}-input`).disabled = false;
    }
    $('handover-open-page').disabled = !pages.some(page => page.name === 'project-handover');
    updateHandoverSelection();
  } catch (error) {
    state.handover.loaded = false;
    setHandoverStatus(error.message, true);
  }
}

function setHandoverView(view) {
  const previewing = view === 'preview';
  $('handover-edit-tab').classList.toggle('active', !previewing);
  $('handover-edit-tab').setAttribute('aria-selected', String(!previewing));
  $('handover-preview-tab').classList.toggle('active', previewing);
  $('handover-preview-tab').setAttribute('aria-selected', String(previewing));
  $('handover-editor').hidden = previewing;
  $('handover-preview').hidden = !previewing;
  if (previewing) {
    $('handover-preview').innerHTML = renderMd($('handover-editor').value);
    typesetMath($('handover-preview'));
  }
}

async function generateHandover() {
  if (state.handover.generating || state.handover.publishing) return;
  const projectName = $('handover-project-name').value.trim();
  if (!projectName) {
    setHandoverStatus('Add a project name before generating the handover.', true);
    $('handover-project-name').focus();
    return;
  }
  if (!handoverSelectionCount()) {
    setHandoverStatus('Select at least one workspace item.', true);
    return;
  }
  if (!state.chatgpt?.ready) {
    setHandoverStatus('Connect your ChatGPT subscription before generating a draft.', true);
    void refreshChatGPTStatus({ open: true, message: 'Connect ChatGPT to generate a project handover.' });
    return;
  }

  state.handover.generating = true;
  updateHandoverSelection();
  setHandoverStep(2);
  setHandoverStatus();
  $('handover-drafting').focus({ preventScroll: true });
  try {
    const input = handoverInput();
    const result = await api.generateHandover(input);
    state.handover.generatedInput = JSON.stringify(input);
    state.handover.draft = result.draft;
    $('handover-editor').value = result.draft;
    $('handover-empty').hidden = true;
    $('handover-editor').hidden = false;
    $('handover-review').hidden = false;
    $('handover-reviewed').checked = false;
    $('handover-publish').disabled = true;
    setHandoverView('preview');
    setHandoverStep(3);
    setHandoverStatus();
  } catch (error) {
    setHandoverStatus(error.message, true);
  } finally {
    state.handover.generating = false;
    updateHandoverSelection();
    setHandoverStep(state.handover.step);
  }
}

async function publishHandover() {
  if (state.handover.step !== 4 || state.handover.generating || state.handover.publishing || !$('handover-reviewed').checked) return;
  const content = $('handover-editor').value.trim();
  if (!content) {
    setHandoverStatus('The reviewed handover is empty.', true);
    return;
  }
  state.handover.publishing = true;
  updateHandoverNavigation();
  $('handover-publish').disabled = true;
  $('handover-publish').textContent = 'Publishing...';
  setHandoverStatus('Saving the reviewed guide, index entry and audit log together.');
  try {
    await api.publishHandover(content);
    state.handover.draft = content;
    setHandoverStep(4);
    setHandoverStatus('Published. The reviewed guide is now part of the wiki.');
    $('handover-publish').textContent = 'Published';
    $('handover-reviewed').checked = false;
    $('handover-open-page').disabled = false;
    buildSidebar(await api.getWikiList());
  } catch (error) {
    $('handover-publish').textContent = 'Publish reviewed guide';
    setHandoverStatus(error.message, true);
  } finally {
    state.handover.publishing = false;
    $('handover-publish').disabled = !$('handover-reviewed').checked;
    updateHandoverNavigation();
  }
}

for (const [type, short] of Object.entries(HANDOVER_SELECTORS)) {
  const input = $(`handover-${short}-input`);
  input.addEventListener('change', () => addHandoverMaterial(type));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addHandoverMaterial(type, true);
    }
  });
  $(`handover-${short}-selected`).addEventListener('click', event => {
    const button = event.target.closest('[data-handover-remove]');
    if (!button || state.handover.generating) return;
    handoverSelectedSet(type).delete(button.dataset.handoverRemove);
    updateHandoverSelection();
    input.focus();
  });
}

document.querySelectorAll('[data-handover-toggle]').forEach(button => button.addEventListener('click', () => {
  if (state.handover.generating) return;
  const type = button.dataset.handoverToggle;
  const items = state.handover.materials[type];
  const selected = handoverSelectedSet(type);
  const shouldSelect = selected.size !== items.length;
  selected.clear();
  if (shouldSelect) items.forEach(item => selected.add(item.name));
  updateHandoverSelection();
}));

$('handover-next').addEventListener('click', advanceHandover);
$('handover-back').addEventListener('click', () => {
  if (state.handover.step > 1 && !state.handover.generating && !state.handover.publishing) {
    setHandoverStatus();
    setHandoverStep(state.handover.step - 1);
  }
});
$('handover-edit-tab').addEventListener('click', () => setHandoverView('edit'));
$('handover-preview-tab').addEventListener('click', () => setHandoverView('preview'));
$('handover-editor').addEventListener('input', () => {
  state.handover.draft = $('handover-editor').value;
  $('handover-reviewed').checked = false;
  $('handover-publish').disabled = true;
  $('handover-publish').textContent = 'Publish reviewed guide';
  updateHandoverNavigation();
  if (!$('handover-preview').hidden) setHandoverView('preview');
});
$('handover-reviewed').addEventListener('change', () => {
  $('handover-publish').disabled = !$('handover-reviewed').checked || state.handover.publishing;
  updateHandoverNavigation();
});
$('handover-publish').addEventListener('click', () => { void publishHandover(); });
$('handover-open-page').addEventListener('click', () => { void openPage('project-handover'); });

const SOURCE_FILTERS = [
  { key: 'author', label: 'Author', example: 'author:"Jocelyn Bell Burnell"' },
  { key: 'year', label: 'Publication year', example: 'year:2024' },
  { key: 'from', label: 'Published from', example: 'from:2020' },
  { key: 'to', label: 'Published through', example: 'to:2026' },
  { key: 'title', label: 'Exact title', example: 'title:"pulsar timing arrays"' },
  { key: 'object', label: 'Astronomical object', example: 'object:"Crab pulsar"' },
  { key: 'category', label: 'arXiv category', example: 'category:astro-ph.HE' },
  { key: 'source', label: 'Data source', example: 'source:arxiv' },
  { key: 'doi', label: 'DOI', example: 'doi:10.1234/example' },
  { key: 'bibcode', label: 'ADS bibcode', example: 'bibcode:2024ApJ...' },
];

function setSourceView(name) {
  state.sourceView = ['add', 'upload', 'saved', 'references'].includes(name) ? name : 'add';
  document.querySelectorAll('[data-source-view]').forEach(button => {
    const active = button.dataset.sourceView === state.sourceView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.source-view').forEach(view => {
    const active = view.id === `source-view-${state.sourceView}`;
    view.classList.toggle('active', active);
    view.hidden = !active;
  });
  if (state.sourceView === 'saved') void loadFiles().catch(() => {});
  if (state.sourceView === 'references') void window.ReferencesEditor?.open();
}

function formatPaperDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? stripEmoji(value) : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function authorSummary(authors) {
  if (!Array.isArray(authors) || !authors.length) return 'Authors unavailable';
  if (authors.length <= 3) return authors.map(stripEmoji).join(', ');
  return `${authors.slice(0, 3).map(stripEmoji).join(', ')} +${authors.length - 3}`;
}

function sourceProviderMark(provider) {
  return provider === 'NASA ADS' ? 'ADS' : 'arXiv';
}

function sourceTopicTags(paper) {
  const tags = Array.isArray(paper.keywords) ? paper.keywords : [];
  return [...new Set(tags.map(stripEmoji).filter(Boolean))].slice(0, 6);
}

function sourceKeywordMarkup(paper) {
  const tags = sourceTopicTags(paper);
  if (tags.length) return tags.map(tag => `<span>${escHtml(tag)}</span>`).join('');
  return `<small>${escHtml(paper.keywordError || (paper.abstract?.trim() ? 'Generating keywords…' : 'No abstract available'))}</small>`;
}

async function loadSourceKeywords(results, isCurrent) {
  const searchWorkspace = workspaceId;
  let next = 0;
  const current = () => workspaceId === searchWorkspace && (isCurrent ? isCurrent() : state.sourceResults === results);
  async function worker() {
    while (current() && next < results.length) {
      const paper = results[next++];
      if (!paper.abstract?.trim() || sourceTopicTags(paper).length) continue;
      try { Object.assign(paper, await api.getSourceKeywords(paper.id)); }
      catch (error) { paper.keywordError = `Keywords unavailable: ${stripEmoji(error.message)}`; }
      if (!current()) return;
      for (const prefix of ['source-keywords', 'paper-keywords', 'references-keywords', 'citations-keywords']) {
        const tags = $(`${prefix}-${paper.id}`);
        if (tags) tags.innerHTML = sourceKeywordMarkup(paper);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, results.length) }, worker));
}

function resultPaperMarkup(paper, keywordPrefix = 'source-keywords') {
  const selected = state.selectedSourceIds.has(paper.id);
  const unavailable = !paper.canImport;
  const citations = Number.isInteger(paper.citationCount) && paper.citationCount >= 0
    ? `${paper.citationCount.toLocaleString()} citation${paper.citationCount === 1 ? '' : 's'}`
    : 'Citations unavailable';
  const identifier = paper.doi || paper.arxivId || paper.bibcode;
  const identifierLabel = paper.doi ? `DOI: ${paper.doi}` : paper.arxivId ? `arXiv: ${paper.arxivId}` : paper.bibcode ? `ADS: ${paper.bibcode}` : 'Identifier unavailable';
  const identifierUrl = paper.doi ? `https://doi.org/${encodeURIComponent(paper.doi)}` : paper.recordUrl;
  return `
    <article class="source-result" data-source-id="${escHtml(paper.id)}">
      <div class="source-result-main">
        <header class="source-result-kicker">
          <span class="source-result-publication">${escHtml(paper.publication || sourceProviderMark(paper.provider))}</span>
          <span class="source-result-date">${escHtml(formatPaperDate(paper.published))}</span>
          <label class="source-result-check${unavailable ? ' disabled' : ''}" title="${unavailable ? 'No open arXiv PDF is available for import' : 'Select paper for import'}">
            <input type="checkbox" data-source-select="${escHtml(paper.id)}" ${selected ? 'checked' : ''} ${unavailable ? 'disabled' : ''}/>
            <span aria-hidden="true"></span>
            <small>${selected ? 'Selected' : 'Select'}</small>
          </label>
        </header>
        <h4>${escHtml(paper.title)}</h4>
        <p class="source-result-authors" data-orcid-paper="${escHtml(paper.id)}">${window.AuthorOrcids ? window.AuthorOrcids.markup(paper, 3) : escHtml(authorSummary(paper.authors))}</p>
        <p class="source-result-citations">${escHtml(citations)}</p>
        <div class="source-result-tags" id="${keywordPrefix}-${escHtml(paper.id)}" aria-label="AI keywords from abstract" aria-live="polite">
          ${sourceKeywordMarkup(paper)}
        </div>
        <div class="source-result-actions">
          ${identifier && identifierUrl
            ? `<a href="${escHtml(identifierUrl)}" target="_blank" rel="noreferrer">${escHtml(identifierLabel)}</a>`
            : `<span class="disabled" aria-disabled="true">${escHtml(identifierLabel)}</span>`}
          ${paper.recordUrl
            ? `<a href="${escHtml(paper.recordUrl)}" target="_blank" rel="noreferrer">Cite Article</a>`
            : '<span class="disabled" aria-disabled="true">Cite Article</span>'}
          <button class="source-result-preview" type="button" data-source-preview="${escHtml(paper.id)}">Show More</button>
        </div>
      </div>
    </article>`;
}

function renderSourceResults(results) {
  state.sourceResults = Array.isArray(results) ? results : [];
  for (const paper of state.sourceResults) state.sourcePapers.set(paper.id, paper);
  dom.sourceResultsSection.hidden = false;
  $('source-results-header').hidden = false;
  $('source-results-title').textContent = `${state.sourceResults.length} paper${state.sourceResults.length === 1 ? '' : 's'} found`;
  dom.sourceResults.innerHTML = state.sourceResults.length
    ? state.sourceResults.map(paper => resultPaperMarkup(paper)).join('')
    : '<div class="source-empty"><strong>No matching papers found</strong><p>Try fewer terms, a broader date range, or remove a filter.</p></div>';
  void window.AuthorOrcids?.hydrate(dom.sourceResults, state.sourceResults);
  updateSourceSelection();
}

function updateSourceSelection() {
  const count = state.selectedSourceIds.size;
  dom.sourceSelectedCount.textContent = count;
  dom.sourceImportSelected.disabled = state.sourceImportRunning || count === 0;
  dom.sourceImportSelected.classList.toggle('active', count > 0);
  $('source-paper-import').disabled = state.sourceImportRunning || count === 0;
  $('source-paper-import').textContent = `Import selected (${count})`;
  const paper = state.sourcePapers.get(state.activeSourceId);
  const currentImport = $('source-paper-import-current');
  currentImport.disabled = Boolean(state.sourceImportRunning || !paper?.canImport);
  currentImport.title = paper && !paper.canImport ? 'No open arXiv PDF is available for import' : '';
}

function closeSourceDetail() {
  state.activeSourceId = null;
  state.sourceDetailRequest++;
  state.sourcePaperHistory = [];
  $('source-paper-page').hidden = true;
  $('source-search-page').hidden = false;
  renderSourceResults(state.sourceResults);
}

async function showSourceDetail(id, remember = true) {
  const paper = state.sourcePapers.get(id);
  if (!paper) return;
  if (remember && state.activeSourceId) state.sourcePaperHistory.push(state.activeSourceId);
  state.activeSourceId = id;
  const request = ++state.sourceDetailRequest;
  const detailWorkspace = workspaceId;
  const current = () => workspaceId === detailWorkspace && state.sourceDetailRequest === request && state.activeSourceId === id;
  $('source-search-page').hidden = true;
  $('source-paper-page').hidden = false;
  $('source-paper-back').textContent = state.sourcePaperHistory.length ? 'Back to previous paper' : 'Back to results';
  $('source-paper-metadata').innerHTML = `
    <header class="source-paper-header">
      <h2 id="source-paper-title" tabindex="-1">${escHtml(paper.title)}</h2>
      <p class="source-result-authors" data-orcid-paper="${escHtml(paper.id)}">${window.AuthorOrcids ? window.AuthorOrcids.markup(paper) : escHtml(paper.authors?.length ? paper.authors.map(stripEmoji).join(', ') : 'Authors unavailable')}</p>
      <p class="source-paper-journal"><strong>Journal</strong> ${escHtml(paper.publication || 'Journal unavailable')} &middot; ${escHtml(formatPaperDate(paper.published))}</p>
    </header>
    <section class="source-paper-abstract" id="source-paper-abstract"><h3>Abstract</h3><p>${escHtml(paper.abstract || 'No abstract is available for this record.')}</p></section>
    <section class="source-paper-keywords"><h3>Keywords</h3><div class="source-result-tags" id="paper-keywords-${escHtml(id)}" aria-label="AI keywords from abstract" aria-live="polite">${sourceKeywordMarkup(paper)}</div></section>
    ${paper.recordUrl ? `<a class="source-record-link" href="${escHtml(paper.recordUrl)}" target="_blank" rel="noreferrer">Open publication record</a>` : ''}`;
  typesetMath($('source-paper-abstract'));
  void window.AuthorOrcids?.hydrate($('source-paper-metadata'), [paper]);
  $('source-paper-title').focus({ preventScroll: true });
  $('panel-files').scrollTop = 0;
  updateSourceSelection();
  const relations = $('source-paper-relations');
  relations.innerHTML = '<p class="source-related-loading"><span class="document-spinner"></span>Loading references and citations...</p>';
  void loadSourceKeywords([paper], current);
  try {
    const data = await api.getRelatedSources(id, paper);
    if (!current()) return;
    const related = [];
    relations.innerHTML = ['references', 'citations'].map(key => {
      const group = (data.groups || []).find(item => item.key === key);
      const papers = group?.results || [];
      for (const item of papers) {
        const existing = state.sourcePapers.get(item.id);
        if (existing?.keywords) item.keywords = existing.keywords;
        state.sourcePapers.set(item.id, item);
        related.push(item);
      }
      return `<section class="source-paper-group"><h3>${key === 'references' ? 'References' : 'Cited in'}</h3>
        ${group?.error ? `<p class="source-related-empty">${escHtml(group.error)}</p>` : ''}
        ${papers.length ? `<div class="source-results">${papers.map(item => resultPaperMarkup(item, `${key}-keywords`)).join('')}</div>` : !group?.error ? '<p class="source-related-empty">No records available.</p>' : ''}
        ${group?.limit && papers.length >= group.limit ? `<p class="source-related-empty">Showing the ${group.limit} most recent records.</p>` : ''}</section>`;
    }).join('');
    void window.AuthorOrcids?.hydrate(relations, related);
    void loadSourceKeywords(related, current);
  } catch (error) {
    if (current()) relations.innerHTML = `<p class="source-related-empty">${escHtml(stripEmoji(error.message))}</p><button class="btn" type="button" data-source-preview="${escHtml(id)}">Retry</button>`;
  }
}

async function runSourceSearch() {
  const query = dom.sourceSearchInput.value.trim();
  if (!query) {
    dom.sourceSearchInput.focus();
    return;
  }
  if (!$('source-search-form').reportValidity()) return;
  const request = (state.sourceSearchRequest || 0) + 1;
  state.sourceSearchRequest = request;
  const searchWorkspace = workspaceId;
  const current = () => state.sourceSearchRequest === request && workspaceId === searchWorkspace;
  const options = {
    sort: $('source-sort').value,
    filters: {
      refereed: $('source-refereed').value,
      collection: $('source-collection').value,
      year: $('source-year').value,
      minCitations: $('source-min-citations').value,
    },
  };
  dom.sourceFilterSuggestions.classList.remove('visible');
  dom.sourceSearchStatus.className = 'source-search-status visible loading';
  dom.sourceSearchStatus.innerHTML = '<span class="document-spinner"></span><span>Searching for papers...</span>';
  $('source-search-submit').disabled = true;
  state.selectedSourceIds.clear();
  closeSourceDetail();
  state.sourcePapers.clear();
  state.sourceResults = [];
  dom.sourceResults.innerHTML = '';
  $('source-results-header').hidden = true;
  try {
    const data = await api.searchSources(query, 20, options);
    if (!current()) return;
    state.sourceFilters = data.filters || SOURCE_FILTERS;
    renderSourceResults(data.results);
    void loadSourceKeywords(state.sourceResults);
    const warning = data.warnings?.length ? ` ${data.warnings.join(' ')}` : '';
    const intent = data.query?.intent === 'specific' ? 'Exact lookup' : data.query?.intent === 'research-question' ? 'Research question' : 'Keyword search';
    dom.sourceSearchStatus.className = `source-search-status visible${warning ? ' warning' : ''}`;
    dom.sourceSearchStatus.textContent = `${intent} complete.${warning}`;
  } catch (error) {
    if (!current()) return;
    dom.sourceSearchStatus.className = 'source-search-status visible error';
    dom.sourceSearchStatus.textContent = stripEmoji(error.message);
  } finally {
    if (current()) $('source-search-submit').disabled = false;
  }
}

function updateFilterSuggestions() {
  const input = dom.sourceSearchInput;
  const caret = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, caret);
  const token = before.match(/(?:^|\s)([a-z]*:?[^\s]*)$/i)?.[1] || '';
  const keyPart = token.split(':')[0].toLowerCase();
  const shouldSuggest = token.includes(':') || keyPart.length >= 2;
  const matches = shouldSuggest ? (state.sourceFilters.length ? state.sourceFilters : SOURCE_FILTERS)
    .filter(filter => filter.key.startsWith(keyPart)).slice(0, 6) : [];
  dom.sourceFilterSuggestions.innerHTML = matches.map(filter => `
    <button type="button" role="option" data-filter-key="${escHtml(filter.key)}" data-filter-value="${escHtml(filter.example)}">
      <strong>${escHtml(filter.key)}:</strong><span>${escHtml(filter.label)}</span><code>${escHtml(filter.example)}</code>
    </button>`).join('');
  dom.sourceFilterSuggestions.classList.toggle('visible', matches.length > 0);
}

function insertSourceFilter(value) {
  const input = dom.sourceSearchInput;
  const caret = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, caret);
  const match = before.match(/(?:^|\s)([a-z]*:?[^\s]*)$/i);
  const start = match ? caret - match[1].length : caret;
  const prefix = start > 0 && !/\s/.test(input.value[start - 1]) ? ' ' : '';
  input.value = `${input.value.slice(0, start)}${prefix}${value}${input.value.slice(caret)}`;
  const emptyQuotes = value.indexOf('""');
  const nextCaret = start + prefix.length + value.length - (emptyQuotes === -1 ? 0 : 1);
  input.focus();
  input.setSelectionRange(nextCaret, nextCaret);
  dom.sourceFilterSuggestions.classList.remove('visible');
}

async function importSelectedSources() {
  await importSourcePapers([...state.selectedSourceIds]);
}

async function importCurrentSource() {
  const paper = state.sourcePapers.get(state.activeSourceId);
  if (!paper?.canImport) return;
  await importSourcePapers([paper.id]);
}

async function importSourcePapers(ids) {
  if (!ids.length || state.sourceImportRunning) return;
  state.sourceImportRunning = true;
  updateSourceSelection();
  dom.sourceImportSelected.textContent = `Importing ${ids.length}...`;
  dom.sourceJobStatus.className = 'source-job-status visible running';
  dom.sourceJobStatus.textContent = 'Downloading selected PDFs to the workspace...';
  try {
    const result = await api.importSources(ids);
    const imported = result.imported?.length || 0;
    const failed = result.failed?.length || 0;
    for (const id of ids) state.selectedSourceIds.delete(id);
    renderSourceResults(state.sourceResults);
    await loadFiles();
    setSourceView('saved');
    dom.sourceJobStatus.className = `source-job-status visible${failed ? ' warning' : ''}`;
    dom.sourceJobStatus.textContent = `${imported} paper${imported === 1 ? '' : 's'} saved${failed ? `; ${failed} could not be imported` : ''}. Background wiki review queued.`;
    if (result.ingestJob?.id) monitorSourceJob(result.ingestJob.id);
  } catch (error) {
    dom.sourceJobStatus.className = 'source-job-status visible error';
    dom.sourceJobStatus.textContent = stripEmoji(error.message);
  } finally {
    state.sourceImportRunning = false;
    dom.sourceImportSelected.innerHTML = 'Import selected <span id="source-selected-count">0</span>';
    updateSourceSelection();
  }
}

function monitorSourceJob(id) {
  clearInterval(state.sourceJobTimer);
  const update = async () => {
    try {
      const job = await api.getSourceJob(id);
      const messages = {
        queued: 'PDF saved. Background wiki review is queued.',
        running: 'PDF saved. AI is reviewing the source in the background.',
        'awaiting-connection': 'PDF saved. Connect ChatGPT to start the background wiki review.',
        completed: 'Background wiki review is ready in Saved chats.',
        failed: job.error || 'The PDF was saved, but the background wiki review failed.',
      };
      dom.sourceJobStatus.className = `source-job-status visible ${job.status}`;
      dom.sourceJobStatus.textContent = messages[job.status] || 'Background wiki review is queued.';
      if (['completed', 'failed', 'awaiting-connection'].includes(job.status)) {
        clearInterval(state.sourceJobTimer);
        if (job.status === 'completed') {
          refreshWiki();
          loadThreads();
        }
      }
    } catch {
      clearInterval(state.sourceJobTimer);
    }
  };
  void update();
  state.sourceJobTimer = setInterval(update, 2500);
}

document.querySelectorAll('[data-source-view]').forEach(button => button.addEventListener('click', () => setSourceView(button.dataset.sourceView)));
dom.sourceSearchForm.addEventListener('submit', event => { event.preventDefault(); void runSourceSearch(); });
for (const id of ['source-sort', 'source-refereed', 'source-collection', 'source-year', 'source-min-citations']) {
  $(id).addEventListener('change', () => {
    if (dom.sourceSearchInput.value.trim()) void runSourceSearch();
  });
}
dom.sourceSearchInput.addEventListener('input', () => {
  updateFilterSuggestions();
});
dom.sourceSearchInput.addEventListener('click', updateFilterSuggestions);
dom.sourceFilterSuggestions.addEventListener('mousedown', event => {
  const option = event.target.closest('[data-filter-value]');
  if (!option) return;
  event.preventDefault();
  insertSourceFilter(option.dataset.filterValue);
});
document.querySelectorAll('[data-filter-example]').forEach(button => button.addEventListener('click', () => insertSourceFilter(button.dataset.filterExample)));
document.addEventListener('click', event => {
  if (!event.target.closest('#source-search-box')) dom.sourceFilterSuggestions.classList.remove('visible');
});
$('panel-files').addEventListener('change', event => {
  const checkbox = event.target.closest('[data-source-select], [data-related-select]');
  if (!checkbox) return;
  if (checkbox.checked) state.selectedSourceIds.add(checkbox.dataset.sourceSelect || checkbox.dataset.relatedSelect);
  else state.selectedSourceIds.delete(checkbox.dataset.sourceSelect || checkbox.dataset.relatedSelect);
  updateSourceSelection();
});
$('panel-files').addEventListener('click', event => {
  const preview = event.target.closest('[data-source-preview]');
  if (preview) void showSourceDetail(preview.dataset.sourcePreview, preview.dataset.sourcePreview !== state.activeSourceId);
});
$('source-paper-back').addEventListener('click', () => {
  const previous = state.sourcePaperHistory.pop();
  if (previous) void showSourceDetail(previous, false);
  else closeSourceDetail();
});
$('source-paper-import').addEventListener('click', () => { void importSelectedSources(); });
$('source-paper-import-current').addEventListener('click', () => { void importCurrentSource(); });

dom.sourceImportSelected.addEventListener('click', () => { void importSelectedSources(); });

function setDocumentStatus(message, detail = '', isError = false) {
  dom.documentStage.innerHTML = `
    <div class="document-status${isError ? ' error' : ''}">
      ${isError ? fileIcon('file') : '<span class="document-spinner"></span>'}
      <strong>${escHtml(message)}</strong>
      ${detail ? `<span>${escHtml(detail)}</span>` : ''}
    </div>`;
}

async function openRawFile(name, ext, file = {}, updateHash = true) {
  window.ActiveReading?.close();
  const normalizedExt = String(ext || '').toLowerCase();
  const url = workspaceUrl(`/api/raw/${encodeURIComponent(name)}`);
  const session = ++state.documentSession;
  state.currentDocument = { name, ext: normalizedExt, url };
  state.pdf.doc = null;
  state.pdf.page = 1;
  state.pdf.scale = 1;
  state.pdf.fitWidth = true;
  if (state.pdf.renderTask) state.pdf.renderTask.cancel();

  showPanel('document');
  if (updateHash) history.replaceState(null, '', `#file/${encodeURIComponent(name)}`);
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
      typesetMath(dom.documentStage);
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
  if (window.ActiveReading) {
    await window.ActiveReading.open(pdf, state.currentDocument.name, session);
    return;
  }
  await renderPdfPage(1, true);
}

function clampPdfScale(value) {
  return Math.min(3, Math.max(0.25, value));
}

async function renderPdfPage(pageNumber, fitWidth = state.pdf.fitWidth) {
  if (window.ActiveReading?.isOpen()) return window.ActiveReading.navigate(pageNumber, fitWidth);
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
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
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
$('saved-upload-btn').onclick = openUploadModal;
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
  if (!files.length) return;
  dom.uploadProgress.textContent = `Uploading ${files.length} file(s)...`;
  let latestJob = null;
  try {
    for (const file of files) {
      dom.uploadProgress.textContent = `Uploading ${stripEmoji(file.name)}...`;
      const result = await api.uploadFile(file, p => {
        dom.uploadProgress.textContent = `Uploading ${stripEmoji(file.name)} - ${Math.round(p * 100)}%`;
      });
      latestJob = result.ingestJob || latestJob;
    }
    dom.uploadProgress.textContent = 'Upload complete';
    await loadFiles();
    if (latestJob?.id) monitorSourceJob(latestJob.id);
    setTimeout(() => { closeUploadModal(); setSourceView('saved'); }, 700);
  } catch (error) {
    dom.uploadProgress.textContent = stripEmoji(error.message);
  }
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
  window.ResearchNotebooks?.theme(t);
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
  if (state.panel === 'wiki' && state.currentPage) openPage(state.currentPage, { historyMode: 'none' });
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
  if (/^#notebook\/[a-f0-9-]{36}(?:\?|$)/.test(location.hash)) return;
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
      if (willOpen) {
        const sidebarRect = $('sidebar').getBoundingClientRect();
        const buttonRect = menu.getBoundingClientRect();
        actions.style.left = `${sidebarRect.right + 4}px`;
        actions.style.top = `${Math.max(4, Math.min(buttonRect.top, window.innerHeight - actions.offsetHeight - 4))}px`;
      }
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
  void refreshAdsSettings();
}

function closeChatGPTSettings() {
  $('ads-token').value = '';
  dom.chatgptSettingsModal.style.display = 'none';
}

async function readAdsSettingsResponse(response) {
  if (response.status === 404 || response.status === 409) {
    throw new Error('Restart the PulsarWiki server, then refresh this page to enable saving NASA ADS tokens.');
  }
  return readJsonResponse(response, 'NASA ADS settings');
}

function renderAdsSettings(status) {
  $('ads-token-remove').disabled = !status.saved;
  $('ads-token').placeholder = status.configured ? 'Enter a replacement token' : 'Paste your token';
  $('ads-token-status').textContent = status.fromEnvironment
    ? 'Using the token configured in the server environment.'
    : status.configured ? 'Token saved. NASA ADS searches are enabled.' : 'No token configured. Searches use arXiv.';
}

async function refreshAdsSettings() {
  $('ads-token').value = '';
  $('ads-token-remove').disabled = true;
  $('ads-token-status').textContent = 'Loading NASA ADS settings...';
  try {
    renderAdsSettings(await readAdsSettingsResponse(await workspaceFetch('/api/settings/ads')));
  } catch (error) {
    $('ads-token-status').textContent = error.message;
  }
}

async function updateAdsSettings(remove = false) {
  const hadSavedToken = !$('ads-token-remove').disabled;
  $('ads-token-save').disabled = true;
  $('ads-token-remove').disabled = true;
  try {
    const status = await readAdsSettingsResponse(await workspaceFetch('/api/settings/ads', {
      method: remove ? 'DELETE' : 'PUT',
      ...(remove ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: $('ads-token').value }) }),
    }));
    $('ads-token').value = '';
    renderAdsSettings(status);
  } catch (error) {
    $('ads-token-status').textContent = error.message;
    $('ads-token-remove').disabled = !hadSavedToken;
  } finally {
    $('ads-token-save').disabled = false;
  }
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
  const ws = new WebSocket(workspaceUrl(proto + '://' + location.host + '/'));
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
  typesetMath(aiTarget.el);
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
  if (role !== 'user') typesetMath(el);
  dom.chatMessages.appendChild(el);
  scrollChat();
}

function handleChatWikiLink(event) {
  const link = wikiLinkForInAppNavigation(event);
  if (!link || !dom.chatMessages.contains(link)) return;
  event.preventDefault();
  void openPage(link.dataset.page);
}

document.addEventListener('click', event => {
  if (!event.target.closest('.chat-thread-menu-wrap')) closeThreadMenus();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeThreadMenus();
});
dom.chatThreadList.addEventListener('scroll', closeThreadMenus);
window.addEventListener('resize', closeThreadMenus);

dom.chatgptSettingsButton.addEventListener('click', () => { void refreshChatGPTStatus({ open: true }); });
dom.chatgptClose.addEventListener('click', closeChatGPTSettings);
$('ads-settings-form').addEventListener('submit', event => { event.preventDefault(); void updateAdsSettings(); });
$('ads-token-remove').addEventListener('click', () => { void updateAdsSettings(true); });
dom.chatgptModelSave.addEventListener('click', () => { void saveChatGPTModel(); });
dom.chatgptConnect.addEventListener('click', () => { window.location.assign('/auth/chatgpt/start'); });
dom.chatgptNewAccount.addEventListener('click', () => { void useAnotherChatGPTAccount(); });
dom.chatgptDisconnect.addEventListener('click', () => { void disconnectChatGPT(); });
dom.chatgptForget.addEventListener('click', () => { void forgetChatGPTAccount(); });
dom.chatgptSettingsModal.addEventListener('click', event => {
  if (event.target === dom.chatgptSettingsModal) closeChatGPTSettings();
});
dom.chatNewThread.addEventListener('click', () => { void createThread(); });
dom.chatMessages.addEventListener('click', handleChatWikiLink);
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
  if (!await initializeWorkspaceUi()) return;
  try {
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
    if (!routedToWiki && await window.ResearchNotebooks?.route(hash)) return;
    if (!routedToWiki && await window.ActiveReading?.route(hash)) return;
    if (!routedToWiki && ['#sources', '#sources/saved', '#sources/references'].includes(hash)) {
      showPanel('files');
      setSourceView(hash.endsWith('/references') ? 'references' : hash.endsWith('/saved') ? 'saved' : 'add');
      return;
    }
    if (!routedToWiki && hash.startsWith('#file/')) {
      const name = decodeURIComponent(hash.slice(6).split('?')[0]);
      const files = await api.getRawList();
      const file = files.find(item => item.name === name);
      if (file) {
        await openRawFile(file.name, file.ext, file, false);
        return;
      }
    }
    if (!routedToWiki) await openPage('index', { historyMode: 'replace' });
  } catch (error) {
    const status = $('workspace-status');
    status.textContent = `Could not finish opening project: ${stripEmoji(error.message)}`;
    status.hidden = false;
  } finally {
    window.setWorkspaceLoading(false);
  }
})();
