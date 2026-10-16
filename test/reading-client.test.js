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
  const element = () => ({ style: {}, dataset: {}, children: [], listeners: {}, attributes: {}, hidden: false, innerHTML: '', offsetWidth: 350, offsetHeight: 45, classList: { add() {}, remove() {}, toggle() {} }, addEventListener(type, listener) { this.listeners[type] = listener; }, querySelectorAll() { return []; }, querySelector() { return null; }, contains() { return false; }, setAttribute(key, value) { this.attributes[key] = value; }, showModal() { this.open = true; }, close() { this.open = false; }, append(child) { this.children.push(child); }, getBoundingClientRect() { return { left: 100, top: 100, right: 500, bottom: 900, width: 400, height: 800 }; } });
  const document = { activeElement: null, getElementById(id) { if (!staticIds.has(id) && ![...nodes.values()].some(node => node.innerHTML.includes(`id="${id}"`))) return null; if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, querySelectorAll() { return []; }, addEventListener() {}, createElement(tag) { const node = element(); if (tag === 'template') node.content = { querySelectorAll() { return []; } }; return node; } };
  const context = { document, window: { addEventListener() {}, getSelection() { return null; }, innerWidth: 1200, innerHeight: 900 }, state: { panel: 'reading' }, setTimeout, clearTimeout, URL, URLSearchParams, Node: { TEXT_NODE: 3 }, renderMd(v) { return v; } };
  vm.createContext(context);
  vm.runInContext(source.replace('window.ActiveReading =', 'window.__readingTest = { r, selectedPayload, previewSnapshot, captureSelection, paintHighlights, diffHtml, renderWorkspace, filteredHighlights, library, joinHighlightRects, setHighlightsEnabled, saveSelection, deleteHighlight, undoDeletion, connectKnowledge }; window.ActiveReading ='), context);
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
  assert.doesNotMatch(output, /Local &amp; private/); assert.match(output, /Select shown/); assert.match(output, /Create artifact/); assert.match(output, /Export private backup/);
  assert.match(output, /Include this comment in selected inputs/); assert.match(output, /reading-select="highlight-two"/);
});

test('reader sidebar shows every matching highlight with filters and a delete action per highlight', () => {
  const c = client(); populate(c); c.context.state.panel = 'document'; c.r.tab = 'assistance';
  c.renderWorkspace();
  const output = c.nodes.get('reading-notes').innerHTML;
  assert.match(output, /reading-filter-document/); assert.match(output, /reading-filter-color/);
  assert.match(output, /data-reading-card="highlight-one"/); assert.match(output, /data-reading-card="highlight-two"/);
  assert.match(output, /Do not send unchecked notes/);
  assert.doesNotMatch(output, /Local &amp; private|reading-nav|data-reading-select|Export private backup/);
  assert.equal((output.match(/<button\b/g) || []).length, 2);
  assert.match(output, /data-reading-delete="highlight-one"/); assert.match(output, /data-reading-delete="highlight-two"/);
  assert.equal(c.r.selected.size, 0, 'showing highlights must not automatically include them in AI inputs');
});

function addAssistance(c, overrides = {}) {
  const task = { id: 'task-one', action: 'explain', status: 'completed', response: 'This is the AI explanation of the timing result.', question: 'Why does this matter?', snapshot: { highlights: structuredClone([c.r.data.highlights[0]]), documents: c.r.data.documents, annotations: [], wikiPages: [], discoveries: [], responses: [] }, ...overrides };
  c.r.data.tasks.push(task);
  return task;
}

test('saved AI responses appear beside their source comments and use a dedicated overlay colour', () => {
  const c = client(); populate(c); c.context.state.panel = 'document'; c.r.document = c.r.data.documents[0];
  addAssistance(c); c.renderWorkspace();
  const output = c.nodes.get('reading-notes').innerHTML;
  const first = output.split('data-reading-card="highlight-one"')[1].split('</article>')[0];
  const second = output.split('data-reading-card="highlight-two"')[1].split('</article>')[0];
  assert.match(first, /Researcher comment/); assert.match(first, /AI-generated comment/);
  assert.match(first, /This is the AI explanation/); assert.match(first, /data-color="blue"/);
  assert.doesNotMatch(second, /AI-generated comment/);
  const overlay = { children: [], set innerHTML(value) { this.children = []; }, append(mark) { this.children.push(mark); } };
  c.paintHighlights({ number: 1, overlay, viewport: { convertToViewportRectangle(coords) { return coords; } } });
  assert.equal(overlay.children[0].dataset.color, 'blue');
  assert.equal(c.r.data.highlights[0].color, 'yellow', 'AI styling must preserve the researcher colour');
  assert.equal(c.selectedPayload().assistanceIds.length, 0, 'displayed explanations still require explicit inclusion');
  c.r.filter.color = 'blue'; assert.deepEqual(Array.from(c.filteredHighlights(), h => h.id), ['highlight-one']);
  c.r.filter.color = ''; c.r.filter.query = 'AI explanation';
  assert.deepEqual(Array.from(c.filteredHighlights(), h => h.id), ['highlight-one']);
});

test('pending, failed and artifact tasks do not mark passages as AI assistance or attach unrelated comments', () => {
  const c = client(); populate(c); c.context.state.panel = 'document';
  addAssistance(c, { status: 'running' }); addAssistance(c, { id: 'task-failed', status: 'failed' });
  addAssistance(c, { id: 'task-artifact', artifactId: 'artifact-one' });
  addAssistance(c, { id: 'task-draft', action: 'artifact' });
  c.renderWorkspace();
  assert.doesNotMatch(c.nodes.get('reading-notes').innerHTML, /AI-generated comment|data-color="blue"/);
});

test('reattaching a passage keeps earlier AI explanations with their original preserved inputs', () => {
  const c = client(); populate(c); c.context.state.panel = 'document';
  const task = addAssistance(c);
  c.r.data.highlights[0].anchors[0].page = 3;
  c.renderWorkspace();
  assert.doesNotMatch(c.nodes.get('reading-notes').innerHTML, /AI-generated comment|data-color="blue"/);
  assert.equal(task.snapshot.highlights[0].anchors[0].page, 1);
  assert.equal(task.response, 'This is the AI explanation of the timing result.');
});

test('opening the library resets stale filters and views without selecting private evidence', async () => {
  const c = client(); populate(c);
  c.r.tab = 'artifacts'; c.r.filter = { document: 'document-one', color: 'blue', category: 'result', query: 'missing', annotated: true };
  c.context.fetch = async () => ({ ok: true, json: async () => c.r.data });
  c.context.history = { replaceState() {} };
  await c.library();
  assert.equal(c.r.tab, 'highlights');
  assert.equal(c.filteredHighlights().length, 2);
  assert.equal(c.r.selected.size, 0);
});

test('word rectangles merge into continuous lines without joining columns or adjacent lines', () => {
  const c = client();
  const rects = [[10, 10, 40, 20], [45, 10.5, 70, 20.5], [74, 10, 100, 20], [160, 10, 190, 20], [10, 26, 80, 36]];
  const joined = Array.from(c.joinHighlightRects(rects), rect => Array.from(rect));
  assert.equal(joined.length, 3);
  assert.ok(joined.some(rect => rect.join(',') === '10,10,100,20.5'));
  assert.ok(joined.some(rect => rect.join(',') === '160,10,190,20'));
  assert.ok(joined.some(rect => rect.join(',') === '10,26,80,36'));
  assert.deepEqual(rects[0], [10, 10, 40, 20], 'source anchors must remain unchanged');
  const rotated = rects.map(([x1, y1, x2, y2]) => [y1, x1, y2, x2]);
  assert.equal(c.joinHighlightRects(rotated, true).length, 3);
  const scaled = rects.map(rect => rect.map(n => n * 3));
  assert.equal(c.joinHighlightRects(scaled).length, 3);
});

test('highlight toggle hides and restores marks, stops new selections, and preserves saved evidence', () => {
  const c = client(); populate(c); c.r.document = c.r.data.documents[0]; c.context.state.panel = 'document';
  const overlay = { children: [], set innerHTML(value) { this.children = []; }, append(mark) { this.children.push(mark); } };
  const page = { number: 1, overlay, viewport: { convertToViewportRectangle(coords) { return coords; } } };
  c.r.pages.set(1, page); c.r.pending = { text: 'Unsaved selection' }; c.paintHighlights(page);
  assert.equal(overlay.children.length, 1);
  c.setHighlightsEnabled(false);
  assert.equal(overlay.children.length, 0); assert.equal(c.r.pending, null);
  assert.equal(c.nodes.get('reading-highlights-toggle').attributes['aria-pressed'], 'false');
  assert.equal(c.nodes.get('reading-selection-toolbar').hidden, true);
  c.context.window.getSelection = () => { throw new Error('Disabled highlighting must not capture text'); };
  c.captureSelection();
  c.setHighlightsEnabled(true);
  assert.equal(overlay.children.length, 1); assert.equal(c.r.data.highlights.length, 2);
  assert.equal(c.nodes.get('reading-highlights-toggle').attributes['aria-pressed'], 'true');
});

test('manual blue selection is rejected while legacy blue highlights retain their saved data', async () => {
  const c = client(); populate(c); c.r.pending = { text: 'Selected passage' };
  await assert.rejects(c.saveSelection('blue'), /reserved for AI assistance/);
  c.r.filter.color = 'blue'; assert.equal(c.filteredHighlights().length, 0);
  assert.equal(c.r.data.highlights[1].color, 'blue');
});

test('sidebar deletion removes the selected highlight and undo restores it', async () => {
  const c = client(); populate(c); c.context.state.panel = 'document'; c.r.selected.add('highlight-one');
  const calls = [];
  c.context.fetch = async (url, options) => {
    calls.push({ url, method: options.method });
    const h = c.r.data.highlights[0];
    if (options.method === 'DELETE') { h.deletedAt = 'now'; h.revision += 1; }
    if (options.method === 'PATCH') { h.deletedAt = null; h.revision += 1; }
    return { ok: true, json: async () => options.method === 'GET' ? c.r.data : { ...h } };
  };
  await c.deleteHighlight('highlight-one');
  assert.doesNotMatch(c.nodes.get('reading-notes').innerHTML, /data-reading-card="highlight-one"/);
  assert.match(c.nodes.get('reading-notes').innerHTML, /Undo deletion/);
  assert.equal(c.r.selected.has('highlight-one'), false);
  await c.undoDeletion();
  assert.match(c.nodes.get('reading-notes').innerHTML, /data-reading-card="highlight-one"/);
  assert.ok(calls.some(call => call.method === 'PATCH'));
  clearTimeout(c.r.toastTimer);
});

test('add-to-wiki selection opens a reviewed draft workflow using only that passage', async () => {
  const c = client(); populate(c); c.r.pending = { text: 'A new selection' };
  c.r.selected.add('highlight-two'); c.r.assistanceIds.add('earlier-ai'); c.r.discoveryIds.add('earlier-paper');
  const h = { ...c.r.data.highlights[0], id: 'highlight-new' };
  c.context.api = { getWikiList: async () => [] };
  c.context.fetch = async (_url, options) => {
    if (options.method === 'POST') { c.r.data.highlights.push(h); return { ok: true, json: async () => h }; }
    return { ok: true, json: async () => c.r.data };
  };
  await c.saveSelection('yellow', 'wiki');
  assert.equal(c.nodes.get('reading-dialog-title').textContent, 'Add highlighted passage to wiki');
  assert.match(c.nodes.get('reading-dialog-body').innerHTML, /Review the draft and source citations/);
  assert.deepEqual(Array.from(c.r.selected), ['highlight-new']);
  assert.equal(c.selectedPayload().assistanceIds.length, 0); assert.equal(c.selectedPayload().discoveryIds.length, 0);
});

test('connect action requests only the highlighted passage and renders wiki references', async () => {
  const c = client(); populate(c);
  let submitted;
  c.context.fetch = async (url, options) => {
    submitted = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ wiki: [{ name: 'timing', title: 'Timing', url: '/wiki/timing', text: 'Related timing knowledge.', matchedTerms: ['timing'] }], papers: [], warnings: [] }) };
  };
  await c.connectKnowledge('highlight-one');
  assert.equal(submitted.url, '/api/reading/connections');
  assert.deepEqual(Object.keys(submitted.body).sort(), ['highlightId', 'revision']);
  assert.match(c.nodes.get('reading-connections-results').innerHTML, /href="\/wiki\/timing"/);
  assert.match(c.nodes.get('reading-connections-results').innerHTML, /Connect this page/);
  assert.doesNotMatch(JSON.stringify(submitted), /Do not send unchecked notes/);
});
