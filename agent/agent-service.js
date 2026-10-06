'use strict';

const crypto = require('node:crypto');
const { ChatGPTAuthError } = require('./chatgpt-auth');
const { ProviderError, createChatGPTAdapter } = require('./providers');

class AgentServiceError extends Error {
  constructor(message, code = 'agent-error') {
    super(message);
    this.name = 'AgentServiceError';
    this.code = code;
  }
}

function instructionVersion(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function safeRunError(error, signal) {
  if (signal?.aborted || error?.code === 'aborted' || error?.name === 'AbortError') {
    return new AgentServiceError('The chat request was stopped.', 'aborted');
  }
  if (error instanceof AgentServiceError || error instanceof ProviderError) return error;
  if (error instanceof ChatGPTAuthError) return new AgentServiceError(error.message, error.code);
  return new AgentServiceError('PulsarWiki could not complete this chat request.', 'agent-error');
}

const LOCAL_TOOL_GUIDANCE = `

## Local wiki tool protocol

Use the exact JSON fields in each tool schema. In particular, use \`name\` for \`read_wiki_page\` and \`query\` for \`search_wiki\`. Page names are lowercase and hyphenated, without a directory path. A \`read_wiki_page\` result with \`exists: false\` is an expected absence check, not a reason to stop. To create or edit a normal wiki page, use \`apply_wiki_changes\` with the page and the updated \`index\`; it appends the log automatically. Never claim that a page was created unless that tool returned successfully.`;

class AgentService {
  constructor({ threadStore, authService, wikiTools, instructions, providerFactory = createChatGPTAdapter } = {}) {
    this.threadStore = threadStore;
    this.authService = authService;
    this.wikiTools = wikiTools;
    this.instructions = instructions || '';
    this.instructionsVersion = instructionVersion(this.instructions);
    this.providerFactory = providerFactory;
  }

  listThreads() {
    return this.threadStore.list();
  }

  getThread(id) {
    const thread = this.threadStore.get(id);
    return { ...thread, summary: undefined, toolEvents: undefined, failures: undefined, instructionSnapshot: undefined };
  }

  createThread(title) {
    return this.threadStore.create({
      title,
      instructionVersion: this.instructionsVersion,
      instructionSnapshot: this.instructions,
    });
  }

  renameThread(id, title) {
    return this.threadStore.rename(id, title);
  }

  deleteThread(id) {
    this.threadStore.delete(id);
  }

  async runTurn({ threadId, text, onDelta, onTool, signal }) {
    if (typeof text !== 'string' || !text.trim()) throw new AgentServiceError('A chat message is required.', 'invalid-message');
    if (signal?.aborted) throw new AgentServiceError('The chat request was stopped.', 'aborted');

    const thread = this.threadStore.get(threadId);
    const userText = text.trim();
    const instructions = `${thread.instructionSnapshot || this.instructions}${LOCAL_TOOL_GUIDANCE}`;
    const toolEvents = [];
    let connection = null;
    try {
      connection = await this.authService.inferenceConfig();
      const adapter = this.providerFactory({ accessToken: connection.accessToken });
      const result = await adapter.runTurn({
        model: connection.model,
        instructions,
        messages: [...this.threadStore.context(threadId), { role: 'user', text: userText }],
        tools: this.wikiTools.definitions(),
        signal,
        onDelta,
        onTool: event => {
          const publicEvent = { name: event.name, status: event.status || event.phase || 'running' };
          if (publicEvent.status === 'failed' && typeof event.error === 'string') publicEvent.detail = event.error;
          toolEvents.push(publicEvent);
          onTool?.(publicEvent);
        },
        executeTool: (name, args) => this.wikiTools.execute(name, args),
      });
      if (signal?.aborted) throw new AgentServiceError('The chat request was stopped.', 'aborted');
      if (!result?.text?.trim()) {
        throw new AgentServiceError('ChatGPT completed without a usable message. Please try again.', 'empty-response');
      }
      return this.threadStore.append(threadId, [
        { role: 'user', text: userText },
        { role: 'assistant', text: result.text },
      ], {
        provider: 'chatgpt',
        model: connection.model,
        toolEvents,
      });
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'reauthorization-required') this.authService.invalidateSession?.();
      const publicError = safeRunError(error, signal);
      if (publicError.code !== 'aborted') {
        try {
          this.threadStore.recordFailure(threadId, {
            code: publicError.code,
            message: publicError.message,
            provider: 'chatgpt',
            model: connection?.model || thread.model || null,
            prompt: userText,
            responseSteps: error?.diagnostics?.responseSteps,
            outputTypes: error?.diagnostics?.outputTypes,
            tools: toolEvents,
          });
        } catch { /* Preserve the original chat failure if local diagnostics cannot be written. */ }
      }
      throw publicError;
    }
  }
}

module.exports = { AgentService, AgentServiceError, instructionVersion, safeRunError };
