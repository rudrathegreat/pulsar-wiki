import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';
import { IThemeManager } from '@jupyterlab/apputils';

export default {
  id: 'pulsarwiki-notebook-bridge:plugin',
  autoStart: true,
  requires: [INotebookTracker, IThemeManager],
  activate: async (app, tracker, themes) => {
    const response = await fetch('/_bridge/config');
    if (!response.ok || window.parent === window) return;
    const { parentOrigin, channel } = await response.json();
    const emit = (type, data = {}) => window.parent.postMessage({ type, channel, ...data }, parentOrigin);
    const selection = () => {
      const widget = tracker.currentWidget;
      return widget ? { path: widget.context.path, cellId: widget.content.activeCell?.model.id, dirty: widget.context.model.dirty, kernel: widget.sessionContext.kernelDisplayStatus } : {};
    };
    const saveAll = async () => {
      const widgets = []; tracker.forEach(widget => widgets.push(widget));
      for (const widget of widgets) { await widget.context.ready; if (widget.context.model.dirty) await widget.context.save(); }
      return selection();
    };
    const activeRuns = new Map();
    NotebookActions.executionScheduled.connect((_sender, { cell }) => activeRuns.set(cell.model.id, new Date().toISOString()));
    NotebookActions.executed.connect(async (_sender, { notebook, cell, success }) => {
      let widget; tracker.forEach(candidate => { if (candidate.content === notebook) widget = candidate; });
      if (!widget) return;
      try { await widget.context.save(); emit('pulsarwiki-execution', { path: widget.context.path, cellId: cell.model.id, success, startedAt: activeRuns.get(cell.model.id) || '' }); }
      catch (error) { emit('pulsarwiki-warning', { message: `Execution finished, but its notebook could not be saved: ${error.message}` }); }
      activeRuns.delete(cell.model.id);
    });
    const announced = new WeakSet();
    tracker.widgetAdded.connect((_sender, widget) => {
      if (announced.has(widget)) return; announced.add(widget);
      widget.context.saveState.connect((_context, state) => { if (state === 'completed') emit('pulsarwiki-saved', { path: widget.context.path }); });
      widget.content.activeCellChanged.connect(() => emit('pulsarwiki-selection', selection()));
      widget.sessionContext.statusChanged.connect(() => emit('pulsarwiki-selection', selection()));
    });
    tracker.currentChanged.connect(() => emit('pulsarwiki-selection', selection()));
    window.addEventListener('message', async event => {
      const message = event.data;
      if (event.source !== window.parent || event.origin !== parentOrigin || message?.type !== 'pulsarwiki-command' || message.channel !== channel || typeof message.requestId !== 'string') return;
      try {
        let result = {};
        if (message.command === 'save') result = await saveAll();
        else if (message.command === 'open' || message.command === 'reload') {
          if (typeof message.path !== 'string' || !message.path.endsWith('.ipynb') || message.path.split('/').includes('..')) throw Error('Invalid notebook path.');
          const widget = await app.commands.execute('docmanager:open', { path: message.path, factory: 'Notebook' });
          await widget.context.ready;
          if (message.command === 'reload') {
            if (widget.context.model.dirty) throw Error('Material was saved on disk. This notebook has newer unsaved edits; save a copy or resolve Jupyter’s file conflict before reloading.');
            await widget.context.revert();
          }
          if (message.cellId) { const index = widget.content.widgets.findIndex(cell => cell.model.id === message.cellId); if (index >= 0) { widget.content.activeCellIndex = index; await widget.content.scrollToItem(index); } }
          result = selection();
        } else if (message.command === 'theme') await themes.setTheme(message.theme === 'light' ? 'JupyterLab Light' : 'JupyterLab Dark');
        else if (message.command === 'close') { await saveAll(); const widgets = []; tracker.forEach(widget => widgets.push(widget)); for (const widget of widgets) widget.close(); }
        else throw Error('Unknown notebook command.');
        emit('pulsarwiki-reply', { requestId: message.requestId, result });
      } catch (error) { emit('pulsarwiki-reply', { requestId: message.requestId, error: error.message }); }
    });
    // Research links return to the parent app instead of navigating the embedded editor.
    document.addEventListener('click', event => {
      const link = event.target.closest('a[href]'); if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const value = link.getAttribute('href');
      if (/^\/(?:wiki\/|#(?:reading\/|file\/|notebook\/))/.test(value)) { event.preventDefault(); event.stopPropagation(); emit('pulsarwiki-navigate', { href: value }); }
    }, true);
    // Restoration depends on plugin activation completing. Register the ready
    // notification without making this activation promise wait for restoration.
    void app.restored.then(() => emit('pulsarwiki-ready', selection()));
  }
};
