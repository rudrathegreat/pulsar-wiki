'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const Orcid = require('../public/orcid');
const { SourceDiscoveryService, parseAdsResponse, parseArxivFeed } = require('../agent/source-discovery');
const { References } = require('../agent/references');
const ID = '0000-0002-1825-0097';
const OTHER = '0000-0001-5109-3700';

test('ORCID links validate checksums and escape author names', () => {
  assert.equal(Orcid.normalize(`http://orcid.org/${ID}`), ID);
  for (const invalid of ['0000-0000-0000-0000', 'javascript:alert(1)', `https://evil.test/${ID}`, `${ID}?bad=1`]) assert.equal(Orcid.normalize(invalid), null);
  const html = Orcid.markup({ authors: ['<Ada>', 'Sam', 'Kim', 'Lee'], authorOrcids: [ID] }, 3);
  assert.ok(html.includes(`href="https://orcid.org/${ID}"`));
  assert.match(html, /&lt;Ada&gt;/);
  assert.match(html, / \+1$/);
  assert.equal(Orcid.matchAuthors(['Pulsar, Ada', 'A. Pulsar', 'Same Name'], [
    { name: 'Ada Pulsar', orcid: ID }, { name: 'Same Name', orcid: ID }, { name: 'Same Name', orcid: OTHER },
  ]).join(','), `${ID},,`);
});

test('ADS and arXiv IDs remain aligned with authors including missing slots', () => {
  const [paper] = parseAdsResponse({ response: { docs: [{ title: ['Paper'], author: ['Ada', 'Sam', 'Kim'], orcid_pub: ['-', ID, '-'], orcid_user: [OTHER, '-', '-'] }] } });
  assert.deepEqual(paper.authorOrcids, [OTHER, ID, null]);
  const [arxiv] = parseArxivFeed(`<feed><entry><id>https://arxiv.org/abs/2401.01234</id><title>Paper</title><author><name>Ada</name></author><author><name>Sam</name><arxiv:orcid>${ID}</arxiv:orcid></author></entry></feed>`);
  assert.deepEqual(arxiv.authorOrcids, [null, ID]);
});

test('paper lookups match authors by name, cache duplicate work and tolerate unavailable metadata', async () => {
  const calls = [];
  const service = new SourceDiscoveryService({ rawDir: '.', adsToken: '', fetchImpl: async url => {
    calls.push(url);
    if (url.includes('missing')) throw new Error('Offline');
    return new Response(JSON.stringify({ message: { author: [{ given: 'Ada', family: 'Pulsar', ORCID: `https://orcid.org/${ID}` }, { given: 'Sam', family: 'Timing' }] } }));
  } });
  const paper = { doi: '10.1234/paper', authors: ['Timing, Sam', 'Pulsar, Ada', 'Unknown'] };
  service.remember([{ ...paper, id: 'cached-paper' }]);
  const result = await service.authorOrcids([paper, paper]);
  assert.deepEqual(result.orcids, [[null, ID, null], [null, ID, null]]);
  assert.deepEqual(service.cached('cached-paper').authorOrcids, [null, ID, null]);
  assert.equal(calls.length, 1);
  await service.authorOrcids([paper]);
  assert.equal(calls.length, 1);
  assert.deepEqual((await service.authorOrcids([{ doi: '10.1234/missing', authors: ['Ada'] }])).orcids, [[null]]);
  await assert.rejects(service.authorOrcids([{ authors: 'Ada' }]), /author names/);
});

test('existing references resolve exact ADS titles and reject ambiguous matches', async () => {
  let ambiguous = false;
  const service = new SourceDiscoveryService({ rawDir: '.', adsToken: 'test', fetchImpl: async url => {
    assert.match(new URL(url).searchParams.get('fl'), /orcid_pub/);
    const doc = { title: ['Pulsar timing'], author: ['Pulsar, Ada'], orcid_pub: [ID] };
    return new Response(JSON.stringify({ response: { docs: ambiguous ? [doc, doc] : [doc] } }));
  } });
  assert.deepEqual((await service.authorOrcids([{ title: 'Pulsar timing', authors: ['Ada Pulsar'] }])).orcids, [[ID]]);
  ambiguous = true;
  service.orcidCache.clear();
  assert.deepEqual((await service.authorOrcids([{ title: 'Pulsar timing', authors: ['Ada Pulsar'] }])).orcids, [[null]]);
});

test('imports preserve positional ORCID IDs in editable BibTeX', t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsarwiki-orcid-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const refs = new References({ rootDir, rawDir: rootDir });
  const result = refs.add([{ name: 'paper.pdf', title: 'Paper', authors: ['Ada', 'Sam'], authorOrcids: [null, ID] }]);
  assert.match(result.content, new RegExp(`orcid = \\{-(?: and )${ID}\\}`));
});

test('browser lookup replaces original author nodes with safe profile links', async () => {
  const span = { dataset: { orcidIndex: '0' }, innerHTML: 'Ada' };
  const node = { dataset: { orcidPaper: 'paper' }, querySelectorAll: () => [span] };
  const context = { workspaceFetch: async (_url, options) => {
    assert.equal(JSON.parse(options.body).papers[0].doi, '10.1234/paper');
    return { orcids: [[ID]] };
  }, readJsonResponse: async value => value };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/orcid.js'), 'utf8'), context);
  await context.AuthorOrcids.hydrate({ querySelectorAll: () => [node] }, [{ id: 'paper', doi: '10.1234/paper', authors: ['Ada'] }]);
  assert.ok(span.innerHTML.includes(`href="https://orcid.org/${ID}"`));
});
