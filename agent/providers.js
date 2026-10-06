'use strict';

const OpenAI = require('openai');
const { toResponseInputItems } = require('openai/lib/responses/ResponseInputItems');

const MAX_RESPONSE_STEPS = 16;

class ProviderError extends Error {
  constructor(message, code = 'provider-error', diagnostics = null) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

const SUBSCRIPTION_ERRORS = new Map([
  ['subscription_sharing_user_not_eligible', ['This ChatGPT account is not eligible to use its subscription with PulsarWiki.', 'subscription-not-eligible']],
  ['subscription_sharing_usage_limit_exceeded', ['PulsarWiki reached this account\'s ChatGPT app usage limit. Review usage at https://chatgpt.com/settings/usage.', 'subscription-limit-reached']],
  ['subscription_sharing_usage_unavailable', ['ChatGPT subscription usage is temporarily unavailable. Please try again later.', 'subscription-usage-unavailable']],
  ['subscription_sharing_unsupported_capability', ['The selected ChatGPT model does not support part of this request.', 'unsupported-capability']],
  ['subscription_sharing_route_not_supported', ['ChatGPT plan usage rejected the requested API route.', 'unsupported-route']],
  ['subscription_sharing_invalid_user', ['Your ChatGPT session is no longer valid. Sign in again to continue.', 'reauthorization-required']],
  ['chatpass_v2_scope_not_authorized', ['Enable ChatGPT plan usage for PulsarWiki, then reconnect.', 'plan-permission-required']],
  ['chatpass_v2_invalid_authorization_context', ['The ChatGPT authorization does not permit this request. Reconnect your account.', 'reauthorization-required']],
  ['subscription_sharing_user_unavailable', ['ChatGPT account information is temporarily unavailable. Please try again later.', 'subscription-usage-unavailable']],
]);

function remoteErrorCode(error) {
  return error?.remoteCode || error?.error?.code || error?.response?.error?.code || error?.code || null;
}

function providerFailure(error) {
  if (error instanceof ProviderError) return error;
  const code = remoteErrorCode(error);
  if (SUBSCRIPTION_ERRORS.has(code)) {
    const [message, publicCode] = SUBSCRIPTION_ERRORS.get(code);
    return new ProviderError(message, publicCode);
  }
  const status = error?.status || error?.statusCode;
  if (status === 401) return new ProviderError('Your ChatGPT session is no longer valid. Sign in again to continue.', 'reauthorization-required');
  if (status === 403) return new ProviderError('The connected ChatGPT account is not permitted to complete this request.', 'subscription-not-eligible');
  if (status === 429) return new ProviderError('The ChatGPT usage limit was reached. Review usage at https://chatgpt.com/settings/usage.', 'subscription-limit-reached');
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return new ProviderError('The chat request was stopped.', 'aborted');
  return new ProviderError('ChatGPT could not complete this request. Please try again.', 'provider-error');
}

function parseArguments(value) {
  if (typeof value === 'object' && value !== null) return value;
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function toOpenAITools(tools) {
  if (!tools.length) return [];
  return [{
    type: 'namespace',
    name: 'pulsarwiki',
    description: 'Bounded local tools for reading and updating the PulsarWiki knowledge base.',
    tools: tools.map(tool => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false,
    })),
  }];
}

async function callTool(executeTool, onTool, name, args) {
  onTool?.({ phase: 'started', name });
  try {
    const result = await executeTool(name, args);
    onTool?.({ phase: 'completed', name });
    return result;
  } catch (error) {
    const result = { ok: false, error: error?.message || 'The requested local operation failed.' };
    onTool?.({ phase: 'failed', name, error: result.error });
    return result;
  }
}

async function openAIResponse(client, request, { onDelta, signal }) {
  const stream = await client.responses.create({ ...request, store: false, stream: true }, { signal });
  let completed = null;
  const completedItems = [];
  for await (const event of stream) {
    if (event.type === 'response.output_text.delta' && event.delta) onDelta?.(event.delta);
    if (event.type === 'response.output_item.done' && event.item) {
      if (Number.isInteger(event.output_index) && event.output_index >= 0) completedItems[event.output_index] = event.item;
      else completedItems.push(event.item);
    }
    if (event.type === 'response.completed') completed = event.response;
    if (event.type === 'response.failed') {
      const subscriptionFailure = SUBSCRIPTION_ERRORS.get(event.response?.error?.code);
      throw new ProviderError(
        subscriptionFailure?.[0] || 'ChatGPT could not complete this request. Please try again.',
        subscriptionFailure?.[1] || 'provider-error'
      );
    }
    if (event.type === 'response.incomplete') throw new ProviderError('ChatGPT ended the response before it completed.', 'incomplete-response');
  }
  if (!completed) throw new ProviderError('ChatGPT ended the response before it completed.', 'incomplete-response');
  if (!completedItems.length) return completed;
  const terminalOutput = Array.isArray(completed.output) ? completed.output : [];
  const output = [];
  const length = Math.max(completedItems.length, terminalOutput.length);
  for (let index = 0; index < length; index += 1) {
    const item = completedItems[index] || terminalOutput[index];
    if (item) output.push(item);
  }
  return { ...completed, output };
}

function messageText(message) {
  if (!message || !Array.isArray(message.content)) return { text: '', refusal: '' };
  const text = [];
  const refusals = [];
  for (const part of message.content) {
    if (part?.type === 'output_text' && typeof part.text === 'string') text.push(part.text);
    if (part?.type === 'refusal' && typeof part.refusal === 'string') refusals.push(part.refusal);
  }
  return { text: text.join(''), refusal: refusals.join('\n') };
}

function responseDiagnostics(responseSteps, outputTypes) {
  return {
    responseSteps,
    outputTypes: outputTypes.slice(-64),
  };
}

function createChatGPTAdapter({ accessToken, client } = {}) {
  const openai = client || new OpenAI({ apiKey: accessToken, baseURL: 'https://api.openai.com/v1', maxRetries: 0 });
  return {
    async runTurn({ model, instructions, messages, tools, executeTool, onDelta, onTool, signal }) {
      let input = messages.map(message => ({ role: message.role, content: message.text }));
      const outputTypes = [];
      let responseSteps = 0;
      try {
        while (responseSteps < MAX_RESPONSE_STEPS) {
          let streamedText = '';
          const response = await openAIResponse(openai, {
            model,
            instructions,
            input,
            tools: toOpenAITools(tools),
          }, {
            signal,
            onDelta: text => { streamedText += text; onDelta?.(text); },
          });
          responseSteps += 1;
          const output = Array.isArray(response.output) ? response.output : [];
          outputTypes.push(...output.map(item => typeof item?.type === 'string' ? item.type : 'unknown'));
          input.push(...toResponseInputItems(output));
          const calls = output.filter(item => item.type === 'function_call');
          for (const call of calls) {
            const result = await callTool(executeTool, onTool, call.name, parseArguments(call.arguments));
            input.push({
              type: 'function_call_output',
              call_id: call.call_id,
              output: JSON.stringify(result),
              ...(call.name ? { name: call.name } : {}),
              ...(call.namespace ? { namespace: call.namespace } : {}),
              ...(call.caller ? { caller: call.caller } : {}),
            });
          }
          if (calls.length) continue;

          const message = output.find(item => item.type === 'message');
          if (!message) continue;
          const content = messageText(message);
          const text = streamedText
            || (typeof response.output_text === 'string' ? response.output_text : '')
            || content.text
            || content.refusal;
          if (text.trim()) return { text };
          throw new ProviderError(
            'ChatGPT completed without a usable message. Please try again.',
            'empty-response',
            responseDiagnostics(responseSteps, outputTypes)
          );
        }
        throw new ProviderError(
          'ChatGPT did not finish this request within the allowed response steps.',
          'response-step-limit',
          responseDiagnostics(responseSteps, outputTypes)
        );
      } catch (error) {
        const failure = providerFailure(error);
        if (!failure.diagnostics) failure.diagnostics = responseDiagnostics(responseSteps, outputTypes);
        throw failure;
      }
    },
  };
}

module.exports = { MAX_RESPONSE_STEPS, ProviderError, createChatGPTAdapter, messageText, providerFailure, toOpenAITools };
