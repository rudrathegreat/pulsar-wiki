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
  const wikiUrl = '/wiki/timing';
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
        name: 'timing.md', type: 'Wiki', url: wikiUrl, matches: [{ url, text: '<Pulse> & pulse', location: 'Line 2' }],
      }, {
        name: 'paper.pdf', label: 'Pulse & Timing.PDF', type: 'Source', url: '/#file/paper.pdf', matches: [],
      }, {
        name: 'pulse.pdf', label: 'pulse.pdf', type: 'Source', url: '/#file/pulse.pdf', matches: [],
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
  assert.match(results.innerHTML, /class="workspace-find-result-heading">\s*<span class="md-body"><a href="\/wiki\/timing">timing<\/a><\/span>\s*<small>Wiki · Line 2<\/small><\/div>/);
  assert.match(results.innerHTML, /&lt;<mark>Pulse<\/mark>&gt; &amp; <mark>pulse<\/mark>[\s\S]*href="\/wiki\/timing\?start=12&amp;end=17">Go to location/);
  assert.match(results.innerHTML, /href="\/#file\/paper\.pdf">Pulse &amp; Timing<\/a>/);
  assert.match(results.innerHTML, /href="\/#file\/pulse\.pdf">pulse<\/a>/);
  results.handlers.click({
    target: { closest: () => ({ getAttribute: () => 'https://example.com' }) },
    button: 0, preventDefault() { assert.fail('External links should use browser navigation'); },
  });
  results.handlers.click({
    target: { closest: () => ({ getAttribute: () => wikiUrl }) },
    button: 0, preventDefault() {},
  });
  results.handlers.click({
    target: { closest: () => ({ getAttribute: () => url }) },
    button: 0, preventDefault() {},
  });
  assert.deepEqual(routes, [wikiUrl, 'opened', url, 'opened']);
  assert.equal(results.hidden, true);
});
