'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('workspace Find debounces typing, shows completions and opens the selected location', async () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const elements = new Map();
  const timers = new Map();
  const queries = [];
  const routes = [];
  const url = '/wiki/timing?start=12&end=17';
  let nextTimer = 0;
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      handlers: {}, value: '', hidden: true, innerHTML: '',
      addEventListener(type, callback) { this.handlers[type] = callback; },
      replaceChildren() { this.innerHTML = ''; },
    });
    return elements.get(id);
  }
  const context = {
    $: element, AbortController, navigator: { platform: 'Win32' }, workspaceMenus: element('workspace-menus'),
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    api: { async searchWorkspace(query) {
      queries.push(query);
      return { unavailable: 0, suggestions: ['Pulsars'], results: [{
        name: 'timing.md', type: 'Wiki', matches: [{ url, text: '<Pulse> & pulse', location: 'Line 2' }],
      }] };
    } },
    updateAppHistory(value) { routes.push(value); },
    restoreAppRoute() { routes.push('opened'); },
  };
  vm.createContext(context);
  vm.runInContext(`${app.slice(app.indexOf('function escapeHtmlText'), app.indexOf('function escAttr'))}
    ${app.slice(app.indexOf('const workspaceEditMenu'), app.indexOf('function closeWorkspaceMenu'))}`, context);
  const query = element('workspace-find-query');
  for (const value of ['pul', 'pulse']) {
    query.value = value;
    query.handlers.input({ isComposing: false });
  }
  assert.equal(timers.size, 1);
  await [...timers.values()][0]();
  assert.deepEqual(queries, ['pulse']);
  assert.match(element('workspace-find-suggestions').innerHTML, /value="Pulsars"/);
  const results = element('workspace-find-results');
  assert.match(results.innerHTML, /timing\.md[\s\S]*Wiki · Line 2[\s\S]*&lt;<mark>Pulse<\/mark>&gt; &amp; <mark>pulse<\/mark>[\s\S]*Go to location/);
  results.handlers.click({
    target: { closest: () => ({ getAttribute: () => url }) },
    button: 0, preventDefault() {},
  });
  assert.deepEqual(routes, [url, 'opened']);
  assert.equal(results.hidden, true);
});
