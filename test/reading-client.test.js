'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'reading.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function client({ performanceRecorder = null } = {}) {
  const nodes = new Map();
  const staticIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const element = () => ({ style: {}, dataset: {}, value: '', children: [], listeners: {}, attributes: {}, hidden: false, innerHTML: '', offsetWidth: 350, offsetHeight: 45, classList: { add() {}, remove() {}, toggle() {} }, addEventListener(type, listener) { this.listeners[type] = listener; }, querySelectorAll() { return []; }, querySelector() { return null; }, contains() { return false; }, focus() {}, setAttribute(key, value) { this.attributes[key] = value; }, showModal() { this.open = true; }, close() { this.open = false; }, append(child) { this.children.push(child); }, getBoundingClientRect() { return { left: 100, top: 100, right: 500, bottom: 900, width: 400, height: 800 }; } });
  const document = { activeElement: null, getElementById(id) { if (!staticIds.has(id) && ![...nodes.values()].some(node => node.innerHTML.includes(`id="${id}"`))) return null; if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, querySelectorAll() { return []; }, addEventListener() {}, createElement(tag) { const node = element(); if (tag === 'template') node.content = { querySelectorAll() { return []; } }; return node; } };
  const context = { document, window: { addEventListener() {}, getSelection() { return null; }, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout, innerWidth: 1200, innerHeight: 900 }, state: { panel: 'document' }, setTimeout, clearTimeout, ReadableStream, URL, URLSearchParams, Node: { TEXT_NODE: 3 }, renderMd(v) { return v; }, typesetMath() {} };
  context.window.WorkspaceSession = { fetch: (...args) => context.fetch(...args), url: value => value };
  if (performanceRecorder) context.window.ReadingPerformance = { create({ sample }) { performanceRecorder.sample = sample; return performanceRecorder; } };
  vm.createContext(context);
  vm.runInContext(source.replace('window.ActiveReading =', 'window.__readingTest = { r, selectedPayload, previewSnapshot, captureSelection, paintHighlights, renderWorkspace, filteredHighlights, route, joinHighlightRects, setHighlightsEnabled, saveSelection, deleteHighlight, undoDeletion, connectKnowledge, openHighlightHelper, closeHelper, watchTask, paperSummaryPage, renderPage, releasePage, releaseDistantPages, textChunks, close, layout, findNext, updateViewport, queueNearbyPages, queueThumbnail }; window.ActiveReading ='), context);
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
  assert.equal(c.r.pending.anchors[0].label, '1');
  assert.equal(c.r.pending.anchors[1].label, '2');
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

test('reading library is removed and its old route opens Files', async () => {
  const c = client(); populate(c);
  assert.doesNotMatch(html, /ib-reading|panel-reading|reading-library-content|reading-open-files/);
  assert.equal(c.context.window.ActiveReading.library, undefined);
  const panels = []; const urls = [];
  c.context.showPanel = panel => panels.push(panel);
  c.context.history = { replaceState(_state, _title, url) { urls.push(url); } };
  assert.equal(await c.route('#reading'), true);
  assert.deepEqual(panels, ['files']);
  assert.deepEqual(urls, ['/#files']);
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
  assert.match(first, /Researcher comment/); assert.match(first, /AI Generated Response/);
  assert.match(first, /User question/); assert.match(first, /reading-response-collapsed/);
  assert.match(first, /data-reading-expand="highlight-one"[^>]*>Show more<\/button>[\s\S]*data-reading-delete="highlight-one"/);
  assert.match(first, /This is the AI explanation/); assert.match(first, /data-color="blue"/);
  assert.doesNotMatch(second, /AI Generated Response/);
  const overlay = { children: [], set innerHTML(value) { this.children = []; }, append(mark) { this.children.push(mark); } };
  c.paintHighlights({ number: 1, overlay, viewport: { convertToViewportRectangle(coords) { return coords; } } });
  assert.equal(overlay.children[0].dataset.color, 'blue');
  c.r.expandedResponses.add('highlight-one'); c.renderWorkspace();
  assert.match(c.nodes.get('reading-notes').innerHTML, /aria-expanded="true">Show less/);
  assert.doesNotMatch(c.nodes.get('reading-notes').innerHTML, /reading-response-collapsed/);
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
  assert.doesNotMatch(c.nodes.get('reading-notes').innerHTML, /AI Generated Response|data-color="blue"/);
});

test('reattaching a passage keeps earlier AI explanations with their original preserved inputs', () => {
  const c = client(); populate(c); c.context.state.panel = 'document';
  const task = addAssistance(c);
  c.r.data.highlights[0].anchors[0].page = 3;
  c.renderWorkspace();
  assert.doesNotMatch(c.nodes.get('reading-notes').innerHTML, /AI Generated Response|data-color="blue"/);
  assert.equal(task.snapshot.highlights[0].anchors[0].page, 1);
  assert.equal(task.response, 'This is the AI explanation of the timing result.');
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

test('add-to-wiki selection defaults the destination using only that passage', async () => {
  const c = client(); populate(c); c.r.pending = { text: 'A new selection' };
  c.r.selected.add('highlight-two'); c.r.assistanceIds.add('earlier-ai'); c.r.discoveryIds.add('earlier-paper');
  const h = { ...c.r.data.highlights[0], id: 'highlight-new' };
  c.context.api = { getWikiList: async () => [{ name: 'paper' }, { name: 'timing' }] };
  c.context.fetch = async (_url, options) => {
    if (options.method === 'POST') { c.r.data.highlights.push(h); return { ok: true, json: async () => h }; }
    return { ok: true, json: async () => c.r.data };
  };
  await c.saveSelection('yellow', 'wiki');
  assert.equal(c.nodes.get('reading-helper-title').textContent, 'Add highlighted passage to wiki');
  const form = c.nodes.get('reading-helper-body').innerHTML;
  assert.match(form, /value="paper" selected/);
  assert.match(form, />Add<\/button>/);
  assert.doesNotMatch(form, /Artifact type|reading-new-artifact-type|reading-new-artifact-title|Existing concept page|Create private draft/);
  assert.doesNotMatch(c.nodes.get('reading-helper-body').innerHTML, /Prepare this passage|Review the draft and source citations/);
  assert.equal(c.nodes.get('reading-helper-details').hidden, false);
  assert.equal(c.nodes.get('reading-selection-toolbar').hidden, false);
  assert.ok(!c.nodes.get('reading-dialog')?.open);
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

test('clicking a saved PDF highlight opens its helper and Ask AI reuses it without creating a duplicate', async () => {
  const c = client(); populate(c); c.context.state.panel = 'document';
  const calls = [];
  c.context.fetch = async (url, options) => { calls.push({ url, method: options.method }); return { ok: true, json: async () => c.r.data }; };
  const wrap = { dataset: { readingPage: '1' }, getBoundingClientRect() { return { left: 100, top: 100 }; } };
  c.r.pages.set(1, { overlay: { children: [{ dataset: { highlightId: 'highlight-one' }, style: { left: '10px', top: '20px', width: '30px', height: '10px' } }] } });
  c.nodes.get('document-stage').listeners.click({ target: { closest() { return wrap; } }, clientX: 125, clientY: 125 });
  assert.equal(c.r.helper.highlightId, 'highlight-one');
  assert.equal(c.nodes.get('reading-selection-toolbar').hidden, false);
  await c.saveSelection('yellow', 'ask');
  const form = c.nodes.get('reading-helper-body').innerHTML;
  assert.match(form, /reading-ai-question/);
  assert.doesNotMatch(form, /reading-ai-action|reading-ai-pages|Additional wiki pages|Nothing is sent until/);
  assert.ok(!c.nodes.get('reading-dialog')?.open);
  assert.equal(c.r.data.highlights.length, 2);
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('Send submits AI inputs directly and keeps the completed response in the expanded helper', async () => {
  const c = client(); populate(c); c.context.state.panel = 'document';
  c.openHighlightHelper('highlight-one', 150, 180);
  let submitted;
  const snapshot = { highlights: structuredClone([c.r.data.highlights[0]]), documents: c.r.data.documents, annotations: [], wikiPages: [], discoveries: [], responses: [] };
  const task = { id: 'task-inline', action: 'question', status: 'completed', response: 'The inline timing explanation.', snapshot };
  c.context.fetch = async (url, options) => {
    if (url === '/api/reading/tasks' && options.method === 'POST') { submitted = JSON.parse(options.body); c.r.data.tasks.push(task); }
    return { ok: true, json: async () => url.includes('/tasks') ? task : c.r.data };
  };
  await c.saveSelection('yellow', 'ask');
  c.document.getElementById('reading-ai-question').value = 'Why are these residuals important?';
  c.document.getElementById('reading-ai-context').checked = true;
  assert.match(c.nodes.get('reading-helper-body').innerHTML, />Send<\/button>/);
  await c.nodes.get('reading-ai-review').listeners.click();
  assert.equal(submitted.action, 'question');
  assert.equal(submitted.question, 'Why are these residuals important?');
  assert.deepEqual(submitted.wikiPages, []); assert.deepEqual(submitted.highlightIds, ['highlight-one']);
  assert.match(c.nodes.get('reading-task-complete').innerHTML, /inline timing explanation/);
  assert.match(c.nodes.get('reading-task-complete').innerHTML, /Would you like to add this explanation/);
  c.context.api = { getWikiList: async () => [{ name: 'paper' }] };
  await c.nodes.get('reading-task-add-note').listeners.click();
  assert.ok(c.r.assistanceIds.has(task.id));
  assert.match(c.nodes.get('reading-helper-body').innerHTML, /Add highlighted passage to wiki|reading-new-artifact-create/);
  assert.equal(c.r.helper.expanded, true); assert.ok(!c.nodes.get('reading-dialog')?.open);
});

test('notes save from the helper and collapse back to the same highlight menu', async () => {
  const c = client(); populate(c); c.context.state.panel = 'document'; c.r.data.annotations = [];
  const h = c.r.data.highlights[0]; h.color = 'green';
  c.context.fetch = async (url, options) => {
    if (options.method === 'PATCH') { Object.assign(h, JSON.parse(options.body), { revision: h.revision + 1 }); }
    if (url === '/api/reading/annotations') c.r.data.annotations.push({ id: 'note-inline', ...JSON.parse(options.body) });
    return { ok: true, json: async () => options.method === 'GET' ? c.r.data : h };
  };
  c.openHighlightHelper(h.id, 160, 180); await c.saveSelection('yellow', 'note');
  assert.equal(h.color, 'green', 'opening an existing highlight action must preserve its colour');
  const form = c.nodes.get('reading-helper-body').innerHTML;
  assert.equal(c.nodes.get('reading-helper-title').textContent, 'Add note');
  assert.doesNotMatch(form, /reading-edit-color|Highlight colour|paper\.pdf|p\. 1/);
  c.document.getElementById('reading-edit-categories').value = 'result';
  c.nodes.get('reading-new-comment').value = 'My inline note.';
  await c.nodes.get('reading-save-highlight').listeners.click();
  assert.equal(h.color, 'green', 'saving a note must preserve its highlight colour');
  assert.equal(c.r.data.annotations[0].text, 'My inline note.');
  assert.equal(c.r.data.annotations[0].highlightId, h.id);
  assert.equal(c.r.helper.highlightId, h.id); assert.equal(c.r.helper.expanded, false);
  assert.equal(c.nodes.get('reading-selection-toolbar').hidden, false); assert.ok(!c.nodes.get('reading-dialog')?.open);
  clearTimeout(c.r.toastTimer);
});

test('related knowledge results expand within an existing highlight helper', async () => {
  const c = client(); populate(c); c.context.state.panel = 'document';
  c.context.fetch = async url => ({ ok: true, json: async () => url.endsWith('/connections') ? { wiki: [{ name: 'timing', title: 'Timing', url: '/wiki/timing', text: 'Timing context.', matchedTerms: ['timing'] }], papers: [], warnings: [] } : c.r.data });
  c.openHighlightHelper('highlight-one', 160, 180); await c.saveSelection('yellow', 'connect');
  assert.equal(c.nodes.get('reading-helper-title').textContent, 'Connect to related knowledge');
  assert.match(c.nodes.get('reading-connections-results').innerHTML, /Connect this page/);
  assert.equal(c.r.helper.expanded, true); assert.ok(!c.nodes.get('reading-dialog')?.open);
});

test('Add sends the selected passage for automatic saving and shows completion without a Markdown editor', async () => {
  const c = client(); populate(c); c.context.state.panel = 'document';
  const task = { id: 'wiki-note-one', action: 'wiki-note', targetPage: 'timing', status: 'completed', publication: { page: 'timing' }, response: '### Generated note', snapshot: { highlights: [c.r.data.highlights[0]], documents: c.r.data.documents, annotations: [], wikiPages: [], discoveries: [], responses: [] } };
  c.context.api = { getWikiList: async () => [{ name: 'paper' }, { name: 'timing' }] };
  let submitted; let sidebarUpdated = false;
  c.context.buildSidebar = () => { sidebarUpdated = true; };
  c.context.fetch = async (url, options) => {
    if (url.endsWith('/tasks') && options.method === 'POST') { submitted = JSON.parse(options.body); return { ok: true, json: async () => task }; }
    return { ok: true, json: async () => url.includes('/tasks/') ? task : c.r.data };
  };
  c.openHighlightHelper('highlight-one', 160, 180); await c.saveSelection('yellow', 'wiki');
  c.document.getElementById('reading-new-artifact-target').value = 'timing';
  await c.nodes.get('reading-new-artifact-create').listeners.click();
  assert.equal(submitted.action, 'wiki-note');
  assert.equal(submitted.targetPage, 'timing');
  assert.equal(submitted.createMissingPage, false);
  assert.deepEqual(submitted.highlightIds, ['highlight-one']);
  assert.equal(c.nodes.get('reading-helper-title').textContent, 'Adding note to wiki');
  assert.match(c.nodes.get('reading-task-complete').innerHTML, /Note added to.*href="\/wiki\/timing"/);
  assert.doesNotMatch(c.nodes.get('reading-helper-body').innerHTML, /reading-artifact-editor|reading-artifact-reviewed|Markdown draft|Publish reviewed/);
  assert.equal(sidebarUpdated, true);
  assert.equal(c.r.helper.expanded, true); assert.ok(!c.nodes.get('reading-dialog')?.open);
});

test('a late AI response cannot reopen or replace another highlight helper', async () => {
  const c = client(); populate(c); c.context.state.panel = 'document';
  c.openHighlightHelper('highlight-one', 160, 180); c.r.helper.expanded = true;
  const task = { id: 'task-late', action: 'question', status: 'completed', response: 'Late response.', snapshot: { highlights: [c.r.data.highlights[0]], documents: c.r.data.documents, annotations: [], wikiPages: [], discoveries: [], responses: [] } };
  let finish;
  c.context.fetch = async url => url.includes('/tasks/') ? new Promise(resolve => { finish = () => resolve({ ok: true, json: async () => task }); }) : { ok: true, json: async () => c.r.data };
  const watching = c.watchTask(task);
  c.closeHelper(); c.openHighlightHelper('highlight-two', 200, 240);
  finish(); await watching;
  assert.equal(c.r.helper.highlightId, 'highlight-two'); assert.equal(c.r.helper.expanded, false);
  assert.equal(c.nodes.get('reading-helper-body').innerHTML, '');
  assert.ok(!c.nodes.get('reading-dialog')?.open);
});


test('journal page labels display as one-based page numbers without changing saved evidence', () => {
  const c = client(); populate(c); c.context.state.panel = 'document';
  c.r.data.highlights[0].anchors[0].label = '1789';
  c.renderWorkspace();
  assert.match(c.nodes.get('reading-notes').innerHTML, /p\. 1/);
  assert.doesNotMatch(c.nodes.get('reading-notes').innerHTML, /1789/);
  assert.equal(c.r.data.highlights[0].anchors[0].label, '1789');
  assert.doesNotMatch(html, /reading-ai-swatch/);
});


test('paper destination prefers its published summary and supports filename-based summaries', () => {
  const c = client(); populate(c); c.r.selected.add('highlight-one');
  const pages = [{ name: 'paper-summary' }, { name: 'timing-results' }];
  assert.equal(c.paperSummaryPage(pages), 'paper-summary');
  c.r.data.artifacts.push({ type: 'summary', updatedAt: '2026-10-16', snapshot: { documents: [c.r.data.documents[0]] }, publications: [{ page: 'timing-results' }] });
  assert.equal(c.paperSummaryPage(pages), 'timing-results');
  assert.equal(c.paperSummaryPage([{ name: 'unrelated' }]), 'timing-results');
});

test('researcher comments toggle preserves the filters and narrows the matching passages', async () => {
  const c = client(); populate(c); c.context.state.panel = 'document';
  c.r.data.annotations = [c.r.data.annotations[0]];
  c.renderWorkspace();
  const filters = () => c.nodes.get('reading-notes').innerHTML.split('<div class="reading-filters">')[1].split('<label class="reading-check">')[0];
  const before = filters();
  await c.nodes.get('reading-notes').listeners.change({ target: { id: 'reading-filter-annotated', checked: true, dataset: {} } });
  assert.equal(filters(), before);
  assert.equal(c.r.filter.annotated, true);
  assert.match(c.nodes.get('reading-notes').innerHTML, /data-reading-card="highlight-one"/);
  assert.doesNotMatch(c.nodes.get('reading-notes').innerHTML, /data-reading-card="highlight-two"/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'reading.css'), 'utf8');
  assert.match(css, /#reading-notes\s*\{[^}]*scrollbar-gutter:stable/);
});

function renderer({ count = 6, items = 2, holdCanvas = false, holdText = false, performanceRecorder = null } = {}) {
  const c = client({ performanceRecorder }); populate(c);
  c.context.state.panel = 'document';
  c.context.state.pdf = { page: 1, scale: 1, fitWidth: false };
  c.r.document = c.r.data.documents[0];
  const starts = []; const pending = []; const chunks = []; const textCancelled = []; const contextRequests = [];
  const stage = c.document.getElementById('document-stage');
  Object.assign(stage, { scrollTop: 0, clientHeight: 800, clientWidth: 648 });
  let active = 0; let maxActive = 0;
  c.context.getPdfLibrary = async () => ({ TextLayer: class {
    constructor({ textContentSource }) { this.reader = textContentSource.getReader(); this.textDivs = []; this.textContentItemsStr = []; }
    async render() {
      for (;;) {
        const { done, value } = await this.reader.read(); if (done) break;
        chunks.push(value.items.length);
        for (const item of value.items) { this.textDivs.push({ dataset: {} }); this.textContentItemsStr.push(item.str); }
      }
    }
    cancel() { void this.reader.cancel(); }
    update() {}
  } });
  c.r.pdf = {
    numPages: count,
    async destroy() {},
    async getPage(number) {
      return {
        rotate: 0, userUnit: 1, cleanups: 0,
        cleanup() { this.cleanups += 1; },
        getViewport({ scale, rotation = 0 }) { return { scale, rotation, width: 600 * scale, height: 800 * scale, convertToViewportRectangle: coords => coords }; },
        streamTextContent() {
          let offset = 0;
          return new ReadableStream({
            pull(controller) {
              if (holdText) return;
              if (offset >= items) { controller.close(); return; }
              const length = Math.min(100, items - offset);
              controller.enqueue({ items: Array.from({ length }, (_, i) => ({ str: `word-${offset + i} ` })), styles: {}, lang: 'en' });
              offset += length;
            },
            cancel() { textCancelled.push(number); },
          });
        },
        render() {
          starts.push(number); active += 1; maxActive = Math.max(maxActive, active);
          let finish; let fail;
          const promise = new Promise((resolve, reject) => { finish = resolve; fail = reject; }).finally(() => { active -= 1; });
          pending.push(finish);
          if (!holdCanvas) finish();
          return { promise, cancel() { fail(Object.assign(new Error('cancelled'), { name: 'RenderingCancelledException' })); } };
        },
      };
    },
  };
  for (let number = 1; number <= count; number += 1) {
    const offsetTop = 28 + (number - 1) * 826;
    c.r.pages.set(number, { number, near: true, rendered: false, wrap: { offsetTop, offsetHeight: 800, scrollIntoView() { stage.scrollTop = offsetTop; }, style: { setProperty() {} } }, canvas: { style: {}, getContext(type, options) { contextRequests.push({ number, type, options }); return { getContextAttributes: () => options }; } }, layer: { textContent: '' }, overlay: { innerHTML: '', textContent: '', append() {} } });
  }
  c.r.nearPages = new Set(c.r.pages.keys());
  return { ...c, stage, starts, pending, chunks, textCancelled, contextRequests, maxActive: () => maxActive };
}
async function until(check) {
  for (let i = 0; i < 200; i += 1) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  throw new Error('Reader did not reach the expected state');
}

test('page renders are serial, prioritise the new viewport, and skip obsolete prefetch', async () => {
  const c = renderer({ holdCanvas: true });
  const first = c.renderPage(1);
  await until(() => c.starts.length === 1);
  const distant = c.renderPage(2, true);
  const next = c.renderPage(6, true);
  const middle = c.renderPage(4, true);
  c.context.state.pdf.page = 6;
  c.r.pages.get(2).near = false;
  c.pending.shift()(); await first;
  await until(() => c.starts.length === 2);
  assert.deepEqual(c.starts, [1, 6]);
  c.pending.shift()(); await next;
  await until(() => c.starts.length === 3);
  c.pending.shift()(); await Promise.all([distant, middle]);
  assert.deepEqual(c.starts, [1, 6, 4]);
  assert.equal(c.maxActive(), 1);
});

test('offscreen text and canvas are released and can be rebuilt with identical selection offsets', async () => {
  const c = renderer({ count: 1, items: 275 }); const p = c.r.pages.get(1);
  await c.renderPage(1);
  const text = p.text; const offsets = p.textLayer.textDivs.map(span => ({ ...span.dataset }));
  assert.ok(c.chunks.length >= 3 && c.chunks.every(size => size <= 100));
  p.near = false; c.releasePage(p);
  assert.equal(p.canvas.width, 0); assert.equal(p.canvas.height, 0);
  assert.equal(p.textLayer, null); assert.equal(p.content, null); assert.equal(p.text, null);
  assert.equal(p.layer.textContent, ''); assert.equal(p.rendered, false);
  assert.ok(p.page.cleanups > 0);
  p.near = true; await c.renderPage(1);
  assert.equal(p.text, text);
  assert.deepEqual(p.textLayer.textDivs.map(span => ({ ...span.dataset })), offsets);
});

test('cache eviction protects active cross-page selections and allows release after deselection', async () => {
  const c = renderer({ count: 3 });
  await Promise.all([c.renderPage(1), c.renderPage(2, true), c.renderPage(3, true)]);
  const [one, two, three] = [...c.r.pages.values()];
  three.canvas.width = 32 * 1024 * 1024; three.canvas.height = 1;
  c.context.window.getSelection = () => ({ isCollapsed: false, rangeCount: 1, getRangeAt() { return { intersectsNode: layer => layer === one.layer || layer === two.layer }; } });
  for (const p of c.r.pages.values()) p.near = false;
  c.releaseDistantPages();
  assert.ok(one.textLayer); assert.ok(two.textLayer); assert.equal(three.textLayer, null);
  c.context.window.getSelection = () => ({ isCollapsed: true });
  c.releasePage(one); c.releasePage(two);
  assert.equal(one.textLayer, null); assert.equal(two.textLayer, null);
});

test('scrolling cancels an in-flight page and closing resolves queued work without late DOM writes', async () => {
  const c = renderer({ holdCanvas: true });
  const first = c.renderPage(1); const next = c.renderPage(2, true);
  await until(() => c.starts.length === 1);
  c.context.state.pdf.page = 2;
  const p = c.r.pages.get(1); p.near = false; c.releasePage(p);
  await first;
  assert.ok(p.page.cleanups > 0, 'a cancelled render must release its PDF page resources after settling');
  await until(() => c.starts.length === 2);
  const queued = c.renderPage(3, true);
  c.close();
  await Promise.all([next, queued]);
  assert.deepEqual(c.starts, [1, 2]);
  assert.equal(c.r.pages.size, 0); assert.equal(p.textLayer, null);
});

test('text chunks yield between batches and stop when the page is no longer wanted', async () => {
  const c = client(); let current = true;
  const content = { items: Array.from({ length: 1000 }, (_, i) => ({ str: String(i) })), styles: { font: {} }, lang: 'en' };
  const reader = c.textChunks(content, () => current).getReader();
  let inputHandled = false;
  setTimeout(() => { inputHandled = true; }, 0);
  const first = await reader.read();
  assert.equal(inputHandled, true);
  assert.equal(first.value.items.length, 100); assert.equal(first.value.styles, content.styles);
  current = false;
  assert.equal((await reader.read()).done, true);
});

test('large zoom levels keep the canvas pixel allocation within its budget', async () => {
  const c = renderer({ count: 1 });
  c.context.state.pdf.scale = 10; c.context.window.devicePixelRatio = 2;
  await c.renderPage(1);
  const canvas = c.r.pages.get(1).canvas;
  assert.ok(canvas.width * canvas.height <= 8 * 1024 * 1024);
  assert.equal(canvas.style.width, '6000px');
});

test('the first full-page canvas context uses the PDF.js software-backed settings', async () => {
  const c = renderer({ count: 1 });
  await c.renderPage(1);
  assert.equal(c.contextRequests.length, 1);
  assert.equal(c.contextRequests[0].options.willReadFrequently, true);
  assert.equal(c.contextRequests[0].options.alpha, false);
  assert.equal(c.r.pages.get(1).contextAttributes.willReadFrequently, true);
  c.close();
});

test('lag sampling cannot create a default context before PDF drawing chooses its settings', async () => {
  const performanceRecorder = { mark() {} };
  const c = renderer({ count: 2, performanceRecorder });
  for (const p of c.r.pages.values()) { p.canvas.width = 300; p.canvas.height = 150; }
  assert.deepEqual([...performanceRecorder.sample().canvases], []);
  assert.equal(c.contextRequests.length, 0);
  await c.renderPage(1);
  const sample = performanceRecorder.sample();
  assert.equal(sample.canvases.length, 1);
  assert.equal(sample.canvases[0].context.willReadFrequently, true);
  assert.equal(c.contextRequests.length, 1);
  const json = JSON.stringify(sample);
  assert.doesNotMatch(json, /Measured timing result|Assumption|word-0|Do not send unchecked/);
  c.close();
});

test('zoom during rendering cancels the old canvas and completes the same request at the new scale', async () => {
  const c = renderer({ count: 1, holdCanvas: true });
  c.r.defaultSize = { width: 600, height: 800 };
  const result = c.renderPage(1);
  await until(() => c.starts.length === 1);
  c.pending.shift(); // The first render is cancelled by layout, not completed.
  c.context.state.pdf.scale = 2; c.layout();
  await until(() => c.starts.length === 2);
  c.pending.shift()(); await result;
  assert.equal(c.r.pages.get(1).canvas.style.width, '1200px');
  assert.equal(c.r.pages.get(1).rendered, true);
  assert.equal(c.maxActive(), 1);
});

test('closing during text construction cancels the stream and leaves no retained text layer', async () => {
  const c = renderer({ count: 1, items: 3000 }); const p = c.r.pages.get(1);
  const result = c.renderPage(1);
  await until(() => p.buildingTextLayer);
  c.close(); await result;
  assert.equal(p.textLayer, null); assert.equal(p.buildingTextLayer, null);
  assert.equal(p.layer.textContent, '');
  assert.equal(c.r.pages.size, 0);
});

test('reading a long document keeps retained page content bounded and rebuilds earlier pages on return', async () => {
  const c = renderer({ count: 40 });
  for (const p of c.r.pages.values()) p.near = false;
  for (let number = 1; number <= 40; number += 1) {
    c.context.state.pdf.page = number;
    for (const p of c.r.pages.values()) p.near = p.number === number;
    c.releaseDistantPages();
    await c.renderPage(number);
    assert.ok([...c.r.pages.values()].filter(p => p.textLayer).length <= 5);
  }
  c.context.state.pdf.page = 1;
  c.r.pages.get(40).near = false; c.r.pages.get(1).near = true;
  c.releaseDistantPages(); await c.renderPage(1);
  assert.equal(c.r.pages.get(1).text, 'word-0 word-1 ');
  assert.equal(c.starts.filter(number => number === 1).length, 2);
});

test('an offscreen foreground page is not restarted while the current-page value is stale', async () => {
  const c = renderer({ count: 2, holdCanvas: true });
  const first = c.renderPage(1);
  await until(() => c.starts.length === 1);
  const second = c.renderPage(2, true);
  const old = c.r.pages.get(1); old.near = false; c.releasePage(old);
  await first;
  await until(() => c.starts.length === 2);
  assert.equal(c.context.state.pdf.page, 1);
  assert.deepEqual(c.starts, [1, 2]);
  c.pending[1](); await second; c.close();
});

test('rapid scroll events pause rendering and update viewport priority before scrolling settles', async () => {
  const c = renderer({ count: 6, holdCanvas: true }); const frames = [];
  c.context.window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  c.context.window.cancelAnimationFrame = () => {};
  const first = c.renderPage(1);
  await until(() => c.starts.length === 1);
  for (let i = 0; i < 12; i += 1) {
    c.stage.scrollTop = c.r.pages.get(i % 2 ? 6 : 1).wrap.offsetTop;
    c.stage.listeners.scroll();
  }
  assert.equal(frames.length, 1, 'viewport reads should be coalesced into one animation frame');
  frames.shift()();
  assert.equal(c.context.state.pdf.page, 6, 'priority must change before the settle timer');
  assert.equal(c.r.pages.get(1).near, false);
  const target = c.renderPage(6, true);
  await first;
  assert.deepEqual(c.starts, [1], 'no new canvas should start during scrolling');
  await until(() => c.starts.length === 2);
  assert.deepEqual(c.starts, [1, 6], 'the visible destination should precede nearby prefetch');
  c.pending[1](); await target;
  assert.equal(c.maxActive(), 1); c.close();
});

test('reversing between two cached pages twelve times requires only two complete builds', async () => {
  const c = renderer({ count: 2, items: 275 });
  for (let step = 0; step < 12; step += 1) {
    const number = step % 2 + 1; c.context.state.pdf.page = number;
    for (const p of c.r.pages.values()) p.near = p.number === number;
    c.releaseDistantPages(); await c.renderPage(number);
  }
  assert.deepEqual(c.starts, [1, 2]);
  assert.equal(c.chunks.length, 6, 'text layers should also be reused');
  assert.equal(c.r.pages.get(1).textLayer.textDivs[1].dataset.textStart, 'word-0 '.length);
  c.close();
});

test('cache eviction obeys its combined pixel budget at high zoom', async () => {
  const c = renderer({ count: 8 });
  c.context.state.pdf.scale = 3; c.context.window.devicePixelRatio = 2;
  for (let number = 1; number <= 8; number += 1) {
    c.context.state.pdf.page = number;
    for (const p of c.r.pages.values()) p.near = p.number === number;
    await c.renderPage(number);
  }
  const retained = [...c.r.pages.values()].filter(p => p.canvasReady);
  assert.ok(retained.length <= 3);
  assert.ok(retained.reduce((sum, p) => sum + p.canvas.width * p.canvas.height, 0) <= 24 * 1024 * 1024);
  assert.equal(c.r.pages.get(8).rendered, true); c.close();
});

test('wheel input cancels extraction and resumes text without redrawing the completed canvas', async () => {
  const c = renderer({ count: 1, holdText: true }); const p = c.r.pages.get(1);
  const result = c.renderPage(1);
  await until(() => p.textReader);
  c.stage.listeners.wheel();
  await until(() => c.textCancelled.length === 1);
  assert.equal(p.canvasReady, true);
  p.page.streamTextContent = () => new ReadableStream({ start(controller) {
    controller.enqueue({ items: [{ str: 'Resumed text' }], styles: {}, lang: 'en' }); controller.close();
  } });
  await result;
  assert.equal(p.text, 'Resumed text'); assert.deepEqual(c.starts, [1]); c.close();
});

test('closing during pending extraction cancels the worker stream and clears delayed scrolling work', async () => {
  const c = renderer({ count: 1, holdText: true });
  const result = c.renderPage(1);
  await until(() => c.r.pages.get(1).textReader);
  c.stage.listeners.scroll(); c.close(); await result;
  assert.deepEqual(c.textCancelled, [1]);
  assert.equal(c.r.viewportFrame, null); assert.equal(c.r.scrolling, false);
  assert.equal(c.r.pages.size, 0);
});

test('viewport tracking finds a distant page without measuring the whole document', () => {
  const c = renderer({ count: 400 }); let reads = 0;
  for (const p of c.r.pages.values()) {
    const top = p.wrap.offsetTop;
    Object.defineProperty(p.wrap, 'offsetTop', { get() { reads += 1; return top; } });
    p.near = p.number <= 2;
  }
  c.r.nearPages = new Set([1, 2]); c.stage.scrollTop = 28 + 249 * 826;
  c.updateViewport();
  assert.equal(c.context.state.pdf.page, 250);
  assert.ok(reads < 30, `expected bounded layout reads, got ${reads}`);
  assert.equal(c.r.pages.get(250).visible, true);
  assert.equal(c.r.pages.get(249).visible, false);
  assert.equal(c.r.pages.get(1).near, false); c.close();
});

test('zoom invalidates completed cached canvases before they are reused', async () => {
  const c = renderer({ count: 2 }); c.r.defaultSize = { width: 600, height: 800 };
  await c.renderPage(1); await c.renderPage(2);
  c.context.state.pdf.scale = 2; c.layout();
  assert.equal(c.r.pages.get(1).canvasReady, false);
  await c.renderPage(1);
  assert.deepEqual(c.starts, [1, 2, 1]);
  assert.equal(c.r.pages.get(1).canvas.style.width, '1200px'); c.close();
});

test('hiding the reader cancels visible and queued work without rendering the hidden document', async () => {
  const c = renderer({ count: 40, holdCanvas: true });
  const first = c.renderPage(1); const second = c.renderPage(2, true);
  await until(() => c.starts.length === 1);
  c.stage.clientHeight = 0; c.updateViewport(); c.queueNearbyPages();
  await Promise.all([first, second]);
  assert.equal(c.r.nearPages.size, 0);
  assert.deepEqual(c.starts, [1]); c.close();
});

function thumbnail(c, number) {
  const nav = c.document.getElementById('reading-thumbnails'); nav.hidden = false;
  const button = c.document.createElement('button');
  button.dataset = { readingJump: String(number), near: 'true' };
  const canvas = { getContext(type, options) { button.contextOptions = options; return {}; } };
  button.querySelector = () => canvas;
  nav.append(button); nav.contains = node => nav.children.includes(node);
  return button;
}

test('thumbnails share the render slot and yield to full-size page requests', async () => {
  const c = renderer({ count: 6, holdCanvas: true });
  const first = c.renderPage(1);
  await until(() => c.starts.length === 1);
  const fourth = thumbnail(c, 4);
  c.queueThumbnail(fourth); c.queueThumbnail(thumbnail(c, 5));
  c.pending[0](); await first;
  await until(() => c.starts.length === 2);
  assert.deepEqual(c.starts, [1, 4]);
  assert.equal(fourth.contextOptions.willReadFrequently, true);
  assert.equal(fourth.contextOptions.alpha, false);
  const target = c.renderPage(6);
  await until(() => c.starts.length === 3);
  assert.deepEqual(c.starts, [1, 4, 6], 'visible reading must interrupt thumbnail work');
  c.pending[2](); await target;
  assert.equal(c.maxActive(), 1); c.close();
});

test('scrolling also interrupts thumbnail work and leaves no extra render running', async () => {
  const c = renderer({ count: 1, holdCanvas: true });
  c.queueThumbnail(thumbnail(c, 1));
  await until(() => c.starts.length === 1);
  c.stage.listeners.wheel();
  await until(() => !c.r.thumbnailTask);
  assert.deepEqual(c.starts, [1]); assert.equal(c.r.scrolling, true); c.close();
});


test('Add to wiki keeps the missing paper page selected and queues automatic creation only on Add', async () => {
  const c = client(); populate(c); c.context.state.panel = 'document';
  c.context.api = { getWikiList: async () => [{ name: 'index' }, { name: 'log' }, { name: 'timing' }] };
  const requests = []; let sidebarUpdated = false;
  c.context.buildSidebar = () => { sidebarUpdated = true; };
  const task = { id: 'new-paper-note', action: 'wiki-note', targetPage: 'paper', status: 'completed', publication: { page: 'paper' }, response: '### Note', snapshot: { highlights: [c.r.data.highlights[0]], documents: c.r.data.documents, annotations: [], wikiPages: [], discoveries: [], responses: [] } };
  c.context.fetch = async (url, options) => {
    if (options.method === 'POST') {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => task };
    }
    return { ok: true, json: async () => url.includes('/tasks/') ? task : c.r.data };
  };
  c.openHighlightHelper('highlight-one', 160, 180); await c.saveSelection('yellow', 'wiki');
  assert.equal(c.nodes.get('reading-new-artifact-target').value, 'paper');
  assert.match(c.nodes.get('reading-helper-body').innerHTML, /value="paper" selected>paper \(create on Add\)/);
  assert.doesNotMatch(c.nodes.get('reading-helper-body').innerHTML, /Choose a wiki page|value="index"|value="log"/);
  assert.equal(requests.length, 0);
  await c.nodes.get('reading-new-artifact-create').listeners.click();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, 'wiki-note');
  assert.equal(requests[0].targetPage, 'paper');
  assert.equal(requests[0].createMissingPage, true);
  assert.equal(sidebarUpdated, true);
  assert.match(c.nodes.get('reading-task-complete').innerHTML, /Note added to/);
  assert.doesNotMatch(c.nodes.get('reading-helper-body').innerHTML, /reading-artifact-editor|reading-artifact-reviewed/);
});

test('paper destinations match renamed sources and always provide a safe fallback', () => {
  const c = client(); populate(c); c.r.selected.add('highlight-one');
  const doc = c.r.data.documents[0];
  doc.currentName = 'Renamed Paper.pdf';
  assert.equal(c.paperSummaryPage([{ name: 'paper-summary' }]), 'paper-summary');
  assert.equal(c.paperSummaryPage([]), 'renamed-paper');
  doc.currentName = 'index.pdf'; doc.aliases = ['log.pdf'];
  assert.match(c.paperSummaryPage([]), /^paper-document-one-notes$/);
});


test('automatic wiki-note progress hides generated Markdown and offers retry after failure', async () => {
  const c = client(); populate(c); c.context.state.panel = 'document';
  c.openHighlightHelper('highlight-one', 160, 180); c.r.helper.expanded = true;
  const task = { id: 'note-failed', action: 'wiki-note', targetPage: 'paper', status: 'failed', error: 'Could not connect.', progress: '### Partial generated Markdown', response: '', snapshot: { highlights: [c.r.data.highlights[0]], documents: c.r.data.documents, annotations: [], wikiPages: [], discoveries: [], responses: [] } };
  c.context.fetch = async url => ({ ok: true, json: async () => url.includes('/tasks/') ? task : c.r.data });
  await c.watchTask(task);
  assert.equal(c.nodes.get('reading-task-live').textContent, '');
  assert.match(c.nodes.get('reading-task-complete').innerHTML, /Could not connect/);
  assert.match(c.nodes.get('reading-task-complete').innerHTML, /Try again/);
  assert.doesNotMatch(c.nodes.get('reading-helper-body').innerHTML, /reading-artifact-editor|Markdown draft/);
});
