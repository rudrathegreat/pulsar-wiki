'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse, text } = require('../public/bibtex');
const { normalize: normalizeOrcid } = require('../public/orcid');
const COMPLETION_NOTE = 'Bibliographic metadata needs completion';

// Treat metadata as text, never as BibTeX syntax supplied by a source.
function bibText(value) {
  return String(value ?? '').replace(/[\\{}%&#_$]/g, char => char === '\\' ? '\\textbackslash{}' : `\\${char}`)
    .replace(/[\r\n\t]+/g, ' ');
}

class References {
  constructor({ rootDir, rawDir, metadata = null }) {
    this.file = path.join(rootDir, 'references.bib');
    this.rawDir = rawDir;
    this.metadata = metadata;
    this.extracted = new Set();
  }

  read() {
    if (fs.existsSync(this.file) && fs.lstatSync(this.file).isSymbolicLink()) throw new Error('references.bib must be a file inside the workspace.');
    const content = fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8') : '';
    return { content, revision: crypto.createHash('sha256').update(content).digest('hex') };
  }

  write(content) {
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporary, this.file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  add(files) {
    let { content } = this.read();
    const keys = new Set([...content.matchAll(/@\w+\s*[{(]\s*([^\s,]+)\s*,/g)].map(match => match[1]));
    for (const source of files) {
      const file = bibText(`raw/${source.name}`);
      // The file field associates a citation with its immutable source even after a key is edited.
      const escapedFile = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\bfile\\s*=\\s*(?:\\{\\s*${escapedFile}\\s*\\}|"\\s*${escapedFile}\\s*")`, 'i').test(content)) continue;
      const existing = this.findPaper(source, content);
      if (existing && !existing.fields.file) {
        const lastValueEnd = Math.max(...Object.values(existing.fieldLocations).map(location => location.end));
        const tail = content.slice(lastValueEnd, existing.end - 1).replace(/%[^\n]*/g, '').trim();
        content = content.slice(0, existing.end - 1) + `${tail === ',' ? '' : ','}\n  file = {${file}}\n` + content.slice(existing.end - 1);
        continue;
      }
      const stem = source.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'source';
      let key = stem;
      for (let suffix = 2; keys.has(key); suffix++) key = `${stem}-${suffix}`;
      keys.add(key);
      const fields = { title: source.title || source.name };
      if (source.authors?.length) fields.author = source.authors.map(bibText).join(' and ');
      if (source.authorOrcids?.some(id => normalizeOrcid(id))) fields.orcid = source.authors.map((_, i) => normalizeOrcid(source.authorOrcids[i]) || '-').join(' and ');
      const year = String(source.year || source.published || '').match(/^\d{4}/)?.[0];
      if (year) fields.year = year;
      if (source.publication && !['arXiv preprint', 'NASA ADS record'].includes(source.publication)) fields.journal = source.publication;
      if (source.doi) fields.doi = source.doi;
      if (source.arxivId) { fields.eprint = source.arxivId; fields.archivePrefix = 'arXiv'; }
      if (source.recordUrl) fields.url = source.recordUrl;
      fields.file = `raw/${source.name}`;
      if (!source.title) fields.note = 'Bibliographic metadata needs completion';
      const type = fields.journal ? 'article' : 'misc';
      const entry = Object.entries(fields).map(([name, value]) => `  ${name} = {${name === 'author' ? value : bibText(value)}}`).join(',\n');
      content = `${content}${content && !content.endsWith('\n') ? '\n' : ''}\n@${type}{${key},\n${entry}\n}\n`;
    }
    if (content !== this.read().content || !fs.existsSync(this.file)) this.write(content);
    return this.read();
  }

  findPaper(source, content) {
    const norm = value => text(value || '').trim().toLowerCase();
    const doi = value => norm(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
    const title = value => norm(value).replace(/[^\p{L}\p{N}]/gu, '');
    return parse(content, { locations: true }).entries.find(entry =>
      (source.doi && doi(entry.fields.doi) === doi(source.doi)) ||
      (source.bibcode && norm(entry.fields.bibcode || entry.fields.adsbibcode) === norm(source.bibcode)) ||
      (source.arxivId && norm(entry.fields.eprint) === norm(source.arxivId)) ||
      (source.title && title(entry.fields.title) === title(source.title)));
  }

  addPaper(source) {
    const { content } = this.read();
    const entries = parse(content).entries;
    const duplicate = this.findPaper(source, content);
    if (duplicate) return { added: false };
    const keys = new Set(entries.map(entry => entry.key));
    const stem = String(source.bibcode || source.arxivId || source.doi || source.title || 'paper')
      .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'paper';
    let key = stem;
    for (let suffix = 2; keys.has(key); suffix++) key = `${stem}-${suffix}`;
    const fields = { title: source.title };
    if (source.authors?.length) fields.author = source.authors.map(bibText).join(' and ');
    if (source.authorOrcids?.some(id => normalizeOrcid(id))) fields.orcid = source.authors.map((_, i) => normalizeOrcid(source.authorOrcids[i]) || '-').join(' and ');
    const year = String(source.published || source.year || '').match(/^\d{4}/)?.[0];
    if (year) fields.year = year;
    if (source.publication && !['arXiv preprint', 'NASA ADS record'].includes(source.publication)) fields.journal = source.publication;
    if (source.doi) fields.doi = source.doi;
    if (source.bibcode) fields.bibcode = source.bibcode;
    if (source.arxivId) { fields.eprint = source.arxivId; fields.archivePrefix = 'arXiv'; }
    if (source.recordUrl) fields.url = source.recordUrl;
    const encoded = Object.entries(fields).filter(([, value]) => value).map(([name, value]) => `  ${name} = {${name === 'author' ? value : bibText(value)}}`).join(',\n');
    this.write(`${content}${content && !content.endsWith('\n') ? '\n' : ''}\n@${fields.journal ? 'article' : 'misc'}{${key},\n${encoded}\n}\n`);
    return { added: true, key };
  }

  sync() {
    return this.add(fs.readdirSync(this.rawDir).filter(name => fs.lstatSync(path.join(this.rawDir, name)).isFile()).map(name => ({ name })));
  }

  entryFor(name, content = this.read().content) {
    return parse(content, { locations: true }).entries.find(entry => entry.fields.file === bibText(`raw/${name}`) || text(entry.fields.file) === `raw/${name}`);
  }

  async enrich(files) {
    for (const source of files) {
      // Do not publish a new placeholder until extraction has been attempted.
      const existing = this.entryFor(source.name);
      const complete = existing ? ['title', 'author', 'year'].every(field => existing.fields[field]?.trim()) && text(existing.fields.title) !== source.name && existing.fields.note !== COMPLETION_NOTE : source.title && source.authors?.length && /^\d{4}/.test(String(source.year || source.published || ''));
      if (!this.metadata || complete || this.extracted.has(source.name)) { this.add([source]); continue; }
      let fields = {};
      try { fields = await this.metadata.extract(source.name); } catch { /* Keep the editable fallback if extraction fails. */ }
      this.add([source]);
      if (!Object.keys(fields).length) continue;
      this.extracted.add(source.name);
      // Re-read after inference so edits and concurrent imports are retained.
      const { content } = this.read();
      const entry = this.entryFor(source.name, content);
      if (!entry) continue;
      const replacements = [];
      const additions = [];
      for (const [field, value] of Object.entries(fields)) {
        const placeholder = field === 'title' && text(entry.fields.title) === source.name;
        if (entry.fields[field]?.trim() && !placeholder) continue;
        const encoded = field === 'author' ? value.map(bibText).join(' and ') : bibText(value);
        const replacement = `${field} = {${encoded}}`;
        const location = entry.fieldLocations[field];
        if (location) replacements.push({ ...location, value: replacement });
        else additions.push(replacement);
      }
      if (additions.length) {
        const lastValueEnd = Math.max(...Object.values(entry.fieldLocations).map(location => location.end));
        const tail = content.slice(lastValueEnd, entry.end - 1).replace(/%[^\n]*/g, '').trim();
        replacements.push({ start: entry.end - 1, end: entry.end - 1, value: `${tail === ',' ? '' : ','}\n  ${additions.join(',\n  ')}\n` });
      }
      let updated = content;
      for (const change of replacements.sort((a, b) => b.start - a.start)) updated = updated.slice(0, change.start) + change.value + updated.slice(change.end);
      if (entry.fields.note === COMPLETION_NOTE) {
        const location = this.entryFor(source.name, updated).fieldLocations.note;
        const separator = /^(?:\s|%[^\n]*(?:\n|$))*,/.exec(updated.slice(location.end));
        if (separator) {
          const comma = location.end + separator[0].length - 1;
          updated = updated.slice(0, comma) + updated.slice(comma + 1);
        }
        updated = updated.slice(0, location.start) + updated.slice(location.end);
      }
      if (updated !== content) this.write(updated);
    }
    return this.read();
  }

  async syncEnriched() {
    const files = fs.readdirSync(this.rawDir).filter(name => fs.lstatSync(path.join(this.rawDir, name)).isFile()).map(name => ({ name }));
    await this.enrich(files);
    return this.sync();
  }

  save(content, revision) {
    if (typeof content !== 'string' || typeof revision !== 'string') {
      const error = new Error('Content and revision are required.'); error.status = 400; throw error;
    }
    if (this.read().revision !== revision) {
      const error = new Error('References changed since you opened them. Copy your edits, then reload the file before saving.'); error.status = 409; throw error;
    }
    this.write(content);
    return this.read();
  }
}

module.exports = { References, bibText };
