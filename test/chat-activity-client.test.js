'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const start = source.indexOf('function handleToolStatus(event)');
const code = source.slice(start, source.indexOf('\nfunction handleAiError', start));

test('wiki activity shows one readable numbered item per action and updates its status', () => {
  const items = [];
  const activity = { hidden: true };
  const context = {
    aiTarget: { activity, activityOutput: { appendChild: item => items.push(item) }, actions: [] },
    document: { createElement: () => ({ textContent: '', classList: { toggle() {} } }) },
    stripEmoji: value => String(value), scrollChat() {},
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  context.handleToolStatus({ name: 'read_wiki_page', status: 'started', subject: 'pulsar-timing.md' });
  assert.equal(activity.hidden, false);
  assert.equal(items[0].textContent, 'Reading pulsar timing');
  context.handleToolStatus({ name: 'read_wiki_page', status: 'completed' });
  assert.equal(items.length, 1);
  assert.equal(items[0].textContent, 'Read pulsar timing');
  context.handleToolStatus({ name: 'list_wiki_pages', status: 'started' });
  context.handleToolStatus({ name: 'list_wiki_pages', status: 'completed' });
  assert.equal(items[1].textContent, 'Listed wiki pages');
  context.handleToolStatus({ name: 'read_source', status: 'started', subject: 'paper-name.pdf' });
  context.handleToolStatus({ name: 'read_source', status: 'failed', detail: 'Not found' });
  assert.equal(items[2].textContent, 'Reading source paper-name.pdf failed: Not found');
  context.handleToolStatus({ name: 'read_wiki_page', status: 'started' });
  context.handleToolStatus({ name: 'read_wiki_page', status: 'completed', subject: 'recovered-page' });
  assert.equal(items[3].textContent, 'Read recovered page');
});
