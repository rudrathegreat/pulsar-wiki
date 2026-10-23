const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, text, authors } = require('../public/bibtex');

test('reads nested titles, quotes, comments, macros and concatenation', () => {
  const source = `% @misc{ignored, title={No}}
@string{journal = "Pulsar " # {Letters}}
@preamble{"ignored"}
@comment{not a paper {nested}}
@article(key,
 title = {A {NICER} view, with {nested {braces}}},
 journal = journal, month = jan,
 author = "Riley, T. and {Research and Timing Group}",
 year = 2021, note = "A {protected \"quote\"} and comma, here"
)`;
  const result = parse(source);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].key, 'key');
  assert.equal(result.entries[0].fields.journal, 'Pulsar Letters');
  assert.equal(result.entries[0].fields.month, 'January');
  assert.equal(text(result.entries[0].fields.title), 'A NICER view, with nested braces');
  assert.deepEqual(authors(result.entries[0].fields.author), ['Riley, T.', 'Research and Timing Group']);
});

test('recovers complete papers after malformed entries without changing source', () => {
  const source = '@article{bad, title={Incomplete\n@misc{good, title={Complete}}';
  const result = parse(source);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].key, 'good');
  assert.match(result.warnings[0], /line 1/);
  assert.equal(source, '@article{bad, title={Incomplete\n@misc{good, title={Complete}}');
  assert.deepEqual(parse('').entries, []);
  assert.equal(parse('not bibtex').warnings.length, 1);
});

test('decodes common BibTeX escapes and preserves unknown commands visibly', () => {
  assert.equal(text(String.raw`{Garc\'ia} \& \textit{pulsars} in tempo2\_manual`), 'García & pulsars in tempo2_manual');
  assert.equal(text(String.raw`\unknown{value}`), String.raw`\unknownvalue`);
});
