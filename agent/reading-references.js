'use strict';

const PAPER_REFERENCE = /\[P:([^\]\n]*)\]/g;
const wikiReferences = text => [...text.matchAll(/\[W:[^\]\n]*\]/g)].map(([reference]) => reference);

function citedPaperIndexes(answer, papers, allowedWikiReferences = new Set()) {
  const indexes = new Set();
  let hasWikiCitation = false;
  for (const paragraph of answer.split(/\n\s*\n/)) {
    const matches = [...paragraph.matchAll(PAPER_REFERENCE)];
    const wiki = wikiReferences(paragraph);
    if ((!matches.length && !wiki.length) || wiki.some(reference => !allowedWikiReferences.has(reference)) ||
        matches.some(([, id]) => !/^[1-9]\d*$/.test(id) || !papers[Number(id) - 1])) return null;
    hasWikiCitation ||= wiki.length > 0;
    for (const [, id] of matches) indexes.add(Number(id) - 1);
  }
  return indexes.size && (!allowedWikiReferences.size || hasWikiCitation) ? indexes : null;
}

function authorName(name, initialsFirst = false) {
  const [surname, givenNames] = name.trim().split(/,\s*/, 2);
  if (!givenNames) return surname;
  const initials = givenNames.match(/\p{L}+(?:-\p{L}+)*/gu)?.map(word =>
    word.split('-').map(part => `${[...part][0]}.`).join('-')).join('') || '';
  return (initialsFirst ? `${initials} ${surname}` : `${surname} ${initials}`).trim();
}

function escapeMarkdown(value) {
  return String(value).replace(/\s+/g, ' ').replace(/([\\`*_{}\[\]<>])/g, '\\$1');
}

function renderResearchAnswer(answer, papers, indexes) {
  const entries = [...indexes].map(index => ({ index, ...papers[index] }));
  entries.sort((a, b) => a.authors[0].localeCompare(b.authors[0]) ||
    Math.min(a.authors.length, 3) - Math.min(b.authors.length, 3) ||
    (a.authors.length === 2 ? a.authors[1].localeCompare(b.authors[1]) : 0) ||
    a.year.localeCompare(b.year) || a.title.localeCompare(b.title));

  const sameAuthorYear = new Map();
  for (const entry of entries) {
    const authors = entry.authors.length > 2 ? entry.authors.slice(0, 1) : entry.authors;
    const key = JSON.stringify([authors, entry.year]);
    if (!sameAuthorYear.has(key)) sameAuthorYear.set(key, []);
    sameAuthorYear.get(key).push(entry);
  }
  for (const group of sameAuthorYear.values()) {
    if (group.length < 2) continue;
    group.forEach((entry, index) => { entry.year += String.fromCharCode(97 + index); });
  }

  const byIndex = new Map(entries.map(entry => [entry.index, entry]));
  const seen = new Set();
  const body = answer.replace(PAPER_REFERENCE, (_, id) => {
    const index = Number(id) - 1;
    const { authors, year, recordUrl } = byIndex.get(index);
    const names = authors.slice(0, 3).map(name => authorName(name, true));
    const short = authors.length > 3 || (authors.length === 3 && seen.has(index));
    const label = short ? `${names[0]} et al.` : names.join(', ').replace(/, ([^,]+)$/, ' & $1');
    seen.add(index);
    return `[(${escapeMarkdown(label)} ${year})](${recordUrl})`;
  });

  const references = entries.map(({ authors, year, publication, volume, page, recordUrl }) => {
    const names = authors.length > 8 ? `${authorName(authors[0])} et al.` : authors.map(name => authorName(name)).join(', ');
    const details = [names, year, publication, volume, page].filter(Boolean).join(', ');
    return `- [${escapeMarkdown(details)}](${recordUrl})`;
  });
  return `${body}\n\n### References\n\n${references.join('\n')}`;
}

module.exports = { citedPaperIndexes, renderResearchAnswer, wikiReferences };
