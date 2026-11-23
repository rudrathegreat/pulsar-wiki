'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const normalize = text => text.replace(/\s+/g, ' ').trim();
const notebookText = value => Array.isArray(value) ? value.join('') : typeof value === 'string' ? value : '';

async function* files(directory, recursive = false, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name;
    if (entry.isFile()) yield name;
    else if (recursive && entry.isDirectory() && !entry.name.startsWith('.')) {
      yield* files(path.join(directory, entry.name), true, `${name}/`);
    }
  }
}

async function searchWorkspace(workspace, query, { displayNames = {}, signal } = {}) {
  const results = [];
  const suggestions = new Map();
  let unavailable = 0;
  const needle = normalize(query);
  if (!needle) return { results, unavailable };
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped.replaceAll(' ', '\\s+'), 'giu');
  const completion = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}[\\p{L}\\p{N}_+-]+`, 'iu');

  function suggest(value) {
    if (value && value.toLowerCase() !== needle.toLowerCase() && suggestions.size < 8) {
      suggestions.set(value.toLowerCase(), value);
    }
  }

  function excerpt(text, start, end, markdown) {
    if (markdown && text.length <= 512) return text;
    const slice = text.slice(Math.max(0, start - 55), end + 85);
    const context = markdown ? slice : normalize(slice);
    return `${start > 55 ? '…' : ''}${context}${end + 85 < text.length ? '…' : ''}`;
  }

  function* textSections(text, markdown = false) {
    let start = 0;
    let line = 1;
    for (const breakAt of text.matchAll(/\r?\n[ \t]*\r?\n/g)) {
      const section = text.slice(start, breakAt.index);
      yield { text: section, start, line, markdown };
      start = breakAt.index + breakAt[0].length;
      line += 2 + (section.match(/\n/g) || []).length;
    }
    yield { text: text.slice(start), start, line, markdown };
  }

  async function collect(directory, type, include, read) {
    for await (const name of files(directory, type === 'Notebook')) {
      signal?.throwIfAborted();
      if (!include(name)) continue;
      const label = type === 'Source' && typeof displayNames[name] === 'string' ? displayNames[name] : name;
      const matches = [];
      const url = type === 'Wiki' ? `/wiki/${encodeURIComponent(name.slice(0, -3))}`
        : type === 'Notebook' ? `/#notebook/?path=${encodeURIComponent(name)}` : `/#file/${encodeURIComponent(name)}`;
      try {
        const sections = await read(name, url);
        for (const section of sections) {
          signal?.throwIfAborted();
          if (suggestions.size < 8) suggest(completion.exec(normalize(section.text))?.[0]);
          for (const match of section.text.matchAll(pattern)) {
            const start = match.index;
            const end = start + match[0].length;
            let location = section.location;
            let matchUrl = section.url || url;
            if (section.line) location = `Line ${section.line + (section.text.slice(0, start).match(/\n/g) || []).length}`;
            if (type !== 'Notebook') {
              const offset = section.start || 0;
              matchUrl += `${matchUrl.includes('?') ? '&' : '?'}start=${offset + start}&end=${offset + end}`;
            }
            matches.push({
              text: excerpt(section.text, start, end, section.markdown), location, url: matchUrl,
              ...(section.markdown ? { markdown: true } : {}),
            });
            if (matches.length === 3 || type === 'Notebook') break;
          }
          if (matches.length === 3) break;
        }
      } catch {
        signal?.throwIfAborted();
        unavailable++;
      }
      const matchingName = [name, label].find(value => normalize(value).search(pattern) !== -1);
      if (matchingName) suggest(matchingName);
      if (matches.length || matchingName) results.push({ type, name, label, url, matches, ...(matchingName ? { matchingName } : {}) });
    }
  }

  await collect(workspace.wikiDir, 'Wiki', name => name.endsWith('.md'), async name => {
    const text = await fs.readFile(path.join(workspace.wikiDir, name), 'utf8');
    return textSections(text, true);
  });
  await collect(workspace.rawDir, 'Source', () => true, async (name, url) => {
    const extension = path.extname(name).toLowerCase();
    if (extension === '.pdf') {
      const { searchPages, labels } = await workspace.readingService.extract(name);
      if (!searchPages.some(text => text.trim())) throw new Error('PDF has no searchable text.');
      return searchPages.map((text, index) => ({ text, location: `Page ${labels[index]}`, url: `${url}?page=${index + 1}` }));
    }
    const text = await workspace.wikiTools.sourceText(name);
    return textSections(text, extension === '.md' || extension === '.markdown');
  });
  await collect(path.join(workspace.rootDir, 'notebooks'), 'Notebook', name => name.endsWith('.ipynb') && !path.basename(name).startsWith('.'), async (name, url) => {
    const book = JSON.parse(await fs.readFile(path.join(workspace.rootDir, 'notebooks', name), 'utf8'));
    if (!Array.isArray(book.cells)) throw new Error('Invalid notebook cells.');
    return book.cells.flatMap((cell, index) => {
      const location = `Cell ${index + 1}`;
      const cellUrl = /^[\w-]{1,64}$/.test(cell.id || '') ? `${url}&cell=${encodeURIComponent(cell.id)}` : `${url}&cellIndex=${index}`;
      return [
        { text: notebookText(cell.source), location, url: cellUrl, markdown: cell.cell_type === 'markdown' },
        ...(cell.outputs || []).map(output => ({
          text: notebookText(output.text || output.data?.['text/plain'] || output.traceback?.join('\n') || output.evalue),
          location: `${location} output`, url: cellUrl,
        })),
      ];
    });
  });
  return { results, unavailable, ...(suggestions.size ? { suggestions: [...suggestions.values()] } : {}) };
}

module.exports = { searchWorkspace };
