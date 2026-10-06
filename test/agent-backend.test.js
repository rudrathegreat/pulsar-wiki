'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AgentService, AgentServiceError } = require('../agent/agent-service');
const {
  MAX_RESPONSE_STEPS,
  ProviderError,
  createChatGPTAdapter,
  providerFailure,
  toOpenAITools,
} = require('../agent/providers');
const { MAX_FAILURES, ThreadStore } = require('../agent/thread-store');

function temporaryStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsarwiki-chat-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new ThreadStore({ dataDir: directory });
}

function asyncEvents(events) {
  return { async *[Symbol.asyncIterator]() { for (const event of events) yield event; } };
}

function assistantMessage(content, extra = {}) {
  return {
    id: 'message-1',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content,
    ...extra,
  };
}

test('threads persist complete provider context and remain isolated', t => {
  const store = temporaryStore(t);
  const first = store.create({ title: 'First', instructionVersion: 'one', instructionSnapshot: 'instructions one' });
  const second = store.create({ title: 'Second', instructionVersion: 'two', instructionSnapshot: 'instructions two' });
  for (let index = 0; index < 20; index += 1) {
    store.append(first.id, [{ role: index % 2 ? 'assistant' : 'user', text: 'first-' + index }]);
  }
  store.append(second.id, [{ role: 'user', text: 'second-only' }]);

  const restored = new ThreadStore({ dataDir: store.dataDir });
  assert.equal(restored.get(first.id).messages.length, 20);
  assert.equal(restored.context(first.id).length, 20);
  assert.equal(restored.context(first.id)[0].text, 'first-0');
  assert.equal(restored.context(first.id).at(-1).text, 'first-19');
  assert.doesNotMatch(JSON.stringify(restored.context(first.id)), /second-only/);
  assert.equal(restored.get(first.id).instructionSnapshot, 'instructions one');
});

test('legacy unmatched user messages stay visible but are excluded from inference context', t => {
  const store = temporaryStore(t);
  const thread = store.create({ title: 'Legacy' });
  store.append(thread.id, [
    { role: 'user', text: 'failed old prompt' },
    { role: 'user', text: 'completed prompt' },
    { role: 'assistant', text: 'completed answer' },
    { role: 'user', text: 'dangling prompt' },
  ]);

  assert.deepEqual(store.get(thread.id).messages.map(message => message.text), [
    'failed old prompt', 'completed prompt', 'completed answer', 'dangling prompt',
  ]);
  assert.deepEqual(store.context(thread.id), [
    { role: 'user', text: 'completed prompt' },
    { role: 'assistant', text: 'completed answer' },
  ]);
});

test('thread diagnostics are sanitized, thread-local, and bounded to twenty records', t => {
  const store = temporaryStore(t);
  const thread = store.create({ title: 'Diagnostics' });
  for (let index = 0; index < MAX_FAILURES + 5; index += 1) {
    store.recordFailure(thread.id, {
      code: `failure-${index}`,
      message: 'Safe local message',
      model: 'subscription-model',
      prompt: 'p'.repeat(700),
      responseSteps: 200,
      outputTypes: ['reasoning', 'unsafe output type'],
      tools: [{ name: 'search_wiki', status: 'completed', arguments: 'must not persist' }],
      accessToken: 'must-not-persist',
      callId: 'must-not-persist',
    });
  }

  const failures = store.get(thread.id).failures;
  assert.equal(failures.length, MAX_FAILURES);
  assert.equal(failures[0].code, 'failure-5');
  assert.match(failures[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(failures[0].promptExcerpt.length, 500);
  assert.equal(failures[0].responseSteps, 100);
  assert.deepEqual(failures[0].outputTypes, ['reasoning', 'unknown']);
  assert.deepEqual(failures[0].tools, [{ name: 'search_wiki', status: 'completed' }]);
  assert.doesNotMatch(JSON.stringify(failures), /accessToken|callId|arguments|must-not-persist/);
});

test('agent uses only ChatGPT OAuth configuration, streams, and keeps the instruction snapshot', async t => {
  const store = temporaryStore(t);
  const adapterCalls = [];
  const persistedBatches = [];
  const append = store.append.bind(store);
  store.append = (id, entries, metadata) => {
    persistedBatches.push(structuredClone(entries));
    return append(id, entries, metadata);
  };
  const service = new AgentService({
    threadStore: store,
    authService: { async inferenceConfig() { return { accessToken: 'oauth-access', model: 'subscription-model' }; } },
    wikiTools: {
      definitions() { return [{ name: 'search_wiki', inputSchema: { type: 'object' } }]; },
      async execute(name, args) { return { name, args, ok: true }; },
    },
    instructions: 'snapshot A',
    providerFactory: connection => ({
      async runTurn(input) {
        adapterCalls.push({ connection, input });
        input.onTool({ name: 'search_wiki', phase: 'started' });
        input.onTool({ name: 'search_wiki', phase: 'completed' });
        input.onDelta?.('Hello');
        input.onDelta?.(' world');
        return { text: 'Hello world' };
      },
    }),
  });
  const thread = service.createThread('Research');
  const chunks = [];
  const tools = [];
  await service.runTurn({
    threadId: thread.id,
    text: 'What is timing noise?',
    onDelta: text => chunks.push(text),
    onTool: event => tools.push(event),
  });
  await service.runTurn({ threadId: thread.id, text: 'Continue.' });

  assert.deepEqual(chunks, ['Hello', ' world']);
  assert.deepEqual(tools, [
    { name: 'search_wiki', status: 'started' },
    { name: 'search_wiki', status: 'completed' },
  ]);
  assert.deepEqual(adapterCalls[0].connection, { accessToken: 'oauth-access' });
  assert.equal(adapterCalls[0].input.model, 'subscription-model');
  assert.match(adapterCalls[0].input.instructions, /^snapshot A\n\n## Local wiki tool protocol/);
  assert.deepEqual(adapterCalls[1].input.messages.map(message => message.text), [
    'What is timing noise?', 'Hello world', 'Continue.',
  ]);
  assert.equal(store.get(thread.id).provider, 'chatgpt');
  assert.equal(store.get(thread.id).messages.length, 4);
  assert.deepEqual(persistedBatches.map(entries => entries.map(entry => entry.role)), [
    ['user', 'assistant'],
    ['user', 'assistant'],
  ]);
});

test('failed prompts are not persisted or replayed and create only sanitized diagnostics', async t => {
  const store = temporaryStore(t);
  const providerMessages = [];
  let attempt = 0;
  const service = new AgentService({
    threadStore: store,
    authService: { async inferenceConfig() { return { accessToken: 'oauth-secret', model: 'subscription-model' }; } },
    wikiTools: {
      definitions() { return [{ name: 'search_wiki', inputSchema: { type: 'object' } }]; },
      async execute() { return {}; },
    },
    instructions: 'snapshot',
    providerFactory: () => ({
      async runTurn(input) {
        attempt += 1;
        providerMessages.push(structuredClone(input.messages));
        if (attempt === 1) {
          input.onTool({ name: 'search_wiki', phase: 'started' });
          input.onTool({ name: 'search_wiki', phase: 'completed' });
          const error = new ProviderError('ChatGPT could not complete this request. Please try again.', 'provider-error', {
            responseSteps: 2,
            outputTypes: ['reasoning', 'function_call'],
          });
          error.accessToken = 'oauth-secret';
          error.responseId = 'response-secret';
          throw error;
        }
        return { text: 'Recovered answer' };
      },
    }),
  });
  const thread = service.createThread('Failure recovery');
  const failedPrompt = `failed lint prompt ${'x'.repeat(600)}`;

  await assert.rejects(
    service.runTurn({ threadId: thread.id, text: failedPrompt }),
    error => error instanceof ProviderError && error.code === 'provider-error'
  );
  const failedThread = store.get(thread.id);
  assert.equal(failedThread.messages.length, 0);
  assert.equal(failedThread.failures.length, 1);
  assert.equal(failedThread.failures[0].promptExcerpt.length, 500);
  assert.equal(failedThread.failures[0].responseSteps, 2);
  assert.deepEqual(failedThread.failures[0].outputTypes, ['reasoning', 'function_call']);
  assert.deepEqual(failedThread.failures[0].tools, [
    { name: 'search_wiki', status: 'started' },
    { name: 'search_wiki', status: 'completed' },
  ]);
  assert.doesNotMatch(JSON.stringify(failedThread.failures), /oauth-secret|response-secret|accessToken|responseId/);
  assert.doesNotMatch(JSON.stringify(service.getThread(thread.id)), /failures|promptExcerpt|responseSteps/);

  await service.runTurn({ threadId: thread.id, text: 'working prompt' });
  assert.deepEqual(providerMessages[1], [{ role: 'user', text: 'working prompt' }]);
  assert.deepEqual(store.get(thread.id).messages.map(message => message.text), ['working prompt', 'Recovered answer']);
});

test('request-time cancellation is not recorded as a failure', async t => {
  const store = temporaryStore(t);
  const service = new AgentService({
    threadStore: store,
    authService: { async inferenceConfig() { return { accessToken: 'token', model: 'model' }; } },
    wikiTools: { definitions() { return []; } },
    instructions: 'snapshot',
    providerFactory: () => ({
      async runTurn() { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); },
    }),
  });
  const thread = service.createThread('Cancelled in flight');
  await assert.rejects(
    service.runTurn({ threadId: thread.id, text: 'stop now' }),
    error => error instanceof AgentServiceError && error.code === 'aborted'
  );
  assert.equal(store.get(thread.id).messages.length, 0);
  assert.equal(store.get(thread.id).failures.length, 0);
});

test('agent cancellation is request-scoped and does not request OAuth configuration', async t => {
  const store = temporaryStore(t);
  let called = false;
  const service = new AgentService({
    threadStore: store,
    authService: { async inferenceConfig() { called = true; return {}; } },
    wikiTools: { definitions() { return []; } },
    instructions: 'snapshot',
  });
  const thread = service.createThread('Cancelled');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    service.runTurn({ threadId: thread.id, text: 'stop', signal: controller.signal }),
    error => error instanceof AgentServiceError && error.code === 'aborted'
  );
  assert.equal(called, false);
  assert.equal(store.get(thread.id).messages.length, 0);
  assert.equal(store.get(thread.id).failures.length, 0);
});

test('invalid empty submissions are rejected without a diagnostic record', async t => {
  const store = temporaryStore(t);
  const service = new AgentService({
    threadStore: store,
    authService: { async inferenceConfig() { throw new Error('must not be called'); } },
    wikiTools: { definitions() { return []; } },
    instructions: 'snapshot',
  });
  const thread = service.createThread('Empty');
  await assert.rejects(
    service.runTurn({ threadId: thread.id, text: '   ' }),
    error => error instanceof AgentServiceError && error.code === 'invalid-message'
  );
  assert.equal(store.get(thread.id).failures.length, 0);
});

test('ChatGPT replays reasoning and namespaced calls through a reasoning-only response to the final message', async () => {
  const requests = [];
  const options = [];
  let call = 0;
  const adapter = createChatGPTAdapter({
    client: {
      responses: {
        async create(request, option) {
          requests.push(structuredClone(request));
          options.push(option);
          call += 1;
          if (call === 1) {
            return asyncEvents([
              {
                type: 'response.output_item.done',
                output_index: 0,
                item: { type: 'reasoning', id: 'reasoning-1', encrypted_content: 'encrypted-one', summary: [], created_by: 'server' },
              },
              {
                type: 'response.output_item.done',
                output_index: 1,
                item: {
                  type: 'function_call',
                  id: 'function-1',
                  call_id: 'call-1',
                  namespace: 'pulsarwiki',
                  name: 'search_wiki',
                  arguments: '{"query":"timing"}',
                  caller: { type: 'direct' },
                  created_by: 'server',
                },
              },
              { type: 'response.completed', response: { id: 'must-not-be-reused', output: [] } },
            ]);
          }
          if (call === 2) {
            return asyncEvents([
              {
                type: 'response.output_item.done',
                output_index: 0,
                item: { type: 'reasoning', id: 'reasoning-2', encrypted_content: 'encrypted-two', summary: [], created_by: 'server' },
              },
              { type: 'response.completed', response: { output: [] } },
            ]);
          }
          return asyncEvents([
            { type: 'response.output_text.delta', delta: 'Subscription answer' },
            {
              type: 'response.output_item.done',
              output_index: 0,
              item: assistantMessage([{ type: 'output_text', text: 'terminal fallback', annotations: [] }]),
            },
            { type: 'response.completed', response: {
              output: [],
              output_text: 'response fallback',
            } },
          ]);
        },
      },
    },
  });
  const controller = new AbortController();
  const toolEvents = [];
  const result = await adapter.runTurn({
    model: 'subscription-model',
    instructions: 'instruction snapshot',
    messages: [
      { role: 'user', text: 'Earlier question' },
      { role: 'assistant', text: 'Earlier answer' },
      { role: 'user', text: 'Find the source.' },
    ],
    tools: [{ name: 'search_wiki', description: 'search', inputSchema: { type: 'object' } }],
    executeTool: async (name, args) => ({ name, args, found: true }),
    onTool: event => toolEvents.push(event),
    signal: controller.signal,
  });

  assert.equal(result.text, 'Subscription answer');
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.store, false);
    assert.equal(request.stream, true);
    assert.equal(Object.hasOwn(request, 'previous_response_id'), false);
  }
  assert.deepEqual(requests[0].input.map(item => item.content), ['Earlier question', 'Earlier answer', 'Find the source.']);
  assert.deepEqual(requests[0].tools, [{
    type: 'namespace',
    name: 'pulsarwiki',
    description: 'Bounded local tools for reading and updating the PulsarWiki knowledge base.',
    tools: [{ type: 'function', name: 'search_wiki', description: 'search', parameters: { type: 'object' }, strict: false }],
  }]);
  const replayedReasoning = requests[1].input.find(item => item.id === 'reasoning-1');
  assert.equal(replayedReasoning.encrypted_content, 'encrypted-one');
  assert.equal(Object.hasOwn(replayedReasoning, 'created_by'), false);
  const replayedCall = requests[1].input.find(item => item.type === 'function_call');
  assert.equal(Object.hasOwn(replayedCall, 'created_by'), false);
  const toolResult = requests[1].input.at(-1);
  assert.equal(toolResult.type, 'function_call_output');
  assert.equal(toolResult.call_id, 'call-1');
  assert.equal(toolResult.name, 'search_wiki');
  assert.equal(toolResult.namespace, 'pulsarwiki');
  assert.deepEqual(toolResult.caller, { type: 'direct' });
  const secondReasoning = requests[2].input.find(item => item.id === 'reasoning-2');
  assert.equal(secondReasoning.encrypted_content, 'encrypted-two');
  assert.equal(Object.hasOwn(secondReasoning, 'created_by'), false);
  assert.equal(options[0].signal, controller.signal);
  assert.deepEqual(toolEvents.map(event => event.phase), ['started', 'completed']);
});

test('final assistant text uses deltas, output_text, message content, then refusal content', async t => {
  const cases = [
    {
      name: 'streamed delta',
      events: [
        { type: 'response.output_text.delta', delta: 'from delta' },
        { type: 'response.completed', response: {
          output_text: 'from output_text',
          output: [assistantMessage([{ type: 'output_text', text: 'from message', annotations: [] }])],
        } },
      ],
      expected: 'from delta',
    },
    {
      name: 'terminal output_text',
      events: [{ type: 'response.completed', response: {
        output_text: 'from output_text',
        output: [assistantMessage([{ type: 'output_text', text: 'from message', annotations: [] }])],
      } }],
      expected: 'from output_text',
    },
    {
      name: 'message content',
      events: [{ type: 'response.completed', response: {
        output: [assistantMessage([{ type: 'output_text', text: 'from message', annotations: [] }])],
      } }],
      expected: 'from message',
    },
    {
      name: 'refusal content',
      events: [{ type: 'response.completed', response: {
        output: [assistantMessage([{ type: 'refusal', refusal: 'safe refusal' }])],
      } }],
      expected: 'safe refusal',
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const adapter = createChatGPTAdapter({
        client: { responses: { async create() { return asyncEvents(scenario.events); } } },
      });
      const result = await adapter.runTurn({
        model: 'model', instructions: '', messages: [], tools: [], executeTool() {},
      });
      assert.equal(result.text, scenario.expected);
    });
  }
});

test('empty final messages, incomplete responses, cancellation, and the response step bound are safe failures', async t => {
  await t.test('empty final message', async () => {
    const adapter = createChatGPTAdapter({
      client: { responses: { async create() {
        return asyncEvents([{ type: 'response.completed', response: { output: [assistantMessage([])] } }]);
      } } },
    });
    await assert.rejects(
      adapter.runTurn({ model: 'model', instructions: '', messages: [], tools: [], executeTool() {} }),
      error => error instanceof ProviderError
        && error.code === 'empty-response'
        && error.diagnostics.responseSteps === 1
    );
  });

  await t.test('incomplete response', async () => {
    const adapter = createChatGPTAdapter({
      client: { responses: { async create() {
        return asyncEvents([{ type: 'response.incomplete', response: {} }]);
      } } },
    });
    await assert.rejects(
      adapter.runTurn({ model: 'model', instructions: '', messages: [], tools: [], executeTool() {} }),
      error => error instanceof ProviderError && error.code === 'incomplete-response'
    );
  });

  await t.test('cancellation', async () => {
    const adapter = createChatGPTAdapter({
      client: { responses: { async create() {
        throw Object.assign(new Error('secret abort detail'), { name: 'AbortError' });
      } } },
    });
    await assert.rejects(
      adapter.runTurn({ model: 'model', instructions: '', messages: [], tools: [], executeTool() {} }),
      error => error instanceof ProviderError && error.code === 'aborted' && !error.message.includes('secret')
    );
  });

  await t.test('sixteen response steps', async () => {
    let requests = 0;
    const adapter = createChatGPTAdapter({
      client: { responses: { async create() {
        requests += 1;
        return asyncEvents([{ type: 'response.completed', response: {
          output: [{ type: 'reasoning', id: `reasoning-${requests}`, encrypted_content: 'opaque', summary: [] }],
        } }]);
      } } },
    });
    await assert.rejects(
      adapter.runTurn({ model: 'model', instructions: '', messages: [], tools: [], executeTool() {} }),
      error => error instanceof ProviderError
        && error.code === 'response-step-limit'
        && error.diagnostics.responseSteps === MAX_RESPONSE_STEPS
    );
    assert.equal(requests, MAX_RESPONSE_STEPS);
  });
});

test('namespace construction omits an empty namespace', () => {
  assert.deepEqual(toOpenAITools([]), []);
});

test('subscription response failures and cancellation map to safe errors', async () => {
  const limited = createChatGPTAdapter({
    client: { responses: { async create() {
      return asyncEvents([{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'secret detail' } } }]);
    } } },
  });
  await assert.rejects(
    limited.runTurn({ model: 'model', instructions: '', messages: [], tools: [], executeTool() {} }),
    error => error instanceof ProviderError
      && error.code === 'subscription-limit-reached'
      && !error.message.includes('secret detail')
  );

  const unknown = createChatGPTAdapter({
    client: { responses: { async create() {
      return asyncEvents([{ type: 'response.failed', response: { error: { code: 'remote_internal_detail', message: 'secret detail' } } }]);
    } } },
  });
  await assert.rejects(
    unknown.runTurn({ model: 'model', instructions: '', messages: [], tools: [], executeTool() {} }),
    error => error instanceof ProviderError
      && error.code === 'provider-error'
      && !error.message.includes('secret detail')
      && !error.message.includes('remote_internal_detail')
  );

  const stopped = providerFailure(Object.assign(new Error('raw error'), { name: 'AbortError' }));
  assert.equal(stopped.code, 'aborted');
  assert.equal(stopped.message, 'The chat request was stopped.');
  const invalid = providerFailure({ status: 401, message: 'raw provider response' });
  assert.equal(invalid.code, 'reauthorization-required');
  assert.doesNotMatch(invalid.message, /raw provider response/);
});
