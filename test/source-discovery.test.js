'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  SourceDiscoveryService,
  buildAdsQuery,
  buildArxivQuery,
  classifyQuery,
  parseAdsResponse,
  parseArxivFeed,
  safeFileName,
} = require('../agent/source-discovery');

const ARXIV_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2401.01234v2</id>
    <updated>2024-02-03T00:00:00Z</updated>
    <published>2024-01-05T00:00:00Z</published>
    <title>Precision &amp; pulsar timing</title>
    <summary>We present a detailed timing analysis.</summary>
    <author><name>Ada Pulsar</name></author>
    <author><name>Sam Timing</name></author>
    <arxiv:doi>10.1234/example.1</arxiv:doi>
    <arxiv:journal_ref>Monthly Notices of the Royal Astronomical Society</arxiv:journal_ref>
    <link title="pdf" href="https://arxiv.org/pdf/2401.01234v2" rel="related" type="application/pdf"/>
    <link href="https://arxiv.org/abs/2401.01234v2" rel="alternate" type="text/html"/>
    <category term="astro-ph.HE"/>
  </entry>
</feed>`;

test('query classification distinguishes questions, exact identifiers, and inline filters', () => {
  const question = classifyQuery('How do pulsar glitches affect timing noise? author:"Jane Doe" year:2024');
  assert.equal(question.intent, 'research-question');
  assert.equal(question.terms, 'How do pulsar glitches affect timing noise?');
  assert.deepEqual(question.filters.author, ['Jane Doe']);
  assert.deepEqual(question.filters.year, ['2024']);

  const doi = classifyQuery('https://doi.org/10.1234/ABC.9');
  assert.equal(doi.intent, 'specific');
  assert.equal(doi.doi.toLowerCase(), '10.1234/abc.9');

  const ads = classifyQuery('https://ui.adsabs.harvard.edu/abs/2024ApJ...123..456A/abstract');
  assert.equal(ads.bibcode, '2024ApJ...123..456A');
});

test('provider queries retain structured ADS-style filters', () => {
  const query = classifyQuery('millisecond pulsar binaries author:"J. Smith" from:2020 to:2025 category:astro-ph.HE');
  const arxiv = buildArxivQuery(query);
  const ads = buildAdsQuery(query);
  assert.match(arxiv, /all:\(millisecond AND pulsar AND binaries\)/);
  assert.match(arxiv, /au:"J\. Smith"/);
  assert.match(arxiv, /submittedDate:\[202001010000 TO 202512312359\]/);
  assert.match(ads, /author:"J\. Smith"/);
  assert.match(ads, /year:\[2020 TO 2025\]/);
});

test('arXiv and ADS records normalize to preview and import metadata', () => {
  const [arxiv] = parseArxivFeed(ARXIV_FEED);
  assert.equal(arxiv.arxivId, '2401.01234');
  assert.equal(arxiv.title, 'Precision & pulsar timing');
  assert.deepEqual(arxiv.authors, ['Ada Pulsar', 'Sam Timing']);
  assert.equal(arxiv.canImport, true);
  assert.equal(arxiv.publication, 'Monthly Notices of the Royal Astronomical Society');
  assert.equal(arxiv.categories[0], 'astro-ph.HE');

  const [ads] = parseAdsResponse({ response: { docs: [{
    bibcode: '2024ApJ...123..456A', title: ['An ADS paper'], author: ['A. Author'], year: 2024,
    identifier: ['arXiv:2401.01234'], citation_count: 8, reference_count: 22,
  }] } });
  assert.equal(ads.provider, 'NASA ADS');
  assert.equal(ads.arxivId, '2401.01234');
  assert.equal(ads.citationCount, 8);
  assert.equal(ads.canImport, true);
});

test('search caches previews and import writes a validated PDF without overwriting it', async t => {
  const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsarwiki-sources-'));
  t.after(() => fs.rmSync(rawDir, { recursive: true, force: true }));
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).includes('/api/query')) return new Response(ARXIV_FEED, { status: 200, headers: { 'content-type': 'application/atom+xml' } });
    if (String(url).startsWith('https://arxiv.org/pdf/')) {
      return new Response(Buffer.from('%PDF-1.4\nminimal test pdf'), { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const service = new SourceDiscoveryService({ rawDir, fetchImpl, adsToken: '' });
  const search = await service.search('How do pulsars keep time?', { limit: 5 });
  assert.equal(search.query.intent, 'research-question');
  assert.equal(search.results.length, 1);
  assert.match(search.warnings.join(' '), /NASA ADS is unavailable/);

  const first = await service.import([search.results[0].id]);
  assert.equal(first.imported.length, 1);
  assert.equal(first.imported[0].existed, false);
  assert.equal(fs.readFileSync(path.join(rawDir, first.imported[0].name), 'utf8').startsWith('%PDF-'), true);

  const second = await service.import([search.results[0].id]);
  assert.equal(second.imported[0].existed, true);
  assert.equal(calls.filter(url => url.startsWith('https://arxiv.org/pdf/')).length, 1);
});

test('default search uses sciX without requesting arXiv when matches exist', async () => {
  const calls = [];
  const service = new SourceDiscoveryService({ rawDir: os.tmpdir(), adsToken: 'test', fetchImpl: async url => {
    calls.push(String(url));
    return Response.json({ response: { docs: [{ bibcode: '2024ApJ...123..456A', title: ['Pulsar timing'] }] } });
  } });
  const result = await service.search('pulsar');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith('https://api.adsabs.harvard.edu/'));
  assert.equal(result.results[0].provider, 'NASA ADS');
  assert.deepEqual(result.warnings, []);
});

for (const outcome of ['empty', 'error', 'invalid response']) {
  test(`default search falls back to arXiv after sciX ${outcome}`, async () => {
    const calls = [];
    const service = new SourceDiscoveryService({ rawDir: os.tmpdir(), adsToken: 'test', fetchImpl: async url => {
      calls.push(String(url));
      if (String(url).startsWith('https://api.adsabs.harvard.edu/')) {
        if (outcome === 'error') return new Response('', { status: 503 });
        if (outcome === 'invalid response') return new Response('invalid JSON');
        return Response.json({ response: { docs: [] } });
      }
      return new Response(ARXIV_FEED);
    } });
    const result = await service.search('pulsar');
    assert.equal(calls.length, 2);
    assert.ok(calls[0].startsWith('https://api.adsabs.harvard.edu/'));
    assert.ok(calls[1].startsWith('https://export.arxiv.org/'));
    assert.equal(result.results[0].provider, 'arXiv');
    assert.equal(result.warnings.length, outcome === 'empty' ? 0 : 1);
  });
}

for (const provider of ['arxiv', 'scix', 'ads', 'nasa-ads']) {
  test(`explicit source:${provider} searches only the selected provider`, async () => {
    const calls = [];
    const service = new SourceDiscoveryService({ rawDir: os.tmpdir(), adsToken: 'test', fetchImpl: async url => {
      calls.push(String(url));
      return provider === 'arxiv' ? new Response(ARXIV_FEED) : Response.json({ response: { docs: [] } });
    } });
    await service.search(`pulsar source:${provider}`);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith(provider === 'arxiv' ? 'https://export.arxiv.org/' : 'https://api.adsabs.harvard.edu/'));
  });
}

test('import filenames are portable and bounded', () => {
  const name = safeFileName({ doi: '10.1234/a:b/c*d?e', title: 'ignored' });
  assert.equal(name, '10.1234-a-b-c-d-e.pdf');
  assert.ok(name.length <= 144);
});

test('related resolves arXiv records in ADS and keeps real citation groups cached', async () => {
  const queries = [];
  const service = new SourceDiscoveryService({ rawDir: os.tmpdir(), adsToken: 'test', fetchImpl: async url => {
    const params = new URL(String(url)).searchParams;
    const query = params.get('q');
    queries.push(query);
    const doc = query.startsWith('doi:') ? { bibcode: 'main' }
      : { bibcode: query.startsWith('references(') ? 'reference' : 'citing', title: ['Related paper'], abstract: 'Full abstract', author: ['Author'], pub: 'Journal', identifier: ['arXiv:2401.09999'] };
    return Response.json({ response: { docs: [doc] } });
  } });
  const [paper] = parseArxivFeed(ARXIV_FEED);
  service.remember([paper]);
  const data = await service.related(paper.id);
  assert.equal(queries[0], 'doi:"10.1234/example.1"');
  assert.ok(queries.includes('references(bibcode:"main")'));
  assert.ok(queries.includes('citations(bibcode:"main")'));
  assert.deepEqual(data.groups.map(group => group.key), ['references', 'citations']);
  for (const group of data.groups) {
    assert.equal(group.results[0].abstract, 'Full abstract');
    assert.equal(service.cached(group.results[0].id).publication, 'Journal');
    assert.equal(group.limit, 25);
  }
});

test('related distinguishes unavailable, unmatched and failed ADS data from empty groups', async () => {
  const [paper] = parseArxivFeed(ARXIV_FEED);
  const service = new SourceDiscoveryService({ rawDir: os.tmpdir(), adsToken: '', fetchImpl: async () => { throw new Error('Should not fetch'); } });
  service.remember([paper]);
  assert.match((await service.related(paper.id)).groups[0].error, /token in Settings/);
  service.adsToken = 'test';
  service.fetch = async () => Response.json({ response: { docs: [] } });
  assert.match((await service.related(paper.id)).groups[0].error, /no matching/);
  service.remember([{ ...paper, bibcode: 'known' }]);
  service.fetch = async url => new URL(String(url)).searchParams.get('q').startsWith('references(')
    ? new Response('', { status: 503 }) : Response.json({ response: { docs: [] } });
  const { groups } = await service.related(paper.id);
  assert.match(groups[0].error, /503/);
  assert.equal(groups[1].error, undefined);
  assert.deepEqual(groups[1].results, []);
});
