(function (root) {
  'use strict';
  // Read-only parser: rendering never serializes or changes the original bibliography.
  function parse(source, { locations = false } = {}) {
    let i = 0;
    let valueEnd = 0;
    const entries = [], warnings = [];
    const macros = Object.assign(Object.create(null), { jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June', jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December' });
    const skip = () => {
      while (i < source.length) {
        if (/\s/.test(source[i])) i++;
        else if (source[i] === '%') { while (i < source.length && source[i] !== '\n') i++; }
        else break;
      }
    };
    function enclosed(open, close) {
      i++;
      const start = i;
      let depth = 1;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (open !== close && source[i] === open) depth++;
        if (source[i] === close && --depth === 0) return source.slice(start, i++);
        i++;
      }
      throw new Error('Unclosed value');
    }
    function value(close) {
      let result = '';
      do {
        skip();
        if (source[i] === '{') result += enclosed('{', '}');
        else if (source[i] === '"') {
          // Quotes inside protected braces do not terminate a quoted value.
          i++; let part = '', depth = 0, closed = false;
          while (i < source.length) {
            const ch = source[i++];
            if (ch === '\\') { part += ch + (source[i++] || ''); continue; }
            if (ch === '{') depth++;
            if (ch === '}') depth--;
            if (ch === '"' && depth === 0) { closed = true; break; }
            part += ch;
          }
          if (!closed) throw new Error('Unclosed quoted value');
          result += part;
        } else {
          const start = i;
          while (i < source.length && ![',', '#', close, '%'].includes(source[i]) && !/\s/.test(source[i])) i++;
          const token = source.slice(start, i);
          if (!token) throw new Error('Missing field value');
          result += macros[token.toLowerCase()] ?? token;
        }
        valueEnd = i;
        skip();
        if (source[i] !== '#') break;
        i++;
      } while (i < source.length);
      return result;
    }
    while (i < source.length) {
      skip();
      if (source[i] !== '@') { i++; continue; }
      const start = i++;
      const type = /^[a-z]+/i.exec(source.slice(i));
      if (!type) continue;
      i += type[0].length; skip();
      if (!['{', '('].includes(source[i])) continue;
      const open = source[i], close = open === '{' ? '}' : ')';
      const kind = type[0].toLowerCase();
      try {
        if (kind === 'comment') { enclosed(open, close); continue; }
        i++; skip();
        if (kind === 'preamble') { value(close); skip(); if (source[i++] !== close) throw new Error('Unclosed preamble'); continue; }
        const entry = { type: kind, key: '', fields: Object.create(null) };
        if (locations) { entry.start = start; entry.fieldLocations = Object.create(null); }
        if (kind !== 'string') {
          const keyStart = i;
          while (i < source.length && ![',', close].includes(source[i])) i++;
          entry.key = source.slice(keyStart, i).trim();
          if (!entry.key) throw new Error('Missing citation key');
          if (source[i] === ',') i++;
        }
        while (i < source.length) {
          skip();
          if (source[i] === close) break;
          const fieldStart = i;
          const name = /^[\w:-]+/.exec(source.slice(i));
          if (!name) throw new Error('Expected a field name');
          i += name[0].length; skip();
          if (source[i++] !== '=') throw new Error('Expected =');
          entry.fields[name[0].toLowerCase()] = value(close);
          if (locations) entry.fieldLocations[name[0].toLowerCase()] = { start: fieldStart, end: valueEnd };
          skip();
          if (source[i] === ',') i++;
          else if (source[i] !== close) throw new Error('Expected a comma');
        }
        if (source[i++] !== close) throw new Error('Unclosed entry');
        if (locations) entry.end = i;
        if (kind === 'string') Object.assign(macros, entry.fields);
        else entries.push(entry);
      } catch (error) {
        warnings.push(`Entry near line ${source.slice(0, start).split('\n').length}: ${error.message}.`);
        // Recover at a new entry after an incomplete edit, never invent missing metadata.
        const next = /(?:^|\n)\s*@\w+\s*[{(]/g;
        next.lastIndex = start + 1;
        const match = next.exec(source);
        i = match ? match.index + match[0].indexOf('@') : source.length;
      }
    }
    if (!entries.length && source.trim() && !warnings.length && !/^\s*(%|@(?:comment|string|preamble)\b)/i.test(source)) warnings.push('No BibTeX entries could be read. Open BibTeX to inspect the source.');
    return { entries, warnings };
  }
  function text(value = '') {
    return String(value)
      .replace(/\\(?:textit|textbf|emph|textrm|texttt|mathrm)\s*\{([^{}]*)\}/g, '$1')
      .replace(/\\([&%_$#{}])/g, '$1')
      .replace(/\\(?:(["'`^~=.])|([uvHck])(?=\s|\{))\s*\{?([A-Za-z])\}?/g, (_, symbol, command, letter) => {
        const accent = symbol || command;
        const marks = { '"': '\u0308', "'": '\u0301', '`': '\u0300', '^': '\u0302', '~': '\u0303', '=': '\u0304', '.': '\u0307', u: '\u0306', v: '\u030c', H: '\u030b', c: '\u0327', k: '\u0328' };
        return (letter + marks[accent]).normalize('NFC');
      })
      .replace(/[{}]/g, '').replace(/~/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function authors(value = '') {
    // A corporate author protected with braces can contain the word "and".
    const names = []; let depth = 0, start = 0;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '\\') { i++; continue; }
      if (value[i] === '{') depth++;
      if (value[i] === '}') depth--;
      const separator = depth === 0 && /^\s+and\s+/i.exec(value.slice(i));
      if (separator) { names.push(value.slice(start, i)); i += separator[0].length - 1; start = i + 1; }
    }
    names.push(value.slice(start));
    return names.map(text).filter(Boolean);
  }
  const api = { parse, text, authors };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BibTeX = api;
})(globalThis);
