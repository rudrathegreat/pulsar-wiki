const CLI_TOOLS = Object.freeze({
  claude: Object.freeze({
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    description: 'Anthropic\'s agentic coding CLI.',
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    buildArgs: prompt => ['-p', '--output-format', 'text', '--', prompt],
  }),
  antigravity: Object.freeze({
    id: 'antigravity',
    name: 'Antigravity CLI',
    command: 'agy',
    description: 'Google Antigravity\'s terminal agent.',
    installUrl: 'https://antigravity.google/docs/cli-getting-started',
    buildArgs: prompt => ['--print', '--output-format', 'text', '--', prompt],
  }),
  codex: Object.freeze({
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    description: 'OpenAI\'s coding agent for the terminal.',
    installUrl: 'https://developers.openai.com/codex/cli',
    buildArgs: prompt => ['exec', '--color', 'never', '--', prompt],
  }),
  opencode: Object.freeze({
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    description: 'The open-source AI coding agent.',
    installUrl: 'https://opencode.ai/docs/cli/',
    buildArgs: prompt => ['run', '--', prompt],
  }),
});

function listCliTools() {
  return Object.values(CLI_TOOLS).map(({ buildArgs, ...tool }) => tool);
}

function getCliTool(id) {
  return CLI_TOOLS[id] || null;
}

function buildCliInvocation(id, prompt) {
  const tool = getCliTool(id);
  if (!tool) throw new Error(`Unsupported CLI tool: ${id}`);
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Prompt is required');

  return {
    command: tool.command,
    args: tool.buildArgs(prompt),
  };
}

module.exports = { buildCliInvocation, getCliTool, listCliTools };
