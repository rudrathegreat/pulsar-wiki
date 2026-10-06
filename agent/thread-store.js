'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const STORE_VERSION = 1;
const KEEP_CONTEXT_MESSAGES = 16;
const MAX_SUMMARY_CHARS = 12000;
const MAX_FAILURES = 20;
const MAX_PROMPT_EXCERPT_CHARS = 500;

class ThreadStoreError extends Error {
  constructor(message, code = 'thread-store-error') {
    super(message);
    this.name = 'ThreadStoreError';
    this.code = code;
  }
}

function makeId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function plainThread(thread) {
  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    provider: thread.provider || null,
    model: thread.model || null,
    instructionVersion: thread.instructionVersion,
    messageCount: thread.messages.length,
  };
}

function titleFromText(text) {
  const collapsed = String(text || '').replace(/\s+/g, ' ').trim();
  if (!collapsed) return 'New chat';
  return collapsed.length > 72 ? `${collapsed.slice(0, 69)}…` : collapsed;
}

function buildSummary(messages) {
  const lines = messages.map(message => {
    const text = String(message.text || '').replace(/\s+/g, ' ').trim();
    const label = message.role === 'assistant' ? 'Assistant' : 'User';
    return `${label}: ${text.slice(0, 900)}`;
  });
  const joined = lines.join('\n');
  return joined.length > MAX_SUMMARY_CHARS ? joined.slice(-MAX_SUMMARY_CHARS) : joined;
}

function completedMessages(messages) {
  const completed = [];
  let pendingUser = null;
  for (const message of messages) {
    if (message?.role === 'user') {
      pendingUser = message;
    } else if (message?.role === 'assistant' && pendingUser) {
      completed.push(pendingUser, message);
      pendingUser = null;
    }
  }
  return completed;
}

function safeDiagnosticString(value, maximum, fallback = null) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximum) : fallback;
}

function safeDiagnosticToken(value, fallback) {
  const normalized = safeDiagnosticString(value, 100, fallback);
  return /^[a-z0-9._:-]+$/i.test(normalized) ? normalized : fallback;
}

class ThreadStore {
  constructor({ dataDir, fsModule = fs, makeThreadId = makeId, now = nowIso } = {}) {
    if (!dataDir) throw new Error('dataDir is required');
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'threads.json');
    this.fs = fsModule;
    this.makeThreadId = makeThreadId;
    this.now = now;
    this.data = null;
  }

  ensureLoaded() {
    if (this.data) return;
    try {
      const parsed = JSON.parse(this.fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.threads)) throw new Error('invalid store');
      for (const thread of parsed.threads) {
        if (!Array.isArray(thread.failures)) thread.failures = [];
      }
      this.data = parsed;
    } catch (error) {
      if (error.code && error.code !== 'ENOENT') throw new ThreadStoreError('Unable to read local chat history.');
      this.data = { version: STORE_VERSION, threads: [] };
    }
  }

  persist() {
    this.fs.mkdirSync(this.dataDir, { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    this.fs.writeFileSync(temporary, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    this.fs.renameSync(temporary, this.filePath);
  }

  list() {
    this.ensureLoaded();
    return this.data.threads
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(plainThread);
  }

  get(id) {
    this.ensureLoaded();
    const thread = this.data.threads.find(candidate => candidate.id === id);
    if (!thread) throw new ThreadStoreError('Chat not found.', 'thread-not-found');
    return structuredClone(thread);
  }

  create({ title = 'New chat', instructionVersion = null, instructionSnapshot = null } = {}) {
    this.ensureLoaded();
    const timestamp = this.now();
    const thread = {
      id: this.makeThreadId(),
      title: titleFromText(title),
      createdAt: timestamp,
      updatedAt: timestamp,
      instructionVersion,
      instructionSnapshot: typeof instructionSnapshot === 'string' ? instructionSnapshot : null,
      provider: null,
      model: null,
      summary: '',
      messages: [],
      toolEvents: [],
      failures: [],
    };
    this.data.threads.push(thread);
    this.persist();
    return plainThread(thread);
  }

  rename(id, title) {
    this.ensureLoaded();
    const thread = this.data.threads.find(candidate => candidate.id === id);
    if (!thread) throw new ThreadStoreError('Chat not found.', 'thread-not-found');
    if (typeof title !== 'string' || !title.trim()) throw new ThreadStoreError('A chat title is required.', 'invalid-title');
    thread.title = titleFromText(title);
    thread.updatedAt = this.now();
    this.persist();
    return plainThread(thread);
  }

  delete(id) {
    this.ensureLoaded();
    const index = this.data.threads.findIndex(candidate => candidate.id === id);
    if (index === -1) throw new ThreadStoreError('Chat not found.', 'thread-not-found');
    this.data.threads.splice(index, 1);
    this.persist();
  }

  append(id, entries, { provider = null, model = null, toolEvents = [] } = {}) {
    this.ensureLoaded();
    const thread = this.data.threads.find(candidate => candidate.id === id);
    if (!thread) throw new ThreadStoreError('Chat not found.', 'thread-not-found');
    const timestamp = this.now();
    for (const entry of entries) {
      if (!['user', 'assistant'].includes(entry.role) || typeof entry.text !== 'string') {
        throw new ThreadStoreError('Invalid chat message.', 'invalid-message');
      }
      thread.messages.push({
        id: this.makeThreadId(),
        role: entry.role,
        text: entry.text,
        createdAt: timestamp,
        provider,
        model,
      });
      if (entry.role === 'user' && thread.messages.length === 1 && thread.title === 'New chat') thread.title = titleFromText(entry.text);
    }
    if (provider) thread.provider = provider;
    if (model) thread.model = model;
    if (toolEvents.length) {
      thread.toolEvents.push(...toolEvents.map(event => ({ name: event.name, createdAt: timestamp })));
      thread.toolEvents = thread.toolEvents.slice(-100);
    }
    thread.updatedAt = timestamp;
    const olderMessages = completedMessages(thread.messages).slice(0, -KEEP_CONTEXT_MESSAGES);
    thread.summary = olderMessages.length ? buildSummary(olderMessages) : '';
    this.persist();
    return this.get(id);
  }

  recordFailure(id, {
    code,
    message,
    model = null,
    provider = 'chatgpt',
    prompt = '',
    responseSteps = 0,
    outputTypes = [],
    tools = [],
  } = {}) {
    this.ensureLoaded();
    const thread = this.data.threads.find(candidate => candidate.id === id);
    if (!thread) throw new ThreadStoreError('Chat not found.', 'thread-not-found');
    const timestamp = this.now();
    const failure = {
      timestamp,
      code: safeDiagnosticToken(code, 'agent-error'),
      message: safeDiagnosticString(message, 500, 'PulsarWiki could not complete this chat request.'),
      provider: safeDiagnosticToken(provider, 'chatgpt'),
      model: safeDiagnosticString(model, 256),
      promptExcerpt: String(prompt || '').slice(0, MAX_PROMPT_EXCERPT_CHARS),
      responseSteps: Number.isInteger(responseSteps) ? Math.max(0, Math.min(responseSteps, 100)) : 0,
      outputTypes: Array.isArray(outputTypes)
        ? outputTypes.slice(-64).map(value => safeDiagnosticToken(value, 'unknown'))
        : [],
      tools: Array.isArray(tools) ? tools.slice(-100).map(tool => ({
        name: safeDiagnosticToken(tool?.name, 'unknown'),
        status: safeDiagnosticToken(tool?.status, 'unknown'),
      })) : [],
    };
    thread.failures = [...(Array.isArray(thread.failures) ? thread.failures : []), failure].slice(-MAX_FAILURES);
    thread.updatedAt = timestamp;
    this.persist();
    return structuredClone(failure);
  }

  context(id) {
    const thread = this.get(id);
    return completedMessages(thread.messages).map(message => ({ role: message.role, text: message.text }));
  }
}

module.exports = { MAX_FAILURES, ThreadStore, ThreadStoreError, completedMessages, plainThread };
