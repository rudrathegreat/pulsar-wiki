'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TABLES = ['documents', 'highlights', 'annotations', 'relationships', 'collections', 'tasks', 'artifacts', 'discoveries'];
const COLORS = new Set(['yellow', 'green', 'blue', 'pink']);
const ARTIFACT_TYPES = new Set(['summary', 'synthesis', 'evidence', 'concept']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

class ReadingError extends Error {
  constructor(message, code = 'invalid-reading-data', status = 400) {
    super(message);
    this.name = 'ReadingError';
    this.code = code;
    this.status = status;
  }
}

function text(value, maximum = 20000) {
  if (typeof value !== 'string' || value.length > maximum) throw new ReadingError(`Text must be at most ${maximum} characters.`);
  return value;
}

function ids(values, maximum = 200) {
  if (!Array.isArray(values) || values.length > maximum || values.some(v => typeof v !== 'string' || v.length > 150)) throw new ReadingError('Invalid selection.');
  return [...new Set(values)];
}

function anchors(values) {
  if (!Array.isArray(values) || !values.length || values.length > 100) throw new ReadingError('Select a passage or region.');
  return values.map(a => {
    if (!Number.isInteger(a.page) || a.page < 1 || a.page > 100000) throw new ReadingError('Invalid page number.');
    if (!Array.isArray(a.rects) || !a.rects.length || a.rects.length > 500) throw new ReadingError('A selection needs page coordinates.');
    const rects = a.rects.map(r => {
      if (!Array.isArray(r) || r.length !== 4 || r.some(v => !Number.isFinite(v) || Math.abs(v) > 100000)) throw new ReadingError('Invalid selection coordinates.');
      return [...r];
    });
    const start = a.start == null ? null : a.start;
    const end = a.end == null ? null : a.end;
    if ((start !== null && (!Number.isInteger(start) || start < 0)) || (end !== null && (!Number.isInteger(end) || end < (start || 0)))) throw new ReadingError('Invalid text offsets.');
    return { page: a.page, label: text(a.label || String(a.page), 100), rects, exact: text(a.exact || ''), prefix: text(a.prefix || '', 500), suffix: text(a.suffix || '', 500), start, end };
  });
}

function imageData(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 4 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value)) throw new ReadingError('Use a PNG selection smaller than 3 MB.');
  const bytes = Buffer.from(value.split(',')[1], 'base64');
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new ReadingError('Invalid PNG selection.');
  return value;
}

function validateSnapshot(snapshot) {
  if (!snapshot || !['highlights', 'annotations', 'documents', 'wikiPages', 'discoveries', 'responses'].every(key => Array.isArray(snapshot[key]))) throw new ReadingError('Invalid preserved reading inputs.');
  for (const h of snapshot.highlights) {
    if (!h || !/^[a-zA-Z0-9-]{1,150}$/.test(h.id) || !/^[a-zA-Z0-9-]{1,150}$/.test(h.documentId) || !Number.isInteger(h.revision) || !COLORS.has(h.color) || !['text', 'region'].includes(h.kind)) throw new ReadingError('Invalid preserved highlight.');
    anchors(h.anchors); text(h.text); ids(h.categories); imageData(h.image);
  }
  for (const d of snapshot.documents) {
    if (!d || !/^[a-zA-Z0-9-]{1,150}$/.test(d.id) || !/^[a-f0-9]{64}$/.test(d.hash) || !Array.isArray(d.aliases) || !d.aliases.length || d.aliases.some(n => typeof n !== 'string' || /[\\/<>\r\n]/.test(n))) throw new ReadingError('Invalid preserved document.');
  }
  if (snapshot.highlights.some(h => !snapshot.documents.some(d => d.id === h.documentId))) throw new ReadingError('Missing preserved document.');
  for (const a of snapshot.annotations) { if (!a || !/^[a-zA-Z0-9-]{1,150}$/.test(a.id) || !snapshot.highlights.some(h => h.id === a.highlightId)) throw new ReadingError('Invalid preserved comment.'); text(a.text); }
  for (const w of snapshot.wikiPages) { if (!w || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(w.name)) throw new ReadingError('Invalid preserved wiki page.'); text(w.content, 1000000); }
  for (const d of snapshot.discoveries) validateDiscovery(d);
  for (const response of snapshot.responses) { if (!response || !/^[a-zA-Z0-9-]{1,150}$/.test(response.id)) throw new ReadingError('Invalid included AI response.'); text(response.response, 500000); }
}

function validateDiscovery(record) {
  if (!record || !record.source || typeof record.source.id !== 'string') throw new ReadingError('Invalid external candidate.');
  text(record.source.title, 2000); text(record.source.abstract || '', 100000);
  if (record.source.authors !== undefined && (!Array.isArray(record.source.authors) || record.source.authors.some(a => typeof a !== 'string'))) throw new ReadingError('Invalid paper authors.');
  let url;
  try { url = new URL(record.source.recordUrl); } catch { throw new ReadingError('Invalid paper record URL.'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new ReadingError('Unsafe paper record URL.');
}

class ReadingStore {
  constructor({ dataDir, fsModule = fs } = {}) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'reading.json');
    this.fs = fsModule;
    this.data = null;
  }

  load() {
    if (this.data) return this.data;
    try {
      const data = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
      this.validate(data);
      this.data = data;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new ReadingError('Reading records could not be loaded. The original file has been preserved; restore a valid backup before continuing.', 'reading-store-unreadable', 503);
      this.data = { version: 1, revision: 0, ...Object.fromEntries(TABLES.map(t => [t, []])) };
    }
    return this.data;
  }

  validate(data) {
    if (!data || data.version !== 1 || !Number.isInteger(data.revision) || data.revision < 0 || TABLES.some(t => !Array.isArray(data[t]))) throw new ReadingError('Unsupported or damaged reading backup.');
    for (const table of TABLES) {
      const seen = new Set();
      for (const record of data[table]) {
        if (!record || typeof record.id !== 'string' || !/^[a-zA-Z0-9-]{1,150}$/.test(record.id) || seen.has(record.id) || !Number.isInteger(record.revision) || record.revision < 1) throw new ReadingError('Invalid or duplicate reading record.');
        seen.add(record.id);
      }
    }
    const documents = new Set(data.documents.map(d => d.id));
    const highlights = new Set(data.highlights.map(h => h.id));
    for (const d of data.documents) {
      if (!/^[a-f0-9]{64}$/.test(d.hash) || !Array.isArray(d.aliases) || !d.aliases.length || d.aliases.some(n => typeof n !== 'string' || path.basename(n) !== n || /[\\/<>\r\n]/.test(n))) throw new ReadingError('Invalid document identity.');
      if (!Number.isInteger(d.pageCount) || d.pageCount < 1 || d.pageCount > 100000 || !Array.isArray(d.labels) || d.labels.length !== d.pageCount) throw new ReadingError('Invalid page inventory.');
      for (const label of d.labels) text(label, 100);
      if (!d.position || !Number.isInteger(d.position.page) || d.position.page < 1 || d.position.page > d.pageCount || !Number.isFinite(d.position.scale) || d.position.scale < .25 || d.position.scale > 4 || typeof d.position.fitWidth !== 'boolean') throw new ReadingError('Invalid saved reading position.');
    }
    for (const h of data.highlights) {
      if (!documents.has(h.documentId) || !['text', 'region'].includes(h.kind) || !COLORS.has(h.color)) throw new ReadingError('Invalid highlight.');
      anchors(h.anchors); text(h.text); ids(h.categories); imageData(h.image);
      if (h.history !== undefined) {
        if (!Array.isArray(h.history) || h.history.some(previous => previous.history !== undefined || previous.id !== h.id)) throw new ReadingError('Invalid highlight history.');
        for (const previous of h.history) validateSnapshot({ highlights: [previous], documents: data.documents, annotations: [], wikiPages: [], discoveries: [], responses: [] });
      }
    }
    for (const a of data.annotations) { if (!highlights.has(a.highlightId)) throw new ReadingError('Orphan annotation.'); text(a.text); }
    for (const c of data.collections) {
      text(c.name, 120); text(c.notes);
      if (ids(c.highlightIds).some(id => !highlights.has(id)) || !c.groups || typeof c.groups !== 'object' || Array.isArray(c.groups)) throw new ReadingError('Invalid collection members or groups.');
      for (const [id, value] of Object.entries(c.groups)) { if (!c.highlightIds.includes(id)) throw new ReadingError('Invalid collection group.'); text(value, 120); }
    }
    for (const r of data.relationships) if (!highlights.has(r.from) || !['highlight', 'wiki'].includes(r.targetType) || (r.targetType === 'highlight' ? !highlights.has(r.target) : !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.target))) throw new ReadingError('Invalid relationship.');
    for (const a of data.artifacts) {
      if (!ARTIFACT_TYPES.has(a.type) || typeof a.content !== 'string' || !Array.isArray(a.revisions) || !Array.isArray(a.publications)) throw new ReadingError('Invalid artifact.');
      text(a.title, 200); text(a.content, 500000); validateSnapshot(a.snapshot);
      for (const publication of a.publications) { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(publication.page)) throw new ReadingError('Invalid publication history.'); validateSnapshot(publication.snapshot); }
    }
    for (const t of data.tasks) { if (!['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(t.status)) throw new ReadingError('Invalid assistance record.'); validateSnapshot(t.snapshot); }
    for (const d of data.discoveries) validateDiscovery(d);
    return data;
  }

  read() { return structuredClone(this.load()); }

  get(table, id, { deleted = false } = {}) {
    if (!TABLES.includes(table)) throw new ReadingError('Unknown reading resource.');
    const record = this.load()[table].find(r => r.id === id && (deleted || !r.deletedAt));
    if (!record) throw new ReadingError('Reading record not found.', 'reading-not-found', 404);
    return structuredClone(record);
  }

  transaction(change, expectedRevision) {
    const current = this.load();
    if (expectedRevision !== undefined && expectedRevision !== current.revision) throw new ReadingError('Reading data changed in another tab. Refresh and retry.', 'reading-conflict', 409);
    const next = structuredClone(current);
    const result = change(next);
    next.revision += 1;
    this.validate(next);
    this.fs.mkdirSync(this.dir, { recursive: true });
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      const fd = this.fs.openSync(temporary, 'wx', 0o600);
      try { this.fs.writeFileSync(fd, `${JSON.stringify(next)}\n`); this.fs.fsyncSync(fd); } finally { this.fs.closeSync(fd); }
      this.fs.renameSync(temporary, this.file);
    } catch {
      try { this.fs.unlinkSync(temporary); } catch { /* original remains intact */ }
      throw new ReadingError('Reading changes could not be saved. Your previous records are intact.', 'reading-write-failed', 503);
    }
    this.data = next;
    return structuredClone(result);
  }

  create(table, values) {
    return this.transaction(data => {
      const record = { ...values, id: crypto.randomUUID(), revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      data[table].push(record);
      return record;
    });
  }

  update(table, id, expectedRevision, values) {
    return this.transaction(data => {
      const record = data[table].find(r => r.id === id && !r.deletedAt);
      if (!record) throw new ReadingError('Reading record not found.', 'reading-not-found', 404);
      if (record.revision !== expectedRevision) throw new ReadingError('This record changed in another tab. Refresh before saving.', 'reading-conflict', 409);
      Object.assign(record, values, { revision: record.revision + 1, updatedAt: new Date().toISOString() });
      return record;
    });
  }

  recoverTasks() {
    if (!this.load().tasks.some(t => ['queued', 'running'].includes(t.status))) return;
    this.transaction(data => {
      for (const t of data.tasks) if (['queued', 'running'].includes(t.status)) { t.status = 'interrupted'; t.error = 'The server restarted. Retry explicitly to run this request again.'; t.revision += 1; }
    });
  }

  importBackup(input, expectedRevision) {
    const incoming = this.validate(structuredClone(input));
    if (JSON.stringify(incoming).length > 100 * 1024 * 1024) throw new ReadingError('Backup is larger than the 100 MB import limit.');
    // Merge only absent IDs. Existing records and immutable snapshots are never overwritten.
    return this.transaction(data => {
      let added = 0;
      for (const table of TABLES) {
        const existing = new Map(data[table].map(r => [r.id, r]));
        for (const record of incoming[table]) {
          if (existing.has(record.id)) {
            if (JSON.stringify(existing.get(record.id)) !== JSON.stringify(record)) throw new ReadingError('This backup conflicts with existing records. Import into a fresh workspace or use the current backup.', 'reading-conflict', 409);
          } else { data[table].push(record); added += 1; }
        }
      }
      for (const t of data.tasks) if (['queued', 'running'].includes(t.status)) t.status = 'interrupted';
      return { added };
    }, expectedRevision);
  }
}

module.exports = { ReadingStore, ReadingError, COLORS, ARTIFACT_TYPES, anchors, ids, text, imageData, hash };
