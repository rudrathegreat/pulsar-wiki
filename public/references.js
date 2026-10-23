(() => {
  const $ = id => document.getElementById(id);
  const editor = $('references-editor');
  const save = $('references-save');
  const reload = $('references-reload');
  const status = $('references-status');
  let revision = null;
  let saved = '';
  let busy = false;
  const dirty = () => revision !== null && editor.value !== saved;
  const render = () => {
    save.disabled = busy || !dirty();
    reload.disabled = busy;
    editor.disabled = busy || revision === null;
  };
  async function request(options) {
    return readJsonResponse(await workspaceFetch('/api/references', options), 'References');
  }
  async function load() {
    if (busy) return;
    busy = true; render(); status.textContent = 'Loading references.bib…';
    try {
      const data = await request();
      saved = data.content; revision = data.revision; editor.value = saved;
      status.textContent = 'Loaded references.bib';
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
