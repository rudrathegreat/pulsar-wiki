'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_READ_CHARS = 24000;
const MAX_SEARCH_RESULTS = 20;

class WikiToolError extends Error {
  constructor(message, code = 'tool-error') {
    super(message);
    this.name = 'WikiToolError';
    this.code = code;
  }
}

const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'list_wiki_pages',
    description: 'List available PulsarWiki Markdown pages.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_wiki_page',
    description: 'Read a bounded excerpt from one wiki page. Pass the lowercase, hyphenated page name in name (for example, "pulsar-timing-array"). If the page does not exist, this returns exists: false; that is useful when creating a new page. Read wiki/index first when answering a question.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, offset: { type: 'integer' }, maxChars: { type: 'integer' } },
      required: ['name'], additionalProperties: false,
    },
  },
  {
    name: 'search_wiki',
    description: 'Search current wiki pages and return matching line excerpts. Pass the search text in the query field.',
    inputSchema: {
      type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false,
    },
  },
  {
    name: 'list_sources',
    description: 'List immutable source documents in raw/.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_source',
    description: 'Read a bounded local text or PDF excerpt from raw/. PDF text is extracted locally; raw files are never changed.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, offset: { type: 'integer' }, maxChars: { type: 'integer' } },
      required: ['name'], additionalProperties: false,
    },
  },
  {
    name: 'apply_wiki_changes',
    description: 'Atomically apply wiki Markdown changes. For normal page changes, include an updated index page. The operation appends wiki/log.md automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        changes: {
          type: 'array', minItems: 1, maxItems: 20,
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, content: { type: 'string' } },
            required: ['name', 'content'], additionalProperties: false,
          },
        },
        logSummary: { type: 'string' },
      },
      required: ['changes', 'logSummary'], additionalProperties: false,
    },
  },
]);

function clamp(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(Math.floor(number), maximum));
}

function safeName(value) {
  if (typeof value !== 'string') throw new WikiToolError('A file name is required.', 'invalid-name');
  const base = path.basename(value);
  if (base !== value || base.includes('..') || !base) throw new WikiToolError('Invalid file name.', 'invalid-name');
  return base;
}

function validPageName(value) {
  return value === 'index' || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function firstDefined(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function toolPageName(args) {
  return firstDefined(args, ['name', 'page', 'pageName', 'fileName', 'filename']);
}

function toolQuery(args) {
  const value = firstDefined(args, ['query', 'q', 'search', 'searchQuery', 'search_term', 'term', 'keywords']);
  return Array.isArray(value) ? value.join(' ') : value;
}

function excerpt(content, offset, maxChars) {
  const start = clamp(offset, 0, content.length);
  const length = clamp(maxChars, 12000, MAX_READ_CHARS);
  return {
    offset: start,
    content: content.slice(start, start + length),
    hasMore: start + length < content.length,
    totalChars: content.length,
  };
}

class WikiTools {
  constructor({ rootDir, wikiDir, rawDir, dataDir, fsModule = fs } = {}) {
    if (!rootDir || !wikiDir || !rawDir || !dataDir) throw new Error('Wiki tool directories are required.');
    this.rootDir = rootDir;
    this.wikiDir = wikiDir;
    this.rawDir = rawDir;
    this.dataDir = dataDir;
    this.fs = fsModule;
    this.pdfCache = new Map();
  }

  definitions() {
    return TOOL_DEFINITIONS;
  }

  wikiPath(name) {
    if (!validPageName(name)) throw new WikiToolError('Wiki page names must use lowercase letters, numbers, and hyphens.', 'invalid-page-name');
    return path.join(this.wikiDir, `${name}.md`);
  }

  sourcePath(name) {
    const fileName = safeName(name);
    const resolved = path.resolve(this.rawDir, fileName);
    if (path.dirname(resolved) !== path.resolve(this.rawDir)) throw new WikiToolError('Invalid source name.', 'invalid-source-name');
    return resolved;
  }

  listWikiPages() {
    return this.fs.readdirSync(this.wikiDir)
      .filter(name => name.endsWith('.md'))
      .map(name => name.slice(0, -3))
      .sort();
  }

  readWikiPage(args = {}) {
    const { offset, maxChars } = args;
    const page = String(toolPageName(args) || '').replace(/\.md$/i, '');
    const filePath = this.wikiPath(page);
    if (!this.fs.existsSync(filePath)) {
      return { name: page, exists: false, offset: 0, content: '', hasMore: false, totalChars: 0 };
    }
    return { name: page, exists: true, ...excerpt(this.fs.readFileSync(filePath, 'utf8'), offset, maxChars) };
  }

  searchWiki(args = {}) {
    const normalized = String(toolQuery(args) || '').trim().toLowerCase();
    if (!normalized) throw new WikiToolError('A search query is required.', 'invalid-query');
    const results = [];
    for (const page of this.listWikiPages()) {
      const content = this.fs.readFileSync(this.wikiPath(page), 'utf8');
      content.split(/\r?\n/).forEach((line, index) => {
        if (line.toLowerCase().includes(normalized) && results.length < MAX_SEARCH_RESULTS) {
          results.push({ page, line: index + 1, text: line.trim().slice(0, 240) });
        }
      });
      if (results.length >= MAX_SEARCH_RESULTS) break;
    }
    return { query: normalized, results };
  }

  listSources() {
    return this.fs.readdirSync(this.rawDir)
      .filter(name => this.fs.statSync(path.join(this.rawDir, name)).isFile())
      .sort()
      .map(name => ({ name, type: path.extname(name).slice(1).toLowerCase() || 'unknown' }));
  }

  async sourceText(name) {
    const filePath = this.sourcePath(name);
    if (!this.fs.existsSync(filePath)) throw new WikiToolError('Source file not found.', 'source-not-found');
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.txt' || extension === '.md') return this.fs.readFileSync(filePath, 'utf8');
    if (extension !== '.pdf') throw new WikiToolError('Only text, Markdown, and PDF sources can be read.', 'unsupported-source');

    const stat = this.fs.statSync(filePath);
    const cached = this.pdfCache.get(filePath);
    if (cached && cached.modifiedMs === stat.mtimeMs) return cached.text;
    let pdfjs;
    try {
      pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    } catch {
      throw new WikiToolError('The local PDF text extractor is unavailable.', 'pdf-extractor-unavailable');
    }
    try {
      const data = new Uint8Array(this.fs.readFileSync(filePath));
      const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
      const pages = [];
      for (let number = 1; number <= document.numPages; number += 1) {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        pages.push(content.items.map(item => item.str || '').join(' '));
      }
      const text = pages.join('\n\n');
      this.pdfCache.set(filePath, { modifiedMs: stat.mtimeMs, text });
      return text;
    } catch (error) {
      throw new WikiToolError('PulsarWiki could not extract text from that PDF.', 'pdf-extraction-failed');
    }
  }

  async readSource({ name, offset, maxChars } = {}) {
    const fileName = safeName(name);
    return { name: fileName, ...excerpt(await this.sourceText(fileName), offset, maxChars) };
  }

  applyWikiChanges({ changes, logSummary } = {}) {
    if (!Array.isArray(changes) || !changes.length || changes.length > 20) throw new WikiToolError('Provide between one and twenty wiki changes.', 'invalid-changes');
    if (typeof logSummary !== 'string' || !logSummary.trim() || logSummary.length > 1000) {
      throw new WikiToolError('Provide a concise operation summary.', 'invalid-log-summary');
    }
    const names = new Set();
    const prepared = changes.map(change => {
      const name = String(change?.name || '').replace(/\.md$/i, '');
      if (!validPageName(name) || name === 'log') throw new WikiToolError('Changes may target normal pages or index.md, but never log.md.', 'invalid-page-name');
      if (names.has(name)) throw new WikiToolError('Each wiki page can be changed only once per operation.', 'duplicate-page');
      names.add(name);
      if (typeof change.content !== 'string' || change.content.length > 1024 * 1024) throw new WikiToolError('Invalid wiki page content.', 'invalid-content');
      return { name, content: change.content, filePath: this.wikiPath(name) };
    });
    if (prepared.some(change => change.name !== 'index') && !names.has('index')) {
      throw new WikiToolError('Include the corresponding index.md update with page changes.', 'index-update-required');
    }

    const logPath = this.wikiPath('log');
    const originals = new Map([...prepared.map(change => change.filePath), logPath].map(filePath => [
      filePath, this.fs.existsSync(filePath) ? this.fs.readFileSync(filePath) : null,
    ]));
    try {
      for (const change of prepared) {
        const temporary = `${change.filePath}.${process.pid}.${Date.now()}.tmp`;
        this.fs.writeFileSync(temporary, change.content, 'utf8');
        this.fs.renameSync(temporary, change.filePath);
      }
      const logPrefix = this.fs.existsSync(logPath) ? this.fs.readFileSync(logPath, 'utf8').replace(/\s*$/, '\n') : '# Wiki log\n';
      const date = new Date().toISOString().slice(0, 10);
      this.fs.writeFileSync(logPath, `${logPrefix}- ${date}: ${logSummary.trim()}\n`, 'utf8');
    } catch (error) {
      for (const [filePath, original] of originals) {
        try {
          if (original === null) this.fs.rmSync(filePath, { force: true });
          else this.fs.writeFileSync(filePath, original);
        } catch { /* Preserve the original failure while making best-effort rollback. */ }
      }
      throw new WikiToolError('No wiki changes were saved because the update could not be completed.', 'wiki-write-failed');
    }
    return { ok: true, changedPages: prepared.map(change => change.name), logUpdated: true };
  }

  async execute(name, args) {
    switch (name) {
      case 'list_wiki_pages': return { pages: this.listWikiPages() };
      case 'read_wiki_page': return this.readWikiPage(args);
      case 'search_wiki': return this.searchWiki(args);
      case 'list_sources': return { sources: this.listSources() };
      case 'read_source': return this.readSource(args);
      case 'apply_wiki_changes': return this.applyWikiChanges(args);
      default: throw new WikiToolError('Unknown tool request.', 'unknown-tool');
    }
  }
}

module.exports = { WikiTools, WikiToolError, TOOL_DEFINITIONS };
