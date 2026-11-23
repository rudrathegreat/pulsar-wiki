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
  let unavailable = 0;
  const needle = normalize(query);
  if (!needle) return { results, unavailable };
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');

  function snippet(value) {
    const text = normalize(value);
    const match = pattern.exec(text);
    if (!match) return '';
    const start = Math.max(0, match.index - 55);
    const end = match.index + match[0].length + 85;
    return `${start ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
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
          const text = snippet(section.text);
          if (!text) continue;
          matches.push({ text, location: section.location, url: section.url || url });
          if (matches.length === 3) break;
        }
      } catch { unavailable++; }
      if (matches.length || snippet(name) || snippet(label)) results.push({ type, label, url, matches });
    }
  }

  await collect(workspace.wikiDir, 'Wiki', name => name.endsWith('.md'), async name => {
    const text = await fs.readFile(path.join(workspace.wikiDir, name), 'utf8');
    return text.split(/\r?\n[ \t]*\r?\n/).map(text => ({ text }));
  });
  await collect(workspace.rawDir, 'Source', () => true, async (name, url) => {
    if (path.extname(name).toLowerCase() === '.pdf') {
      const { searchPages, labels } = await workspace.readingService.extract(name);
      if (!searchPages.some(text => text.trim())) throw new Error('PDF has no searchable text.');
      return searchPages.map((text, index) => ({ text, location: `Page ${labels[index]}`, url: `${url}?page=${index + 1}` }));
    }
    const text = await workspace.wikiTools.sourceText(name);
    return text.split(/\r?\n[ \t]*\r?\n/).map(text => ({ text }));
  });
  await collect(path.join(workspace.rootDir, 'notebooks'), 'Notebook', name => name.endsWith('.ipynb') && !path.basename(name).startsWith('.'), async (name, url) => {
    const book = JSON.parse(await fs.readFile(path.join(workspace.rootDir, 'notebooks', name), 'utf8'));
    if (!Array.isArray(book.cells)) throw new Error('Invalid notebook cells.');
    return book.cells.flatMap((cell, index) => {
      const location = `Cell ${index + 1}`;
      const cellUrl = /^[\w-]{1,64}$/.test(cell.id || '') ? `${url}&cell=${encodeURIComponent(cell.id)}` : url;
      return [
        { text: notebookText(cell.source), location, url: cellUrl },
        ...(cell.outputs || []).map(output => ({
          text: notebookText(output.text || output.data?.['text/plain'] || output.traceback?.join('\n') || output.evalue),
          location: `${location} output`, url: cellUrl,
        })),
      ];
    });
  });
  return { results, unavailable };
}

module.exports = { searchWorkspace };
