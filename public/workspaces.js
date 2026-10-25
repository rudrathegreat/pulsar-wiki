/* Folder selection stays separate from document and chat state. */
(() => {
  const $ = id => document.getElementById(id);
  let info = null;
  let picking = false;
  let opening = false;
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem('pw-recent-workspaces') || '[]'); } catch { /* optional history */ }
  if (!Array.isArray(recent)) recent = [];
  const showError = error => {
    const target = $(info?.active ? 'workspace-status' : 'workspace-error');
    target.textContent = error.message; target.hidden = false;
  };
  const setBusy = busy => {
    for (const id of ['workspace-open', 'workspace-switch', 'workspace-change', 'workspace-close', 'workspace-new', 'workspace-create-browse', 'workspace-create-submit', 'workspace-create-cancel', 'workspace-create-name', 'workspace-create-parent']) $(id).disabled = busy;
  };
  window.setWorkspaceLoading = loading => {
    if (loading) document.body.classList.add('workspace-loading');
    else document.body.classList.remove('workspace-loading');
    $('workspace-welcome').inert = loading;
    $('app').inert = loading;
  };
  const json = (url, options) => workspaceFetch(url, options).then(response => readJsonResponse(response, 'Workspace'));
  const post = (url, body) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function renderRecent(serverRecent) {
    const unique = [...new Map([...serverRecent, ...recent].filter(item => item && typeof item.path === 'string').map(item => [item.path, item])).values()].slice(0, 8);
    if (!unique.length) return;
    $('workspace-recents').replaceChildren();
    for (const item of unique) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'workspace-recent'; button.title = item.path;
      const name = document.createElement('strong'); name.textContent = item.name || item.path;
      const path = document.createElement('span'); path.textContent = item.path;
      button.append(name, path); button.addEventListener('click', () => { void select(item.path); }); $('workspace-recents').append(button);
    }
  }

  async function select(path, creation = null) {
    if (opening) return;
    opening = true;
    setBusy(true);
    window.setWorkspaceLoading(true);
    $('workspace-error').textContent = ''; $('workspace-status').hidden = true;
    try {
      if (info?.active) await window.ResearchNotebooks?.prepareToLeave();
      const result = await post(creation ? '/api/workspaces/create' : '/api/workspaces/open', creation || { path });
      workspaceId = result.active.id;
      sessionStorage.setItem('pw-workspace', workspaceId);
      recent = [result.active, ...recent.filter(item => item.path !== result.active.path)].slice(0, 8);
      try { localStorage.setItem('pw-recent-workspaces', JSON.stringify(recent)); } catch { /* optional history */ }
      // Reinitialise all caches, timers and document state when changing projects.
      if (info?.active) location.assign('/'); else location.reload();
    } catch (error) { window.setWorkspaceLoading(false); showError(error); }
    finally { opening = false; setBusy(picking); }
  }

  async function browse() {
    if (picking || opening) return;
    picking = true; setBusy(true);
    $('workspace-error').textContent = ''; $('workspace-status').hidden = true;
    try {
      const result = await post('/api/workspaces/pick', {});
      if (!result.path) return;
      await select(result.path);
    } catch (error) { showError(error); }
    finally { picking = false; setBusy(false); }
  }

  $('workspace-open').addEventListener('click', browse);
  $('workspace-new').addEventListener('click', () => {
    $('workspace-create-form').hidden = false;
    $('workspace-new').setAttribute('aria-expanded', 'true');
    $('workspace-create-name').focus();
  });
  $('workspace-create-cancel').addEventListener('click', () => {
    $('workspace-create-form').hidden = true;
    $('workspace-new').setAttribute('aria-expanded', 'false');
    $('workspace-error').textContent = '';
    $('workspace-new').focus();
  });
  $('workspace-create-browse').addEventListener('click', async () => {
    if (picking || opening) return;
    picking = true; setBusy(true);
    $('workspace-error').textContent = '';
    try {
      const result = await post('/api/workspaces/pick', { path: $('workspace-create-parent').value.trim() || info?.defaultPath });
      if (result.path) $('workspace-create-parent').value = result.path;
    } catch (error) { showError(error); }
    finally { picking = false; setBusy(false); }
  });
  $('workspace-create-form').addEventListener('submit', event => {
    event.preventDefault();
    if (picking || opening) return;
    return select(null, { name: $('workspace-create-name').value.trim(), parentPath: $('workspace-create-parent').value.trim() });
  });
  $('workspace-switch').addEventListener('click', browse);
  $('workspace-change').addEventListener('click', browse);
  $('workspace-close').addEventListener('click', async () => {
    try {
      await window.ResearchNotebooks?.prepareToLeave();
      await post('/api/workspaces/close', {});
      sessionStorage.setItem('pw-workspace', 'closed'); location.assign('/');
    } catch (error) { showError(error); }
  });

  window.initializeWorkspaceUi = async () => {
    window.setWorkspaceLoading(true);
    try {
      info = await json('/api/workspaces');
      renderRecent(info.recent);
      if (!info.active) {
        workspaceId = 'closed'; sessionStorage.setItem('pw-workspace', 'closed');
        window.setWorkspaceLoading(false); return false;
      }
      workspaceId = info.active.id; sessionStorage.setItem('pw-workspace', workspaceId);
      $('workspace-current-name').textContent = info.active.name;
      $('workspace-current-path').textContent = info.active.path; $('workspace-current-path').title = info.active.path;
      document.title = `${info.active.name} — PulsarWiki`;
      document.body.classList.add('workspace-ready');
      return true;
    } catch (error) { window.setWorkspaceLoading(false); showError(error); return false; }
  };
})();
