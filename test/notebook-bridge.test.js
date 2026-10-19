'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'integrations', 'jupyterlab', 'src', 'index.js'), 'utf8');

test('Jupyter bridge activation completes before restoration, then announces readiness after restoration', async () => {
  let restore;
  const restored = new Promise(resolve => { restore = resolve; });
  const posts = []; const listeners = new Map();
  const signal = () => ({ connect() {} });
  const parent = { postMessage(message, origin) { posts.push({ message, origin }); } };
  const window = { parent, addEventListener(type, listener) { listeners.set(type, listener); } };
  const context = { window, document: { addEventListener() {} }, INotebookTracker: {}, IThemeManager: {},
    NotebookActions: { executionScheduled: signal(), executed: signal() },
    fetch: async () => ({ ok: true, async json() { return { parentOrigin: 'http://127.0.0.1:3000', channel: 'workspace-channel' }; } }),
  };
  vm.createContext(context);
  vm.runInContext(source.replace(/^import .*;\r?$/gm, '').replace('export default', 'globalThis.bridgePlugin ='), context);
  const tracker = { widgetAdded: signal(), currentChanged: signal(), currentWidget: null };
  let activated = false;
  const activation = context.bridgePlugin.activate({ restored }, tracker, {});
  activation.then(() => { activated = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(activated, true, 'activation must return without waiting for restoration; Jupyter startup waits for activation');
  assert.equal(posts.length, 0, 'do not announce readiness before Jupyter is restored');
  assert.ok(listeners.has('message'), 'install the command listener during activation');
  restore(); await activation; await new Promise(resolve => setImmediate(resolve));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].message.type, 'pulsarwiki-ready');
  assert.equal(posts[0].message.channel, 'workspace-channel');
  assert.equal(posts[0].origin, 'http://127.0.0.1:3000');
});
