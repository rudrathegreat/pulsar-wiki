'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const templateSections = require('../integrations/jupyter/notebook-template.json');

const MAX_NOTEBOOK_BYTES = 25 * 1024 * 1024;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const uuid = () => crypto.randomUUID();
class NotebookError extends Error {
  constructor(message, code = 'notebook-error', status = 400) { super(message); this.name = 'NotebookError'; this.code = code; this.status = status; }
}
function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative) || relative.split('/').some(p => !p || p === '.' || p === '..' || /[<>:"|?*]/.test(p))) throw new NotebookError('Invalid notebook path.', 'invalid-path');
  const absolute = path.resolve(root, relative);
  if (!within(root, absolute)) throw new NotebookError('Notebook paths must stay inside the workspace.', 'invalid-path');
  for (let current = absolute; within(root, current); current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new NotebookError('Notebook storage cannot use symbolic links.', 'invalid-path');
    if (current === root) break;
  }
  return absolute;
}
function normalizeNotebook(value, id) {
  const book = structuredClone(value);
  if (!book || book.nbformat !== 4 || !Array.isArray(book.cells) || !book.metadata || typeof book.metadata !== 'object' || Array.isArray(book.metadata)) throw new NotebookError('Choose a valid version 4 Jupyter notebook.', 'invalid-notebook');
  const used = new Set();
  for (const cell of book.cells) {
    if (!cell || !['code', 'markdown', 'raw'].includes(cell.cell_type) || !(typeof cell.source === 'string' || Array.isArray(cell.source) && cell.source.every(s => typeof s === 'string'))) throw new NotebookError('The notebook contains an invalid cell.', 'invalid-notebook');
    cell.metadata ||= {};
    if (typeof cell.metadata !== 'object' || Array.isArray(cell.metadata)) throw new NotebookError('Invalid cell metadata.', 'invalid-notebook');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(cell.id || '') || used.has(cell.id)) cell.id = uuid();
    used.add(cell.id);
    if (cell.cell_type === 'code') { cell.outputs ||= []; cell.execution_count ??= null; if (!Array.isArray(cell.outputs)) throw new NotebookError('Invalid notebook outputs.', 'invalid-notebook'); }
  }
  book.nbformat_minor = Math.max(5, Number(book.nbformat_minor) || 0);
  book.metadata.pulsarwiki = { ...book.metadata.pulsarwiki, id };
  if (Buffer.byteLength(JSON.stringify(book)) > MAX_NOTEBOOK_BYTES) throw new NotebookError('Notebook exceeds the 25 MB limit.', 'notebook-too-large', 413);
  return book;
}
const serialize = value => `${JSON.stringify(value, null, 2)}\n`;
function blankNotebook() { return { nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: 'pulsarwiki-python', display_name: 'Workspace Python', language: 'python' }, language_info: { name: 'python' } }, cells: [{ id: uuid(), cell_type: 'markdown', metadata: {}, source: '' }] }; }
function researchNotebook() {
  const notebook = blankNotebook();
  notebook.cells = templateSections.map(source => ({ id: uuid(), cell_type: 'markdown', metadata: {}, source }));
  return notebook;
}

class NotebookStore {
  constructor({ rootDir, dataDir, fsModule = fs }) {
    this.rootDir = rootDir; this.dir = path.join(rootDir, 'notebooks'); this.dataDir = path.join(dataDir, 'notebooks'); this.fs = fsModule;
    for (const dir of [this.dir, this.dataDir]) {
      if (!within(fs.realpathSync(rootDir), path.resolve(dir))) throw new NotebookError('Notebook storage must stay inside the workspace.');
      // Validate every existing ancestor before creating directories.
      safePath(rootDir, path.relative(rootDir, dir).split(path.sep).join('/'));
      fs.mkdirSync(dir, { recursive: true });
    }
    this.file = path.join(this.dataDir, 'catalog.json');
  }
  load() {
    if (!this.fs.existsSync(this.file)) return { version: 1, notebooks: [], recalls: [], runs: [] };
    try {
      const data = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
      if (data.version !== 1 || !['notebooks', 'recalls', 'runs'].every(k => Array.isArray(data[k]))) throw new Error();
      return data;
    } catch { throw new NotebookError('Notebook history could not be read. Existing files are preserved.', 'history-unavailable', 503); }
  }
  atomic(file, body) {
    const temporary = `${file}.${uuid()}.tmp`;
    this.fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      const fd = this.fs.openSync(temporary, 'wx', 0o600);
      try { this.fs.writeFileSync(fd, body); this.fs.fsyncSync(fd); } finally { this.fs.closeSync(fd); }
      this.fs.renameSync(temporary, file);
    } finally { try { this.fs.unlinkSync(temporary); } catch { /* renamed or absent */ } }
  }
  update(change) { const data = this.load(); const result = change(data); this.atomic(this.file, serialize(data)); return structuredClone(result); }
  path(name) {
    if (!name.endsWith('.ipynb')) throw new NotebookError('Notebook filenames must end in .ipynb.', 'invalid-path');
    return safePath(this.dir, name);
  }
  snapshotPath(id, revision) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !Number.isInteger(Number(revision)) || Number(revision) < 1) throw new NotebookError('Invalid notebook revision.');
    return safePath(this.dataDir, `history/${id}/${Number(revision)}.json`);
  }
  savePath(name, input, expectedRevision, label = '') {
    const file = this.path(name); const data = this.load();
    let entry = data.notebooks.find(n => n.path === name);
    if (expectedRevision !== undefined && (entry?.revision || 0) !== expectedRevision) throw new NotebookError('This notebook changed. Refresh before saving or transferring material.', 'notebook-conflict', 409);
    const id = entry?.id || uuid(); const notebook = normalizeNotebook(input, id); const content = serialize(notebook); const digest = hash(content);
    const previous = this.fs.existsSync(file) ? this.fs.readFileSync(file) : null;
    const diskHash = previous && hash(serialize(normalizeNotebook(JSON.parse(previous.toString()), id)));
    if (expectedRevision !== undefined && entry && diskHash !== entry.hash) throw new NotebookError('The notebook changed outside PulsarWiki. Refresh before saving.', 'notebook-conflict', 409);
    if (entry?.hash === digest && !label) return { ...entry, available: true };
    const date = new Date().toISOString();
    if (!entry) { entry = { id, path: name, revision: 0, createdAt: date, history: [] }; data.notebooks.push(entry); }
    const revision = entry.revision + 1;
    const snapshot = { notebookId: id, revision, path: name, savedAt: date, label: String(label).slice(0, 120), hash: digest, notebook };
    const snapshotFile = this.snapshotPath(id, revision);
    try {
      this.atomic(snapshotFile, serialize(snapshot));
      this.atomic(file, content);
      Object.assign(entry, { revision, hash: digest, updatedAt: date });
      entry.history.push({ revision, hash: digest, savedAt: date, label: snapshot.label });
      this.atomic(this.file, serialize(data));
    } catch {
      try { if (previous) this.atomic(file, previous); else this.fs.unlinkSync(file); } catch { /* report failure; do not replace history */ }
      try { this.fs.unlinkSync(snapshotFile); } catch { /* absent */ }
      throw new NotebookError('The notebook could not be saved. Check local storage before retrying.', 'notebook-write-failed', 503);
    }
    return structuredClone({ ...entry, available: true });
  }
  sync() {
    const scan = (folder, prefix = '') => {
      for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
        if (item.name.startsWith('.') || item.isSymbolicLink()) continue;
        const name = `${prefix}${item.name}`;
        if (item.isDirectory()) { scan(path.join(folder, item.name), `${name}/`); continue; }
        if (!item.isFile() || !name.endsWith('.ipynb')) continue;
        const file = this.path(name);
        if (fs.statSync(file).size > MAX_NOTEBOOK_BYTES) continue;
        let notebook; try { notebook = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
        const data = this.load();
        const prior = data.notebooks.find(n => n.id === notebook.metadata?.pulsarwiki?.id);
        if (prior && prior.path !== name && !fs.existsSync(this.path(prior.path))) this.update(d => { d.notebooks.find(n => n.id === prior.id).path = name; });
        try { this.savePath(name, notebook); } catch (error) { if (error.code !== 'invalid-notebook') throw error; }
      }
    };
    scan(this.dir);
    return this.list();
  }
  list() { return this.load().notebooks.map(n => ({ ...n, available: fs.existsSync(this.path(n.path)) })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  entry(id) { const entry = this.load().notebooks.find(n => n.id === id); if (!entry) throw new NotebookError('Notebook not found.', 'notebook-not-found', 404); return entry; }
  read(id, revision) {
    const entry = this.entry(id); const number = revision === undefined ? entry.revision : Number(revision);
    if (!entry.history.some(r => r.revision === number)) throw new NotebookError('Notebook revision not found.', 'revision-not-found', 404);
    return JSON.parse(this.fs.readFileSync(this.snapshotPath(id, number), 'utf8'));
  }
  create(name, notebook = researchNotebook()) {
    const file = this.path(name);
    if (fs.existsSync(file) || this.load().notebooks.some(n => n.path === name)) throw new NotebookError('Choose another notebook filename.', 'notebook-conflict', 409);
    return this.savePath(name, notebook, 0);
  }
  rename(id, name, revision) {
    this.sync(); const entry = this.entry(id); const destination = this.path(name); const original = this.path(entry.path);
    if (entry.revision !== revision) throw new NotebookError('The notebook changed. Refresh before renaming.', 'notebook-conflict', 409);
    if (fs.existsSync(destination)) throw new NotebookError('That filename already exists.', 'notebook-conflict', 409);
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.renameSync(original, destination);
    try { return this.update(data => Object.assign(data.notebooks.find(n => n.id === id), { path: name })); }
    catch (error) { fs.renameSync(destination, original); throw error; }
  }
  restore(id, revision, expectedRevision) {
    const old = this.read(id, revision); const entry = this.entry(id);
    return this.savePath(entry.path, old.notebook, expectedRevision, `Restored revision ${old.revision}`);
  }
  checkpoint(id, expectedRevision, label) { const entry = this.entry(id); return this.savePath(entry.path, this.read(id).notebook, expectedRevision, label || 'Checkpoint'); }
}

module.exports = { NotebookStore, NotebookError, MAX_NOTEBOOK_BYTES, blankNotebook, normalizeNotebook, safePath, hash, serialize };
