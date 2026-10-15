'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ARXIV_API = 'https://export.arxiv.org/api/query';
const ADS_API = 'https://api.adsabs.harvard.edu/v1/search/query';
const MAX_RESULTS = 50;
const MAX_PDF_BYTES = 75 * 1024 * 1024;
const ALLOWED_PDF_HOSTS = new Set(['arxiv.org', 'export.arxiv.org']);
const FILTERS = [
  { key: 'author', label: 'Author', example: 'author:"Jocelyn Bell Burnell"' },
  { key: 'year', label: 'Publication year', example: 'year:2024' },
  { key: 'from', label: 'Published from', example: 'from:2020' },
  { key: 'to', label: 'Published through', example: 'to:2026' },
  { key: 'title', label: 'Exact title', example: 'title:"pulsar timing arrays"' },
  { key: 'object', label: 'Astronomical object', example: 'object:"Crab pulsar"' },
  { key: 'category', label: 'arXiv category', example: 'category:astro-ph.HE' },
  { key: 'source', label: 'Data source', example: 'source:arxiv' },
  { key: 'doi', label: 'DOI', example: 'doi:10.1234/example' },
  { key: 'bibcode', label: 'ADS bibcode', example: 'bibcode:2024ApJ...' },
];

const QUESTION_WORDS = /^(what|when|where|which|who|why|how|does|do|did|can|could|is|are|was|were|find|show|papers?\s+(?:about|on))\b/i;
const DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:a-z0-9]+\b/i;
const ARXIV_PATTERN = /(?:arxiv:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i;
const FILTER_PATTERN = /(?:^|\s)(author|year|from|to|title|object|category|source|doi|bibcode):(?:"([^"]*)"|(\S+))/gi;

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([\da-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)));
}

function textOf(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]).replace(/\s+/g, ' ').trim() : '';
}

function textsOf(xml, tag) {
  return [...String(xml).matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi'))]
    .map(match => decodeXml(match[1]).replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function escapeQueryValue(value) {
  return String(value || '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseExpression(input) {
  const raw = String(input || '').trim();
  const filters = {};
  let match;
  FILTER_PATTERN.lastIndex = 0;
  while ((match = FILTER_PATTERN.exec(raw)) !== null) {
    const key = match[1].toLowerCase();
    const value = (match[2] ?? match[3] ?? '').trim();
    if (!value) continue;
    if (!filters[key]) filters[key] = [];
    filters[key].push(value);
  }
  const terms = raw.replace(FILTER_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return { raw, terms, filters };
}

function classifyQuery(input) {
  const parsed = parseExpression(input);
  const doi = parsed.raw.match(DOI_PATTERN)?.[0] || parsed.filters.doi?.[0] || null;
  const arxiv = parsed.raw.match(ARXIV_PATTERN)?.[1] || null;
  const isUrl = /^https?:\/\//i.test(parsed.terms);
  let bibcode = parsed.filters.bibcode?.[0] || null;
  if (isUrl) {
    try {
      const url = new URL(parsed.terms);
      const adsMatch = url.hostname.endsWith('adsabs.harvard.edu') && url.pathname.match(/\/abs\/([^/]+)/i);
      if (adsMatch) bibcode = decodeURIComponent(adsMatch[1]);
    } catch { /* malformed links are handled as ordinary specific searches */ }
  }
  const exactFilter = Boolean(parsed.filters.title || parsed.filters.doi || parsed.filters.bibcode);
  const quotedTitle = /^"[^\"]+"$/.test(parsed.terms);
  let intent = 'keywords';
  if (doi || arxiv || isUrl || exactFilter || quotedTitle) intent = 'specific';
  else if (QUESTION_WORDS.test(parsed.terms) || /\?$/.test(parsed.terms)) intent = 'research-question';
  return { ...parsed, intent, doi, arxiv, bibcode, isUrl };
}

function arxivIdFromValue(value) {
  const match = String(value || '').match(ARXIV_PATTERN);
  return match ? match[1].replace(/v\d+$/i, '') : null;
}

function usefulTerms(value, maximum = 8) {
  const stop = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'does', 'for', 'from', 'how', 'in', 'is', 'of', 'on', 'or', 'papers', 'research', 'that', 'the', 'these', 'to', 'using', 'what', 'when', 'where', 'which', 'with']);
  return String(value || '').toLowerCase().match(/[a-z0-9][a-z0-9+.-]{2,}/g)?.filter(term => !stop.has(term)).slice(0, maximum) || [];
}

function buildArxivQuery(classified) {
  const { filters } = classified;
  const clauses = [];
  if (classified.arxiv) clauses.push(`id:${escapeQueryValue(classified.arxiv)}`);
  else if (classified.doi) clauses.push(`doi:${escapeQueryValue(classified.doi)}`);
  else if (filters.title?.length) clauses.push(...filters.title.map(value => `ti:"${escapeQueryValue(value)}"`));
  else {
    const terms = usefulTerms(classified.terms);
    if (terms.length) clauses.push(`all:(${terms.map(escapeQueryValue).join(' AND ')})`);
  }
  for (const value of filters.author || []) clauses.push(`au:"${escapeQueryValue(value)}"`);
  for (const value of filters.category || []) clauses.push(`cat:${escapeQueryValue(value)}`);
  for (const value of filters.object || []) clauses.push(`all:"${escapeQueryValue(value)}"`);
  const year = filters.year?.[0];
  const from = year || filters.from?.[0];
  const to = year || filters.to?.[0];
  if (/^\d{4}$/.test(from || '') || /^\d{4}$/.test(to || '')) {
    clauses.push(`submittedDate:[${/^\d{4}$/.test(from || '') ? from : '1900'}01010000 TO ${/^\d{4}$/.test(to || '') ? to : '2999'}12312359]`);
  }
  return clauses.join(' AND ') || 'all:pulsar';
}

function buildAdsQuery(classified) {
  const { filters } = classified;
  const clauses = [];
  if (classified.bibcode) clauses.push(`bibcode:"${escapeQueryValue(classified.bibcode)}"`);
  else if (classified.doi) clauses.push(`doi:"${escapeQueryValue(classified.doi)}"`);
  else if (classified.arxiv) clauses.push(`identifier:"arXiv:${escapeQueryValue(classified.arxiv)}"`);
  else if (filters.title?.length) clauses.push(...filters.title.map(value => `title:"${escapeQueryValue(value)}"`));
  else {
    const terms = usefulTerms(classified.terms);
    if (terms.length) clauses.push(`(${terms.map(term => `full:"${escapeQueryValue(term)}"`).join(' AND ')})`);
  }
  for (const value of filters.author || []) clauses.push(`author:"${escapeQueryValue(value)}"`);
  for (const value of filters.object || []) clauses.push(`object:"${escapeQueryValue(value)}"`);
  const year = filters.year?.[0];
  const from = year || filters.from?.[0];
  const to = year || filters.to?.[0];
  if (/^\d{4}$/.test(from || '') || /^\d{4}$/.test(to || '')) clauses.push(`year:[${from || '*'} TO ${to || '*'}]`);
  return clauses.join(' AND ') || 'full:"pulsar"';
}

function resultId(result) {
  const identity = result.doi || result.arxivId || result.bibcode || result.title;
  return crypto.createHash('sha256').update(`${result.provider}:${identity}`).digest('hex').slice(0, 20);
}

function parseArxivFeed(xml) {
  const entries = String(xml || '').match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) || [];
  return entries.map(entry => {
    const idUrl = textOf(entry, 'id');
    const arxivId = arxivIdFromValue(idUrl);
    const links = [...entry.matchAll(/<link\b([^>]*)\/?\s*>/gi)].map(match => match[1]);
    const hrefFor = predicate => {
      const attrs = links.find(predicate);
      return attrs?.match(/href=["']([^"']+)["']/i)?.[1] || null;
    };
    const pdfUrl = hrefFor(attrs => /type=["']application\/pdf["']/i.test(attrs)) || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : null);
    const categories = [...entry.matchAll(/<category\b[^>]*term=["']([^"']+)["'][^>]*\/?>/gi)].map(match => decodeXml(match[1]));
    const result = {
      provider: 'arXiv', arxivId, bibcode: null, doi: textOf(entry, 'arxiv:doi') || null,
      title: textOf(entry, 'title'), authors: textsOf(entry, 'name'), abstract: textOf(entry, 'summary'),
      published: textOf(entry, 'published'), publication: categories[0] || 'arXiv preprint', categories,
      pdfUrl, recordUrl: hrefFor(attrs => /rel=["']alternate["']/i.test(attrs)) || idUrl,
      citationCount: null, referenceCount: null,
    };
    return { ...result, id: resultId(result), canImport: Boolean(pdfUrl) };
  }).filter(result => result.title && result.arxivId);
}

function parseAdsResponse(payload) {
  const docs = Array.isArray(payload?.response?.docs) ? payload.response.docs : [];
  return docs.map(doc => {
    const identifiers = Array.isArray(doc.identifier) ? doc.identifier : [];
    const arxivId = identifiers.map(arxivIdFromValue).find(Boolean) || null;
    const result = {
      provider: 'NASA ADS', bibcode: doc.bibcode || null, arxivId,
      doi: (Array.isArray(doc.doi) ? doc.doi[0] : doc.doi) || null,
      title: (Array.isArray(doc.title) ? doc.title[0] : doc.title) || 'Untitled paper',
      authors: Array.isArray(doc.author) ? doc.author : [], abstract: doc.abstract || '',
      published: doc.pubdate || (doc.year ? `${doc.year}-01-01` : ''), publication: doc.pub || 'NASA ADS record',
      categories: [], pdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}` : null,
      recordUrl: doc.bibcode ? `https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(doc.bibcode)}/abstract` : null,
      citationCount: Number.isFinite(doc.citation_count) ? doc.citation_count : null,
      referenceCount: Number.isFinite(doc.reference_count) ? doc.reference_count : null,
    };
    return { ...result, id: resultId(result), canImport: Boolean(result.pdfUrl) };
  });
}

function deduplicate(results) {
  const seen = new Set();
  return results.filter(result => {
    const key = (result.doi && `doi:${result.doi.toLowerCase()}`)
      || (result.arxivId && `arxiv:${result.arxivId.toLowerCase()}`)
      || `title:${result.title.toLowerCase().replace(/\W/g, '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeFileName(result) {
  const base = result.arxivId || result.doi || result.bibcode || result.title || 'paper';
  const cleaned = base.replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 140);
  return `${cleaned || 'paper'}.pdf`;
}

class SourceDiscoveryService {
  constructor({ rawDir, fetchImpl = globalThis.fetch, adsToken = process.env.NASA_ADS_API_TOKEN, now = Date.now } = {}) {
    if (!rawDir) throw new Error('rawDir is required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
    this.rawDir = rawDir;
    this.fetch = fetchImpl;
    this.adsToken = adsToken || '';
    this.now = now;
    this.cache = new Map();
  }

  remember(results) {
    const expires = this.now() + 30 * 60 * 1000;
    for (const result of results) this.cache.set(result.id, { result, expires });
    if (this.cache.size > 1000) {
      for (const [id, value] of this.cache) if (value.expires < this.now()) this.cache.delete(id);
    }
  }

  cached(id) {
    const entry = this.cache.get(String(id));
    if (!entry || entry.expires < this.now()) {
      this.cache.delete(String(id));
      return null;
    }
    return entry.result;
  }

  async fetchText(url, options, label) {
    const response = await this.fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`${label} returned ${response.status}.`);
    return response.text();
  }

  async search(input, { limit = 20 } = {}) {
    const query = classifyQuery(input);
    const rows = Math.min(MAX_RESULTS, Math.max(1, Number(limit) || 20));
    const sourceFilter = query.filters.source?.[0]?.toLowerCase();
    const tasks = [];
    if (!sourceFilter || sourceFilter === 'arxiv') {
      const url = `${ARXIV_API}?search_query=${encodeURIComponent(buildArxivQuery(query))}&start=0&max_results=${rows}&sortBy=relevance&sortOrder=descending`;
      tasks.push(this.fetchText(url, { headers: { 'User-Agent': 'PulsarWiki/1.0 source discovery' } }, 'arXiv')
        .then(parseArxivFeed).then(results => ({ source: 'arXiv', results })).catch(error => ({ source: 'arXiv', results: [], error: error.message })));
    }
    if ((!sourceFilter || ['ads', 'nasa-ads'].includes(sourceFilter)) && this.adsToken) {
      const params = new URLSearchParams({ q: buildAdsQuery(query), fl: 'bibcode,title,author,year,pub,pubdate,abstract,doi,identifier,citation_count,reference_count', rows: String(rows), sort: 'score desc' });
      tasks.push(this.fetchText(`${ADS_API}?${params}`, { headers: { Authorization: `Bearer ${this.adsToken}` } }, 'NASA ADS')
        .then(JSON.parse).then(parseAdsResponse).then(results => ({ source: 'NASA ADS', results })).catch(error => ({ source: 'NASA ADS', results: [], error: error.message })));
    }
    const settled = await Promise.all(tasks);
    const results = deduplicate(settled.flatMap(item => item.results)).slice(0, rows);
    this.remember(results);
    const warnings = settled.filter(item => item.error).map(item => `${item.source}: ${item.error}`);
    if (!this.adsToken && sourceFilter !== 'arxiv') warnings.push('NASA ADS is unavailable until NASA_ADS_API_TOKEN is configured; arXiv results are shown.');
    return { query: { intent: query.intent, terms: query.terms, filters: query.filters }, results, warnings, filters: FILTERS };
  }

  async related(id) {
    const source = this.cached(id);
    if (!source) throw new Error('This paper preview expired. Search for it again.');
    const terms = usefulTerms(`${source.title} ${source.abstract}`, 6);
    const searches = [{ key: 'topics', label: 'Shared research topics', query: terms.join(' ') }];
    if (source.bibcode && this.adsToken) {
      searches.unshift(
        { key: 'citations', label: 'Cited by', adsQuery: `citations(bibcode:"${escapeQueryValue(source.bibcode)}")` },
        { key: 'references', label: 'References', adsQuery: `references(bibcode:"${escapeQueryValue(source.bibcode)}")` },
      );
    }
    const groups = [];
    for (const search of searches) {
      let results = [];
      if (search.adsQuery) {
        const params = new URLSearchParams({ q: search.adsQuery, fl: 'bibcode,title,author,year,pub,pubdate,abstract,doi,identifier,citation_count,reference_count', rows: '6', sort: 'date desc' });
        try {
          const payload = JSON.parse(await this.fetchText(`${ADS_API}?${params}`, { headers: { Authorization: `Bearer ${this.adsToken}` } }, 'NASA ADS'));
          results = parseAdsResponse(payload);
        } catch { results = []; }
      } else if (search.query) {
        try { results = (await this.search(`${search.query} source:arxiv`, { limit: 6 })).results; } catch { results = []; }
      }
      results = results.filter(result => result.id !== source.id).slice(0, 5);
      this.remember(results);
      groups.push({ key: search.key, label: search.label, results });
    }
    return { sourceId: source.id, groups };
  }

  async downloadPdf(result) {
    if (!result?.pdfUrl) throw new Error(`${result?.title || 'Paper'} does not have an open arXiv PDF.`);
    const url = new URL(result.pdfUrl);
    if (url.protocol !== 'https:' || !ALLOWED_PDF_HOSTS.has(url.hostname.toLowerCase())) throw new Error('Only trusted arXiv PDF downloads can be imported.');
    const fileName = safeFileName(result);
    const destination = path.join(this.rawDir, fileName);
    if (fs.existsSync(destination)) return { name: fileName, existed: true, source: result };
    const response = await this.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'PulsarWiki/1.0 source import' } });
    if (!response.ok) throw new Error(`PDF download returned ${response.status}.`);
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (!type.includes('pdf') && !url.pathname.toLowerCase().includes('/pdf/')) throw new Error('The source did not return a PDF.');
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_PDF_BYTES) throw new Error('The PDF is larger than 75 MB.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_PDF_BYTES) throw new Error('The PDF is larger than 75 MB.');
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('The downloaded file is not a valid PDF.');
    fs.mkdirSync(this.rawDir, { recursive: true });
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, bytes, { flag: 'wx' });
      fs.renameSync(temporary, destination);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch { /* best effort */ }
      throw error;
    }
    return { name: fileName, existed: false, source: result };
  }

  async import(ids) {
    const uniqueIds = [...new Set(Array.isArray(ids) ? ids.map(String) : [])];
    if (!uniqueIds.length || uniqueIds.length > 25) throw new Error('Select between 1 and 25 papers to import.');
    const results = uniqueIds.map(id => this.cached(id));
    if (results.some(result => !result)) throw new Error('One or more paper previews expired. Run the search again.');
    const imported = [];
    const failed = [];
    for (const result of results) {
      try { imported.push(await this.downloadPdf(result)); }
      catch (error) { failed.push({ id: result.id, title: result.title, error: error.message }); }
    }
    return { imported, failed };
  }
}

module.exports = {
  FILTERS, SourceDiscoveryService, buildAdsQuery, buildArxivQuery, classifyQuery,
  parseAdsResponse, parseArxivFeed, parseExpression, safeFileName,
};
