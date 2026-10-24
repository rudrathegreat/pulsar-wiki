(function (root) {
  'use strict';
  function normalize(value) {
    const match = String(value || '').trim().match(/^(?:https?:\/\/(?:www\.)?orcid\.org\/)?(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\/?$/i);
    if (!match) return null;
    const id = match[1].toUpperCase();
    const digits = id.replace(/-/g, '');
    let total = 0;
    for (const digit of digits.slice(0, 15)) total = (total + Number(digit)) * 2;
    const check = (12 - total % 11) % 11;
    return digits[15] === (check === 10 ? 'X' : String(check)) ? id : null;
  }
  function nameKey(name) {
    const parts = String(name || '').split(',').map(part => part.trim());
    return (parts.length === 2 ? `${parts[1]} ${parts[0]}` : parts.join(' '))
      .normalize('NFKC').toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
  }
  function matchAuthors(names, records) {
    return names.map(name => {
      const matches = records.filter(record => nameKey(record.name) === nameKey(name));
      const ids = new Set(matches.map(record => normalize(record.orcid)).filter(Boolean));
      return ids.size === 1 ? [...ids][0] : null;
    });
  }
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  function author(name, id) {
    id = normalize(id);
    return id ? `<a class="author-orcid" href="https://orcid.org/${id}" target="_blank" rel="noopener noreferrer" title="ORCID: ${id}">${esc(name)}</a>` : esc(name);
  }
  function markup(paper, limit = Infinity) {
    const names = paper.authors || [];
    const shown = names.slice(0, limit).map((name, index) => `<span data-orcid-index="${index}">${author(name, paper.authorOrcids?.[index])}</span>`).join(', ');
    return shown ? shown + (names.length > limit ? ` +${names.length - limit}` : '') : 'Authors unavailable';
  }
  async function hydrate(container, papers) {
    // Keep references to the original nodes: a late lookup must never update a new view.
    const targets = [...container.querySelectorAll('[data-orcid-paper]')].map(node => ({ node, paper: papers.find(p => String(p.id) === node.dataset.orcidPaper) })).filter(item => item.paper);
    for (let start = 0; start < targets.length; start += 50) {
      const batch = targets.slice(start, start + 50);
      try {
        const data = await readJsonResponse(await workspaceFetch('/api/sources/orcids', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ papers: batch.map(({ paper }) => ({ authors: paper.authors, title: paper.title, doi: paper.doi, arxivId: paper.arxivId, bibcode: paper.bibcode })) }),
        }), 'Author profiles');
        batch.forEach(({ node, paper }, index) => {
          const ids = data.orcids?.[index];
          if (!Array.isArray(ids)) return;
          paper.authorOrcids = paper.authors.map((_, i) => normalize(paper.authorOrcids?.[i]) || normalize(ids[i]));
          node.querySelectorAll('[data-orcid-index]').forEach(span => {
            const i = Number(span.dataset.orcidIndex);
            span.innerHTML = author(paper.authors[i], paper.authorOrcids[i]);
          });
        });
      } catch { /* Author names remain usable when metadata services are unavailable. */ }
    }
  }
  const api = { normalize, matchAuthors, author, markup, hydrate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AuthorOrcids = api;
})(globalThis);
