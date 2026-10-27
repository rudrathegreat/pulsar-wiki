(() => {
  const $ = id => document.getElementById(id);
  const editor = $('references-editor');
  const source = $('references-source');
  const lineNumbers = $('references-line-numbers');
  const gutter = window.SourceEditor(editor, source, lineNumbers);
  const syncLineNumbers = gutter.sync;
  const syncGutterScroll = gutter.syncScroll;
  const save = $('references-save');
  const reload = $('references-reload');
  const status = $('references-status');
  const preview = $('references-preview');
  const tree = $('references-tree');
  const search = $('references-search');
  const typeFilter = $('references-type');
  const previewToggle = $('references-preview-toggle');
  const sourceToggle = $('references-source-toggle');
  const labels = { article: 'Journal article', inproceedings: 'Conference paper', conference: 'Conference paper', book: 'Book', incollection: 'Book chapter', inbook: 'Book chapter', phdthesis: 'PhD thesis', mastersthesis: 'Master’s thesis', techreport: 'Technical report', misc: 'Other', unpublished: 'Unpublished', proceedings: 'Proceedings', booklet: 'Booklet', manual: 'Manual' };
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const readable = value => esc(BibTeX.text(value));
  const tag = (value, extra = '') => `<span class="reference-tag ${extra}">${esc(value)}</span>`;
  let parsed = { entries: [], warnings: [] };
  const folded = new Set();
  const expandedEntries = new Set();
  let sourceView = false;
  let revision = null;
  let saved = '';
  let busy = false;
  const dirty = () => revision !== null && editor.value !== saved;
  const render = () => {
    save.disabled = busy || !dirty();
    reload.disabled = busy;
    editor.disabled = busy || revision === null;
    previewToggle.disabled = sourceToggle.disabled = busy;
  };
  function safeUrl(value) {
    try { const url = new URL(BibTeX.text(value)); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  }
  function sourceFilename(value) {
    const path = BibTeX.text(value).trim().replace(/\\/g, '/').replace(/^\.\//, '');
    const name = path.replace(/^raw\//, '');
    return name && !/[/:\x00-\x1f]/.test(name) && name !== '.' && name !== '..' ? name : '';
  }
  function authorPaper(entry) {
    const fields = entry.fields;
    const authors = BibTeX.authors(fields.author || '');
    // Positional lists retain explicit '-' placeholders for authors without an ID.
    const ids = String(fields.orcid || '').split(/\s+and\s+|\s*;\s*/i);
    const authorOrcids = ids.length === authors.length ? ids : authors.map(() => null);
    return { id: String(parsed.entries.indexOf(entry)), title: BibTeX.text(fields.title || ''), authors, authorOrcids,
      doi: BibTeX.text(fields.doi || ''), bibcode: BibTeX.text(fields.bibcode || fields.adsbibcode || ''),
      arxivId: /arxiv/i.test(fields.archiveprefix || fields.eprinttype || '') ? BibTeX.text(fields.eprint || '') : null };
  }
  function entryTree(entry) {
    const path = String(parsed.entries.indexOf(entry));
    const fields = Object.entries(entry.fields).map(([key, value]) => {
      const fieldPath = `${path}/${key}`;
      if (key === 'author' || key === 'editor') {
        const names = BibTeX.authors(value);
        const paper = authorPaper(entry);
        const profiles = key === 'author' && window.AuthorOrcids;
        return `<div class="reference-field reference-collection"><dt>${esc(key)}</dt><dd><details data-path="${esc(fieldPath)}"${folded.has(fieldPath) ? '' : ' open'}><summary><span class="reference-meta">${names.length} ${key === 'author' ? 'author' : 'editor'}${names.length === 1 ? '' : 's'}</span></summary><ol class="reference-values"${profiles ? ` data-orcid-paper="${esc(path)}"` : ''}>${names.map((name, i) => `<li${profiles ? ` data-orcid-index="${i}"` : ''}>${profiles ? profiles.author(name, paper.authorOrcids[i]) : esc(name)}</li>`).join('')}</ol></details></dd></div>`;
      }
      if (key === 'keywords' || key === 'keyword') {
        const keywords = BibTeX.text(value).split(/[,;]/).map(s => s.trim()).filter(Boolean);
        return `<div class="reference-field"><dt>${esc(key)}</dt><dd class="reference-keywords">${keywords.map(keyword => tag(keyword)).join('')}</dd></div>`;
      }
      if (key === 'file') {
        const name = sourceFilename(value);
        if (name) return `<div class="reference-field"><dt>file</dt><dd><a href="#file/${encodeURIComponent(name)}" data-reference-file="${esc(name)}">${readable(value)}</a></dd></div>`;
      }
      let url = '';
      if (key === 'url') url = safeUrl(value);
      if (key === 'doi') {
        const doi = BibTeX.text(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
        if (doi) url = `https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi, '/')}`;
      }
      if (key === 'eprint' && /arxiv/i.test(entry.fields.archiveprefix || entry.fields.eprinttype || '')) url = `https://arxiv.org/abs/${encodeURIComponent(BibTeX.text(value))}`;
      const wide = ['title', 'abstract', 'note', 'annotation'].includes(key) ? ' reference-field-wide' : '';
      return `<div class="reference-field${wide}"><dt>${esc(key)}</dt><dd>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${readable(value)}</a>` : readable(value)}</dd></div>`;
    }).join('');
    return `<details class="reference-entry" data-path="${path}"${expandedEntries.has(path) ? ' open' : ''}><summary><span class="reference-key">${esc(entry.key)}</span>${tag(entry.type)}<span class="reference-meta">${Object.keys(entry.fields).length} properties</span><button class="btn reference-edit" type="button" data-reference-edit="${path}" aria-label="Edit ${esc(entry.key)} in BibTeX">Edit</button></summary><dl class="reference-fields">${fields}</dl></details>`;
  }
  function renderPreview() {
    const query = search.value.trim().toLocaleLowerCase();
    const entries = parsed.entries.filter(entry => (!typeFilter.value || entry.type === typeFilter.value) && (!query || BibTeX.text([entry.key, entry.type, ...Object.values(entry.fields)].join(' ')).toLocaleLowerCase().includes(query)));
    tree.innerHTML = entries.map(entryTree).join('') || `<div class="references-empty"><h3>${query || typeFilter.value ? 'No matching references' : 'No entries'}</h3><p>${query || typeFilter.value ? 'Try another search or reference type.' : 'Add entries in BibTeX or import a paper.'}</p></div>`;
    void window.AuthorOrcids?.hydrate(tree, entries.map(authorPaper));
  }
  function refreshPreview() {
    parsed = BibTeX.parse(editor.value, { locations: true });
    const selected = typeFilter.value;
    typeFilter.innerHTML = '<option value="">All types</option>' + [...new Set(parsed.entries.map(entry => entry.type))].sort().map(type => `<option value="${esc(type)}">${esc(labels[type] || type)}</option>`).join('');
    typeFilter.value = parsed.entries.some(entry => entry.type === selected) ? selected : '';
    const warning = $('references-warning');
    warning.hidden = !parsed.warnings.length;
    warning.textContent = parsed.warnings.length ? `${parsed.warnings.join(' ')} The preview may be incomplete. Your source is preserved in BibTeX.` : '';
    renderPreview();
  }
  function setView(showSource) {
    sourceView = showSource;
    preview.hidden = sourceView;
    editor.hidden = !sourceView;
    source.hidden = !sourceView;
    if (sourceView) syncLineNumbers();
    previewToggle.setAttribute('aria-pressed', String(!sourceView));
    sourceToggle.setAttribute('aria-pressed', String(sourceView));
    if (!sourceView) refreshPreview();
  }
  previewToggle.addEventListener('click', () => setView(false));
  sourceToggle.addEventListener('click', () => setView(true));
  search.addEventListener('input', renderPreview);
  typeFilter.addEventListener('change', renderPreview);
  function selectEntry(entry) {
    setView(true);
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(entry.start, entry.end);
    const line = editor.value.slice(0, entry.start).split('\n').length - 1;
    editor.scrollTop = gutter.lineOffset(line);
    editor.scrollLeft = 0;
    syncGutterScroll();
    editor.scrollIntoView({ block: 'nearest' });
    status.textContent = `Editing ${entry.key}${dirty() ? ' \u00b7 Unsaved changes' : ''}`;
  }
  tree.addEventListener('click', event => {
    const edit = event.target.closest('[data-reference-edit]');
    if (edit) {
      event.preventDefault();
      if (busy || revision === null) return;
      const entry = parsed.entries[Number(edit.dataset.referenceEdit)];
      if (!entry) return;
      selectEntry(entry);
      return;
    }
    const link = event.target.closest('[data-reference-file]');
    if (!link || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const name = link.dataset.referenceFile;
    const ext = name.includes('.') ? name.split('.').pop() : '';
    void window.openRawFile(name, ext);
  });
  tree.addEventListener('toggle', event => {
    if (event.target.isConnected === false) return;
    const path = event.target.dataset?.path;
    if (path !== undefined) {
      if (!path.includes('/')) {
        if (event.target.open) expandedEntries.add(path); else expandedEntries.delete(path);
        return;
      }
      if (event.target.open) folded.delete(path); else folded.add(path);
    }
  }, true);
  function foldAll(collapse) {
    parsed.entries.forEach((entry, index) => {
      if (collapse) expandedEntries.delete(String(index)); else expandedEntries.add(String(index));
      for (const path of Object.keys(entry.fields).map(key => `${index}/${key}`)) {
        if (collapse) folded.add(path); else folded.delete(path);
      }
    });
    renderPreview();
  }
  $('references-expand').addEventListener('click', () => foldAll(false));
  $('references-collapse').addEventListener('click', () => foldAll(true));
  async function request(options) {
    return readJsonResponse(await workspaceFetch('/api/references', options), 'References');
  }
  let loading = null;
  async function load() {
    if (busy) return;
    busy = true; render(); status.textContent = 'Loading references.bib…';
    try {
      const data = await request();
      saved = data.content; revision = data.revision; editor.value = saved;
      syncLineNumbers();
      folded.clear();
      expandedEntries.clear();
      refreshPreview();
      status.textContent = '';
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; render(); }
  }
  editor.addEventListener('input', () => {
    syncLineNumbers();
    status.textContent = dirty() ? 'Unsaved changes' : 'All changes saved'; render();
  });
  save.addEventListener('click', async () => {
    if (busy || !dirty()) return;
    busy = true; render(); status.textContent = 'Saving references.bib…';
    try {
      const data = await request({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editor.value, revision }) });
      saved = data.content; revision = data.revision;
      editor.value = saved;
      syncLineNumbers();
      refreshPreview();
      status.textContent = 'Saved references.bib';
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; render(); }
  });
  reload.addEventListener('click', () => {
    if (dirty() && !window.confirm('Discard unsaved changes and reload references.bib?')) return;
    void load();
  });
  window.addEventListener('beforeunload', event => {
    if (dirty()) { event.preventDefault(); event.returnValue = ''; }
  });
  function open() {
    if (dirty()) return Promise.resolve();
    if (!loading) loading = load().finally(() => { loading = null; });
    return loading;
  }
  window.ReferencesEditor = { open, async openEntry(key) {
    await open();
    const entry = BibTeX.parse(editor.value, { locations: true }).entries.find(item => item.key === key);
    if (!entry) throw new Error(`Reference ${key} was not found in references.bib.`);
    selectEntry(entry);
  } };
})();
