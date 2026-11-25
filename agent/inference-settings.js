'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { defaultCredentialPath } = require('./chatgpt-auth');
const { createChatGPTAdapter, ProviderError } = require('./providers');
const { ANTIGRAVITY_MODEL, createAntigravityAdapter } = require('./antigravity');

function inferenceAdapter(connection, chatgptFactory = createChatGPTAdapter) {
  if (connection.provider === 'antigravity') return createAntigravityAdapter({ apiKey: connection.apiKey });
  return chatgptFactory({ accessToken: connection.accessToken });
}

class InferenceSettings {
  constructor({ chatgptAuth, file = path.join(path.dirname(defaultCredentialPath()), 'ai-settings.json'), antigravityFactory = createAntigravityAdapter }) {
    Object.assign(this, { chatgptAuth, file, antigravityFactory });
    try { this.saved = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.saved = { provider: 'chatgpt', apiKey: '' };
    }
  }

  status() {
    return { provider: this.saved.provider, antigravityConfigured: Boolean(this.saved.apiKey), antigravityModel: ANTIGRAVITY_MODEL };
  }

  async readiness() {
    return this.saved.provider === 'antigravity' ? { ready: Boolean(this.saved.apiKey) } : this.chatgptAuth.status();
  }

  async inferenceConfig() {
    if (this.saved.provider !== 'antigravity') return this.chatgptAuth.inferenceConfig();
    if (!this.saved.apiKey) throw new ProviderError('Add a Gemini API key in Settings to use Google Antigravity.', 'antigravity-key-required');
    return { provider: 'antigravity', model: ANTIGRAVITY_MODEL, apiKey: this.saved.apiKey };
  }

  invalidateSession() {
    this.chatgptAuth.invalidateSession();
  }

  persist(settings) {
    const temporary = `${this.file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, JSON.stringify(settings), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    this.saved = settings;
    return this.status();
  }

  async save({ provider, apiKey } = {}) {
    if (provider !== 'chatgpt' && provider !== 'antigravity') throw new TypeError('Choose an AI provider.');
    const current = this.saved;
    let key = current.apiKey;
    if (provider === 'antigravity') {
      if (apiKey !== undefined) {
        if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(apiKey.trim())) throw new TypeError('Enter a Gemini API key without spaces.');
        key = apiKey.trim();
        await this.antigravityFactory({ apiKey: key }).runTurn({
          model: ANTIGRAVITY_MODEL,
          instructions: 'Reply with OK.',
          messages: [{ role: 'user', text: 'Connection check' }],
          tools: [],
          signal: AbortSignal.timeout(45000),
        });
        if (current !== this.saved) throw new TypeError('AI settings changed during the connection check. Try saving again.');
      }
      if (!key) throw new TypeError('Enter a Gemini API key to use Google Antigravity.');
    }
    return this.persist({ provider, apiKey: key });
  }

  removeKey() {
    return this.persist({ provider: 'chatgpt', apiKey: '' });
  }
}

module.exports = { InferenceSettings, inferenceAdapter };
