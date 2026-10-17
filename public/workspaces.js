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
    for (const id of ['workspace-open', 'workspace-submit', 'workspace-switch', 'workspace-change', 'workspace-close']) $(id).disabled = busy;
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

  async function select(path) {
    if (opening) return;
    opening = true;
    setBusy(true);
    $('workspace-error').textContent = ''; $('workspace-status').hidden = true;
    try {
      const result = await post('/api/workspaces/open', { path });
      workspaceId = result.active.id;
      sessionStorage.setItem('pw-workspace', workspaceId);
      recent = [result.active, ...recent.filter(item => item.path !== result.active.path)].slice(0, 8);
      try { localStorage.setItem('pw-recent-workspaces', JSON.stringify(recent)); } catch { /* optional history */ }
      // Reinitialise all caches, timers and document state when changing projects.
      if (info?.active) location.assign('/'); else location.reload();
    } catch (error) { showError(error); }
    finally { opening = false; setBusy(picking); }
  }

  async function browse() {
    if (picking || opening) return;
    picking = true; setBusy(true);
    $('workspace-error').textContent = ''; $('workspace-status').hidden = true;
    try {
      const result = await post('/api/workspaces/pick', { path: $('workspace-path').value });
      if (!result.path) return;
      $('workspace-path').value = result.path;
      if (info?.active) await select(result.path);
    } catch (error) { showError(error); }
    finally { picking = false; setBusy(false); }
  }

  $('workspace-open').addEventListener('click', browse);
  $('workspace-switch').addEventListener('click', browse);
  $('workspace-change').addEventListener('click', browse);
  $('workspace-path-form').addEventListener('submit', event => { event.preventDefault(); return select($('workspace-path').value); });
  $('workspace-close').addEventListener('click', async () => {
    try {
      await post('/api/workspaces/close', {});
      sessionStorage.setItem('pw-workspace', 'closed'); location.assign('/');
    } catch (error) { showError(error); }
  });

  window.initializeWorkspaceUi = async () => {
    try {
      info = await json('/api/workspaces');
      renderRecent(info.recent);
      $('workspace-path').value = info.active?.path || info.defaultPath;
      if (!info.active) {
        workspaceId = 'closed'; sessionStorage.setItem('pw-workspace', 'closed');
        document.body.classList.remove('workspace-loading'); return false;
      }
      workspaceId = info.active.id; sessionStorage.setItem('pw-workspace', workspaceId);
      $('workspace-current-name').textContent = info.active.name;
      $('workspace-current-path').textContent = info.active.path; $('workspace-current-path').title = info.active.path;
      document.title = `${info.active.name} — PulsarWiki`;
      document.body.classList.add('workspace-ready'); document.body.classList.remove('workspace-loading');
      return true;
    } catch (error) { document.body.classList.remove('workspace-loading'); showError(error); return false; }
  };
})();
