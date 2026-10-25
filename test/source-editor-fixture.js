const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Supply measured row heights without requiring a browser in client tests.
exports.installSourceEditor = function (context) {
  const observers = [];
  let measure = () => 22.1;
  context.document.createElement = () => ({
    style: {}, children: [], textContent: '', setAttribute() {}, remove() {},
    replaceChildren(...children) { this.children = children; },
    getBoundingClientRect() { return { height: measure(this.textContent) }; },
  });
  context.document.fonts = { ready: Promise.resolve() };
  context.ResizeObserver = class {
    constructor(callback) { observers.push(callback); }
    observe() {}
    disconnect() {}
  };
  context.window.getComputedStyle = () => ({ paddingLeft: '16px', paddingRight: '16px', font: '13px / 22.1px monospace', letterSpacing: 'normal', tabSize: '8' });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/source-editor.js'), 'utf8'), context);
  return { measureWith(fn) { measure = fn; }, resize() { observers.forEach(callback => callback()); } };
};
