/* Standard JupyterLab owns editing and execution. This module connects workspace evidence. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = { data: null, selected: null, historical: null, launch: null, ready: false, pending: new Map(), selection: {}, tray: '', poll: null, refreshing: false };
  const message = value => { $('notebook-status').textContent = value || ''; };
  const guard = fn => async (...args) => { try { return await fn(...args); } catch (error) { message(error.message); } };
  const request = (suffix = '', method = 'GET', body) => WorkspaceSession.fetch(`/api/notebooks${suffix}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }).then(response => readJsonResponse(response, 'Notebooks'));
  const entry = () => n.data?.notebooks.find(book => book.id === n.selected);
  const bodyText = value => Array.isArray(value) ? value.join('') : String(value || '');
  const md = value => window.ActiveReading.sanitizeHtml(renderMd(value));
  function dialog(title, body, submitLabel, submit) {
    $('notebook-dialog-title').textContent = title; $('notebook-dialog-body').innerHTML = body; $('notebook-dialog-submit').textContent = submitLabel; $('notebook-dialog-error').textContent = '';
    $('notebook-dialog-form').onsubmit = async event => {
      event.preventDefault(); const button = $('notebook-dialog-submit'); button.disabled = true;
      try { await submit(); $('notebook-dialog').close(); } catch (error) { $('notebook-dialog-error').textContent = error.message; } finally { button.disabled = false; }
    };
    if (!$('notebook-dialog').open) $('notebook-dialog').showModal();
  }
  function field(id, title, value = '', placeholder = '') { return `<label class="notebook-field">${e(title)}<input id="${id}" value="${e(value)}" placeholder="${e(placeholder)}" required/></label>`; }
  function bridge(command, data = {}) {
    if (!n.ready || !n.launch) return Promise.reject(new Error('Start or reconnect the notebook editor first.'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { n.pending.delete(requestId); reject(new Error('The notebook editor did not respond. Reconnect and retry; saved work is preserved.')); }, 30000);
      n.pending.set(requestId, { resolve, reject, timeout });
      $('notebook-frame').contentWindow.postMessage({ type: 'pulsarwiki-command', channel: n.launch.channel, requestId, command, ...data }, n.launch.origin);
    });
  }
  async function flush() { return n.ready ? bridge('save') : {}; }
  async function refresh() {
    if (n.refreshing) return n.refreshing;
    n.refreshing = (async () => {
      n.data = await request(); renderList(); renderRuntime(); renderToolbar();
      if (n.tray === 'recall') renderRecallTasks();
      if (n.tray === 'history') renderHistory();
      if (n.data.runtime.state === 'running' && !n.launch) await connect();
      if (n.data.runtime.state === 'failed') { message(n.data.runtime.error); disconnect(); }
      if (n.tray === 'sources') renderRuns();
    })();
    try { await n.refreshing; } finally { n.refreshing = false; }
  }
  function renderList() {
    $('notebook-list').innerHTML = (n.data?.notebooks || []).map(book => `<button type="button" data-notebook="${e(book.id)}" class="${book.id === n.selected ? 'active' : ''}"><strong>${e(book.path.replace(/\.ipynb$/, ''))}</strong><small>${book.available ? `${book.history.length} saved revisions` : 'File missing · history preserved'}</small></button>`).join('') || '<p class="notebook-muted" style="padding:12px">Your notebooks will stay in this workspace.</p>';
  }
  function renderRuntime() {
    const runtime = n.data.runtime;
    $('notebook-runtime-state').textContent = runtime.state === 'running' ? 'Ready' : runtime.state;
    if (document.activeElement !== $('notebook-python')) $('notebook-python').value = runtime.python;
    $('notebook-start').disabled = ['starting', 'stopping'].includes(runtime.state);
    $('notebook-start').textContent = runtime.state === 'running' ? 'Reconnect' : runtime.state === 'starting' ? 'Starting…' : 'Start Python';
    $('notebook-stop').disabled = !['running', 'starting'].includes(runtime.state);
    $('notebook-python-save').disabled = ['running', 'starting', 'stopping'].includes(runtime.state);
    const env = runtime.environment;
    $('notebook-environment').textContent = env ? env.ready ? `${env.python}\n${env.executable}\n${env.packages.length} packages recorded` : `Missing: ${(env.missing || []).join(', ') || env.error}` : '';
    if (runtime.error) { message(runtime.error); $('notebook-python-details').open = true; }
  }
  function renderToolbar() {
    const book = entry(); $('notebook-title').textContent = book ? book.path : 'Research notebook';
    for (const id of ['save', 'rename', 'checkpoint', 'history', 'sources', 'export']) $(`notebook-${id}`).disabled = !book;
    $('notebook-save').disabled = !n.ready || !book || Boolean(n.historical);
    $('notebook-kernel').textContent = n.historical ? `Historical revision ${n.historical.revision} · read only` : n.ready && n.selection.kernel ? n.selection.kernel : book ? 'Standard Jupyter notebook' : '';
  }
  async function show() {
    try {
      await refresh();
      if (!n.poll) n.poll = setInterval(() => { if ($('panel-notebooks').classList.contains('active') || n.data?.runtime.state === 'starting' || n.data?.recalls.some(t => ['queued', 'running'].includes(t.status)) || n.data?.runs.some(t => t.status === 'running')) void guard(refresh)(); }, 1500);
    } catch (error) { message(error.message); }
  }
  async function open(id, options = {}) {
    showPanel('notebooks'); await show();
    n.selected = id; n.historical = options.revision ? { revision: Number(options.revision), cellId: options.cellId } : null;
    const book = entry(); if (!book) throw new Error('This notebook is not in the active workspace.');
    renderList(); renderToolbar();
    if (n.ready && !n.historical && book.available) {
      $('notebook-frame').hidden = false; $('notebook-preview').hidden = true;
      await bridge('open', { path: book.path, cellId: options.cellId });
    } else await preview(id, options.revision, options.cellId);
    if (options.history !== false) history.pushState(null, '', `/#notebook/${id}${options.revision ? `?revision=${options.revision}${options.cellId ? `&cell=${encodeURIComponent(options.cellId)}` : ''}` : ''}`);
  }
  function image(mime, data, alt) {
    return ['image/png', 'image/jpeg'].includes(mime) && typeof data === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(data) ? `<img src="data:${mime};base64,${data.replace(/\s/g, '')}" alt="${e(alt)}"/>` : '';
  }
  async function preview(id, revision, cellId) {
    const snapshot = await request(`/${id}${revision ? `?revision=${revision}` : ''}`);
    $('notebook-frame').hidden = true; $('notebook-preview').hidden = false;
    const cellHtml = cell => {
      let content = cell.cell_type === 'markdown' ? `<div class="md-body">${md(bodyText(cell.source))}</div>` : `<pre><code>${e(bodyText(cell.source))}</code></pre>`;
      for (const attachment of Object.values(cell.attachments || {})) for (const [mime, data] of Object.entries(attachment)) content += image(mime, data, 'Preserved notebook attachment');
      for (const output of cell.outputs || []) {
        const plain = output.text || output.data?.['text/plain'] || output.traceback?.join('\n') || output.evalue;
        content += '<div class="notebook-output">';
        if (plain) content += `<pre>${e(bodyText(plain))}</pre>`;
        for (const [mime, data] of Object.entries(output.data || {})) content += image(mime, bodyText(data), 'Saved notebook plot');
        content += '</div>';
      }
      return `<section class="notebook-cell ${cell.id === cellId ? 'selected' : ''}" data-notebook-cell="${e(cell.id)}"><small>${e(cell.cell_type)}${cell.cell_type === 'code' ? ` [${cell.execution_count ?? ' '}]` : ''}</small>${content}</section>`;
    };
    $('notebook-preview').innerHTML = `<header class="notebook-snapshot-header"><span>${revision ? `Revision ${snapshot.revision} · ${e(new Date(snapshot.savedAt).toLocaleString())}` : 'Saved preview · start Python to edit and run'}${snapshot.label ? ` · ${e(snapshot.label)}` : ''}</span><button class="btn" id="notebook-open-current" type="button">Open current notebook</button></header><div class="notebook-cells">${snapshot.notebook.cells.map(cellHtml).join('') || '<p class="notebook-muted">This notebook has no cells yet.</p>'}</div>`;
    $('notebook-open-current').addEventListener('click', guard(() => open(id)));
    typesetMath($('notebook-preview'));
    if (cellId) [...$('notebook-preview').querySelectorAll('[data-notebook-cell]')].find(el => el.dataset.notebookCell === cellId)?.scrollIntoView({ block: 'center' });
  }
  function disconnect() {
    n.ready = false; n.launch = null; n.selection = {};
    for (const task of n.pending.values()) { clearTimeout(task.timeout); task.reject(new Error('Notebook editor disconnected.')); } n.pending.clear();
    $('notebook-frame').removeAttribute('src'); $('notebook-frame').hidden = true; $('notebook-preview').hidden = false; renderToolbar();
  }
  async function connect() {
    if (n.launch) disconnect();
    n.launch = await request('/runtime/launch', 'POST', {});
    $('notebook-frame').src = n.launch.url;
    if (!n.historical) { $('notebook-frame').hidden = false; $('notebook-preview').hidden = true; }
    message('Connecting JupyterLab…');
  }
  window.addEventListener('message', guard(async event => {
    if (!n.launch || event.source !== $('notebook-frame').contentWindow || event.origin !== n.launch.origin) return;
    const data = event.data;
    if (data?.type === 'pulsarwiki-bootstrap') { $('notebook-frame').contentWindow.postMessage({ type: 'pulsarwiki-auth', ticket: n.launch.ticket }, n.launch.origin); delete n.launch.ticket; return; }
    if (data?.channel !== n.launch.channel) return;
    if (data.type === 'pulsarwiki-reply') { const task = n.pending.get(data.requestId); if (task) { clearTimeout(task.timeout); n.pending.delete(data.requestId); data.error ? task.reject(new Error(data.error)) : task.resolve(data.result); } }
    if (data.type === 'pulsarwiki-ready') { n.ready = true; message(''); await bridge('theme', { theme: document.documentElement.dataset.theme }); if (entry() && !n.historical) await bridge('open', { path: entry().path }); renderToolbar(); }
    if (data.type === 'pulsarwiki-selection') { n.selection = { path: data.path, cellId: data.cellId, dirty: data.dirty, kernel: data.kernel }; const book = n.data.notebooks.find(b => b.path === data.path); if (book && !n.historical) { n.selected = book.id; renderList(); } renderToolbar(); }
    if (data.type === 'pulsarwiki-saved') await refresh();
    if (data.type === 'pulsarwiki-execution') { await request('/executions', 'POST', { path: data.path, cellId: data.cellId, success: data.success, startedAt: data.startedAt }); await refresh(); }
    if (data.type === 'pulsarwiki-warning') message(String(data.message).slice(0, 2000));
    if (data.type === 'pulsarwiki-navigate' && typeof data.href === 'string') {
      if (/^\/wiki\/[a-z0-9-]+$/.test(data.href)) await openPage(decodeURIComponent(data.href.slice(6)));
      else if (/^\/#(?:reading\/|file\/)/.test(data.href)) { history.pushState(null, '', data.href); await window.ActiveReading.route(data.href.slice(1)); }
      else if (/^\/#notebook\//.test(data.href)) await route(data.href.slice(1));
    }
  }));
  function newNotebook() {
    dialog('New notebook', field('notebook-name', 'Filename', '', 'analysis.ipynb'), 'Create notebook', async () => { const name = $('notebook-name').value.trim(); const book = await request('', 'POST', { name: name.endsWith('.ipynb') ? name : `${name}.ipynb` }); await refresh(); await open(book.id); });
  }
  function tray(name, title, body = '') { n.tray = name; $('notebook-tray').hidden = false; $('notebook-tray-title').textContent = title; $('notebook-tray-body').innerHTML = body; }
  function renderHistory() {
    const book = entry(); if (!book || n.tray !== 'history') return;
    $('notebook-tray-body').innerHTML = '<p class="notebook-muted">Every changed save is preserved. Restore creates a new revision.</p>' + [...book.history].reverse().map(r => `<div class="notebook-history-item"><strong>Revision ${r.revision}${r.label ? ` · ${e(r.label)}` : ''}</strong><small>${e(new Date(r.savedAt).toLocaleString())}</small><div class="notebook-actions"><button class="btn" data-view-revision="${r.revision}" type="button">View</button><button class="btn" data-restore-revision="${r.revision}" type="button">Restore as new revision</button></div></div>`).join('');
    $('notebook-tray-body').querySelectorAll('[data-view-revision]').forEach(button => button.addEventListener('click', guard(() => open(book.id, { revision: button.dataset.viewRevision }))));
    $('notebook-tray-body').querySelectorAll('[data-restore-revision]').forEach(button => button.addEventListener('click', guard(async () => { await flush(); await refresh(); const current = entry(); await request(`/${current.id}/restore`, 'POST', { revision: Number(button.dataset.restoreRevision), expectedRevision: current.revision }); await reload(current.id); message('Restored as a new revision. Earlier history is preserved.'); })));
  }
  async function reload(id, cellId) {
    await refresh(); n.historical = null; n.selected = id;
    if (n.ready) { await bridge('reload', { path: entry().path, cellId }); $('notebook-frame').hidden = false; $('notebook-preview').hidden = true; renderToolbar(); }
    else await open(id, { cellId });
  }
  async function sources() {
    if (!entry()) return; await flush(); await refresh(); const snapshot = await request(`/${n.selected}`); const files = await WorkspaceSession.fetch('/api/raw').then(r => readJsonResponse(r, 'Sources'));
    tray('sources', 'Sources & reproduction', `<p class="notebook-muted">Optional source links record fingerprints without imposing a notebook structure. Read workspace sources from Python using <code>../raw/filename</code>.</p><label class="notebook-field">Associate a source or dataset<select id="notebook-source-name"><option value="">Choose a saved source</option>${files.map(file => `<option>${e(file.name)}</option>`).join('')}</select></label><button class="btn" id="notebook-source-add" type="button">Associate source</button>${(snapshot.notebook.metadata.pulsarwiki.sources || []).map(source => `<div class="notebook-source"><strong>${e(source.name)}</strong><p>${source.size.toLocaleString()} bytes · fingerprint recorded ${e(new Date(source.capturedAt).toLocaleDateString())}</p></div>`).join('')}<hr/><p>Run every cell in a fresh kernel and save a separate copy. The report records changed inputs and outputs; a successful run does not prove scientific correctness or identical results.</p><button class="btn" id="notebook-rerun" type="button" ${n.data.runtime.state !== 'running' ? 'disabled' : ''}>Run a clean copy</button><div id="notebook-runs"></div>`);
    $('notebook-source-add').addEventListener('click', guard(async () => { if (!$('notebook-source-name').value) throw new Error('Choose a source.'); await flush(); await refresh(); await request(`/${n.selected}/sources`, 'POST', { name: $('notebook-source-name').value, revision: entry().revision }); await reload(n.selected); await sources(); }));
    $('notebook-rerun').addEventListener('click', guard(async () => { await flush(); await refresh(); await request(`/${n.selected}/rerun`, 'POST', { revision: entry().revision }); await refresh(); renderRuns(); })); renderRuns();
  }
  function renderRuns() {
    if (!$('notebook-runs')) return;
    $('notebook-runs').innerHTML = (n.data.runs || []).filter(run => run.notebookId === n.selected && run.kind === 'clean-rerun').slice(-10).reverse().map(run => `<div class="notebook-source"><strong>Clean rerun · ${e(run.status)}</strong><p>${e(run.error || `${run.changedOutputs?.length || 0} cells have changed outputs.`)}</p>${run.sourceChanges?.map(change => `<p>${e(change)}</p>`).join('') || ''}${run.resultNotebookId ? `<button class="btn" data-run-result="${run.resultNotebookId}" type="button">Open result copy</button>` : ''}${run.status === 'running' ? `<button class="btn" data-run-stop="${run.id}" type="button">Stop rerun</button>` : ''}</div>`).join('');
    $('notebook-runs').querySelectorAll('[data-run-result]').forEach(button => button.addEventListener('click', guard(() => open(button.dataset.runResult))));
    $('notebook-runs').querySelectorAll('[data-run-stop]').forEach(button => button.addEventListener('click', guard(async () => { await request(`/runs/${button.dataset.runStop}`, 'DELETE'); await refresh(); })));
  }
  function recall() {
    tray('recall', 'Recall earlier work', '<form id="notebook-recall-form"><label class="notebook-field">What would you like to recall?<textarea id="notebook-recall-query" maxlength="2000" placeholder="Why did I exclude these observations?" required></textarea></label><label class="notebook-check"><input id="notebook-recall-all" type="checkbox" checked/>Search all notebooks in this workspace</label><button class="btn" type="submit">Recall</button></form><p class="notebook-muted">Only matching saved notebook excerpts are sent to the connected AI. Historical evidence stays linked to its original cells.</p><div id="notebook-recall-tasks"></div>');
    $('notebook-recall-form').addEventListener('submit', guard(async event => { event.preventDefault(); const query = $('notebook-recall-query').value.trim(); const notebookId = $('notebook-recall-all').checked ? undefined : n.selected; if (!$('notebook-recall-all').checked && !notebookId) throw new Error('Open a notebook first.'); await flush(); await request('/recalls', 'POST', { query, notebookId }); $('notebook-recall-query').value = ''; await refresh(); })); renderRecallTasks();
  }
  function renderRecallTasks() {
    if (!$('notebook-recall-tasks')) return;
    $('notebook-recall-tasks').innerHTML = [...(n.data.recalls || [])].reverse().slice(0, 20).map(task => {
      const answer = task.response.replace(/\[N:(\d+)\]/g, (match, index) => { const evidence = task.evidence.find(item => item.reference === `N:${index}`); return evidence ? `[${evidence.path.replace(/[\[\]\\]/g, '')}, revision ${evidence.revision}](${evidence.url})` : match; });
      return `<section class="notebook-recall-item"><strong>${e(task.query)}</strong><small>${e(task.status)} · ${e(new Date(task.createdAt).toLocaleString())}</small><div class="md-body">${answer ? md(answer) : e(task.error || 'Retrieving and reading saved evidence…')}</div><details><summary>Evidence sent (${task.evidence.length} excerpts)</summary>${task.evidence.map(item => `<p><a href="${e(item.url)}">${e(item.path)}, revision ${item.revision}</a></p><pre>${e(item.text)}</pre>`).join('')}</details>${['queued', 'running'].includes(task.status) ? `<button class="btn" data-recall-stop="${task.id}" type="button">Stop recall</button>` : ['failed', 'cancelled', 'interrupted'].includes(task.status) ? `<button class="btn" data-recall-retry="${task.id}" type="button">Retry with original evidence</button>` : ''}</section>`;
    }).join('');
    $('notebook-recall-tasks').querySelectorAll('[data-recall-stop]').forEach(button => button.addEventListener('click', guard(async () => { await request(`/recalls/${button.dataset.recallStop}`, 'DELETE'); await refresh(); })));
    $('notebook-recall-tasks').querySelectorAll('[data-recall-retry]').forEach(button => button.addEventListener('click', guard(async () => { await request(`/recalls/${button.dataset.recallRetry}/retry`, 'POST', {}); await refresh(); })));
  }
  async function transferDialog(input) {
    await show();
    dialog('Add to notebook', `<label class="notebook-field">Notebook<select id="notebook-transfer-target"><option value="">Create a new notebook</option>${n.data.notebooks.filter(book => book.available).map(book => `<option value="${e(book.id)}" ${book.id === n.selected ? 'selected' : ''}>${e(book.path)}</option>`).join('')}</select></label>${field('notebook-transfer-name', 'New notebook filename (used when creating)', 'research-notes.ipynb')}${input.kind === 'passages' ? '<label class="notebook-check"><input id="notebook-transfer-images" type="checkbox"/>Include selected visual regions</label>' : ''}<p class="notebook-muted">The selected material will be inserted as cited Markdown after the active cell, or at the end of an unopened notebook. Other researcher comments are excluded.</p>`, 'Add to notebook', async () => {
      const selection = await flush(); await refresh(); let id = $('notebook-transfer-target').value;
      if (!id) { const book = await request('', 'POST', { name: $('notebook-transfer-name').value }); id = book.id; await refresh(); }
      const book = n.data.notebooks.find(item => item.id === id);
      const result = await request(`/${id}/transfers`, 'POST', { ...input, includeImages: $('notebook-transfer-images')?.checked === true, revision: book.revision, afterCellId: selection.path === book.path ? selection.cellId : undefined });
      window.ActiveReading.closeHelper(); await reload(id, result.insertedCellIds[0]); showPanel('notebooks'); message('Research material added with its original source links.');
    });
    if (input.kind === 'passages') window.ActiveReading.closeHelper();
  }
  async function exportDialog() {
    await flush(); await refresh(); const book = entry(); const snapshot = await request(`/${book.id}`); const sources = snapshot.notebook.metadata.pulsarwiki.sources || [];
    dialog('Export notebook', `<p class="notebook-muted">Download the current .ipynb file, or a JSON bundle containing all saved revisions, provenance, and environment/run records. Local history is not included in a Git clone.</p><label class="notebook-field">Export format<select id="notebook-export-format"><option value="ipynb">Current Jupyter notebook (.ipynb)</option><option value="history">Notebook with history (.json)</option></select></label>${sources.map((source, index) => `<label class="notebook-check"><input type="checkbox" data-export-source="${index}"/>Include ${e(source.name)} in the history bundle</label>`).join('')}`, 'Download', async () => {
      if ($('notebook-export-format').value === 'ipynb') download(snapshot.notebook, book.path.split('/').pop(), 'application/x-ipynb+json');
      else { const includeSources = [...$('notebook-dialog-body').querySelectorAll('[data-export-source]:checked')].map(node => sources[Number(node.dataset.exportSource)].name); download(await request(`/${book.id}/export`, 'POST', { includeSources }), `${book.path.split('/').pop()}.history.json`, 'application/json'); }
    });
  }
  function download(value, name, type) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function route(hashValue = location.hash) {
    const match = /^#notebook\/([a-f0-9-]{36})(?:\?(.*))?$/.exec(hashValue); if (!match) return false;
    const query = new URLSearchParams(match[2]); await open(match[1], { revision: query.get('revision') || undefined, cellId: query.get('cell'), history: false }); return true;
  }
  async function prepareToLeave() { await flush(); if (n.data?.runtime.state === 'running' || n.data?.runtime.state === 'starting') await request('/runtime/stop', 'POST', {}); disconnect(); }
  $('notebook-new').addEventListener('click', newNotebook); $('notebook-empty-new').addEventListener('click', newNotebook);
  $('notebook-list').addEventListener('click', guard(event => { const button = event.target.closest('[data-notebook]'); if (button) return open(button.dataset.notebook); }));
  $('notebook-import').addEventListener('click', () => $('notebook-file').click());
  $('notebook-file').addEventListener('change', guard(async () => { const file = $('notebook-file').files[0]; if (!file) return; if (file.size > 25 * 1024 * 1024) throw new Error('Choose a notebook smaller than 25 MB.'); const notebook = JSON.parse(await file.text()); const book = await request('', 'POST', { name: file.name, notebook }); $('notebook-file').value = ''; await refresh(); await open(book.id); }));
  $('notebook-start').addEventListener('click', guard(async () => { if (n.data?.runtime.state === 'running') { await flush(); await connect(); } else { if ($('notebook-python').value !== n.data?.runtime.python) await request('/runtime/python', 'PUT', { python: $('notebook-python').value }); await request('/runtime/start', 'POST', {}); message('Starting local JupyterLab…'); await refresh(); } }));
  $('notebook-stop').addEventListener('click', guard(async () => { await flush(); await request('/runtime/stop', 'POST', {}); disconnect(); await refresh(); if (entry()) await preview(n.selected); message('Python stopped. Saved notebooks and history are preserved.'); }));
  $('notebook-python-save').addEventListener('click', guard(async () => { message('Checking Python…'); await request('/runtime/python', 'PUT', { python: $('notebook-python').value }); await refresh(); message(n.data.runtime.environment?.ready ? 'Python environment is ready.' : 'Install the missing packages in this Python environment.'); }));
  $('notebook-save').addEventListener('click', guard(async () => { await flush(); await refresh(); message('Notebook saved.'); }));
  $('notebook-rename').addEventListener('click', guard(async () => { await flush(); await refresh(); const book = entry(); dialog('Rename notebook', field('notebook-name', 'Filename', book.path), 'Rename', async () => { if (n.ready) await bridge('close'); await request(`/${book.id}`, 'PATCH', { name: $('notebook-name').value, revision: book.revision }); await refresh(); await open(book.id); }); }));
  $('notebook-checkpoint').addEventListener('click', () => dialog('Save a checkpoint', field('notebook-checkpoint-label', 'Name', '', 'Before changing the noise model'), 'Save checkpoint', async () => { await flush(); await refresh(); await request(`/${n.selected}/checkpoints`, 'POST', { revision: entry().revision, label: $('notebook-checkpoint-label').value }); await refresh(); message('Named checkpoint saved.'); }));
  $('notebook-history').addEventListener('click', guard(async () => { await flush(); await refresh(); tray('history', 'Version history'); renderHistory(); }));
  $('notebook-sources').addEventListener('click', guard(sources)); $('notebook-recall').addEventListener('click', recall); $('notebook-export').addEventListener('click', guard(exportDialog));
  $('notebook-tray-close').addEventListener('click', () => { n.tray = ''; $('notebook-tray').hidden = true; }); $('notebook-dialog-close').addEventListener('click', () => $('notebook-dialog').close());
  document.addEventListener('click', guard(async event => { const link = event.target.closest('a[href^="/#notebook/"]'); if (link && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey) { event.preventDefault(); await route(new URL(link.href).hash); history.pushState(null, '', link.getAttribute('href')); } }));
  window.addEventListener('popstate', guard(() => route())); window.addEventListener('hashchange', guard(() => route()));
  window.ResearchNotebooks = { show, open: guard(open), route, transfer: guard(transferDialog), prepareToLeave, theme: theme => { if (n.ready) void guard(() => bridge('theme', { theme }))(); } };
})();
