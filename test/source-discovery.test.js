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
  const search = await service.search('How do pulsars keep time?', { limit: 5, filters: { refereed: 'all' } });
  assert.equal(search.query.intent, 'research-question');
  assert.equal(search.results.length, 1);
  assert.match(search.warnings.join(' '), /NASA ADS is unavailable/);

  const first = await service.import([search.results[0].id]);
  assert.equal(first.imported.length, 1);
  assert.equal(first.imported[0].existed, false);
  assert.equal(fs.readFileSync(path.join(rawDir, first.imported[0].name), 'utf8').startsWith('%PDF-'), true);

  const second = await service.import([search.results[0].id]);
  assert.equal(second.imported.length, 0);
  assert.match(second.failed[0].error, /already downloaded/);
  const again = await service.search('pulsar', { filters: { refereed: 'all' } });
  assert.equal(again.results[0].downloaded, true);
  assert.equal(calls.filter(url => url.startsWith('https://arxiv.org/pdf/')).length, 1);
});

test('saved bibliography identifies renamed PDFs and prevents cross-provider duplicate imports', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsarwiki-duplicates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rawDir = path.join(root, 'raw'); fs.mkdirSync(rawDir);
  fs.writeFileSync(path.join(rawDir, 'renamed.pdf'), '%PDF-1.4');
  const { References } = require('../agent/references');
  const refs = new References({ rootDir: root, rawDir });
  refs.add([{ name: 'renamed.pdf', title: 'Precision & pulsar timing', doi: '10.1234/example.1', arxivId: '2401.01234' }]);
  let downloads = 0;
  const service = new SourceDiscoveryService({ rawDir, references: refs, adsToken: '', fetchImpl: async url => {
    if (String(url).includes('/api/query')) return new Response(ARXIV_FEED);
    downloads++; throw new Error('Unexpected download');
  } });
  const search = await service.search('pulsar', { filters: { refereed: 'all' } });
  assert.equal(search.results[0].downloaded, true);
  const result = await service.import([search.results[0].id]);
  assert.match(result.failed[0].error, /already downloaded/);
  assert.equal(downloads, 0);
  fs.unlinkSync(path.join(rawDir, 'renamed.pdf'));
  assert.equal((await service.search('pulsar', { filters: { refereed: 'all' } })).results[0].downloaded, false);
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
  const params = new URL(calls[0]).searchParams;
  assert.match(params.get('q'), /property:refereed/);
  assert.equal(params.get('sort'), 'score desc');
  assert.equal(result.results[0].provider, 'NASA ADS');
  assert.deepEqual(result.warnings, []);
});

test('ADS receives filters and sorting before limiting results', async () => {
  let params;
  const service = new SourceDiscoveryService({ rawDir: os.tmpdir(), adsToken: 'test', fetchImpl: async url => {
    params = new URL(String(url)).searchParams;
    return Response.json({ response: { docs: [] } });
  } });
  for (const [sort, expected] of [['default', 'score desc'], ['citations', 'citation_count desc'], ['recent', 'date desc'], ['author', 'first_author asc']]) {
    await service.search('pulsar author:"Jane Doe"', { sort, filters: { refereed: 'non-refereed', collection: 'astronomy', year: '2024', minCitations: '12' } });
    assert.equal(params.get('sort'), expected);
    assert.equal(params.get('rows'), '20');
    for (const clause of ['author:"Jane Doe"', 'property:notrefereed', 'database:astronomy', 'year:2024', 'citation_count:[12 TO *]']) assert.ok(params.get('q').includes(clause));
  }
});

test('restricted searches never silently fall back to unverified arXiv records', async () => {
  const calls = [];
  const service = new SourceDiscoveryService({ rawDir: os.tmpdir(), adsToken: '', fetchImpl: async url => { calls.push(url); return new Response(ARXIV_FEED); } });
  for (const options of [{}, { sort: 'citations', filters: { refereed: 'all' } }, { sort: 'author', filters: { refereed: 'all' } }, { filters: { refereed: 'all', minCitations: '0' } }, { filters: { refereed: 'all', collection: 'physics' } }]) {
    const data = await service.search('pulsar', options);
    assert.equal(data.results.length, 0);
    assert.match(data.warnings.join(' '), /require NASA ADS metadata/);
  }
  assert.equal(calls.length, 0);
});

test('arXiv supports recent sorting and publication year when ADS-only filters are cleared', async () => {
  let params;
  const service = new SourceDiscoveryService({ rawDir: os.tmpdir(), adsToken: '', fetchImpl: async url => {
    params = new URL(String(url)).searchParams;
    return new Response(ARXIV_FEED);
  } });
  const data = await service.search('pulsar', { sort: 'recent', filters: { refereed: 'all', year: '2024' } });
  assert.equal(data.results.length, 1);
  assert.equal(params.get('sortBy'), 'submittedDate');
  assert.match(params.get('search_query'), /submittedDate:\[202401010000 TO 202412312359\]/);
});

test('invalid search controls are rejected before contacting a provider', async () => {
  const service = new SourceDiscoveryService({ rawDir: os.tmpdir(), adsToken: 'test', fetchImpl: async () => { assert.fail('Unexpected provider call'); } });
  for (const options of [{ sort: '__proto__' }, { filters: { refereed: 'unknown' } }, { filters: { collection: 'astronomy OR *' } }, { filters: { year: '2024 OR *' } }, { filters: { minCitations: '-1' } }, { filters: { minCitations: '1.5' } }]) {
    await assert.rejects(service.search('pulsar', options));
  }
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
    const result = await service.search('pulsar', { filters: { refereed: 'all' } });
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
    await service.search(`pulsar source:${provider}`, { filters: { refereed: 'all' } });
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
    assert.equal(group.limit, 10);
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

test('related recovers expired and lost search entries from matching citation identifiers', async () => {
  let now = 0;
  const queries = [];
  const service = new SourceDiscoveryService({ rawDir: os.tmpdir(), adsToken: 'test', now: () => now, fetchImpl: async url => {
    const query = new URL(String(url)).searchParams.get('q');
    queries.push(query);
    return Response.json({ response: { docs: query.startsWith('doi:') ? [{ bibcode: 'resolved' }] : [{ bibcode: 'related', title: ['Related paper'] }] } });
  } });
  const [arxiv] = parseArxivFeed(ARXIV_FEED);
  const [ads] = parseAdsResponse({ response: { docs: [{ bibcode: 'known', doi: ['10.1234/test'] }] } });
  for (const paper of [arxiv, ads]) {
    service.remember([paper]);
    now += 31 * 60 * 1000;
    assert.equal(service.cached(paper.id), null);
    for (const reset of [false, true]) {
      if (reset) service.cache.clear();
      const data = await service.related(paper.id, paper);
      assert.equal(data.sourceId, paper.id);
      assert.deepEqual(data.groups.map(group => group.results[0].bibcode), ['related', 'related']);
      assert.equal(service.cached(data.groups[0].results[0].id).title, 'Related paper');
    }
  }
  assert.ok(queries.includes('doi:"10.1234/example.1"'));
  assert.ok(queries.includes('references(bibcode:"known")'));
  await assert.rejects(service.related(arxiv.id, { ...arxiv, doi: '10.1234/different' }), /preview expired/);
  await assert.rejects(service.related(arxiv.id), /preview expired/);
});


test('related pages each citation group independently using ADS totals', async () => {
  const calls = [];
  const service = new SourceDiscoveryService({ rawDir: os.tmpdir(), adsToken: 'test', fetchImpl: async url => {
    const params = new URL(String(url)).searchParams;
    calls.push(params);
    const start = Number(params.get('start'));
    const total = params.get('q').startsWith('references(') ? 12 : 10;
    return Response.json({ response: { numFound: total, docs: Array.from({ length: Math.min(10, total - start) }, (_, i) => ({ bibcode: `paper-${start + i}`, title: ['Related'] })) } });
  } });
  const [paper] = parseArxivFeed(ARXIV_FEED);
  service.remember([{ ...paper, bibcode: 'main' }]);
  const first = await service.related(paper.id);
  assert.deepEqual(first.groups.map(g => [g.results.length, g.hasMore, g.nextStart]), [[10, true, 10], [10, false, 10]]);
  const next = await service.related(paper.id, { group: 'references', start: '10' });
  assert.equal(next.groups.length, 1);
  assert.equal(next.groups[0].results.length, 2);
  assert.equal(next.groups[0].hasMore, false);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].get('rows'), '10');
  await assert.rejects(service.related(paper.id, { group: 'invalid', start: '10' }), /Invalid/);
});
