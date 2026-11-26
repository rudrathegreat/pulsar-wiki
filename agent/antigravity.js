'use strict';

const { Readable } = require('node:stream');
const { createInterface } = require('node:readline');
const { MAX_RESPONSE_STEPS, ProviderError, callTool } = require('./providers');

const ANTIGRAVITY_AGENT = 'antigravity-preview-09-2026';
const ANTIGRAVITY_MODEL = 'gemini-4-hydrogen';
const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

function antigravityInput(messages) {
  const steps = messages.map(message => ({
    type: message.role === 'assistant' ? 'model_output' : 'user_input',
    content: Array.isArray(message.content) ? message.content.map(part => {
      if (part.type === 'input_text') return { type: 'text', text: part.text };
      const image = part.type === 'input_image' && /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i.exec(part.image_url);
      if (!image) throw new ProviderError('Google Antigravity requires an inline PNG, JPEG or WebP image.', 'unsupported-capability');
      return { type: 'image', mime_type: image[1], data: image[2] };
    }) : [{ type: 'text', text: message.content || message.text }],
  }));
  return steps.length === 1 && steps[0].type === 'user_input' ? steps[0].content : steps;
}

async function* streamEvents(body) {
  const source = Readable.fromWeb(body);
  const lines = createInterface({ input: source, crlfDelay: Infinity });
  let data = [];
  try {
    for await (const line of lines) {
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      if (line !== '' || !data.length) continue;
      const payload = data.join('\n');
      data = [];
      if (payload === '[DONE]') return;
      yield JSON.parse(payload);
    }
    if (data.length && data[0] !== '[DONE]') yield JSON.parse(data.join('\n'));
  } finally {
    lines.close();
    source.destroy();
  }
}

async function readInteraction(response, onDelta) {
  const calls = new Map();
  const executed = new Set();
  let interaction;
  let environmentId;
  let text = '';
  for await (const event of streamEvents(response.body)) {
    const { event_type: type, index, step, delta } = event;
    environmentId = event.interaction?.environment_id || environmentId;
    if (type === 'step.start' && step?.type === 'function_call') calls.set(index, { ...step, json: '' });
    if (type === 'step.start' && step?.type === 'function_result') executed.add(step.call_id);
    if (type === 'step.delta' && delta?.type === 'arguments_delta' && calls.has(index)) calls.get(index).json += delta.arguments;
    if (type === 'step.delta' && delta?.type === 'text') {
      text += delta.text;
      onDelta?.(delta.text);
    }
    if (type === 'error') throw requestFailure(event.error);
    if (type === 'interaction.completed') interaction = event.interaction;
  }
  return { interaction, environmentId, text, calls: [...calls.values()].filter(call => !executed.has(call.id)) };
}

function requestFailure(error, status) {
  const code = error?.code;
  const reasons = Array.isArray(error?.details) ? error.details : [];
  if (status === 401 || code === 'authentication' || reasons.some(detail => detail?.reason === 'API_KEY_INVALID')) {
    return new ProviderError('Google rejected the Gemini API key. Replace it in Settings.', 'antigravity-key-invalid');
  }
  if (status === 402 || code === 'payment_required') {
    return new ProviderError('The Gemini API project is out of prepaid credits. Check billing in Google AI Studio.', 'antigravity-payment-required');
  }
  if (status === 403 || status === 404 || code === 'permission_denied' || code === 'not_found' || code === 'model_not_found') {
    return new ProviderError('This Gemini API project cannot access Google Antigravity. Check the key and project access in Google AI Studio.', 'antigravity-access-denied');
  }
  if (status === 429 || ['rate_limit_exceeded', 'quota_exceeded', 'too_many_requests'].includes(code)) {
    return new ProviderError('The Google Antigravity quota was reached. Check your Gemini API project usage in Google AI Studio.', 'antigravity-quota');
  }
  if (code === 'failed_precondition' || error?.status === 'FAILED_PRECONDITION') {
    return new ProviderError('The Gemini API project did not meet a requirement for this request. Check project verification and billing in Google AI Studio.', 'antigravity-project-requirement');
  }
  if (status === 400 || code === 'invalid_request' || code === 'parameter_unknown') {
    return new ProviderError('Google rejected the Antigravity request as invalid.', 'antigravity-request-invalid');
  }
  if (status === 503 || code === 'service_unavailable') {
    return new ProviderError('Google Antigravity is temporarily unavailable. Try again shortly.', 'antigravity-unavailable');
  }
  const statusLabel = status === undefined ? '' : ` (HTTP ${status})`;
  return new ProviderError(`Google Antigravity could not complete this request${statusLabel}. Please try again.`);
}

function createAntigravityAdapter({ apiKey, fetchImpl = globalThis.fetch }) {
  return {
    async runTurn({ model = ANTIGRAVITY_MODEL, instructions, messages, tools, executeTool, onDelta, onTool, signal }) {
      const declarations = tools.map(tool => ({
        type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema,
      }));
      const allowed = new Set(tools.map(tool => tool.name));
      const knownResults = new Map();
      let environment = { type: 'remote', network: 'disabled' };
      let request = {
        input: antigravityInput(messages),
      };
      try {
        for (let count = 0; count < MAX_RESPONSE_STEPS; count += 1) {
          const response = await fetchImpl(INTERACTIONS_URL, {
            method: 'POST',
            redirect: 'error',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
              agent: ANTIGRAVITY_AGENT,
              agent_config: { type: 'antigravity', model },
              system_instruction: instructions,
              tools: declarations,
              stream: true,
              store: declarations.length > 0,
              environment,
              ...request,
            }),
            signal,
          }).catch(error => {
            if (signal?.aborted) throw error;
            throw new ProviderError('PulsarWiki could not reach the Gemini API. Check the connection from the computer running PulsarWiki.', 'antigravity-connection');
          });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw requestFailure(body?.error, response.status);
          }
          const { interaction, environmentId, text, calls } = await readInteraction(response, onDelta);
          signal?.throwIfAborted();
          if (interaction?.status === 'completed') {
            if (text.trim()) return { text };
            throw new ProviderError('Google Antigravity completed without a usable message. Please try again.', 'empty-response');
          }
          if (interaction?.status !== 'requires_action' || !interaction.id || !calls.length) {
            throw new ProviderError('Google Antigravity ended the response before it completed.', 'incomplete-response');
          }
          if (count + 1 === MAX_RESPONSE_STEPS) break;
          const input = [];
          for (const call of calls) {
            signal?.throwIfAborted();
            if (!allowed.has(call.name) || !call.id) {
              throw new ProviderError('Google Antigravity requested an unavailable local tool.', 'tool-not-allowed');
            }
            if (!knownResults.has(call.id)) {
              const args = call.json ? JSON.parse(call.json) : call.arguments || {};
              const result = await callTool(executeTool, onTool, call.name, args);
              knownResults.set(call.id, { type: 'function_result', name: call.name, call_id: call.id, result });
            }
            input.push(knownResults.get(call.id));
          }
          if (environmentId) environment = environmentId;
          request = { input, previous_interaction_id: interaction.id };
        }
        throw new ProviderError('Google Antigravity did not finish within the allowed response steps.', 'response-step-limit');
      } catch (error) {
        if (signal?.aborted) throw new ProviderError('The Google Antigravity request was stopped or timed out.', 'aborted');
        if (error instanceof ProviderError) throw error;
        throw new ProviderError('Google Antigravity could not complete this request. Please try again.');
      }
    },
  };
}

module.exports = { ANTIGRAVITY_AGENT, ANTIGRAVITY_MODEL, createAntigravityAdapter };
