(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const dialog = byId('workspace-explorer');
  const root = byId('workspace-explorer-entries');
  const trigger = byId('workspace-explorer-toggle');
  const refresh = byId('workspace-explorer-refresh');
  const endpoint = '/api/workspaces/explorer';
  let rootLoaded = false;
  let rootLoading = false;

  function fileAction(path) {
    if (path === 'references.bib') return () => byId('wiki-sidebar-references').click();
    const wiki = /^wiki\/([a-z0-9_+.-]+)\.md$/.exec(path);
    if (wiki && !wiki[1].includes('..')) return () => window.openPage(wiki[1]);
    const source = /^raw\/([^/]+)\.([^.\/]+)$/.exec(path);
    if (source && !path.includes('..')) return () => window.openRawFile(path.slice(4), source[2]);
    if (/^notebooks\/.+\.ipynb$/.test(path)) {
      return () => window.ResearchNotebooks.open(null, { path: path.slice('notebooks/'.length) });
    }
    return null;
  }

  function makeFile(entry, path) {
    const action = fileAction(path);
    const row = document.createElement(action ? 'button' : 'a');
    row.className = 'explorer-row explorer-file';
    row.textContent = entry.name;
    if (action) {
      row.type = 'button';
      row.addEventListener('click', () => {
        dialog.close();
        void action();
      });
    } else {
      row.href = window.WorkspaceSession.url(`${endpoint}/download?${new URLSearchParams({ path })}`);
      row.download = entry.name;
      row.title = `Download ${entry.name}`;
    }
    return row;
  }

  function makeFolder(entry, path) {
    const folder = document.createElement('details');
    const summary = document.createElement('summary');
    summary.className = 'explorer-row explorer-folder';
    summary.textContent = entry.name;
    const children = document.createElement('ul');
    children.className = 'explorer-list';
    folder.append(summary, children);
    let loaded = false;
    let loading = false;
    folder.addEventListener('toggle', async () => {
      if (!folder.open || loaded || loading) return;
      loading = true;
      loaded = await loadFolder(children, path);
      loading = false;
    });
    return folder;
  }

  function showStatus(list, message, alert = false) {
    const status = document.createElement('li');
    status.className = 'explorer-status';
    status.setAttribute('role', alert ? 'alert' : 'status');
    status.textContent = message;
    list.replaceChildren(status);
  }

  async function loadFolder(list, path) {
    showStatus(list, 'Loading folder…');
    try {
      const response = await window.WorkspaceSession.fetch(`${endpoint}?${new URLSearchParams({ path })}`);
      const { name, entries } = await readJsonResponse(response, 'Project files');
      if (!path) byId('workspace-explorer-name').textContent = name;
      if (!entries.length) {
        showStatus(list, 'This folder is empty.');
        return true;
      }
      const fragment = document.createDocumentFragment();
      for (const entry of entries) {
        const relative = path ? `${path}/${entry.name}` : entry.name;
        const item = document.createElement('li');
        item.append(entry.directory ? makeFolder(entry, relative) : makeFile(entry, relative));
        fragment.append(item);
      }
      list.replaceChildren(fragment);
      return true;
    } catch (error) {
      showStatus(list, error.message, true);
      return false;
    }
  }

  async function loadRoot() {
    if (rootLoading) return;
    rootLoading = true;
    rootLoaded = await loadFolder(root, '');
    rootLoading = false;
  }

  trigger.addEventListener('click', () => {
    dialog.showModal();
    if (!rootLoaded) void loadRoot();
  });
  byId('workspace-explorer-close').addEventListener('click', () => dialog.close());
  refresh.addEventListener('click', () => { void loadRoot(); });
})();
