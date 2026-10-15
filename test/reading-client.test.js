'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'reading.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function client() {
  const nodes = new Map();
  const staticIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const element = () => ({ style: {}, dataset: {}, children: [], hidden: false, innerHTML: '', offsetWidth: 350, offsetHeight: 45, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }, contains() { return false; }, setAttribute() {}, append(child) { this.children.push(child); }, getBoundingClientRect() { return { left: 100, top: 100, right: 500, bottom: 900, width: 400, height: 800 }; } });
  const document = { activeElement: null, getElementById(id) { if (!staticIds.has(id)) throw new Error(`Missing static element ${id}`); if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, querySelectorAll() { return []; }, addEventListener() {}, createElement() { return element(); } };
  const context = { document, window: { addEventListener() {}, innerWidth: 1200, innerHeight: 900 }, state: { panel: 'reading' }, setTimeout, clearTimeout, URL, URLSearchParams, Node: { TEXT_NODE: 3 }, renderMd(v) { return v; } };
  vm.createContext(context);
  vm.runInContext(source.replace('window.ActiveReading =', 'window.__readingTest = { r, selectedPayload, previewSnapshot, captureSelection, paintHighlights, diffHtml, renderWorkspace }; window.ActiveReading ='), context);
  return { ...context.window.__readingTest, context, nodes, document };
}
function populate(c) {
  c.r.data = { documents: [{ id: 'document-one', aliases: ['paper.pdf'], available: true }], highlights: [{ id: 'highlight-one', documentId: 'document-one', text: 'Measured timing result.', kind: 'text', color: 'yellow', categories: ['result'], revision: 2, anchors: [{ page: 1, label: '1', rects: [[10, 20, 40, 30]] }] }, { id: 'highlight-two', documentId: 'document-one', text: 'Assumption.', kind: 'text', color: 'blue', categories: [], revision: 1, anchors: [{ page: 2, label: '2', rects: [[10, 20, 40, 30]] }] }], annotations: [{ id: 'annotation-private', highlightId: 'highlight-one', text: 'Do not send unchecked notes', revision: 1 }, { id: 'annotation-selected', highlightId: 'highlight-two', text: 'Checked assumption note', revision: 3 }], collections: [], relationships: [], tasks: [], artifacts: [], discoveries: [] };
}

test('reading client initializes against actual HTML and includes only explicitly checked private inputs', () => {
  const c = client(); populate(c);
  c.r.selected.add('highlight-one');
  let payload = c.selectedPayload();
  assert.deepEqual([...payload.highlightIds], ['highlight-one']); assert.equal(payload.annotationIds.length, 0);
  c.r.annotationIds.add('annotation-selected');
  payload = c.selectedPayload(); assert.equal(payload.annotationIds.length, 0, 'unselected passage comments must not leak');
  c.r.selected.add('highlight-two');
  payload = c.selectedPayload();
  assert.deepEqual([...payload.annotationIds], ['annotation-selected']);
  assert.equal(payload.highlightRevisions['highlight-one'], 2);
  const preview = c.previewSnapshot(payload);
  assert.equal(preview.annotations[0].text, 'Checked assumption note');
  assert.ok(!JSON.stringify(preview).includes('Do not send unchecked notes'));
});

test('reader stores cross-page text selections with page-local coordinates and offsets', () => {
  const c = client(); populate(c); c.context.state.panel = 'document';
  const makePage = (number, body) => {
    const layer = { parentElement: { dataset: { readingPage: number } } };
    const span = { dataset: { textStart: '0' }, closest(selector) { return selector === '[data-text-start]' ? this : layer; } };
    const node = { nodeType: 3, parentElement: span };
    return { number, text: body, layer, node, wrap: { getBoundingClientRect() { return { left: 100, top: 100, right: 500, bottom: 900 }; } }, textLayer: {}, viewport: { convertToPdfPoint(x, y) { return [x / 2, y / 2]; } } };
  };
  const first = makePage(1, 'First page selected'); const second = makePage(2, 'Second page text');
  c.r.document = { id: 'document-one', labels: ['i', 'ii'] }; c.r.pages.set(1, first); c.r.pages.set(2, second);
  const range = { startContainer: first.node, startOffset: 6, endContainer: second.node, endOffset: 6, getBoundingClientRect() { return { left: 120, bottom: 160 }; } };
  c.context.window.getSelection = () => ({ isCollapsed: false, rangeCount: 1, getRangeAt() { return range; } });
  c.document.createRange = () => ({ offset: 0, selectNodeContents() {}, setStart(_node, offset) { this.offset = 0; }, setEnd(_node, offset) { this.offset = offset; }, toString() { return 'x'.repeat(this.offset); }, getClientRects() { return [{ left: 120, right: 220, top: 140, bottom: 160, width: 100, height: 20 }]; } });
  c.captureSelection();
  assert.equal(c.r.pending.anchors.length, 2);
  assert.equal(c.r.pending.anchors[0].exact, 'page selected');
  assert.equal(c.r.pending.anchors[1].exact, 'Second');
  assert.equal(c.r.pending.anchors[0].start, 6); assert.equal(c.r.pending.anchors[1].end, 6);
  assert.equal(c.r.pending.anchors[1].label, 'ii');
  assert.deepEqual(Array.from(c.r.pending.anchors[0].rects[0]), [10, 20, 60, 30]);
});

test('highlight overlays transform saved geometry after zoom without modifying saved anchors', () => {
  const c = client(); populate(c); c.r.document = c.r.data.documents[0];
  const overlay = { children: [], set innerHTML(value) { this.children = []; }, append(mark) { this.children.push(mark); } };
  const page = { number: 1, overlay, viewport: { convertToViewportRectangle(coords) { return coords.map(x => x * 2); } } };
  c.paintHighlights(page);
  assert.equal(overlay.children.length, 1); assert.equal(overlay.children[0].style.left, '20px'); assert.equal(overlay.children[0].style.width, '60px');
  page.viewport.convertToViewportRectangle = coords => coords.map(x => x * 3);
  c.paintHighlights(page);
  assert.equal(overlay.children[0].style.width, '90px');
  assert.deepEqual(c.r.data.highlights[0].anchors[0].rects[0], [10, 20, 40, 30]);
});

test('concept diffs expose additions, removals, and reordered lines for review', () => {
  const c = client();
  const diff = c.diffHtml('Old claim\nShared line\nCaveat', 'Shared line\nNew result\nCaveat');
  assert.match(diff, /<del>- Old claim<\/del>/); assert.match(diff, /<ins>\+ New result<\/ins>/); assert.match(diff, /Shared line/);
  assert.ok(!c.diffHtml('<script>bad</script>', 'Safe').includes('<script>'));
});

test('workspace exposes cross-paper controls, optional AI and private backup without invoking assistance', () => {
  const c = client(); populate(c); c.r.selected.add('highlight-one'); c.renderWorkspace();
  const output = c.nodes.get('reading-library-content').innerHTML;
  assert.match(output, /Local &amp; private/); assert.match(output, /Select shown/); assert.match(output, /Create artifact/); assert.match(output, /Export private backup/);
  assert.match(output, /Include this comment in selected inputs/); assert.match(output, /reading-select="highlight-two"/);
});
