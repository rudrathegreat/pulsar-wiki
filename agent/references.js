'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Treat metadata as text, never as BibTeX syntax supplied by a source.
function bibText(value) {
  return String(value ?? '').replace(/[\\{}%&#_$]/g, char => char === '\\' ? '\\textbackslash{}' : `\\${char}`)
    .replace(/[\r\n\t]+/g, ' ');
}

class References {
  constructor({ rootDir, rawDir }) {
    this.file = path.join(rootDir, 'references.bib');
    this.rawDir = rawDir;
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
      const stem = source.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'source';
      let key = stem;
      for (let suffix = 2; keys.has(key); suffix++) key = `${stem}-${suffix}`;
      keys.add(key);
      const fields = { title: source.title || source.name };
      if (source.authors?.length) fields.author = source.authors.map(bibText).join(' and ');
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

  sync() {
    return this.add(fs.readdirSync(this.rawDir).filter(name => fs.lstatSync(path.join(this.rawDir, name)).isFile()).map(name => ({ name })));
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
