'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function setup() {
  class Node {
    constructor() {
      this.attributes = {};
      this.listeners = {};
      this.children = [];
      this.style = {};
      this.classList = { toggle() {} };
      this.offsetWidth = 220;
      this.offsetHeight = this.scrollHeight = 140;
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    dispatchEvent(event) { for (const callback of this.listeners[event.type] || []) callback(event); }
    append(...children) { this.children.push(...children); }
    matches() { return Boolean(this.open); }
    showPopover() { this.open = true; }
    hidePopover() { this.open = false; }
    focus() { this.focused = true; }
    scrollIntoView() {}
    getBoundingClientRect() { return { left: 100, top: 100, bottom: 135, width: 160 }; }
  }
  const label = new Node();
  label.firstChild = { textContent: 'Sort by', replaceWith(node) { label.labelText = node; } };
  const select = new Node();
  select.id = 'source-sort';
  select.options = ['Default', 'Most citations', 'Most recent', 'First author'].map(textContent => ({ textContent }));
  select.selectedIndex = 0;
  Object.defineProperty(select, 'selectedOptions', { get: () => [select.options[select.selectedIndex]] });
  select.closest = () => label;
  const document = new Node();
  document.body = new Node();
  document.querySelectorAll = () => [select];
  document.createElement = () => new Node();
  const window = new Node();
  window.innerWidth = 1000;
  window.innerHeight = 800;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/source-selects.js'), 'utf8'), { document, window, Event });
  const trigger = label.children[0];
  const menu = document.body.children[0];
  const click = node => node.dispatchEvent({ type: 'click' });
  const key = key => trigger.dispatchEvent({ type: 'keydown', key, preventDefault() {} });
  return { select, trigger, menu, click, key };
}

test('custom options preserve the form selection and emit one search change', () => {
  const { select, trigger, menu, click } = setup();
  let changes = 0;
  select.addEventListener('change', () => changes++);
  assert.equal(select.hidden, true);
  assert.equal(trigger.textContent, 'Default');
  click(trigger);
  assert.equal(trigger.attributes['aria-expanded'], 'true');
  click(menu.children[2]);
  assert.equal(select.selectedIndex, 2);
  assert.equal(trigger.textContent, 'Most recent');
  assert.equal(menu.children[2].attributes['aria-selected'], 'true');
  assert.equal(trigger.attributes['aria-expanded'], 'false');
  assert.equal(trigger.focused, true);
  assert.equal(changes, 1);
  click(trigger);
  click(menu.children[2]);
  assert.equal(changes, 1);
});

test('clicking the trigger closes a menu even after native light-dismiss', () => {
  const { trigger, menu, click } = setup();
  click(trigger);
  trigger.dispatchEvent({ type: 'pointerdown' });
  menu.hidePopover();
  click(trigger);
  assert.equal(menu.open, false);
  assert.equal(trigger.attributes['aria-expanded'], 'false');
});

test('keyboard navigation previews, commits, cancels and finds options by typing', () => {
  const { select, trigger, menu, key } = setup();
  key('ArrowDown');
  key('End');
  assert.equal(select.selectedIndex, 0);
  assert.match(trigger.attributes['aria-activedescendant'], /option-3$/);
  key('Escape');
  assert.equal(select.selectedIndex, 0);
  assert.equal(menu.open, false);
  key(' ');
  key('ArrowUp');
  key('Enter');
  assert.equal(select.selectedIndex, 3);
  key('Enter');
  key('Home');
  key('m');
  key('Enter');
  assert.equal(select.selectedIndex, 1);
  key('Enter');
  key('Tab');
  assert.equal(menu.open, false);
});
