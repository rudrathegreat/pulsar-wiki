/* Local active-reading workspace. Add to wiki integrates and saves selected notes automatically. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r = { data: null, document: null, pdf: null, generation: 0, pages: new Map(), selected: new Set(), annotationIds: new Set(), discoveryIds: new Set(), assistanceIds: new Set(), active: null, tab: 'highlights', filter: { document: '', color: '', category: '', query: '', annotated: false }, region: false, rotation: 0, pending: null, undo: null, collection: '', observer: null, polling: null, artifact: null, task: null, saveTimer: null, positionDirty: false, findIndex: 0, searchResults: null };
  const colors = ['yellow', 'green', 'pink'];
  const colorName = color => color === 'blue' ? 'Blue · AI assistance' : color;
  r.highlightsEnabled = true;
  const actions = { 'wiki-note': 'Add to wiki', explain: 'Explain passage', equation: 'Explain equation', methodology: 'Explain methodology', assumptions: 'Examine assumptions', concept: 'Explain concept', question: 'Ask a question', evidence: 'Compare evidence', links: 'Suggest connections' };
  const artifactNames = { summary: 'Paper reading summary', synthesis: 'Collection synthesis', evidence: 'Evidence comparison', concept: 'Concept-page update' };
  const yieldUI = () => typeof window.scheduler?.yield === 'function' ? window.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
  const renderQueue = new Map();
  const thumbnailQueue = new Map();
  const SCROLL_SETTLE_MS = 120;
  const CACHE_PAGES = 5;
  const CACHE_PIXELS = 24 * 1024 * 1024;
  let rendering = false;
  const diagnostics = window.ReadingPerformance?.create({ sample: () => ({
    page: state.pdf.page, scrolling: Boolean(r.scrolling), queuedPages: renderQueue.size, queuedThumbnails: thumbnailQueue.size,
    canvases: [...r.pages.values()].filter(p => (p.canvasReady || p.rendering) && p.canvas.width && p.canvas.height).map(p => ({
      page: p.number, width: p.canvas.width, height: p.canvas.height, visible: Boolean(p.visible), ready: Boolean(p.canvasReady),
      textSpans: p.textLayer?.textDivs.length || 0,
      context: p.contextAttributes || null,
    })),
  }) });
  function renderPhase(phase, page) { diagnostics?.mark(phase, { page }); }

  function interruptPage(p) {
    if (!p?.rendering) return;
    p.renderVersion = (p.renderVersion || 0) + 1;
    p.task?.cancel(); p.buildingTextLayer?.cancel();
    void p.textReader?.cancel().catch(() => {});
  }
  function pageHasSelection(p) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return false;
    for (let i = 0; i < selection.rangeCount; i += 1) {
      if (selection.getRangeAt(i).intersectsNode(p.layer)) return true;
    }
    return false;
  }
  function releasePage(p) {
    if (!p.rendered && !p.rendering && !p.textLayer && !p.content && !p.needsCleanup && p.canvas.width === 0 && p.canvas.height === 0) return;
    if (pageHasSelection(p)) return;
    p.renderVersion = (p.renderVersion || 0) + 1;
    p.task?.cancel(); p.buildingTextLayer?.cancel();
    void p.textReader?.cancel().catch(() => {});
    p.textLayer = null; p.content = null; p.text = null;
    p.layer.textContent = ''; p.overlay.textContent = '';
    p.canvas.width = 0; p.canvas.height = 0; p.rendered = false; p.canvasReady = false;
    p.needsCleanup = Boolean(p.page);
    if (!p.rendering && p.page) p.needsCleanup = p.page.cleanup() === false;
  }
  function releaseDistantPages() {
    // Keep recently viewed pages for direction changes, within both a page and
    // pixel budget. Visible/near pages and active selections take precedence.
    let count = 0; let pixels = 0; const cached = [];
    for (const p of r.pages.values()) {
      if (p.near === false && !p.rendered && !p.canvasReady) { releasePage(p); continue; }
      if (!p.rendered && !p.canvasReady) continue;
      count += 1; pixels += p.canvas.width * p.canvas.height;
      if (p.near === false && !pageHasSelection(p)) cached.push(p);
    }
    cached.sort((a, b) => Math.abs(b.number - state.pdf.page) - Math.abs(a.number - state.pdf.page));
    for (const p of cached) {
      if (count <= CACHE_PAGES && pixels <= CACHE_PIXELS) break;
      count -= 1; pixels -= p.canvas.width * p.canvas.height; releasePage(p);
    }
  }
  function firstPageAfter(y) {
    let low = 1; let high = r.pages.size;
    while (low < high) {
      const middle = (low + high) >> 1; const wrap = r.pages.get(middle).wrap;
      if (wrap.offsetTop + wrap.offsetHeight <= y) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  function updateViewport() {
    if (!r.pdf || !r.pages.size) return;
    const stage = el('document-stage'); const top = stage.scrollTop; const bottom = top + stage.clientHeight;
    const previous = r.nearPages || new Set(); const near = new Set();
    if (!stage.clientHeight) {
      for (const number of previous) {
        const p = r.pages.get(number); if (!p) continue;
        p.near = false; p.visible = false; interruptPage(p);
      }
      r.nearPages = near; return;
    }
    for (let number = firstPageAfter(top - 300); number <= r.pages.size; number += 1) {
      const p = r.pages.get(number); const start = p.wrap.offsetTop; const end = start + p.wrap.offsetHeight;
      if (start >= bottom + 300) break;
      p.near = true; p.visible = end > top && start < bottom; near.add(number);
      if (!previous.has(number) && p.rendered) paintHighlights(p);
    }
    for (const number of previous) if (!near.has(number)) {
      const p = r.pages.get(number); if (!p) continue;
      p.near = false; p.visible = false; interruptPage(p);
    }
    r.nearPages = near;
    const number = firstPageAfter(top + 30);
    if (number !== state.pdf.page) { state.pdf.page = number; updatePageControls(); schedulePosition(); }
  }
  function queueNearbyPages() {
    if (r.scrolling) return;
    const pages = [...(r.nearPages || [])].map(number => r.pages.get(number));
    pages.sort((a, b) => Number(b.visible) - Number(a.visible) || Math.abs(a.number - state.pdf.page) - Math.abs(b.number - state.pdf.page));
    for (const p of pages) void renderPage(p.number, true).catch(report);
  }
  function scheduleViewport() {
    if (r.viewportFrame != null) return;
    r.viewportFrame = window.requestAnimationFrame(() => {
      r.viewportFrame = null; updateViewport(); queueNearbyPages();
    });
  }
  function pauseForScroll() {
    if (!r.pdf || !r.pages.size) return;
    r.scrolling = true; interruptPage(r.renderingPage); r.thumbnailTask?.task.cancel();
    scheduleViewport();
    clearTimeout(r.scrollTimer);
    r.scrollTimer = setTimeout(() => {
      r.scrolling = false; updateViewport(); releaseDistantPages(); queueNearbyPages(); void drainRenderQueue();
    }, SCROLL_SETTLE_MS);
  }
  async function readPageText(p, current) {
    const reader = p.textReader = p.page.streamTextContent().getReader();
    const content = { items: [], styles: Object.create(null), lang: null };
    try {
      while (current()) {
        const { value, done } = await reader.read();
        if (done || !current()) break;
        content.items.push(...value.items); Object.assign(content.styles, value.styles); content.lang ??= value.lang;
        await yieldUI();
      }
      return content;
    } finally {
      if (!current()) await reader.cancel().catch(() => {});
      if (p.textReader === reader) p.textReader = null;
      reader.releaseLock();
    }
  }
  function thumbnailWanted(job) {
    return job.pdf === r.pdf && job.generation === r.generation && !el('reading-thumbnails').hidden &&
      el('reading-thumbnails').contains(job.button) && job.button.dataset.near === 'true';
  }
  function queueThumbnail(button) {
    if (button.dataset.done) return;
    thumbnailQueue.set(button, { button, pdf: r.pdf, generation: r.generation });
    void drainRenderQueue();
  }
  async function drawNextThumbnail() {
    const job = thumbnailQueue.values().next().value; thumbnailQueue.delete(job.button);
    if (!thumbnailWanted(job) || job.button.dataset.done) return;
    let page;
    try {
      page = await job.pdf.getPage(Number(job.button.dataset.readingJump));
      if (!thumbnailWanted(job) || r.scrolling || renderQueue.size) return;
      const viewport = page.getViewport({ scale: .1 }); const canvas = job.button.querySelector('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      renderPhase('thumbnail', Number(job.button.dataset.readingJump));
      const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false, willReadFrequently: true }), viewport });
      r.thumbnailTask = { button: job.button, task };
      task.onContinue = continuation => { void yieldUI().then(() => {
        if (thumbnailWanted(job) && !r.scrolling) continuation(); else if (r.thumbnailTask?.task === task) task.cancel();
      }); };
      await task.promise;
      if (thumbnailWanted(job)) { job.button.dataset.done = 'true'; thumbnailQueue.delete(job.button); }
    } catch (error) { if (error.name !== 'RenderingCancelledException' && error.name !== 'AbortException') job.button.dataset.done = 'error'; }
    finally {
      renderPhase('idle');
      r.thumbnailTask = null;
      if (!job.button.dataset.done && thumbnailWanted(job)) thumbnailQueue.set(job.button, job);
      if (page && !r.pages.get(Number(job.button.dataset.readingJump))?.canvasReady) page.cleanup();
    }
  }
  // PDF.js consumes each stream chunk synchronously. Bound the number of spans
  // built in one turn so dense scientific PDFs leave time for input and paint.
  function textChunks(content, current) {
    let offset = 0; let cancelled = false;
    return new ReadableStream({
      async pull(controller) {
        await yieldUI();
        if (cancelled) return;
        if (!current() || offset >= content.items.length) { controller.close(); return; }
        controller.enqueue({ ...content, items: content.items.slice(offset, offset + 100) });
        offset += 100;
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
  }

  async function request(url = '', method = 'GET', body) {
    const response = await fetch(`/api/reading${url}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || 'Reading request failed.'); error.code = data.code; throw error; }
    return data;
  }
  async function refresh() { r.data = await request(); return r.data; }
  function live(table) { return (r.data?.[table] || []).filter(v => !v.deletedAt); }
  function record(table, id) { return r.data?.[table]?.find(v => v.id === id); }
  function notify(message, persistent = false) {
    el('reading-toast').textContent = message; el('reading-toast').hidden = false;
    clearTimeout(r.toastTimer);
    if (!persistent) r.toastTimer = setTimeout(() => { el('reading-toast').hidden = true; }, 6500);
  }
  function activeHelper() { return r.helper?.expanded && !el('reading-selection-toolbar').hidden ? r.helper : null; }
  function formIsOpen() { return Boolean(activeHelper() || el('reading-dialog').open); }
  function formError() { return el(activeHelper() ? 'reading-helper-error' : 'reading-dialog-error'); }
  function report(error) { if (formIsOpen()) formError().textContent = error.message; else notify(error.message, true); }
  const guard = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(report);
  function dialog(title, html) {
    if (activeHelper()) {
      r.helper.viewVersion = (r.helper.viewVersion || 0) + 1;
      el('reading-helper-title').textContent = title;
      el('reading-helper-body').innerHTML = html;
      el('reading-helper-error').textContent = '';
      el('reading-helper-details').hidden = false;
      el('reading-selection-toolbar').classList.add('expanded');
      positionHelper();
      return;
    }
    el('reading-dialog-title').textContent = title;
    el('reading-dialog-body').innerHTML = html;
    el('reading-dialog-error').textContent = '';
    if (!el('reading-dialog').open) el('reading-dialog').showModal();
  }
  function closeForm() {
    if (activeHelper()) {
      r.helper.expanded = false;
      el('reading-helper-details').hidden = true;
      el('reading-helper-body').innerHTML = '';
      el('reading-selection-toolbar').classList.remove('expanded');
      for (const action of ['wiki', 'ask', 'note', 'connect']) el(`reading-selection-${action}`).setAttribute('aria-expanded', 'false');
      positionHelper();
    } else el('reading-dialog').close();
    r.artifact = null;
  }
  function closeHelper() {
    if (activeHelper()) closeForm();
    el('reading-selection-toolbar').hidden = true;
    r.helper = null; r.pending = null;
  }
  function hasUnsavedHelperDraft() {
    return Boolean(activeHelper() && r.artifact && el('reading-artifact-editor')?.value !== r.artifact.content);
  }
  function safeMarkdown(content, snapshot = null) {
    if (snapshot) content = content.replace(/\[([HAWDR]):([^\]\n]+)\](?!\()/g, (match, kind, id) => {
      if (kind === 'H') { const h = snapshot.highlights.find(h => h.id === id); if (h) return `[Passage ${id.slice(0, 8)}](/#reading/${h.documentId}/${h.id}?revision=${h.revision})`; }
      if (kind === 'W' && snapshot.wikiPages.some(w => w.name === id)) return `[${id}](/wiki/${encodeURIComponent(id)})`;
      if (kind === 'D') { const d = snapshot.discoveries.find(d => d.id === id); if (d) return `[External candidate](${d.source.recordUrl})`; }
      return match;
    });
    return sanitizeHtml(renderMd(content));
  }
  function sanitizeHtml(content) {
    const template = document.createElement('template'); template.innerHTML = content;
    const allowed = new Set(['P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'EM', 'DEL', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE', 'CODE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A']);
    for (const node of [...template.content.querySelectorAll('*')]) {
      if (!allowed.has(node.tagName)) { node.replaceWith(document.createTextNode(node.textContent)); continue; }
      const href = node.tagName === 'A' ? node.getAttribute('href') || '' : '';
      const wiki = node.tagName === 'A' && node.classList.contains('wiki-link') ? node.getAttribute('data-page') : '';
      for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
      if (href && (/^https?:\/\//i.test(href) || /^\/(?!\/)/.test(href))) { node.setAttribute('href', href); node.setAttribute('rel', 'noopener noreferrer'); }
      if (wiki && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(wiki) && href === `/wiki/${encodeURIComponent(wiki)}`) { node.className = 'wiki-link'; node.dataset.page = wiki; }
    }
    return template.innerHTML;
  }
  function docName(id) { const doc = record('documents', id); return doc?.currentName || doc?.aliases?.[0] || 'Missing source'; }
  function selectedPayload() { return { highlightIds: [...r.selected].filter(id => live('highlights').some(h => h.id === id)), annotationIds: [...r.annotationIds].filter(id => live('annotations').some(a => a.id === id && r.selected.has(a.highlightId))), highlightRevisions: Object.fromEntries(selectedHighlights().map(h => [h.id, h.revision])), annotationRevisions: Object.fromEntries(live('annotations').filter(a => r.annotationIds.has(a.id)).map(a => [a.id, a.revision])), discoveryIds: [...r.discoveryIds], assistanceIds: [...r.assistanceIds], wikiPages: [] }; }
  function selectedHighlights() { return live('highlights').filter(h => r.selected.has(h.id)); }

  function close() {
    renderPhase('close');
    if (r.document && r.positionDirty) void savePosition();
    r.generation += 1; r.observer?.disconnect(); r.thumbnailObserver?.disconnect();
    thumbnailQueue.clear(); r.thumbnailTask?.task.cancel();
    clearTimeout(r.scrollTimer); clearTimeout(r.selectionTimer);
    if (r.viewportFrame != null) window.cancelAnimationFrame(r.viewportFrame);
    r.viewportFrame = null; r.scrolling = false; r.nearPages = new Set();
    for (const job of renderQueue.values()) job.resolve();
    renderQueue.clear();
    for (const p of r.pages.values()) { p.task?.cancel(); p.buildingTextLayer?.cancel(); p.textLayer?.cancel(); void p.textReader?.cancel().catch(() => {}); }
    if (r.pdf) { const previous = r.pdf; r.pdf = null; void previous.destroy().catch(() => {}); }
    r.pages.clear(); r.document = null; r.pending = null; r.historical = null; r.findText = null;
    closeHelper(); el('reading-notes').hidden = true; el('reading-thumbnails').hidden = true;
    el('document-stage').classList.remove('reading-region-mode', 'reading-highlights-disabled');
  }
  async function open(pdf, name, session) {
    const generation = ++r.generation;
    r.pdf = pdf; r.rotation = 0; r.region = false; r.findQuery = ''; r.findResults = []; r.findText = null; r.lastScale = null;
    setHighlightsEnabled(r.highlightsEnabled);
    el('reading-region').setAttribute('aria-pressed', 'false');
    const result = await request('/documents', 'POST', { name });
    if (session !== state.documentSession || generation !== r.generation) return;
    r.document = result.document;
    await refresh();
    if (session !== state.documentSession || generation !== r.generation) return;
    r.filter = { document: r.document.id, color: '', category: '', query: '', annotated: false };
    r.tab = 'highlights';
    const first = await pdf.getPage(1);
    const firstViewport = first.getViewport({ scale: 1 });
    r.defaultSize = { width: firstViewport.width, height: firstViewport.height };
    state.pdf.scale = r.document.position?.scale || 1;
    state.pdf.fitWidth = r.document.position?.fitWidth !== false;
    el('reading-notes').hidden = false; el('reading-notes-toggle').setAttribute('aria-expanded', 'true');
    el('document-stage').innerHTML = '';
    r.pages.clear();
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const wrap = document.createElement('div'); wrap.className = 'reading-page'; wrap.dataset.readingPage = number;
      wrap.setAttribute('aria-label', `Page ${number} of ${pdf.numPages}`);
      wrap.innerHTML = `<canvas aria-hidden="true"></canvas><div class="reading-overlays"></div><div class="textLayer"></div><span class="reading-page-label">${number}</span>`;
      el('document-stage').append(wrap);
      r.pages.set(number, { number, wrap, canvas: wrap.querySelector('canvas'), layer: wrap.querySelector('.textLayer'), overlay: wrap.querySelector('.reading-overlays'), rendered: false, near: false });
    }
    layout(); renderWorkspace();
    r.observer = new IntersectionObserver(scheduleViewport, { root: el('document-stage'), rootMargin: '300px 0px' });
    for (const p of r.pages.values()) r.observer.observe(p.wrap);
    await navigate(r.document.position?.page || 1, state.pdf.fitWidth);
    if (result.changedDocuments.length) notify('This filename previously contained a different PDF. Its earlier highlights are preserved in the reading library.', true);
    else if (result.extractionChanged) notify('The PDF text extractor has changed. Existing highlights retain their original coordinates and quotes; reattach any selection that no longer matches.', true);
  }
  function layout() {
    if (!r.pdf || !r.defaultSize) return;
    if (state.pdf.fitWidth) {
      const baseWidth = r.rotation % 180 ? r.defaultSize.height : r.defaultSize.width;
      state.pdf.scale = Math.max(.25, Math.min(3, (el('document-stage').clientWidth - 48) / baseWidth));
    }
    for (const p of r.pages.values()) {
      const viewport = p.page?.getViewport({ scale: state.pdf.scale, rotation: (p.page.rotate + r.rotation) % 360 });
      const viewportChanged = viewport && (!p.viewport || p.viewport.scale !== viewport.scale || p.viewport.rotation !== viewport.rotation);
      p.viewport = viewport || null;
      const size = p.size || r.defaultSize;
      const width = viewport?.width || (r.rotation % 180 ? size.height : size.width) * state.pdf.scale;
      const height = viewport?.height || (r.rotation % 180 ? size.width : size.height) * state.pdf.scale;
      p.wrap.style.width = `${width}px`; p.wrap.style.height = `${height}px`;
      p.wrap.style.setProperty('--scale-factor', state.pdf.scale);
      p.wrap.style.setProperty('--user-unit', p.page?.userUnit || 1);
      p.wrap.style.setProperty('--total-scale-factor', state.pdf.scale * (p.page?.userUnit || 1));
      if (viewportChanged && (p.rendered || p.rendering || p.canvasReady)) {
        p.task?.cancel(); p.buildingTextLayer?.cancel(); void p.textReader?.cancel().catch(() => {});
        p.rendered = false; p.canvasReady = false; p.renderVersion = (p.renderVersion || 0) + 1;
      }
      if (p.near !== false) paintHighlights(p);
    }
    updatePageControls();
  }
  function renderPage(number, background = false) {
    const p = r.pages.get(number);
    if (!p || !r.pdf || p.rendered) return Promise.resolve();
    if (p.renderJob) { if (!background) p.renderJob.foreground = true; return p.renderJob.promise; }
    const job = { p, pdf: r.pdf, generation: r.generation, foreground: !background };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    p.renderJob = job; renderQueue.set(p, job);
    r.thumbnailTask?.task.cancel();
    void drainRenderQueue();
    return job.promise;
  }
  function wanted(job) {
    return job.generation === r.generation && job.pdf === r.pdf && r.pages.get(job.p.number) === job.p &&
      job.p.near !== false && (job.p.near || job.foreground && job.p.number === state.pdf.page);
  }
  async function drainRenderQueue() {
    if (rendering) return;
    rendering = true;
    try {
      // One canvas/text pipeline at a time, with the visible page ahead of prefetch.
      while ((renderQueue.size || thumbnailQueue.size) && !r.scrolling) {
        // Thumbnails share the same slot, behind full-size pages.
        if (!renderQueue.size) { await drawNextThumbnail(); await yieldUI(); continue; }
        const jobs = [...renderQueue.values()].sort((a, b) => Number(Boolean(b.p.visible)) - Number(Boolean(a.p.visible)) || Number(b.p.number === state.pdf.page) - Number(a.p.number === state.pdf.page) || Math.abs(a.p.number - state.pdf.page) - Math.abs(b.p.number - state.pdf.page));
        const job = jobs[0]; const p = job.p;
        renderQueue.delete(p);
        try {
          if (wanted(job)) await drawPage(job);
          if (wanted(job) && !p.rendered) { renderQueue.set(p, job); continue; }
          job.resolve();
        } catch (error) { job.reject(error); }
        finally { if (!renderQueue.has(p)) p.renderJob = null; }
        await yieldUI();
      }
    } finally { rendering = false; }
  }
  async function drawPage(job) {
    const { p, pdf, generation } = job;
    const version = p.renderVersion || 0;
    const current = () => wanted(job) && !r.scrolling && version === (p.renderVersion || 0);
    p.rendering = true; r.renderingPage = p;
    renderPhase('page-request', p.number);
    try {
      p.page ||= await pdf.getPage(p.number);
      p.needsCleanup = true;
      if (!current()) return;
      const base = p.page.getViewport({ scale: 1 });
      p.size = { width: base.width, height: base.height };
      const viewport = p.page.getViewport({ scale: state.pdf.scale, rotation: (p.page.rotate + r.rotation) % 360 });
      p.viewport = viewport;
      p.wrap.style.width = `${viewport.width}px`; p.wrap.style.height = `${viewport.height}px`;
      p.wrap.style.setProperty('--total-scale-factor', state.pdf.scale * (p.page.userUnit || 1));
      // Bound canvas memory at large zoom levels as well as on high-DPI screens.
      const outputScale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8 * 1024 * 1024 / (viewport.width * viewport.height)));
      if (!p.canvasReady) {
        renderPhase('canvas', p.number);
        p.canvas.width = Math.floor(viewport.width * outputScale); p.canvas.height = Math.floor(viewport.height * outputScale);
        p.canvas.style.width = `${viewport.width}px`; p.canvas.style.height = `${viewport.height}px`;
        // The first getContext call determines the backing store. Match PDF.js's
        // software-canvas default before it obtains this context again internally.
        const context = p.canvas.getContext('2d', { alpha: false, willReadFrequently: true });
        p.contextAttributes = context.getContextAttributes?.() || null;
        const task = p.task = p.page.render({ canvasContext: context, viewport, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0] });
        task.onContinue = continuation => { void yieldUI().then(() => { if (current()) continuation(); else if (p.task === task) task.cancel(); }); };
        await task.promise;
        if (!current()) return;
        p.task = null; p.canvasReady = true;
      }
      if (!current()) return;
      renderPhase('text-extraction', p.number);
      const content = p.content || await readPageText(p, current);
      if (!current()) return;
      p.content = content;
      if (!p.textLayer) {
        renderPhase('text-layer', p.number);
        const lib = await getPdfLibrary();
        if (!current()) return;
        p.layer.textContent = '';
        const layer = p.buildingTextLayer = new lib.TextLayer({ textContentSource: textChunks(p.content, current), container: p.layer, viewport });
        await layer.render();
        if (!current()) return;
        p.text = layer.textContentItemsStr.join('');
        let offset = 0;
        for (let i = 0; i < layer.textDivs.length; i += 1) {
          const span = layer.textDivs[i]; span.dataset.textStart = offset; span.dataset.textLength = layer.textContentItemsStr[i].length; offset += layer.textContentItemsStr[i].length;
          if (i % 100 === 99) { await yieldUI(); if (!current()) return; }
        }
        p.textLayer = layer;
      } else { renderPhase('text-update', p.number); p.textLayer.update({ viewport }); }
      p.rendered = true;
      renderPhase('highlights', p.number);
      paintHighlights(p);
    } catch (error) { if (error.name !== 'RenderingCancelledException' && error.name !== 'AbortException' && current()) throw error; }
    finally {
      renderPhase('idle');
      p.task = null; p.buildingTextLayer = null; p.rendering = false;
      if (r.renderingPage === p) r.renderingPage = null;
      if (!p.rendered && !p.textLayer) p.layer.textContent = '';
      if (generation !== r.generation) releasePage(p);
      else if (!r.scrolling) releaseDistantPages();
    }
  }
  function joinHighlightRects(rectangles, vertical = false) {
    // Work along the text's baseline, including when the viewer is rotated.
    const boxes = rectangles.map(rect => {
      const [x1, y1, x2, y2] = vertical ? [rect[1], rect[0], rect[3], rect[2]] : rect;
      return { left: Math.min(x1, x2), right: Math.max(x1, x2), top: Math.min(y1, y2), bottom: Math.max(y1, y2) };
    }).sort((a, b) => a.top - b.top || a.left - b.left);
    const lines = [];
    for (const box of boxes) {
      let index;
      while ((index = lines.findIndex(line => {
        const height = box.bottom - box.top;
        const lineHeight = line.bottom - line.top;
        const overlap = Math.min(box.bottom, line.bottom) - Math.max(box.top, line.top);
        const gap = Math.max(box.left - line.right, line.left - box.right, 0);
        return overlap >= Math.min(height, lineHeight) * .65 && Math.abs((box.top + box.bottom) - (line.top + line.bottom)) <= Math.max(height, lineHeight) * .6 && gap <= Math.min(height, lineHeight) * .9;
      })) !== -1) {
        const [line] = lines.splice(index, 1);
        box.left = Math.min(line.left, box.left); box.right = Math.max(line.right, box.right); box.top = Math.min(line.top, box.top); box.bottom = Math.max(line.bottom, box.bottom);
      }
      lines.push(box);
    }
    return lines.map(box => vertical ? [box.top, box.left, box.bottom, box.right] : [box.left, box.top, box.right, box.bottom]);
  }
  function setHighlightsEnabled(enabled) {
    r.highlightsEnabled = enabled;
    el('document-stage').classList.toggle('reading-highlights-disabled', !enabled);
    const toggle = el('reading-highlights-toggle');
    toggle.setAttribute('aria-pressed', String(enabled)); toggle.textContent = enabled ? 'Highlights on' : 'Highlights off';
    toggle.title = enabled ? 'Disable highlighting and hide highlights' : 'Enable highlighting and show highlights';
    el('reading-region').disabled = !enabled;
    if (!enabled) {
      closeHelper(); r.region = false;
      el('document-stage').classList.remove('reading-region-mode');
      el('reading-region').setAttribute('aria-pressed', 'false');
    }
    for (const p of r.pages.values()) paintHighlights(p);
  }
  function paintHighlights(p) {
    if (!p?.viewport || !r.document || p.near === false && !pageHasSelection(p)) return;
    p.overlay.innerHTML = ''; p.overlay.hidden = true;
    if (!r.highlightsEnabled) return;
    const highlights = live('highlights').filter(h => h.documentId === r.document.id && h.id !== r.historical?.highlight.id);
    if (r.historical?.highlight.documentId === r.document.id) highlights.push(r.historical.highlight);
    for (const h of highlights) {
      const rectangles = h.anchors.filter(a => a.page === p.number).flatMap(a => a.rects.map(rect => p.viewport.convertToViewportRectangle(rect)));
      for (const coords of h.kind === 'region' ? rectangles : joinHighlightRects(rectangles, r.rotation % 180 !== 0)) {
        const mark = document.createElement('div'); mark.className = `reading-mark${r.active === h.id ? ' active' : ''}${h.kind === 'region' ? ' region' : ''}`; mark.dataset.color = highlightColor(h); mark.dataset.highlightId = h.id;
        Object.assign(mark.style, { left: `${Math.min(coords[0], coords[2])}px`, top: `${Math.min(coords[1], coords[3])}px`, width: `${Math.abs(coords[2] - coords[0])}px`, height: `${Math.abs(coords[3] - coords[1])}px` });
        p.overlay.append(mark);
        p.overlay.hidden = false;
      }
    }
  }
  function updatePageControls() {
    if (!r.pdf) return;
    el('pdf-page-input').value = state.pdf.page;
    el('pdf-page-count').textContent = `/ ${r.pdf.numPages}`;
    el('pdf-zoom-value').textContent = `${Math.round(state.pdf.scale * 100)}%`;
    el('pdf-prev').disabled = state.pdf.page <= 1; el('pdf-next').disabled = state.pdf.page >= r.pdf.numPages;
    el('pdf-fit').classList.toggle('active', state.pdf.fitWidth);
  }
  async function navigate(number, fitWidth = state.pdf.fitWidth) {
    if (!r.pdf) return;
    const changed = r.lastScale !== state.pdf.scale || state.pdf.fitWidth !== fitWidth || r.lastRotation !== r.rotation;
    state.pdf.fitWidth = fitWidth;
    const page = Math.max(1, Math.min(r.pdf.numPages, Number(number) || 1));
    if (changed || fitWidth) layout();
    r.lastScale = state.pdf.scale; r.lastRotation = r.rotation;
    state.pdf.page = page;
    const p = r.pages.get(page);
    p.wrap.scrollIntoView({ block: 'start' });
    updateViewport();
    await renderPage(page);
    queueNearbyPages();
    updatePageControls(); schedulePosition();
  }
  function schedulePosition() { r.positionDirty = true; clearTimeout(r.saveTimer); r.saveTimer = setTimeout(() => { void savePosition(); }, 900); }
  async function savePosition() {
    clearTimeout(r.saveTimer);
    if (!r.document || !r.pdf || !r.positionDirty) return;
    r.positionDirty = false;
    const document = r.document;
    try { const updated = await request(`/documents/${document.id}`, 'PATCH', { revision: document.revision, position: { page: state.pdf.page, scale: state.pdf.scale, fitWidth: state.pdf.fitWidth } }); if (r.document?.id === document.id) r.document = updated; }
    catch (error) { if (error.code === 'reading-conflict' && r.document?.id === document.id) r.document = await request(`/documents/${document.id}`); else notify(error.message); }
  }
  function textOffset(range, node, offset, end) {
    const span = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node).closest?.('[data-text-start]');
    if (!span) return end ? range.text.length : 0;
    const prefix = document.createRange(); prefix.setStart(span, 0); prefix.setEnd(node, offset);
    return Number(span.dataset.textStart) + prefix.toString().length;
  }
  function captureSelection() {
    if (!r.document || !r.highlightsEnabled || r.region || state.panel !== 'document') return;
    if (hasUnsavedHelperDraft()) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const begin = (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer).closest('.textLayer');
    const end = (range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : range.endContainer).closest('.textLayer');
    if (!begin || !end) return;
    const first = Number(begin.parentElement.dataset.readingPage); const last = Number(end.parentElement.dataset.readingPage);
    const selectedAnchors = [];
    for (let number = first; number <= last; number += 1) {
      const p = r.pages.get(number);
      if (!p?.textLayer || !p.viewport) { notify('Wait for the selected pages to load, then select again.'); return; }
      const local = document.createRange();
      local.selectNodeContents(p.layer);
      if (number === first) local.setStart(range.startContainer, range.startOffset);
      if (number === last) local.setEnd(range.endContainer, range.endOffset);
      const start = number === first ? textOffset(p, range.startContainer, range.startOffset, false) : 0;
      const finish = number === last ? textOffset(p, range.endContainer, range.endOffset, true) : p.text.length;
      const exact = p.text.slice(start, finish);
      if (!exact.trim()) continue;
      const box = p.wrap.getBoundingClientRect();
      const rects = [...local.getClientRects()].filter(b => b.width > 1 && b.height > 1 && b.top >= box.top - 1 && b.bottom <= box.bottom + 1).map(b => [...p.viewport.convertToPdfPoint(b.left - box.left, b.top - box.top), ...p.viewport.convertToPdfPoint(b.right - box.left, b.bottom - box.top)]);
      if (rects.length) selectedAnchors.push({ page: number, label: String(number), rects, exact, prefix: p.text.slice(Math.max(0, start - 220), start), suffix: p.text.slice(finish, finish + 220), start, end: finish });
    }
    if (!selectedAnchors.length) return;
    r.pending = { documentId: r.document.id, kind: 'text', anchors: selectedAnchors, text: selectedAnchors.map(a => a.exact).join('\n'), color: 'yellow', categories: [] };
    const bounds = range.getBoundingClientRect(); showSelectionToolbar(bounds.left, bounds.bottom);
  }
  function showSelectionToolbar(left, top, highlightId = null) {
    if (!r.highlightsEnabled) return;
    if (activeHelper()) closeForm();
    r.helper = { highlightId, expanded: false, anchor: { left, top }, busy: false };
    el('reading-helper-details').hidden = true;
    el('reading-helper-body').innerHTML = '';
    el('reading-helper-error').textContent = '';
    el('reading-selection-toolbar').classList.remove('expanded');
    document.querySelectorAll('[data-selection-color]').forEach(input => { input.checked = Boolean(highlightId && record('highlights', highlightId)?.color === input.dataset.selectionColor); });
    const toolbar = el('reading-selection-toolbar'); toolbar.hidden = false;
    positionHelper();
  }
  function positionHelper() {
    if (!r.helper) return;
    const { left, top } = r.helper.anchor;
    const toolbar = el('reading-selection-toolbar');
    toolbar.style.left = `${Math.max(8, Math.min(left, window.innerWidth - toolbar.offsetWidth - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(window.innerHeight - toolbar.offsetHeight - 12, top + 8))}px`;
  }
  function openHighlightHelper(id, left, top) {
    const h = record('highlights', id);
    if (!r.highlightsEnabled || !h || h.deletedAt) return;
    if (hasUnsavedHelperDraft()) { notify('Save your draft before opening another highlight.'); return; }
    r.pending = null; r.active = id;
    showSelectionToolbar(left, top, id);
    renderWorkspace(); for (const p of r.pages.values()) paintHighlights(p);
  }
  async function saveSelection(color = 'yellow', next = '') {
    if ((!r.pending && !r.helper?.highlightId) || !r.highlightsEnabled) return;
    if (!colors.includes(color)) throw new Error('Blue is reserved for AI assistance.');
    if (hasUnsavedHelperDraft()) { notify('Save your draft before choosing another highlight action.'); return; }
    if (!r.helper) showSelectionToolbar(24, 80);
    const helper = r.helper;
    if (helper.busy) return;
    helper.busy = true;
    if (next) {
      helper.expanded = true;
      for (const action of ['wiki', 'ask', 'note', 'connect']) el(`reading-selection-${action}`).setAttribute('aria-expanded', String(action === next));
      dialog({ wiki: 'Add to wiki', ask: 'Ask AI', note: 'Add note', connect: 'Connect to related knowledge' }[next], '<p role="status">Loading…</p>');
    }
    try {
      let highlight = helper.highlightId ? record('highlights', helper.highlightId) : null;
      if (highlight?.deletedAt) throw new Error('This highlight was deleted.');
      if (!highlight) highlight = await request('/highlights', 'POST', { ...r.pending, color });
      else if (!next && highlight.color !== color) highlight = await request(`/highlights/${highlight.id}`, 'PATCH', { revision: highlight.revision, color });
      if (r.helper !== helper) return highlight;
      helper.highlightId = highlight.id;
      r.active = highlight.id; r.pending = null;
      window.getSelection()?.removeAllRanges();
      await refresh(); renderWorkspace(); for (const p of r.pages.values()) paintHighlights(p);
      if (r.helper !== helper) return highlight;
      if (next === 'note') editHighlight(highlight.id, true);
      if (next === 'ask' || next === 'wiki') {
        r.selected = new Set([highlight.id]); r.annotationIds.clear(); r.assistanceIds.clear(); r.discoveryIds.clear();
        if (next === 'ask') await assistanceDialog(); else await newArtifactDialog(true);
      }
      if (next === 'connect') await connectKnowledge(highlight.id);
      positionHelper();
      return highlight;
    } finally {
      helper.busy = false;
    }
  }
  async function openHighlight(id, options = {}) {
    await refresh();
    const query = new URLSearchParams(options);
    const passage = await request(`/passages/${id}?${query}`); const h = passage.highlight;
    r.active = id;
    const doc = passage.document;
    if (!doc.available) { showPanel('reading'); renderWorkspace(); throw new Error('The original PDF is missing or changed. Your passage and notes are preserved in the library.'); }
    if (r.document?.id !== doc.id || !r.pdf) await openRawFile(doc.currentName, 'pdf', {}, false);
    else showPanel('document');
    r.active = id; r.filter.document = doc.id; r.historical = passage.historical ? passage : null;
    history.replaceState(null, '', `/#reading/${doc.id}/${id}?revision=${h.revision}`);
    await navigate(h.anchors[0].page, state.pdf.fitWidth);
    for (const p of r.pages.values()) paintHighlights(p);
    renderWorkspace();
  }
  async function route(hashValue = location.hash) {
    try { return await routeToPassage(hashValue); }
    catch (error) { showPanel('reading'); notify(error.message, true); return true; }
  }
  async function routeToPassage(hashValue) {
    if (hashValue === '#reading') { showPanel('reading'); return true; }
    const match = /^#reading\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]*)(?:\?.*)?$/.exec(hashValue);
    if (match) {
      if (match[2]) { const revision = new URLSearchParams(hashValue.split('?')[1]).get('revision'); await openHighlight(match[2], { documentId: match[1], ...(revision ? { revision } : {}) }); }
      else {
        const doc = await request(`/documents/${match[1]}`);
        if (!doc.available) throw new Error('The original source file is missing or changed.');
        await openRawFile(doc.currentName, 'pdf', {}, false);
        await navigate(Number(new URLSearchParams(hashValue.split('?')[1]).get('page')) || 1);
      }
      return true;
    }
    if (hashValue.startsWith('#file/') && hashValue.includes('?')) {
      const [file, query] = hashValue.slice(6).split('?'); const name = decodeURIComponent(file);
      const files = await api.getRawList(); const source = files.find(f => f.name === name);
      if (source) { await openRawFile(name, source.ext, source, false); if (r.pdf) await navigate(Number(new URLSearchParams(query).get('page')) || 1); return true; }
    }
    return false;
  }

  async function library() {
    closeHelper();
    await refresh(); r.filter = { document: '', color: '', category: '', query: '', annotated: false }; r.tab = 'highlights'; renderWorkspace();
    if (state.panel === 'reading') history.replaceState(null, '', '/#reading');
  }
  function host() { return state.panel === 'reading' ? el('reading-library-content') : el('reading-notes'); }
  function assistanceFor(h) {
    return live('tasks').filter(t => t.status === 'completed' && t.response && !t.artifactId && !['summary', 'synthesis', 'artifact', 'wiki-note'].includes(t.action) && t.snapshot.highlights.some(source => source.id === h.id && source.documentId === h.documentId && source.text === h.text && JSON.stringify(source.anchors) === JSON.stringify(h.anchors)));
  }
  function highlightColor(h) { return assistanceFor(h).length ? 'blue' : h.color === 'blue' ? 'yellow' : h.color; }
  function filteredHighlights() {
    return live('highlights').filter(h => (!r.filter.document || h.documentId === r.filter.document) && (!r.filter.color || highlightColor(h) === r.filter.color) && (!r.filter.category || h.categories.includes(r.filter.category)) && (!r.filter.annotated || live('annotations').some(a => a.highlightId === h.id)) && (!r.filter.query || `${h.text} ${h.categories.join(' ')} ${live('annotations').filter(a => a.highlightId === h.id).map(a => a.text).join(' ')} ${assistanceFor(h).map(t => `${t.question} ${t.response}`).join(' ')}`.toLowerCase().includes(r.filter.query.toLowerCase())));
  }
  function renderWorkspace() {
    if (!r.data) return;
    const target = host();
    const focused = target.contains(document.activeElement) ? document.activeElement : null;
    const focusId = focused?.id; const caret = focused?.selectionStart;
    const categories = [...new Set(live('highlights').flatMap(h => h.categories))].sort();
    const highlights = filteredHighlights();
    const inLibrary = state.panel === 'reading';
    const header = `<div class="reading-section-title"><h3>${state.panel === 'reading' ? 'Your reading workspace' : 'Active reading'}</h3></div>
      ${inLibrary ? `<nav class="reading-nav" aria-label="Reading workspace views">${['highlights', 'assistance', 'collections', 'artifacts'].map(tab => `<button type="button" data-reading-tab="${tab}" aria-selected="${r.tab === tab}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join('')}</nav>` : ''}
      <div class="reading-filters"><select id="reading-filter-document" aria-label="Filter by paper"><option value="">All papers</option>${r.data.documents.map(d => `<option value="${d.id}" ${d.id === r.filter.document ? 'selected' : ''}>${e(d.currentName || d.aliases[0])}${d.available ? '' : ' (source unavailable)'}</option>`).join('')}</select><select id="reading-filter-color" aria-label="Filter by colour"><option value="">All colours</option>${['yellow', 'green', 'blue', 'pink'].map(c => `<option value="${c}" ${r.filter.color === c ? 'selected' : ''}>${colorName(c)}</option>`).join('')}</select><select id="reading-filter-category" aria-label="Filter by category"><option value="">All categories</option>${categories.map(c => `<option ${r.filter.category === c ? 'selected' : ''}>${e(c)}</option>`).join('')}</select></div>
      <div class="reading-filters"><input id="reading-filter-query" type="search" value="${e(r.filter.query)}" placeholder="Filter passages and notes" aria-label="Filter passages and notes"/></div>
      <label class="reading-check"><input type="checkbox" id="reading-filter-annotated" ${r.filter.annotated ? 'checked' : ''}/>With researcher comments</label>
      ${inLibrary ? `<div class="reading-actions"><button type="button" data-reading-action="select-visible">Select shown (${highlights.length})</button><button type="button" data-reading-action="clear-selection">Clear selection</button>${r.undo ? '<button type="button" data-reading-action="undo">Undo deletion</button>' : ''}</div>
      <p class="reading-muted">${selectedHighlights().length} passages selected across ${new Set(selectedHighlights().map(h => h.documentId)).size} papers. Comments and earlier AI responses are included only when checked.</p>
      <div class="reading-actions"><button type="button" data-reading-action="assist">Ask AI</button><button type="button" data-reading-action="search">Search &amp; discover</button><button type="button" data-reading-action="new-artifact">Create artifact</button><button type="button" data-reading-action="add-collection">Add to collection</button></div>` : ''}`;
    let body = '';
    if (!inLibrary || r.tab === 'highlights') body = highlights.length ? highlights.map(h => highlightCard(h, inLibrary)).join('') : '<div class="reading-empty">No highlights match. Select text in a PDF to highlight it, add a note, or ask AI.</div>';
    if (inLibrary && r.tab === 'assistance') body = live('tasks').filter(t => !r.filter.document || t.snapshot.highlights.some(h => h.documentId === r.filter.document)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(taskCard).join('') || '<div class="reading-empty">AI assistance appears here when you request it. Select passages and choose Ask AI.</div>';
    if (inLibrary && r.tab === 'collections') body = `<div class="reading-actions"><button type="button" data-reading-action="new-collection">New collection</button></div>${live('collections').map(c => `<article class="reading-card"><h3>${e(c.name)}</h3><p class="reading-muted">${c.highlightIds.filter(id => live('highlights').some(h => h.id === id)).length} passages</p><p>${e(c.notes)}</p><div class="reading-actions"><button type="button" data-reading-collection="${c.id}">Organise &amp; compare</button><button type="button" data-reading-collection-select="${c.id}">Select members</button></div></article>`).join('') || '<div class="reading-empty">Organise passages from different papers to compare methods, assumptions, and evidence.</div>'}`;
    if (inLibrary && r.tab === 'artifacts') body = live('artifacts').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(a => `<article class="reading-card"><h3>${e(a.title)}</h3><p class="reading-muted">${e(artifactNames[a.type])} · ${a.snapshot.highlights.length} selected passages${a.outdated ? ' · Notes have changed since capture' : ''}</p><div class="reading-actions"><button type="button" data-reading-artifact="${a.id}">Review draft</button>${a.publications.map(p => `<a href="/wiki/${e(p.page)}">Published page</a>`).join('')}</div></article>`).join('') || '<div class="reading-empty">Create an artifact from selected highlights. You can write it yourself or request an AI draft, then review it before publishing.</div>';
    const historical = r.historical ? `<article class="reading-card"><strong>Preserved selection · revision ${r.historical.highlight.revision}</strong><p class="reading-muted">This is the original source selection. Its current highlight has changed or was deleted.</p><blockquote>${e(r.historical.highlight.text || 'Visual selection')}</blockquote>${r.historical.annotations.map(a => `<p class="reading-comment">${e(a.text)}</p>`).join('')}</article>` : '';
    target.innerHTML = historical + header + body + (inLibrary ? `<div class="reading-actions"><a class="btn" href="/api/reading/export" download>Export private backup</a><button type="button" data-reading-action="import">Import backup</button><input type="file" id="reading-backup-input" accept="application/json,.json" hidden/></div>` : r.undo ? '<div class="reading-actions"><button type="button" data-reading-action="undo">Undo deletion</button></div>' : '');
    if (focusId && el(focusId)) { el(focusId).focus(); if (typeof caret === 'number' && el(focusId).setSelectionRange) { try { el(focusId).setSelectionRange(caret, caret); } catch { /* select elements do not expose text selection */ } } }
    for (const node of target.querySelectorAll('.reading-task-response')) typesetMath(node);
    if (r.active) target.querySelector(`[data-reading-card="${r.active}"]`)?.classList.add('active');
  }
  function highlightCard(h, controls = true) {
    const comments = live('annotations').filter(a => a.highlightId === h.id);
    const relationships = live('relationships').filter(link => link.from === h.id || link.targetType === 'highlight' && link.target === h.id);
    const color = highlightColor(h);
    return `<article class="reading-card ${h.id === r.active ? 'active' : ''}" data-reading-card="${h.id}" tabindex="0" aria-label="Highlight from ${e(docName(h.documentId))}">
      <div class="reading-card-head">${controls ? `<input type="checkbox" data-reading-select="${h.id}" ${r.selected.has(h.id) ? 'checked' : ''} aria-label="Select passage from ${e(docName(h.documentId))}"/>` : ''}<span class="reading-color-dot" data-color="${color}" title="${colorName(color)}"></span><a href="/#reading/${h.documentId}/${h.id}">${e(docName(h.documentId))} · p. ${h.anchors.map(a => e(a.page)).join(', ')}</a></div>
      ${h.image ? `<img src="${h.image}" alt="Selected source region"/>` : ''}<blockquote>${e(h.text || 'Visual region - add a transcription or comment.')}</blockquote>
      ${h.categories.map(c => `<span class="reading-tag">${e(c)}</span>`).join('')}
      ${comments.map(a => `<div class="reading-comment"><small>Researcher comment</small>${e(a.text)}${controls ? `<label class="reading-check"><input type="checkbox" data-reading-annotation="${a.id}" ${r.annotationIds.has(a.id) ? 'checked' : ''}/>Include this comment in selected inputs</label>` : ''}</div>`).join('')}
      ${assistanceFor(h).map(t => `<div class="reading-comment reading-ai-comment"><small>AI-generated comment · ${e(actions[t.action] || 'Reading assistance')}${t.snapshot.highlights.length > 1 ? ' · Shared response for selected passages' : ''}</small>${t.question ? `<p class="reading-ai-question">${e(t.question)}</p>` : ''}<div class="reading-task-response md-body">${safeMarkdown(t.response, t.snapshot)}</div>${controls ? `<label class="reading-check"><input type="checkbox" data-reading-assistance="${t.id}" ${r.assistanceIds.has(t.id) ? 'checked' : ''}/>Include this AI explanation as interpretation</label>` : ''}</div>`).join('')}
      ${relationships.map(link => `<div class="reading-muted">${e(link.relation)}: ${link.targetType === 'wiki' ? `<a href="/wiki/${e(link.target)}">${e(link.target)}</a>` : `<a href="/#reading/${record('highlights', link.from === h.id ? link.target : link.from)?.documentId}/${link.from === h.id ? link.target : link.from}">Related passage</a>`}</div>`).join('')}
      <div class="reading-actions">${controls ? `<button type="button" data-reading-edit="${h.id}">Edit / comment</button><button type="button" data-reading-link="${h.id}">Link</button><button type="button" data-reading-connect="${h.id}">Connect to related knowledge</button><button type="button" data-reading-copy="${h.id}">Copy link</button>${r.pending ? `<button type="button" data-reading-reattach="${h.id}">Reattach to selection</button>` : ''}` : ''}<button type="button" data-reading-delete="${h.id}" aria-label="Delete highlight from ${e(docName(h.documentId))}">Delete</button></div></article>`;
  }
  function taskCard(t) {
    return `<article class="reading-card"><div class="reading-section-title"><strong>${e(actions[t.action] || artifactNames[t.action] || 'Artifact draft')}</strong><span class="reading-muted">${e(t.status)}</span></div><p class="reading-muted">${e(t.question || 'Selected-passage assistance')} · ${e(t.model || '')}</p>${t.error ? `<p>${e(t.error)}</p>` : ''}${t.response ? `<div class="reading-task-response md-body">${safeMarkdown(t.response, t.snapshot)}</div><label class="reading-check"><input type="checkbox" data-reading-assistance="${t.id}" ${r.assistanceIds.has(t.id) ? 'checked' : ''}/>Include this AI explanation as interpretation</label>` : ''}<div class="reading-actions"><button type="button" data-reading-task-inputs="${t.id}">Inspect preserved inputs</button>${['queued', 'running'].includes(t.status) ? `<button type="button" data-reading-task-stop="${t.id}">Stop</button><button type="button" data-reading-task-watch="${t.id}">View progress</button>` : ''}${['failed', 'cancelled', 'interrupted'].includes(t.status) ? `<button type="button" data-reading-task-retry="${t.id}">Retry original inputs</button>` : ''}</div></article>`;
  }
  function snapshotView(snapshot) {
    const passages = snapshot.highlights.map(h => `<article class="reading-card"><a href="/#reading/${h.documentId}/${h.id}?revision=${h.revision}">${e(snapshot.documents.find(d => d.id === h.documentId)?.aliases[0])} · p. ${h.anchors.map(a => e(a.page)).join(', ')}</a>${h.image && snapshot.includeImages ? `<p><img src="${h.image}" alt="Selected visual input"/></p>` : ''}<blockquote>${e(h.text || '(Visual region; no transcription)')}</blockquote>${snapshot.includeContext ? `<details><summary>Nearby context</summary><p>${h.anchors.map(a => e(a.prefix + a.exact + a.suffix)).join('<br>')}</p></details>` : ''}${snapshot.annotations.filter(a => a.highlightId === h.id).map(a => `<div class="reading-comment">Researcher interpretation: ${e(a.text)}</div>`).join('')}</article>`).join('');
    return `<p class="reading-muted">Preserved inputs${snapshot.capturedAt ? ` captured ${e(snapshot.capturedAt)}` : ''}. Selected annotations may contain private research. Only these inputs will be used.</p>${passages}${snapshot.wikiPages.map(w => `<details class="reading-card"><summary>Wiki page: ${e(w.name)}</summary><pre class="reading-diff">${e(w.content)}</pre></details>`).join('')}${snapshot.discoveries.map(d => `<article class="reading-card"><strong>${e(d.source.title)}</strong><p>Abstract only; full text not verified.</p><p>${e(d.source.abstract)}</p></article>`).join('')}${snapshot.responses.map(t => `<details><summary>Earlier AI explanation (not evidence)</summary><pre class="reading-diff">${e(t.response)}</pre></details>`).join('')}`;
  }
  function previewSnapshot(payload) {
    return { capturedAt: '', highlights: payload.highlightIds.map(id => record('highlights', id)), annotations: payload.annotationIds.map(id => record('annotations', id)), documents: [...new Set(payload.highlightIds.map(id => record('highlights', id).documentId))].map(id => record('documents', id)), discoveries: payload.discoveryIds.map(id => record('discoveries', id)), responses: payload.assistanceIds.map(id => record('tasks', id)), wikiPages: [], includeContext: payload.includeContext, includeImages: payload.includeImages };
  }
  function editHighlight(id, focusNote = false) {
    const h = record('highlights', id); const comments = live('annotations').filter(a => a.highlightId === id);
    dialog(focusNote ? 'Add note' : 'Edit passage and comments', `${focusNote ? '' : `<p class="reading-muted">${e(docName(h.documentId))} · p. ${h.anchors.map(a => e(a.page)).join(', ')}</p>`}<blockquote>${e(h.text || 'Selected visual region')}</blockquote>${focusNote ? '' : `<label class="reading-field">Highlight colour<select id="reading-edit-color">${colors.map(c => `<option ${c === h.color ? 'selected' : ''}>${c}</option>`).join('')}</select></label>`}<label class="reading-field">Categories (comma separated, optional)<input id="reading-edit-categories" value="${e(h.categories.join(', '))}" maxlength="1000"/></label>${h.kind === 'region' ? `<label class="reading-field">Researcher transcription<textarea id="reading-edit-transcription">${e(h.text)}</textarea></label>` : ''}${comments.map(a => `<label class="reading-field">Researcher comment<textarea data-edit-comment="${a.id}">${e(a.text)}</textarea></label><label class="reading-check"><input type="checkbox" data-delete-comment="${a.id}"/>Delete this comment</label>`).join('')}<label class="reading-field">Add a personal comment<textarea id="reading-new-comment" placeholder="Interpretations, questions, or caveats..."></textarea></label><div class="reading-actions"><button type="button" id="reading-save-highlight">Save passage and comments</button></div>`);
    const helper = activeHelper(); const viewVersion = helper?.viewVersion;
    el('reading-save-highlight').addEventListener('click', guard(async () => {
      await request(`/highlights/${id}`, 'PATCH', { revision: h.revision, ...(focusNote ? {} : { color: el('reading-edit-color').value }), categories: el('reading-edit-categories').value.split(',').map(c => c.trim()).filter(Boolean), ...(h.kind === 'region' ? { text: el('reading-edit-transcription').value } : {}) });
      for (const a of comments) {
        if (document.querySelector(`[data-delete-comment="${a.id}"]`).checked) await request(`/annotations/${a.id}`, 'DELETE', { revision: a.revision });
        else if (document.querySelector(`[data-edit-comment="${a.id}"]`).value !== a.text) await request(`/annotations/${a.id}`, 'PATCH', { revision: a.revision, highlightId: id, text: document.querySelector(`[data-edit-comment="${a.id}"]`).value });
      }
      if (el('reading-new-comment').value.trim()) await request('/annotations', 'POST', { highlightId: id, text: el('reading-new-comment').value });
      await refresh(); renderWorkspace(); for (const p of r.pages.values()) paintHighlights(p);
      if (!helper || activeHelper() === helper && helper.viewVersion === viewVersion) closeForm();
      notify('Passage and comments saved locally.');
    }));
    if (focusNote) el('reading-new-comment').focus();
  }
  async function linkDialog(id) {
    const wikiPages = await api.getWikiList(); const related = live('highlights').filter(h => h.id !== id);
    dialog('Connect this passage', `<label class="reading-field">Existing wiki page<select id="reading-link-wiki"><option value="">Choose a wiki page</option>${wikiPages.filter(w => !['index', 'log'].includes(w.name)).map(w => `<option>${e(w.name)}</option>`).join('')}</select></label><label class="reading-field">Or another highlighted passage<select id="reading-link-highlight"><option value="">Choose a passage</option>${related.map(h => `<option value="${h.id}">${e(docName(h.documentId))}: ${e(h.text.slice(0, 110) || 'Visual selection')}</option>`).join('')}</select></label><label class="reading-field">Relationship<select id="reading-link-relation"><option>related</option><option>supports</option><option>competes</option><option>qualifies</option></select></label><label class="reading-field">Reason (optional)<textarea id="reading-link-note"></textarea></label><div class="reading-actions"><button type="button" id="reading-link-save">Save connection</button></div>${live('relationships').filter(link => link.from === id).map(link => `<p>${e(link.relation)} → ${e(link.target)} <button type="button" data-unlink="${link.id}">Remove</button></p>`).join('')}`);
    el('reading-link-save').addEventListener('click', guard(async () => {
      const wiki = el('reading-link-wiki').value; const highlight = el('reading-link-highlight').value;
      if (Boolean(wiki) === Boolean(highlight)) throw new Error('Choose one wiki page or one passage.');
      await request('/relationships', 'POST', { from: id, target: wiki || highlight, targetType: wiki ? 'wiki' : 'highlight', relation: el('reading-link-relation').value, note: el('reading-link-note').value });
      await refresh(); renderWorkspace(); closeForm();
    }));
    for (const button of document.querySelectorAll('[data-unlink]')) button.addEventListener('click', guard(async () => { const link = record('relationships', button.dataset.unlink); await request(`/relationships/${link.id}`, 'DELETE', { revision: link.revision }); await refresh(); await linkDialog(id); renderWorkspace(); }));
  }
  async function connectKnowledge(id) {
    const helper = activeHelper();
    const h = record('highlights', id);
    const token = r.connectionRequest = (r.connectionRequest || 0) + 1;
    dialog('Connect to related knowledge', `<blockquote>${e(h.text || 'Visual selection')}</blockquote><p id="reading-connections-status" role="status">Looking for a related wiki page, then arXiv and NASA ADS if needed…</p><div id="reading-connections-results"></div>`);
    const result = await request('/connections', 'POST', { highlightId: id, revision: h.revision });
    if (token !== r.connectionRequest || helper && activeHelper() !== helper || !el('reading-connections-results')) return;
    el('reading-connections-status').textContent = result.wiki.length ? 'Related wiki knowledge found.' : result.papers.length ? 'No close wiki match. Related papers from arXiv / NASA ADS:' : 'No close wiki match or directly related paper found. Try a more specific passage or add a transcription.';
    const container = el('reading-connections-results');
    container.innerHTML = result.wiki.map(page => `<article class="reading-card"><h3><a class="wiki-link" data-page="${e(page.name)}" href="${e(page.url)}">${e(page.title)}</a></h3><p>${e(page.text)}</p><p class="reading-muted">Matching concepts: ${e(page.matchedTerms.join(', '))}</p><div class="reading-actions"><button type="button" data-connect-wiki="${e(page.name)}">Connect this page</button></div></article>`).join('') + result.papers.map(paper => `<article class="reading-card"><h3><a href="${e(paper.source.recordUrl)}" target="_blank" rel="noopener noreferrer">${e(paper.source.title)}</a></h3><p class="reading-muted">${e(paper.source.provider || 'arXiv / NASA ADS')}${paper.source.year ? ` · ${e(paper.source.year)}` : ''} · Abstract only; full text not verified</p><p>${e(paper.source.abstract)}</p><p class="reading-muted">Matching concepts: ${e(paper.matchedTerms.join(', '))}</p><div class="reading-actions"><button type="button" data-connect-paper="${paper.id}">Save paper reference</button></div></article>`).join('') + result.warnings.map(warning => `<p class="reading-muted">${e(warning)}</p>`).join('');
    container.addEventListener('click', guard(async event => {
      const button = event.target.closest('button'); if (!button || button.disabled) return;
      button.disabled = true;
      try {
        if (button.dataset.connectWiki) {
          await request('/relationships', 'POST', { from: id, targetType: 'wiki', target: button.dataset.connectWiki, relation: 'related', note: 'Connected from the highlighted passage.' });
        } else if (button.dataset.connectPaper) {
          const paper = result.papers.find(p => p.id === button.dataset.connectPaper);
          await request('/annotations', 'POST', { highlightId: id, text: `Related paper: ${paper.source.title}\n${paper.source.recordUrl}\nAbstract-only reference; full text not verified.` });
        } else return;
        await refresh(); renderWorkspace(); button.textContent = 'Connected';
      } catch (error) { button.disabled = false; throw error; }
    }));
  }
  function collectionDialog(id = null, add = false) {
    const c = id ? record('collections', id) : { name: '', notes: '', highlightIds: [], groups: {} };
    const members = [...new Set([...c.highlightIds, ...(add ? [...r.selected] : [])])].map(id => record('highlights', id)).filter(h => h && !h.deletedAt);
    dialog(id ? 'Organise and compare collection' : 'New reading collection', `<label class="reading-field">Name<input id="reading-collection-name" value="${e(c.name)}" maxlength="120"/></label><label class="reading-field">Collection notes<textarea id="reading-collection-notes">${e(c.notes)}</textarea></label><div class="reading-actions"><button type="button" id="reading-collection-save">Save collection</button>${id ? '<button type="button" id="reading-collection-delete">Delete collection</button>' : ''}</div><p class="reading-muted">Order passages and group them by theme. Comparisons remain your interpretation until you request AI assistance.</p><div style="overflow:auto"><table class="reading-evidence-table"><thead><tr><th>Source and passage</th><th>Researcher categories and comments</th><th>Theme and order</th></tr></thead><tbody id="reading-collection-members">${members.map(h => `<tr data-collection-member="${h.id}"><td><a href="/#reading/${h.documentId}/${h.id}">${e(docName(h.documentId))}, p. ${h.anchors.map(a => e(a.page)).join(', ')}</a><p>${e(h.text || 'Visual region')}</p></td><td>${e(h.categories.join(', '))}${live('annotations').filter(a => a.highlightId === h.id).map(a => `<p>${e(a.text)}</p>`).join('')}</td><td><label class="reading-field">Theme<input data-collection-theme="${h.id}" value="${e(c.groups[h.id] || '')}" maxlength="120"/></label><div class="reading-actions"><button type="button" data-member-up="${h.id}" aria-label="Move passage up">Up</button><button type="button" data-member-down="${h.id}" aria-label="Move passage down">Down</button><button type="button" data-member-remove="${h.id}">Remove</button></div></td></tr>`).join('')}</tbody></table></div>`);
    el('reading-collection-members').addEventListener('click', event => {
      const up = event.target.closest('[data-member-up]'); const down = event.target.closest('[data-member-down]'); const remove = event.target.closest('[data-member-remove]');
      const row = event.target.closest('tr'); if (!row) return;
      if (up && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
      if (down && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
      if (remove) row.remove();
    });
    el('reading-collection-save').addEventListener('click', guard(async () => {
      const rows = [...el('reading-collection-members').querySelectorAll('[data-collection-member]')];
      await request(`/collections${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', { name: el('reading-collection-name').value, notes: el('reading-collection-notes').value, highlightIds: rows.map(row => row.dataset.collectionMember), groups: Object.fromEntries(rows.map(row => [row.dataset.collectionMember, row.querySelector('input').value])), revision: c.revision });
      await refresh(); r.tab = 'collections'; renderWorkspace(); el('reading-dialog').close();
    }));
    el('reading-collection-delete')?.addEventListener('click', guard(async () => { await request(`/collections/${id}`, 'DELETE', { revision: c.revision }); await refresh(); renderWorkspace(); el('reading-dialog').close(); }));
  }
  function addCollectionDialog() {
    if (!selectedHighlights().length) throw new Error('Select some passages first.');
    dialog('Add selected passages to a collection', `<label class="reading-field">Collection<select id="reading-add-collection"><option value="">Create a new collection</option>${live('collections').map(c => `<option value="${c.id}">${e(c.name)}</option>`).join('')}</select></label><div class="reading-actions"><button type="button" id="reading-add-collection-go">Continue</button></div>`);
    el('reading-add-collection-go').addEventListener('click', () => collectionDialog(el('reading-add-collection').value || null, true));
  }
  async function backlinks(page, container) {
    const links = await request(`/backlinks/${encodeURIComponent(page)}`);
    if (!links.length || state.currentPage !== page) return;
    const section = document.createElement('section'); section.className = 'reading-card';
    section.innerHTML = `<h3>Private reading connections</h3><p class="reading-muted">These links are saved locally and are not part of the wiki page.</p>${links.map(link => `<a class="reading-source-link" href="/#reading/${link.highlight.documentId}/${link.highlight.id}">${e(link.highlight.text.slice(0, 180) || 'Visual selection')} (${e(link.relation)})</a>`).join('')}`;
    container.append(section);
  }
  async function findNext() {
    if (!r.document) return;
    const query = el('reading-find').value.trim(); if (!query) return;
    const generation = r.generation;
    if (!r.findText) {
      const content = await request(`/documents/${r.document.id}/text`);
      if (generation !== r.generation) return;
      r.findText = content.pages;
    }
    if (r.findQuery !== query) {
      r.findQuery = query; r.findIndex = 0; r.findResults = [];
      for (const content of r.findText) {
        const body = content.text.toLowerCase(); let start = body.indexOf(query.toLowerCase());
        while (start !== -1) { r.findResults.push({ page: content.page, start, end: start + query.length }); start = body.indexOf(query.toLowerCase(), start + query.length); }
      }
    }
    if (!r.findResults.length) { notify('No text matches. Scanned pages may need a visual selection.'); return; }
    const found = r.findResults[r.findIndex++ % r.findResults.length]; await navigate(found.page);
    if (generation !== r.generation || !r.pages.get(found.page)?.textLayer) return;
    const p = r.pages.get(found.page); const range = document.createRange(); let begin = null; let finish = null;
    for (const span of p.textLayer.textDivs) { const start = Number(span.dataset.textStart); const end = start + Number(span.dataset.textLength); if (!begin && found.start >= start && found.start < end) begin = { node: span.firstChild, offset: found.start - start }; if (found.end > start && found.end <= end) finish = { node: span.firstChild, offset: found.end - start }; }
    if (begin && finish) { range.setStart(begin.node, begin.offset); range.setEnd(finish.node, finish.offset); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); begin.node.parentElement.scrollIntoView({ block: 'center' }); captureSelection(); }
    notify(`Match ${(r.findIndex - 1) % r.findResults.length + 1} of ${r.findResults.length}`);
  }

  async function assistanceDialog(draft = {}) {
    if (!selectedHighlights().length) throw new Error('Select one or more highlights first.');
    dialog('Ask AI', `<label class="reading-field">Question or instructions<textarea id="reading-ai-question" placeholder="What would you like to understand or compare?">${e(draft.question || '')}</textarea></label><label class="reading-check"><input type="checkbox" id="reading-ai-context" ${draft.includeContext !== false ? 'checked' : ''}/>Include the displayed nearby passage context</label><label class="reading-check"><input type="checkbox" id="reading-ai-images" ${(draft.includeImages ?? selectedHighlights().some(h => h.image)) ? 'checked' : ''}/>Include selected visual regions (requires image-capable model)</label><p class="reading-muted">${selectedHighlights().length} passages; ${selectedPayload().annotationIds.length} checked comments; ${r.discoveryIds.size} checked external abstracts; ${r.assistanceIds.size} checked AI explanations.</p><details><summary>Inspect selected inputs</summary>${snapshotView(previewSnapshot({ ...selectedPayload(), includeContext: draft.includeContext !== false, includeImages: draft.includeImages ?? selectedHighlights().some(h => h.image) }))}</details><div class="reading-actions"><button type="button" id="reading-ai-review">Send</button></div>`);
    el('reading-ai-review').addEventListener('click', guard(async () => {
      const input = { question: el('reading-ai-question').value, includeContext: el('reading-ai-context').checked, includeImages: el('reading-ai-images').checked };
      const payload = { ...selectedPayload(), ...input, action: 'question', question: input.question.trim() || 'Explain the selected passage and any important concepts or assumptions.', wikiPages: [] };
      const helper = activeHelper(); const viewVersion = helper?.viewVersion;
      const submit = el('reading-ai-review'); submit.disabled = true;
      try {
        const task = await request('/tasks', 'POST', payload);
        if (helper && (activeHelper() !== helper || helper.viewVersion !== viewVersion)) { await refresh(); renderWorkspace(); return; }
        await watchTask(task);
      } finally { submit.disabled = false; }
    }));
  }
  async function watchTask(task) {
    clearTimeout(r.polling); r.task = task.id; r.artifact = null; r.tab = 'assistance';
    const automatic = task.action === 'wiki-note';
    dialog(automatic ? 'Adding note to wiki' : 'Reading assistance', `<p class="reading-muted">${e(automatic ? `Updating ${task.targetPage}?` : task.question || 'Assistance based on your selected passages')}</p><p id="reading-task-status" role="status"></p><div class="reading-actions"><button type="button" id="reading-task-cancel">Stop request</button></div>${automatic ? '' : `<details><summary>Inspect inputs</summary>${snapshotView(task.snapshot)}</details>`}<div id="reading-task-live" class="reading-task-progress"></div><div id="reading-task-complete" class="reading-task-response md-body"></div>`);
    const helper = activeHelper(); const viewVersion = helper?.viewVersion;
    const isCurrentView = () => helper ? activeHelper() === helper && helper.viewVersion === viewVersion : !activeHelper() && el('reading-dialog').open && Boolean(el('reading-task-status'));
    el('reading-task-cancel').addEventListener('click', guard(async () => { await request(`/tasks/${task.id}`, 'DELETE'); }));
    const poll = async () => {
      try {
        const current = await request(`/tasks/${task.id}`);
        if (r.task !== task.id) return;
        if (isCurrentView() && el('reading-task-status')) el('reading-task-status').textContent = `${current.status}${current.model ? ` · ${current.model}` : ''}${current.error ? `: ${current.error}` : ''}`;
        if (isCurrentView() && el('reading-task-live')) el('reading-task-live').textContent = automatic ? '' : current.progress || '';
        if (['queued', 'running'].includes(current.status)) { r.polling = setTimeout(poll, 900); return; }
        await refresh(); renderWorkspace(); for (const p of r.pages.values()) paintHighlights(p);
        if (automatic && current.publication) buildSidebar(await api.getWikiList());
        if (!isCurrentView()) return;
        if (el('reading-task-cancel')) el('reading-task-cancel').hidden = true;
        if (el('reading-task-live')) el('reading-task-live').textContent = '';
        if (el('reading-task-complete')) {
          el('reading-task-complete').innerHTML = automatic
            ? current.publication ? `<p>Note added to <a href="/wiki/${encodeURIComponent(current.publication.page)}">${e(current.publication.page)}</a>.</p>${current.warning ? `<p>${e(current.warning)}</p>` : ''}` : `<p>${e(current.error || 'The wiki was not updated.')}</p><button type="button" id="reading-task-retry">Try again</button>`
            : current.response ? safeMarkdown(current.response, current.snapshot) : `<p>${e(current.error || 'The request did not complete.')}</p>`;
          typesetMath(el('reading-task-complete'));
          if (automatic && !current.publication) el('reading-task-retry').addEventListener('click', guard(async () => { await watchTask(await request(`/tasks/${task.id}/retry`, 'POST', {})); }));
        }
        positionHelper();
        if (current.artifactId && current.status === 'completed' && !current.artifactApplied) notify('The draft changed while AI was working. The new response is saved in Assistance; your edited draft was preserved.', true);
        if (current.artifactApplied && current.status === 'completed' && formIsOpen() && el('reading-task-complete')) await artifactDialog(current.artifactId);
      } catch (error) { report(error); }
    };
    await poll();
  }
  function searchDialog() {
    const query = selectedHighlights().map(h => h.text).join(' ').slice(0, 600);
    dialog('Search workspace and discover papers', `<label class="reading-field">Search query (editable)<textarea id="reading-search-query">${e(query)}</textarea></label><p class="reading-muted">Workspace search runs locally. Discover papers sends only the displayed query to arXiv and NASA ADS; it does not send comments or automatically import papers.</p><div class="reading-actions"><button type="button" id="reading-search-local">Search workspace</button><button type="button" id="reading-search-external">Discover external papers</button><button type="button" id="reading-search-saved">Saved candidates</button></div><div id="reading-search-status" role="status"></div><div id="reading-search-results"></div>`);
    const candidates = records => {
      el('reading-search-results').innerHTML = records.map(d => `<article class="reading-card"><h3>${e(d.source.title)}</h3><p class="reading-muted">${e(d.source.authors?.slice(0, 4).join(', '))} · ${e(d.source.year)} · Abstract only</p><p>${e(d.source.abstract)}</p><a href="${e(d.source.recordUrl)}" target="_blank" rel="noopener noreferrer">Open paper record</a><label class="reading-check"><input type="checkbox" data-discovery-select="${d.id}" ${r.discoveryIds.has(d.id) ? 'checked' : ''}/>Include this abstract in an evidence request (full text not verified)</label>${d.source.canImport ? `<div class="reading-actions"><button type="button" data-discovery-import="${d.id}">Import PDF and start existing ingestion workflow</button></div>` : ''}</article>`).join('');
    };
    el('reading-search-saved').addEventListener('click', () => { candidates(live('discoveries')); el('reading-search-status').textContent = `${live('discoveries').length} saved external candidates.`; });
    candidates(live('discoveries'));
    el('reading-search-local').addEventListener('click', guard(async () => {
      el('reading-search-status').textContent = 'Searching local wiki and source passages...';
      const result = await request('/search', 'POST', { query: el('reading-search-query').value });
      el('reading-search-status').textContent = `${result.results.length} matching passages. ${result.warnings.join('; ')}`;
      el('reading-search-results').innerHTML = result.results.map(item => `<article class="reading-card"><a href="${e(item.url)}">${e(item.name)}${item.page ? ` · p. ${e(item.label || item.page)}` : ''}</a><p class="reading-muted">${e(item.kind)} · excerpt at character ${item.offset}</p><p>${e(item.text)}</p></article>`).join('');
    }));
    el('reading-search-external').addEventListener('click', guard(async () => {
      el('reading-search-status').textContent = 'Searching arXiv / NASA ADS...';
      const result = await request('/discover', 'POST', { query: el('reading-search-query').value });
      await refresh();
      el('reading-search-status').textContent = `${result.records.length} candidate papers. ${result.warnings.join('; ')}`;
      candidates(result.records);
    }));
    el('reading-search-results').addEventListener('change', event => { const id = event.target.dataset.discoverySelect; if (id) { if (event.target.checked) r.discoveryIds.add(id); else r.discoveryIds.delete(id); } });
    el('reading-search-results').addEventListener('click', guard(async event => { const button = event.target.closest('[data-discovery-import]'); if (!button) return; button.disabled = true; const result = await request('/discover/import', 'POST', { ids: [button.dataset.discoveryImport] }); button.textContent = result.imported.length ? 'Imported; ingestion started' : 'Import unavailable'; notify(result.imported.length ? 'PDF imported. The existing automatic ingestion workflow has started.' : 'The paper could not be imported.'); }));
  }
  function paperSummaryPage(pages) {
    const highlights = selectedHighlights();
    const documentId = highlights[0]?.documentId;
    const source = record('documents', documentId);
    const names = [...new Set([source?.currentName, ...(source?.aliases || [])].filter(Boolean).map(name => name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')))];
    const summaries = live('artifacts').filter(a => a.type === 'summary' && a.snapshot.documents.some(d => d.id === documentId)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    for (const artifact of summaries) {
      const published = [...artifact.publications].reverse().find(publication => pages.some(page => page.name === publication.page));
      if (published) return published.page;
    }
    return pages.find(page => names.includes(page.name))?.name
      || pages.find(page => names.some(name => page.name === `${name}-summary` || page.name === `summary-${name}`))?.name
      || summaries.flatMap(artifact => [...artifact.publications].reverse())[0]?.page
      || names.find(name => name && !['index', 'log'].includes(name))
      || `paper-${documentId}-notes`;
  }
  async function newArtifactDialog(addToWiki = false) {
    if (!selectedHighlights().length) throw new Error('Select one or more highlights to create an artifact.');
    const helper = activeHelper(); const viewVersion = helper?.viewVersion;
    const pages = await api.getWikiList();
    if (helper && (activeHelper() !== helper || helper.viewVersion !== viewVersion)) return;
    const destinations = pages.filter(page => !['index', 'log'].includes(page.name));
    const defaultPage = addToWiki ? paperSummaryPage(destinations) : '';
    const createDefault = addToWiki && !destinations.some(page => page.name === defaultPage);
    if (createDefault) destinations.unshift({ name: defaultPage });
    const destinationField = `<label class="reading-field">Wiki page<select id="reading-new-artifact-target">${destinations.map(page => `<option value="${e(page.name)}" ${page.name === defaultPage ? 'selected' : ''}>${e(page.name)}${createDefault && page.name === defaultPage ? ' (create on Add)' : ''}</option>`).join('')}</select></label>`;
    dialog(addToWiki ? 'Add highlighted passage to wiki' : 'Create a reading artifact', `${addToWiki ? destinationField : `<p class="reading-muted">Create a private draft from selected material. AI generation and wiki publication are separate actions.</p><label class="reading-field">Artifact type<select id="reading-new-artifact-type">${Object.entries(artifactNames).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label class="reading-field">Title<input id="reading-new-artifact-title" maxlength="200" placeholder="e.g. Timing-noise assumptions across selected papers"/></label><label class="reading-field">Existing concept page (only for concept updates)<select id="reading-new-artifact-target"><option value="">Choose a page</option>${pages.filter(p => !['index', 'log'].includes(p.name)).map(p => `<option>${e(p.name)}</option>`).join('')}</select></label>`}<label class="reading-check"><input type="checkbox" id="reading-new-artifact-images" ${selectedHighlights().some(h => h.image) ? 'checked' : ''}/>${addToWiki ? 'Include selected visual regions' : 'Include selected visual regions if AI is requested'}</label><details><summary>${addToWiki ? 'Selected inputs' : 'Review selected private inputs'}</summary>${snapshotView(previewSnapshot({ ...selectedPayload(), includeContext: false, includeImages: true }))}</details><div class="reading-actions"><button type="button" id="reading-new-artifact-create">${addToWiki ? 'Add' : 'Create private draft'}</button></div>`);
    if (addToWiki) el('reading-new-artifact-target').value = defaultPage;
    el('reading-new-artifact-create').addEventListener('click', guard(async () => {
      const surface = activeHelper(); const version = surface?.viewVersion;
      const targetPage = el('reading-new-artifact-target').value;
      if (addToWiki && !destinations.some(page => page.name === targetPage)) throw new Error('Choose a wiki page.');
      const payload = { ...selectedPayload(), targetPage, includeContext: false, includeImages: el('reading-new-artifact-images').checked };
      if (addToWiki) {
        const submit = el('reading-new-artifact-create');
        if (submit.disabled) return;
        submit.disabled = true;
        try {
          const task = await request('/tasks', 'POST', { ...payload, action: 'wiki-note', createMissingPage: createDefault && targetPage === defaultPage });
          if (surface && (activeHelper() !== surface || surface.viewVersion !== version)) { await refresh(); renderWorkspace(); return; }
          await watchTask(task);
        } finally { submit.disabled = false; }
        return;
      }
      const artifact = await request('/artifacts', 'POST', { ...payload, type: el('reading-new-artifact-type').value, title: el('reading-new-artifact-title').value });
      await refresh(); r.tab = 'artifacts'; renderWorkspace();
      if (surface && (activeHelper() !== surface || surface.viewVersion !== version)) return;
      await artifactDialog(artifact.id);
    }));
  }
  function diffHtml(before, after) {
    const a = before.split('\n'); const b = after.split('\n');
    if (a.length * b.length > 1000000) return `<del>${e(before)}</del><ins>${e(after)}</ins>`;
    const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    const output = []; let i = 0; let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { output.push(`<span>  ${e(a[i])}</span>`); i += 1; j += 1; }
      else if (j < b.length && (i === a.length || lengths[i][j + 1] >= lengths[i + 1][j])) output.push(`<ins>+ ${e(b[j++])}</ins>`);
      else output.push(`<del>- ${e(a[i++])}</del>`);
    }
    return output.join('\n');
  }
  async function artifactDialog(id) {
    const helper = activeHelper(); const viewVersion = helper?.viewVersion;
    await refresh();
    if (helper && (activeHelper() !== helper || helper.viewVersion !== viewVersion)) return;
    const artifact = record('artifacts', id); r.artifact = artifact; r.tab = 'artifacts';
    const original = artifact.snapshot.wikiPages.find(w => w.name === artifact.targetPage)?.content || '';
    dialog(artifact.title, `<p class="reading-muted">${e(artifactNames[artifact.type])}${artifact.outdated ? ' · Source notes changed: review the preserved inputs before using this draft.' : ''}</p><details><summary>Inspect exactly which private inputs will be published</summary>${snapshotView(artifact.snapshot)}<p class="reading-muted">Publication includes the selected excerpts, source hashes and page links, checked researcher comments, and external-candidate references. Other private notes remain local. Visual crops remain private; their page locations and entered transcriptions are preserved.</p></details><label class="reading-field">Instructions or evidence claim (for optional AI generation)<textarea id="reading-artifact-instructions" placeholder="Specify the question, comparison, intended audience, or claim."></textarea></label><div class="reading-actions"><button type="button" id="reading-artifact-save">Save private draft</button><button type="button" id="reading-artifact-generate">Request AI draft from these inputs</button><button type="button" id="reading-artifact-preview-button">Refresh preview and diff</button></div><div class="reading-compose-grid"><label class="reading-field">Markdown draft<textarea id="reading-artifact-editor">${e(artifact.content)}</textarea></label><section><p class="reading-muted">Preview</p><div class="reading-preview md-body" id="reading-artifact-preview">${safeMarkdown(artifact.content, artifact.snapshot)}</div></section></div>${artifact.type === 'concept' ? `<details open><summary>Proposed changes to ${e(artifact.targetPage)}</summary><div id="reading-artifact-diff" class="reading-diff">${diffHtml(original, artifact.content)}</div></details>` : ''}<label class="reading-field">${artifact.type === 'concept' ? 'Existing target page' : 'New wiki page name'}<input id="reading-artifact-page" value="${e(artifact.targetPage || artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}" ${artifact.type === 'concept' ? 'readonly' : ''} pattern="[a-z0-9]+(-[a-z0-9]+)*"/></label><label class="reading-check"><input type="checkbox" id="reading-artifact-reviewed"/>I reviewed the draft, evidence classifications, source citations, proposed changes, and the selected private material that will be published.</label>${artifact.outdated ? '<label class="reading-check"><input type="checkbox" id="reading-artifact-outdated"/>Use the preserved inputs even though the current notes have changed.</label>' : ''}<div class="reading-actions"><button type="button" id="reading-artifact-publish" disabled>Publish reviewed artifact</button></div><p class="reading-muted">Publication updates the page, wiki index, and operation log together.</p>`);
    typesetMath(el('reading-artifact-preview'));
    const preview = () => { el('reading-artifact-preview').innerHTML = safeMarkdown(el('reading-artifact-editor').value, artifact.snapshot); typesetMath(el('reading-artifact-preview')); if (el('reading-artifact-diff')) el('reading-artifact-diff').innerHTML = diffHtml(original, el('reading-artifact-editor').value); el('reading-artifact-reviewed').checked = false; el('reading-artifact-publish').disabled = true; };
    const save = async () => { const updated = await request(`/artifacts/${id}`, 'PATCH', { revision: r.artifact.revision, content: el('reading-artifact-editor').value }); r.artifact = { ...updated, outdated: artifact.outdated }; formError().textContent = ''; return updated; };
    el('reading-artifact-save').addEventListener('click', guard(async () => { await save(); notify('Private draft saved.'); }));
    el('reading-artifact-preview-button').addEventListener('click', preview);
    el('reading-artifact-editor').addEventListener('input', () => { el('reading-artifact-reviewed').checked = false; el('reading-artifact-publish').disabled = true; });
    el('reading-artifact-page').addEventListener('input', () => { el('reading-artifact-reviewed').checked = false; el('reading-artifact-publish').disabled = true; });
    el('reading-artifact-reviewed').addEventListener('change', () => { el('reading-artifact-publish').disabled = !el('reading-artifact-reviewed').checked; });
    el('reading-artifact-generate').addEventListener('click', guard(async () => {
      const instructions = el('reading-artifact-instructions').value;
      await save(); const task = await request(`/artifacts/${id}/generate`, 'POST', { revision: r.artifact.revision, question: instructions }); await watchTask(task);
    }));
    el('reading-artifact-publish').addEventListener('click', guard(async () => {
      if (!el('reading-artifact-reviewed').checked) throw new Error('Review the draft and selected inputs first.');
      el('reading-artifact-publish').disabled = true;
      try {
        await save();
        const published = await request(`/artifacts/${id}/publish`, 'POST', { revision: r.artifact.revision, pageName: el('reading-artifact-page').value, reviewed: true, acceptOutdated: el('reading-artifact-outdated')?.checked === true });
        r.artifact = null; closeForm(); await refresh(); renderWorkspace(); buildSidebar(await api.getWikiList()); notify(`Published ${published.page}.${published.historySaved ? '' : ' The wiki was saved, but local publication history could not be updated.'}`);
      } finally { if (el('reading-artifact-publish')) el('reading-artifact-publish').disabled = false; }
    }));
  }

  for (const target of [el('reading-notes'), el('reading-library-content')]) {
    target.addEventListener('change', guard(async event => {
      const node = event.target;
      if (node.dataset.readingSelect) { if (node.checked) r.selected.add(node.dataset.readingSelect); else r.selected.delete(node.dataset.readingSelect); renderWorkspace(); }
      if (node.dataset.readingAnnotation) { if (node.checked) { r.annotationIds.add(node.dataset.readingAnnotation); r.selected.add(record('annotations', node.dataset.readingAnnotation).highlightId); } else r.annotationIds.delete(node.dataset.readingAnnotation); renderWorkspace(); }
      if (node.dataset.readingAssistance) { if (node.checked) { const task = record('tasks', node.dataset.readingAssistance); task.snapshot.highlights.forEach(h => r.selected.add(h.id)); r.assistanceIds.add(task.id); } else r.assistanceIds.delete(node.dataset.readingAssistance); renderWorkspace(); }
      if (node.id === 'reading-filter-document') { r.filter.document = node.value; renderWorkspace(); }
      if (node.id === 'reading-filter-color') { r.filter.color = node.value; renderWorkspace(); }
      if (node.id === 'reading-filter-category') { r.filter.category = node.value; renderWorkspace(); }
      if (node.id === 'reading-filter-annotated') { r.filter.annotated = node.checked; renderWorkspace(); }
      if (node.id === 'reading-backup-input' && node.files[0]) { const data = JSON.parse(await node.files[0].text()); await request('/import', 'POST', { data, revision: r.data.revision }); await refresh(); renderWorkspace(); notify('Private backup imported. Existing records were preserved.'); }
    }));
    target.addEventListener('input', event => { if (event.target.id === 'reading-filter-query') { r.filter.query = event.target.value; clearTimeout(r.filterTimer); r.filterTimer = setTimeout(renderWorkspace, 180); } });
    target.addEventListener('click', guard(async event => {
      const button = event.target.closest('button');
      if (!button) {
        const card = event.target.closest('[data-reading-card]');
        if (card && !event.target.closest('a,input,label,textarea,select')) openHighlightHelper(card.dataset.readingCard, event.clientX, event.clientY);
        return;
      }
      const d = button.dataset;
      if (d.readingTab) { r.tab = d.readingTab; renderWorkspace(); }
      if (d.readingOpen) await openHighlight(d.readingOpen);
      if (d.readingEdit) editHighlight(d.readingEdit);
      if (d.readingLink) await linkDialog(d.readingLink);
      if (d.readingConnect) await connectKnowledge(d.readingConnect);
      if (d.readingCopy) { const h = record('highlights', d.readingCopy); await navigator.clipboard.writeText(`${location.origin}/#reading/${h.documentId}/${h.id}?revision=${h.revision}`); notify('Passage link copied.'); }
      if (d.readingDelete) await deleteHighlight(d.readingDelete);
      if (d.readingReattach) { if (!r.pending) throw new Error('Select a passage in the replacement PDF first.'); const h = record('highlights', d.readingReattach); await request(`/highlights/${h.id}`, 'PATCH', { ...r.pending, revision: h.revision }); r.pending = null; el('reading-selection-toolbar').hidden = true; await refresh(); renderWorkspace(); for (const p of r.pages.values()) paintHighlights(p); }
      if (d.readingCollection) collectionDialog(d.readingCollection);
      if (d.readingCollectionSelect) { const c = record('collections', d.readingCollectionSelect); r.selected = new Set(c.highlightIds); r.filter.document = ''; r.tab = 'highlights'; renderWorkspace(); }
      if (d.readingArtifact) await artifactDialog(d.readingArtifact);
      if (d.readingTaskInputs) { const t = record('tasks', d.readingTaskInputs); dialog('Preserved assistance inputs', snapshotView(t.snapshot)); }
      if (d.readingTaskStop) { await request(`/tasks/${d.readingTaskStop}`, 'DELETE'); await refresh(); renderWorkspace(); }
      if (d.readingTaskRetry) await watchTask(await request(`/tasks/${d.readingTaskRetry}/retry`, 'POST', {}));
      if (d.readingTaskWatch) await watchTask(await request(`/tasks/${d.readingTaskWatch}`));
      if (d.readingAction === 'select-visible') { filteredHighlights().forEach(h => r.selected.add(h.id)); renderWorkspace(); }
      if (d.readingAction === 'clear-selection') { r.selected.clear(); r.annotationIds.clear(); r.assistanceIds.clear(); r.discoveryIds.clear(); renderWorkspace(); }
      if (d.readingAction === 'undo') await undoDeletion();
      if (d.readingAction === 'assist') assistanceDialog();
      if (d.readingAction === 'search') searchDialog();
      if (d.readingAction === 'new-artifact') await newArtifactDialog();
      if (d.readingAction === 'add-collection') addCollectionDialog();
      if (d.readingAction === 'new-collection') collectionDialog(null, true);
      if (d.readingAction === 'import') el('reading-backup-input').click();
    }));
    target.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key) || !event.target.dataset.readingCard) return;
      event.preventDefault(); const bounds = event.target.getBoundingClientRect();
      openHighlightHelper(event.target.dataset.readingCard, bounds.left, bounds.top);
    });
  }

  async function deleteHighlight(id) {
    const h = record('highlights', id);
    r.undo = await request(`/highlights/${h.id}`, 'DELETE', { revision: h.revision });
    r.selected.delete(h.id); if (r.active === h.id) r.active = null;
    if (r.helper?.highlightId === id) closeHelper();
    if (r.historical?.highlight.id === h.id) r.historical = null;
    await refresh(); renderWorkspace(); for (const p of r.pages.values()) paintHighlights(p);
    notify('Highlight deleted. Choose Undo deletion to restore it.');
  }
  async function undoDeletion() {
    if (!r.undo) return;
    await request(`/highlights/${r.undo.id}`, 'PATCH', { revision: r.undo.revision, deletedAt: null });
    r.undo = null; await refresh(); renderWorkspace(); for (const p of r.pages.values()) paintHighlights(p);
  }
  el('reading-selection-toolbar').addEventListener('pointerdown', event => { if (event.target.closest('button')) event.preventDefault(); });
  document.querySelectorAll('[data-selection-color]').forEach(input => input.addEventListener('change', guard(() => saveSelection(input.dataset.selectionColor))));
  el('reading-selection-wiki').addEventListener('click', guard(() => saveSelection('yellow', 'wiki')));
  el('reading-selection-note').addEventListener('click', guard(() => saveSelection('yellow', 'note')));
  el('reading-selection-ask').addEventListener('click', guard(() => saveSelection('yellow', 'ask')));
  el('reading-selection-connect').addEventListener('click', guard(() => saveSelection('yellow', 'connect')));
  el('reading-helper-close').addEventListener('click', () => {
    if (r.artifact && el('reading-artifact-editor')?.value !== r.artifact.content) { notify('Save your draft before closing, or press Escape to discard unsaved edits.'); return; }
    closeHelper();
  });
  el('reading-dialog-close').addEventListener('click', () => {
    if (r.artifact && el('reading-artifact-editor')?.value !== r.artifact.content) { notify('Save your draft before closing, or press Escape to discard unsaved edits.'); return; }
    el('reading-dialog').close(); r.artifact = null;
  });
  el('reading-dialog').addEventListener('close', () => { r.artifact = null; });
  el('reading-open-files').addEventListener('click', () => showPanel('files'));
  el('reading-region').addEventListener('click', () => { if (!r.highlightsEnabled) return; r.region = !r.region; el('document-stage').classList.toggle('reading-region-mode', r.region); el('reading-region').setAttribute('aria-pressed', String(r.region)); if (r.region) notify('Drag a rectangle around an equation, figure, or scanned passage.'); });
  el('reading-rotate').addEventListener('click', guard(async () => { r.rotation = (r.rotation + 90) % 360; await navigate(state.pdf.page); }));
  el('reading-highlights-toggle').addEventListener('click', () => setHighlightsEnabled(!r.highlightsEnabled));
  function saveLagRecording() {
    clearTimeout(r.diagnosticTimer);
    const report = diagnostics?.stop();
    const button = el('reading-record-lag'); button.textContent = 'Record lag'; button.setAttribute('aria-pressed', 'false');
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'pulsarwiki-lag.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Local lag report saved. It contains timing and rendering metadata, without paper text or annotations.');
  }
  el('reading-record-lag').addEventListener('click', () => {
    if (!diagnostics) return;
    if (diagnostics.recording) { saveLagRecording(); return; }
    diagnostics.start();
    const button = el('reading-record-lag'); button.textContent = 'Stop & save lag report'; button.setAttribute('aria-pressed', 'true');
    notify('Recording timing for 30 seconds. Reproduce the scrolling lag; the report saves locally.');
    r.diagnosticTimer = setTimeout(saveLagRecording, 30000);
  });
  el('reading-notes-toggle').addEventListener('click', guard(async () => { el('reading-notes').hidden = !el('reading-notes').hidden; el('reading-notes-toggle').setAttribute('aria-expanded', String(!el('reading-notes').hidden)); await navigate(state.pdf.page); }));
  el('reading-thumbnails-toggle').addEventListener('click', guard(async () => {
    const nav = el('reading-thumbnails'); nav.hidden = !nav.hidden; el('reading-thumbnails-toggle').setAttribute('aria-pressed', String(!nav.hidden));
    if (!nav.hidden) {
      const generation = r.generation;
      nav.innerHTML = Array.from({ length: r.pdf.numPages }, (_, i) => `<button type="button" data-reading-jump="${i + 1}"><canvas aria-hidden="true"></canvas><span class="reading-thumbnail-label">${i + 1}</span></button>`).join('');
      // Render small thumbnails only as their buttons enter the page list viewport.
      r.thumbnailObserver?.disconnect();
      r.thumbnailObserver = new IntersectionObserver(entries => entries.forEach(entry => {
        if (generation !== r.generation) return;
        entry.target.dataset.near = String(entry.isIntersecting);
        if (entry.isIntersecting) queueThumbnail(entry.target);
        else { thumbnailQueue.delete(entry.target); if (r.thumbnailTask?.button === entry.target) r.thumbnailTask.task.cancel(); }
      }), { root: nav, rootMargin: '100px' });
      for (const button of nav.querySelectorAll('button')) r.thumbnailObserver.observe(button);
    } else { r.thumbnailObserver?.disconnect(); thumbnailQueue.clear(); r.thumbnailTask?.task.cancel(); }
    await navigate(state.pdf.page);
  }));
  el('reading-thumbnails').addEventListener('click', guard(event => { const button = event.target.closest('[data-reading-jump]'); if (button) return navigate(Number(button.dataset.readingJump)); }));
  el('document-stage').addEventListener('pointerup', () => { if (!r.region) setTimeout(captureSelection, 0); });
  el('document-stage').addEventListener('keyup', () => { if (!r.region) captureSelection(); });
  el('document-stage').addEventListener('scroll', pauseForScroll, { passive: true });
  el('document-stage').addEventListener('wheel', pauseForScroll, { passive: true });
  document.addEventListener('selectionchange', () => {
    clearTimeout(r.selectionTimer);
    r.selectionTimer = setTimeout(releaseDistantPages, 100);
  });
  el('document-stage').addEventListener('click', event => {
    if (!r.highlightsEnabled || r.region || window.getSelection()?.isCollapsed === false) return;
    const wrap = event.target.closest('.reading-page'); if (!wrap) return;
    const p = r.pages.get(Number(wrap.dataset.readingPage)); const box = wrap.getBoundingClientRect();
    const x = event.clientX - box.left; const y = event.clientY - box.top;
    const hits = [...p.overlay.children].filter(mark => x >= parseFloat(mark.style.left) && x <= parseFloat(mark.style.left) + parseFloat(mark.style.width) && y >= parseFloat(mark.style.top) && y <= parseFloat(mark.style.top) + parseFloat(mark.style.height));
    if (hits.length) { const current = hits.findIndex(mark => mark.dataset.highlightId === r.active); openHighlightHelper(hits[(current + 1) % hits.length].dataset.highlightId, event.clientX, event.clientY); }
  });
  el('document-stage').addEventListener('pointerdown', event => {
    if (!r.region || event.button !== 0) return;
    const wrap = event.target.closest('.reading-page'); if (!wrap) return;
    const page = r.pages.get(Number(wrap.dataset.readingPage)); if (!page?.rendered) return;
    event.preventDefault(); wrap.setPointerCapture(event.pointerId);
    const box = wrap.getBoundingClientRect(); const start = [event.clientX - box.left, event.clientY - box.top];
    const drag = document.createElement('div'); drag.className = 'reading-region-drag'; wrap.append(drag);
    const move = moveEvent => { const x = Math.max(0, Math.min(box.width, moveEvent.clientX - box.left)); const y = Math.max(0, Math.min(box.height, moveEvent.clientY - box.top)); Object.assign(drag.style, { left: `${Math.min(x, start[0])}px`, top: `${Math.min(y, start[1])}px`, width: `${Math.abs(x - start[0])}px`, height: `${Math.abs(y - start[1])}px` }); };
    const cancel = () => { wrap.removeEventListener('pointermove', move); wrap.removeEventListener('pointerup', end); wrap.removeEventListener('pointercancel', cancel); drag.remove(); };
    const end = up => {
      move(up); const x = parseFloat(drag.style.left); const y = parseFloat(drag.style.top); const width = parseFloat(drag.style.width); const height = parseFloat(drag.style.height); cancel();
      if (width < 8 || height < 8) return;
      const factor = page.canvas.width / box.width; const crop = document.createElement('canvas'); crop.width = Math.ceil(width * factor); crop.height = Math.ceil(height * factor);
      crop.getContext('2d').drawImage(page.canvas, x * factor, y * factor, width * factor, height * factor, 0, 0, crop.width, crop.height);
      r.pending = { documentId: r.document.id, kind: 'region', text: '', anchors: [{ page: page.number, label: String(page.number), exact: '', prefix: '', suffix: '', rects: [[...page.viewport.convertToPdfPoint(x, y), ...page.viewport.convertToPdfPoint(x + width, y + height)]] }], image: crop.toDataURL('image/png'), categories: [] };
      showSelectionToolbar(up.clientX, up.clientY);
    };
    wrap.addEventListener('pointermove', move); wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', cancel);
  });
  el('reading-find-next').addEventListener('click', guard(findNext));
  el('reading-find').addEventListener('keydown', guard(event => { if (event.key === 'Enter') return findNext(); }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeHelper(); });
  document.addEventListener('click', guard(async event => {
    const link = event.target.closest('a[href^="/#reading"], a[href^="/#file/"]');
    if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
      event.preventDefault();
      if (r.artifact && el('reading-artifact-editor')?.value !== r.artifact.content) throw new Error('Save the draft before opening its source passage.');
      if (el('reading-dialog').open) el('reading-dialog').close();
      closeHelper();
      const hashValue = new URL(link.href).hash; history.pushState(null, '', `/${hashValue}`); await route(hashValue);
    }
  }));
  window.addEventListener('popstate', guard(() => route()));
  window.addEventListener('hashchange', guard(() => route()));
  window.addEventListener('resize', positionHelper);
  if (typeof ResizeObserver !== 'undefined') {
    const helperObserver = new ResizeObserver(positionHelper);
    helperObserver.observe(el('reading-selection-toolbar'));
  }
  window.ActiveReading = { open, close, navigate, route, sanitizeHtml, isOpen: () => Boolean(r.pdf && r.document), library: guard(library), backlinks: guard(backlinks) };
})();
