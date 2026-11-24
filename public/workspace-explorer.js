(() => {
  'use strict';

  const root = document.getElementById('workspace-explorer-entries');
  const endpoint = '/api/workspaces/explorer';
  const fileSymbols = new Map(Object.entries({
    pdf: 'M6 14c2-2 4-5 3-6s-1 4 3 5c1 .3-2-2-6 1Z',
    md: 'M5.5 13V9l1.25 1.5L8 9v4m3-4v4m-1.5-1.5L11 13l1.5-1.5',
    json: 'M7.5 8.5c-2 0 0 2.5-2 3 2 .5 0 3 2 3m3-6c2 0 0 2.5 2 3-2 .5 0 3-2 3',
    ipynb: 'M6.5 8.5h5v6h-5zm-1 1.5h2m-2 3h2',
    bib: 'M7 8.5h4v6l-2-1.5L7 14.5Z',
    csv: 'M5.5 8.5h7v6h-7zm0 3h7M9 8.5v6',
    js: 'M7.5 9.5 5.5 11.5l2 2m3-4 2 2-2 2',
    txt: 'M6 9h6m-6 2.5h6M6 14h4',
    png: 'M5.5 14l3-4 4 4zm5.5-4.5h.1',
    png: 'M5.5 14l3-4 4 4zm5.5-4.5h.1',
  }));
  const fileTypes = new Map(Object.entries({
    markdown: 'md',
    jsonl: 'json',
    tsv: 'csv',
    mjs: 'js', cjs: 'js', ts: 'js', py: 'js', css: 'js', html: 'js',
    jpg: 'png', jpeg: 'png', gif: 'png', svg: 'png', webp: 'png', ico: 'png',
    jpg: 'png', jpeg: 'png', gif: 'png', svg: 'png', webp: 'png', ico: 'png',
  }));

  function fileAction(path) {
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
    const label = document.createElement('span');
    label.textContent = entry.name;
    const extension = /\.([^.]+)$/.exec(entry.name)?.[1].toLowerCase();
    const symbol = fileSymbols.get(fileTypes.get(extension) ?? extension);
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(svgNamespace, 'svg');
    icon.classList.add('explorer-file-icon');
    icon.setAttribute('viewBox', '0 0 18 18');
    icon.setAttribute('aria-hidden', 'true');
    const drawing = document.createElementNS(svgNamespace, 'path');
    drawing.setAttribute('d', `M4 1.5h6l4 4v11H4zM10 1.5v4h4 ${symbol ?? ''}`);
    icon.append(drawing);
    row.append(icon, label);
    if (action) {
      row.type = 'button';
      row.addEventListener('click', () => { void action(); });
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
    const refreshChildren = folderLoader(children, path);
    const refreshOpenFolder = () => folder.open ? refreshChildren() : undefined;
    folder.addEventListener('toggle', refreshOpenFolder);
    return { element: folder, refresh: refreshOpenFolder };
  }

  function showStatus(list, message, alert = false) {
    const status = document.createElement('li');
    status.className = 'explorer-status';
    status.setAttribute('role', alert ? 'alert' : 'status');
    status.textContent = message;
    list.replaceChildren(status);
  }

  function folderLoader(list, path) {
    let rows = new Map();
    let pending = Promise.resolve();

    async function load() {
      if (!list.firstElementChild) showStatus(list, 'Loading folder…');
      let entries;
      try {
        const response = await window.WorkspaceSession.fetch(`${endpoint}?${new URLSearchParams({ path })}`);
        const listing = await readJsonResponse(response, 'Project files');
        entries = listing.entries;
      } catch (error) {
        if (!rows.size) showStatus(list, error.message, true);
        return;
      }

      if (!entries.length) {
        if (rows.size || list.firstElementChild?.textContent !== 'This folder is empty.') {
          showStatus(list, 'This folder is empty.');
        }
        rows.clear();
        return;
      }

      const nextRows = new Map();
      for (const entry of entries) {
        const relative = path ? `${path}/${entry.name}` : entry.name;
        const key = entry.directory ? `${entry.name}/` : entry.name;
        let row = rows.get(key);
        if (!row) {
          const folder = entry.directory ? makeFolder(entry, relative) : null;
          const item = document.createElement('li');
          item.append(folder ? folder.element : makeFile(entry, relative));
          row = { item, folder };
        }
        nextRows.set(key, row);
      }

      if (!rows.size) list.replaceChildren();
      for (const [key, row] of rows) {
        if (!nextRows.has(key)) row.item.remove();
      }
      let nextItem = list.firstElementChild;
      for (const { item } of nextRows.values()) {
        if (item === nextItem) nextItem = item.nextElementSibling;
        else list.insertBefore(item, nextItem);
      }
      rows = nextRows;
      await Promise.all([...rows.values()].map(row => row.folder?.refresh()));
    }

    // A change arriving during a request needs a fresh listing after it finishes.
    return () => {
      pending = pending.then(load);
      return pending;
    };
  }

  const refreshTree = folderLoader(root, '');
  window.WorkspaceExplorer = { show: refreshTree, refresh: refreshTree };
})();
