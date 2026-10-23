(() => {
  const $ = id => document.getElementById(id);
  const editor = $('references-editor');
  const save = $('references-save');
  const reload = $('references-reload');
  const status = $('references-status');
  const library = $('references-library');
  const cards = $('references-cards');
  const search = $('references-search');
  const typeFilter = $('references-type');
  const libraryToggle = $('references-library-toggle');
  const sourceToggle = $('references-source-toggle');
  const labels = { article: 'Journal article', inproceedings: 'Conference paper', conference: 'Conference paper', book: 'Book', incollection: 'Book chapter', inbook: 'Book chapter', phdthesis: 'PhD thesis', mastersthesis: 'Master’s thesis', techreport: 'Technical report', misc: 'Other', unpublished: 'Unpublished', proceedings: 'Proceedings', booklet: 'Booklet', manual: 'Manual' };
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const readable = value => esc(BibTeX.text(value));
  const tag = (value, extra = '') => `<span class="reference-tag ${extra}">${esc(value)}</span>`;
  let parsed = { entries: [], warnings: [] };
  let sourceView = false;
  let revision = null;
  let saved = '';
  let busy = false;
  const dirty = () => revision !== null && editor.value !== saved;
  const render = () => {
    save.disabled = busy || !dirty();
    reload.disabled = busy;
    editor.disabled = busy || revision === null;
    libraryToggle.disabled = sourceToggle.disabled = busy;
  };
  function safeUrl(value) {
    try { const url = new URL(BibTeX.text(value)); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  }
  function paperCard(entry) {
    const f = entry.fields;
    const authors = BibTeX.authors(f.author || f.editor);
    const byline = authors.slice(0, 3).join(' · ') + (authors.length > 3 ? ` · +${authors.length - 3} authors` : '');
    const publication = [f.journal || f.booktitle || f.publisher || f.school || f.institution, f.volume && `Volume ${BibTeX.text(f.volume)}`, f.number && `No. ${BibTeX.text(f.number)}`, f.pages && `pp. ${BibTeX.text(f.pages).replace(/--/g, '–')}`].filter(Boolean).map(BibTeX.text).join(' · ');
    const keywords = BibTeX.text(f.keywords || f.keyword || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
    const doi = BibTeX.text(f.doi || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
    const links = [];
    const link = (url, label) => { if (url) links.push(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} <span aria-hidden="true">↗</span></a>`); };
    if (doi) link(`https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi, '/')}`, 'DOI');
    if (f.eprint && /arxiv/i.test(f.archiveprefix || f.eprinttype || '')) link(`https://arxiv.org/abs/${encodeURIComponent(BibTeX.text(f.eprint))}`, 'arXiv');
    link(safeUrl(f.url), 'Publication');
    const fieldNames = { author: 'Authors', editor: 'Editors', booktitle: 'Book title', journal: 'Journal', doi: 'DOI', url: 'URL', eprint: 'Preprint ID', archiveprefix: 'Archive', file: 'Source file', crossref: 'Parent reference' };
    const fields = Object.entries(f).filter(([key]) => key !== 'title').map(([key, value]) => `<div><dt>${esc(fieldNames[key] || key.replace(/^./, s => s.toUpperCase()))}</dt><dd>${readable(value)}</dd></div>`).join('');
    return `<article class="reference-card">
      <div class="reference-card-top">${tag(labels[entry.type] || entry.type)}${f.year ? tag(BibTeX.text(f.year)) : ''}<span class="reference-key">${esc(entry.key)}</span></div>
      <h4>${readable(f.title || entry.key)}</h4>
      ${byline ? `<p class="reference-authors">${esc(byline)}</p>` : '<p class="reference-authors reference-muted">Authors not recorded</p>'}
      ${publication ? `<p class="reference-publication">${esc(publication)}</p>` : ''}
      ${keywords.length ? `<div class="reference-keywords">${keywords.map(keyword => tag(keyword)).join('')}</div>` : ''}
      ${f.note ? `<p class="reference-note">${readable(f.note)}</p>` : ''}
      <div class="reference-card-bottom"><details><summary>All properties <span>${Object.keys(f).length}</span></summary>${f.abstract ? `<p class="reference-abstract">${readable(f.abstract)}</p>` : ''}<dl>${fields}</dl></details>${links.length ? `<nav aria-label="Links for ${readable(f.title || entry.key)}">${links.join('')}</nav>` : ''}</div>
    </article>`;
  }
  function renderLibrary() {
    const query = search.value.trim().toLocaleLowerCase();
    const entries = parsed.entries.filter(entry => (!typeFilter.value || entry.type === typeFilter.value) && (!query || BibTeX.text([entry.key, entry.type, ...Object.values(entry.fields)].join(' ')).toLocaleLowerCase().includes(query)));
    $('references-count').textContent = `${entries.length}${entries.length !== parsed.entries.length ? ` of ${parsed.entries.length}` : ''} reference${(entries.length !== parsed.entries.length ? parsed.entries.length : entries.length) === 1 ? '' : 's'}`;
    const groups = new Map();
    for (const entry of entries) {
      const year = BibTeX.text(entry.fields.year || '') || 'Undated';
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(entry);
    }
    cards.innerHTML = [...groups].sort(([a], [b]) => a === 'Undated' ? 1 : b === 'Undated' ? -1 : b.localeCompare(a, undefined, { numeric: true })).map(([year, papers]) => `<section class="reference-year"><header><h3>${esc(year)}</h3><span>${papers.length} reference${papers.length === 1 ? '' : 's'}</span></header><div class="reference-year-papers">${papers.map(paperCard).join('')}</div></section>`).join('') || `<div class="references-empty"><h3>${query || typeFilter.value ? 'No matching references' : 'Your reading list starts here'}</h3><p>${query || typeFilter.value ? 'Try another search or reference type.' : 'Import a paper or add entries in BibTeX to build your bibliography.'}</p></div>`;
  }
  function refreshLibrary() {
    parsed = BibTeX.parse(editor.value);
    const selected = typeFilter.value;
    typeFilter.innerHTML = '<option value="">All types</option>' + [...new Set(parsed.entries.map(entry => entry.type))].sort().map(type => `<option value="${esc(type)}">${esc(labels[type] || type)}</option>`).join('');
    typeFilter.value = parsed.entries.some(entry => entry.type === selected) ? selected : '';
    const warning = $('references-warning');
    warning.hidden = !parsed.warnings.length;
    warning.textContent = parsed.warnings.length ? `${parsed.warnings.join(' ')} The library may be incomplete. Your source is preserved in BibTeX.` : '';
    renderLibrary();
  }
  function setView(showSource) {
    sourceView = showSource;
    library.hidden = sourceView;
    editor.hidden = !sourceView;
    libraryToggle.setAttribute('aria-pressed', String(!sourceView));
    sourceToggle.setAttribute('aria-pressed', String(sourceView));
    if (!sourceView) refreshLibrary();
  }
  libraryToggle.addEventListener('click', () => setView(false));
  sourceToggle.addEventListener('click', () => setView(true));
  search.addEventListener('input', renderLibrary);
  typeFilter.addEventListener('change', renderLibrary);
  async function request(options) {
    return readJsonResponse(await workspaceFetch('/api/references', options), 'References');
  }
  async function load() {
    if (busy) return;
    busy = true; render(); status.textContent = 'Loading references.bib…';
    try {
      const data = await request();
      saved = data.content; revision = data.revision; editor.value = saved;
      refreshLibrary();
      status.textContent = '';
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; render(); }
  }
  editor.addEventListener('input', () => {
    status.textContent = dirty() ? 'Unsaved changes' : 'All changes saved'; render();
  });
  save.addEventListener('click', async () => {
    if (busy || !dirty()) return;
    busy = true; render(); status.textContent = 'Saving references.bib…';
    try {
      const data = await request({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editor.value, revision }) });
      saved = data.content; revision = data.revision;
      editor.value = saved;
      refreshLibrary();
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
  window.ReferencesEditor = { open: () => dirty() ? Promise.resolve() : load() };
})();
