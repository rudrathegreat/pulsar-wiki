'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ANTIGRAVITY_AGENT, ANTIGRAVITY_MODEL, createAntigravityAdapter } = require('../agent/antigravity');
const { InferenceSettings } = require('../agent/inference-settings');

const call = (index, id, name) => ({ event_type: 'step.start', index, step: { type: 'function_call', id, name, arguments: {} } });
const delta = (index, args) => ({ event_type: 'step.delta', index, delta: { type: 'arguments_delta', arguments: args } });
const complete = (status = 'completed') => ({ event_type: 'interaction.completed', interaction: { id: 'turn-1', status } });

function stream(...events) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n');
}

test('Antigravity streams images, conversation history and local wiki tool results', async () => {
  const requests = [];
  const outputs = [
    stream(
      { event_type: 'interaction.created', interaction: { id: 'turn-1', environment_id: 'sandbox-1' } },
      call(0, 'wiki-1', 'read_wiki_page'),
      delta(0, '{"name":'),
      delta(0, '"index"}'),
      call(1, 'remote-1', 'list_files'),
      { event_type: 'step.start', index: 2, step: { type: 'function_result', call_id: 'remote-1' } },
      complete('requires_action'),
    ),
    stream({ event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Answer' } }, complete()),
  ];
  const adapter = createAntigravityAdapter({ apiKey: 'test-key', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    requests.push(JSON.parse(options.body));
    return outputs.shift();
  } });
  const calls = [], streamed = [], events = [];
  const response = await adapter.runTurn({
    instructions: 'Read the local wiki when needed.',
    messages: [
      { role: 'user', text: 'Question one' },
      { role: 'assistant', text: 'Earlier answer' },
      { role: 'user', content: [{ type: 'input_text', text: 'Explain this image' }, { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] },
    ],
    tools: [{ name: 'read_wiki_page', inputSchema: { type: 'object' } }],
    executeTool(name, args) { calls.push({ name, args }); return { exists: true }; },
    onDelta: text => streamed.push(text),
    onTool: event => events.push(event.phase),
  });
  assert.deepEqual(response, { text: 'Answer' });
  assert.deepEqual(streamed, ['Answer']);
  assert.deepEqual(events, ['started', 'completed']);
  assert.deepEqual(calls, [{ name: 'read_wiki_page', args: { name: 'index' } }]);
  assert.equal(requests[0].agent, ANTIGRAVITY_AGENT);
  assert.equal(requests[0].agent_config.model, ANTIGRAVITY_MODEL);
  assert.equal(requests[0].store, true);
  assert.deepEqual(requests[0].environment, { type: 'remote', network: 'disabled' });
  assert.equal(requests[0].input[1].type, 'model_output');
  assert.deepEqual(requests[0].input[2].content[1], { type: 'image', mime_type: 'image/png', data: 'AAAA' });
  assert.equal(requests[1].previous_interaction_id, 'turn-1');
  assert.equal(requests[1].environment, 'sandbox-1');
  assert.deepEqual(requests[1].input, [{ type: 'function_result', name: 'read_wiki_page', call_id: 'wiki-1', result: { exists: true } }]);
});

test('Antigravity rejects undeclared tools, honors cancellation and keeps remote errors private', async () => {
  const request = { messages: [{ role: 'user', text: 'Hello' }], tools: [], executeTool: () => assert.fail('Undeclared tool executed') };
  const blocked = createAntigravityAdapter({ apiKey: 'test-key', fetchImpl: async (_url, { body }) => {
    const input = JSON.parse(body);
    assert.deepEqual(input.tools, []);
    assert.equal(input.store, false);
    return stream(call(0, 'unknown-1', 'read_wiki_page'), complete('requires_action'));
  } });
  await assert.rejects(blocked.runTurn(request), { code: 'tool-not-allowed' });
  const rejected = createAntigravityAdapter({ apiKey: 'test-key', fetchImpl: async () => Response.json({
    error: { message: 'Unexpected test-key disclosure', details: [{ reason: 'API_KEY_INVALID' }] },
  }, { status: 400 }) });
  await assert.rejects(rejected.runTurn(request), error => error.code === 'antigravity-key-invalid' && !error.message.includes('test-key'));
  const aborted = createAntigravityAdapter({ apiKey: 'test-key', fetchImpl: async (_url, { signal }) => signal.throwIfAborted() });
  await assert.rejects(aborted.runTurn({ ...request, signal: AbortSignal.abort() }), { code: 'aborted' });
});

test('switching providers persists the verified key and excludes it from public settings', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsarwiki-inference-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'settings.json');
  const chatgptAuth = { inferenceConfig: async () => ({ model: 'openai-model', accessToken: 'oauth-access' }) };
  const options = { file, chatgptAuth, antigravityFactory: ({ apiKey }) => ({
    async runTurn() {
      if (apiKey === 'rejected') throw new Error('Connection failed');
      return { text: 'OK' };
    },
  }) };
  const settings = new InferenceSettings(options);
  await assert.rejects(settings.save({ provider: 'antigravity' }), /Enter a Gemini API key/);
  await assert.rejects(settings.save({ provider: 'antigravity', apiKey: 'rejected' }), /Connection failed/);
  assert.deepEqual(await settings.inferenceConfig(), { model: 'openai-model', accessToken: 'oauth-access' });
  const status = await settings.save({ provider: 'antigravity', apiKey: '  test-key  ' });
  assert.deepEqual(status, { provider: 'antigravity', antigravityConfigured: true, antigravityModel: ANTIGRAVITY_MODEL });
  const restored = new InferenceSettings(options);
  assert.equal((await restored.inferenceConfig()).apiKey, 'test-key');
  await restored.save({ provider: 'chatgpt' });
  assert.equal(restored.status().antigravityConfigured, true);
  await restored.save({ provider: 'antigravity' });
  assert.equal((await restored.inferenceConfig()).apiKey, 'test-key');
  assert.equal(restored.removeKey().provider, 'chatgpt');
  assert.equal(new InferenceSettings(options).status().antigravityConfigured, false);
});
