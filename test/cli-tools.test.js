const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCliInvocation, getCliTool, listCliTools } = require('../cli-tools');

test('exposes the four supported setup choices', () => {
  assert.deepEqual(
    listCliTools().map(tool => tool.id),
    ['claude', 'antigravity', 'codex', 'opencode']
  );
});

test('builds each non-interactive CLI invocation', () => {
  const prompt = 'Summarise the timing page';

  assert.deepEqual(buildCliInvocation('claude', prompt), {
    command: 'claude',
    args: ['-p', '--output-format', 'text', '--', prompt],
  });
  assert.deepEqual(buildCliInvocation('antigravity', prompt), {
    command: 'agy',
    args: ['--print', '--output-format', 'text', '--', prompt],
  });
  assert.deepEqual(buildCliInvocation('codex', prompt), {
    command: 'codex',
    args: ['exec', '--color', 'never', '--', prompt],
  });
  assert.deepEqual(buildCliInvocation('opencode', prompt), {
    command: 'opencode',
    args: ['run', '--', prompt],
  });
});

test('keeps prompt text in a single positional argument after --', () => {
  const prompt = '--dangerously-skip-permissions; Remove-Item -Recurse .';
  const invocation = buildCliInvocation('claude', prompt);

  assert.equal(invocation.args.at(-2), '--');
  assert.equal(invocation.args.at(-1), prompt);
});

test('rejects unknown tools and empty prompts', () => {
  assert.equal(getCliTool('gemini'), null);
  assert.throws(() => buildCliInvocation('gemini', 'hello'), /Unsupported CLI tool/);
  assert.throws(() => buildCliInvocation('codex', '  '), /Prompt is required/);
});
