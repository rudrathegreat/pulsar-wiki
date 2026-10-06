'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STORE_VERSION = 1;
const AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize';
const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
const DISCOVERY_URL = 'https://auth.openai.com/.well-known/openid-configuration';
const RESOURCE = 'https://api.openai.com/v1';
const REQUIRED_PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const REQUESTED_SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const MODEL_CACHE_MS = 5 * 60 * 1000;
const REFRESH_LEEWAY_MS = 60 * 1000;

class ChatGPTAuthError extends Error {
  constructor(message, code = 'chatgpt-auth-error', details = {}) {
    super(message);
    this.name = 'ChatGPTAuthError';
    this.code = code;
    this.status = details.status;
    this.remoteCode = details.remoteCode;
  }
}

function defaultCredentialPath({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
    return path.win32.join(base, 'PulsarWiki', 'chatgpt-auth.json');
  }
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'PulsarWiki', 'chatgpt-auth.json');
  const base = env.XDG_CONFIG_HOME || path.posix.join(home, '.config');
  return path.posix.join(base, 'pulsarwiki', 'chatgpt-auth.json');
}

function stringValue(value, maxLength = 10000) {
  return typeof value === 'string' && value.length <= maxLength ? value : null;
}

function scopeList(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/\s+/);
  return [...new Set(values.filter(item => typeof item === 'string' && /^[a-z0-9.:_-]+$/i.test(item)))];
}

function normalizedRegistration(value) {
  if (!value || typeof value !== 'object') return null;
  const clientId = stringValue(value.clientId, 512);
  const subject = stringValue(value.subject, 512);
  if (!clientId || !subject) return null;
  const tokens = value.tokens && typeof value.tokens === 'object' ? {
    accessToken: stringValue(value.tokens.accessToken, 20000),
    refreshToken: stringValue(value.tokens.refreshToken, 20000),
    idToken: stringValue(value.tokens.idToken, 20000),
    tokenType: stringValue(value.tokens.tokenType, 64) || 'Bearer',
    expiresAt: Number.isFinite(value.tokens.expiresAt) ? value.tokens.expiresAt : 0,
    scopes: scopeList(value.tokens.scopes),
  } : null;
  return {
    clientId,
    subject,
    issuer: stringValue(value.issuer, 512) || 'https://auth.openai.com',
    email: stringValue(value.email, 512),
    name: stringValue(value.name, 512),
    selectedModel: stringValue(value.selectedModel, 256),
    tokens: tokens?.accessToken && tokens?.refreshToken ? tokens : null,
  };
}

function normalizedStore(value) {
  const hostId = stringValue(value?.hostId, 512);
  return {
    version: STORE_VERSION,
    hostId: hostId && /^(urn:uuid:|urn:ietf:params:oauth:jwk-thumbprint:|did:key:)/.test(hostId) ? hostId : null,
    registration: normalizedRegistration(value?.registration),
  };
}

class ChatGPTCredentialStore {
  constructor({ filePath = defaultCredentialPath(), fsModule = fs, platform = process.platform } = {}) {
    this.filePath = filePath;
    this.fs = fsModule;
    this.platform = platform;
    this.data = null;
  }

  load() {
    if (this.data) return structuredClone(this.data);
    try {
      this.data = normalizedStore(JSON.parse(this.fs.readFileSync(this.filePath, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new ChatGPTAuthError('PulsarWiki could not read the saved ChatGPT connection.', 'credential-store-error');
      }
      this.data = normalizedStore(null);
    }
    return structuredClone(this.data);
  }

  persist(next) {
    this.data = normalizedStore(next);
    const directory = path.dirname(this.filePath);
    this.fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.${path.basename(this.filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
      this.fs.writeFileSync(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      if (this.platform !== 'win32') this.fs.chmodSync(temporary, 0o600);
      this.fs.renameSync(temporary, this.filePath);
      if (this.platform !== 'win32') this.fs.chmodSync(this.filePath, 0o600);
    } catch {
      try { this.fs.unlinkSync(temporary); } catch { /* best effort */ }
      throw new ChatGPTAuthError('PulsarWiki could not securely save the ChatGPT connection.', 'credential-store-error');
    }
    return this.load();
  }

  ensureHostId() {
    const data = this.load();
    if (!data.hostId) {
      data.hostId = `urn:uuid:${crypto.randomUUID()}`;
      this.persist(data);
    }
    return data.hostId;
  }

  registration() {
    return this.load().registration;
  }

  saveRegistration(registration) {
    const data = this.load();
    data.registration = registration;
    this.persist(data);
    return this.registration();
  }

  clearTokens() {
    const data = this.load();
    if (data.registration) data.registration.tokens = null;
    this.persist(data);
  }

  forgetAccount() {
    const data = this.load();
    data.registration = null;
    this.persist(data);
  }
}

function queryValue(query, name) {
  const value = query instanceof URLSearchParams ? query.get(name) : query?.[name];
  return Array.isArray(value) ? value[0] : (typeof value === 'string' ? value : null);
}

function oauthErrorCode(payload) {
  return payload?.error?.code || payload?.error || payload?.code || null;
}

async function responsePayload(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { detail: text.slice(0, 500) }; }
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

class ChatGPTAuthService {
  constructor({
    store = new ChatGPTCredentialStore(),
    fetchImpl = globalThis.fetch,
    verifyIdToken,
    now = () => Date.now(),
    randomBytes = crypto.randomBytes,
    agentName = 'PulsarWiki',
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch is required');
    this.store = store;
    this.fetch = fetchImpl;
    this.verifyIdTokenOverride = verifyIdToken;
    this.now = now;
    this.randomBytes = randomBytes;
    this.agentName = agentName;
    this.pending = new Map();
    this.refreshPromise = null;
    this.discovery = null;
    this.remoteJwks = null;
    this.modelCache = null;
  }

  randomToken(bytes = 32) {
    return this.randomBytes(bytes).toString('base64url');
  }

  async discoveryDocument() {
    if (this.discovery) return this.discovery;
    let response;
    try { response = await this.fetch(DISCOVERY_URL, { headers: { Accept: 'application/json' } }); } catch {
      throw new ChatGPTAuthError('OpenAI sign-in is temporarily unavailable.', 'oauth-unavailable');
    }
    const payload = await responsePayload(response);
    if (!response.ok || payload.issuer !== 'https://auth.openai.com' || !payload.jwks_uri) {
      throw new ChatGPTAuthError('OpenAI sign-in returned an invalid discovery document.', 'oauth-protocol-error');
    }
    this.discovery = payload;
    return payload;
  }

  async verifyIdToken(idToken, { clientId, nonce = null, expectedSubject = null } = {}) {
    let payload;
    if (this.verifyIdTokenOverride) {
      payload = await this.verifyIdTokenOverride(idToken, { clientId, nonce, expectedSubject });
    } else {
      const discovery = await this.discoveryDocument();
      const { createRemoteJWKSet, jwtVerify } = await import('jose');
      if (!this.remoteJwks) this.remoteJwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
      const verified = await jwtVerify(idToken, this.remoteJwks, {
        issuer: discovery.issuer,
        audience: clientId,
      });
      payload = verified.payload;
    }
    if (!payload || typeof payload.sub !== 'string') {
      throw new ChatGPTAuthError('OpenAI returned an invalid identity token.', 'invalid-id-token');
    }
    if (nonce && payload.nonce !== nonce) {
      throw new ChatGPTAuthError('The ChatGPT sign-in response did not match this request.', 'invalid-nonce');
    }
    if (expectedSubject && payload.sub !== expectedSubject) {
      throw new ChatGPTAuthError('The ChatGPT account did not match the saved account.', 'account-mismatch');
    }
    return payload;
  }

  startAuthorization({ port } = {}) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ChatGPTAuthError('The local server is not ready for ChatGPT sign-in.', 'server-not-ready');
    }
    const hostId = this.store.ensureHostId();
    const registration = this.store.registration();
    const returning = Boolean(registration);
    const clientId = returning ? registration.clientId : 'dynamic_agent_client';
    const state = this.randomToken(32);
    const nonce = this.randomToken(32);
    const verifier = this.randomToken(64);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const redirectUri = `http://127.0.0.1:${port}/auth/chatgpt/callback`;

    this.pending.clear();
    this.pending.set(state, {
      clientId,
      expectedSubject: returning ? registration.subject : null,
      expiresAt: this.now() + AUTHORIZATION_TTL_MS,
      isNew: !returning,
      nonce,
      redirectUri,
      verifier,
    });

    const url = new URL(AUTHORIZE_URL);
    const parameters = {
      client_id: clientId,
      ext_agent_host_id: hostId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: REQUESTED_SCOPES,
      resource: RESOURCE,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: challenge,
    };
    if (returning) {
      if (registration.tokens?.idToken) parameters.id_token_hint = registration.tokens.idToken;
      if (registration.email) parameters.login_hint = registration.email;
    } else {
      parameters.agent_name_hint = this.agentName;
    }
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    return url.toString();
  }

  async tokenRequest(parameters) {
    let response;
    try {
      response = await this.fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(parameters),
      });
    } catch {
      throw new ChatGPTAuthError('OpenAI sign-in is temporarily unavailable.', 'oauth-unavailable');
    }
    const payload = await responsePayload(response);
    if (!response.ok) {
      throw new ChatGPTAuthError('OpenAI could not complete the sign-in request.', 'oauth-token-error', {
        status: response.status,
        remoteCode: oauthErrorCode(payload),
      });
    }
    return payload;
  }

  async handleCallback(query) {
    const state = queryValue(query, 'state');
    const pending = state ? this.pending.get(state) : null;
    if (state) this.pending.delete(state);
    if (!pending) throw new ChatGPTAuthError('This ChatGPT sign-in request is invalid or has already been used.', 'invalid-state');
    if (pending.expiresAt <= this.now()) throw new ChatGPTAuthError('This ChatGPT sign-in request expired. Please try again.', 'authorization-expired');
    if (queryValue(query, 'error')) throw new ChatGPTAuthError('ChatGPT sign-in was cancelled.', 'access-denied');

    const code = queryValue(query, 'code');
    const callbackClientId = queryValue(query, 'client_id');
    if (!code) throw new ChatGPTAuthError('OpenAI did not return an authorization code.', 'oauth-protocol-error');
    let issuedClientId = pending.clientId;
    if (pending.isNew) {
      if (!callbackClientId || callbackClientId === 'dynamic_agent_client') {
        throw new ChatGPTAuthError('OpenAI did not return the registered client identifier.', 'oauth-protocol-error');
      }
      issuedClientId = callbackClientId;
    } else if (callbackClientId && callbackClientId !== pending.clientId) {
      throw new ChatGPTAuthError('The ChatGPT sign-in response used an unexpected client.', 'client-mismatch');
    }

    const token = await this.tokenRequest({
      grant_type: 'authorization_code',
      client_id: issuedClientId,
      code,
      code_verifier: pending.verifier,
      redirect_uri: pending.redirectUri,
      resource: RESOURCE,
    });
    if (token.client_id && token.client_id !== issuedClientId) {
      throw new ChatGPTAuthError('OpenAI returned tokens for an unexpected client.', 'client-mismatch');
    }
    if (!token.id_token || !token.access_token) {
      throw new ChatGPTAuthError('OpenAI returned an incomplete token response.', 'oauth-protocol-error');
    }

    const previous = this.store.registration();
    const identity = await this.verifyIdToken(token.id_token, {
      clientId: issuedClientId,
      nonce: pending.nonce,
      expectedSubject: pending.expectedSubject,
    });
    const refreshToken = stringValue(token.refresh_token, 20000)
      || (!pending.isNew && previous?.tokens?.refreshToken)
      || null;
    if (!refreshToken) throw new ChatGPTAuthError('OpenAI did not return a renewable session.', 'oauth-protocol-error');
    const scopes = scopeList(token.scope);
    const expiresIn = Number.isFinite(Number(token.expires_in)) ? Math.max(1, Number(token.expires_in)) : 3600;
    this.store.saveRegistration({
      clientId: issuedClientId,
      subject: identity.sub,
      issuer: identity.iss || 'https://auth.openai.com',
      email: stringValue(identity.email, 512),
      name: stringValue(identity.name, 512) || stringValue(identity.preferred_username, 512),
      selectedModel: pending.isNew ? null : previous?.selectedModel || null,
      tokens: {
        accessToken: token.access_token,
        refreshToken,
        idToken: token.id_token,
        tokenType: stringValue(token.token_type, 64) || 'Bearer',
        expiresAt: this.now() + expiresIn * 1000,
        scopes,
      },
    });
    this.modelCache = null;
    if (scopes.includes(REQUIRED_PLAN_SCOPE)) {
      try { await this.listModels({ force: true }); } catch { /* status will expose a safe recovery message */ }
    }
    return this.status();
  }

  async refreshAccessToken() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const registration = this.store.registration();
      if (!registration?.tokens?.refreshToken) {
        throw new ChatGPTAuthError('Connect your ChatGPT subscription before chatting.', 'reauthorization-required');
      }
      let token;
      try {
        token = await this.tokenRequest({
          grant_type: 'refresh_token',
          client_id: registration.clientId,
          refresh_token: registration.tokens.refreshToken,
          resource: RESOURCE,
        });
      } catch (error) {
        if (error instanceof ChatGPTAuthError && [
          'invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired',
          'refresh_token_invalidated', 'refresh_token_reused',
        ].includes(error.remoteCode)) {
          this.store.clearTokens();
          this.modelCache = null;
          throw new ChatGPTAuthError('Your ChatGPT session expired. Sign in again to continue.', 'reauthorization-required');
        }
        throw error;
      }
      if (!token.access_token) throw new ChatGPTAuthError('OpenAI returned an incomplete refresh response.', 'oauth-protocol-error');
      let identity = null;
      if (token.id_token) {
        identity = await this.verifyIdToken(token.id_token, {
          clientId: registration.clientId,
          expectedSubject: registration.subject,
        });
      }
      const expiresIn = Number.isFinite(Number(token.expires_in)) ? Math.max(1, Number(token.expires_in)) : 3600;
      const scopes = token.scope ? scopeList(token.scope) : registration.tokens.scopes;
      this.store.saveRegistration({
        ...registration,
        issuer: identity?.iss || registration.issuer,
        email: stringValue(identity?.email, 512) || registration.email,
        name: stringValue(identity?.name, 512) || registration.name,
        tokens: {
          accessToken: token.access_token,
          refreshToken: stringValue(token.refresh_token, 20000) || registration.tokens.refreshToken,
          idToken: stringValue(token.id_token, 20000) || registration.tokens.idToken,
          tokenType: stringValue(token.token_type, 64) || registration.tokens.tokenType || 'Bearer',
          expiresAt: this.now() + expiresIn * 1000,
          scopes,
        },
      });
      this.modelCache = null;
      if (!scopes.includes(REQUIRED_PLAN_SCOPE)) {
        throw new ChatGPTAuthError('Enable ChatGPT plan usage for PulsarWiki before chatting.', 'plan-permission-required');
      }
      return token.access_token;
    })();
    try { return await this.refreshPromise; } finally { this.refreshPromise = null; }
  }

  async accessToken() {
    const registration = this.store.registration();
    if (!registration?.tokens) {
      throw new ChatGPTAuthError('Connect your ChatGPT subscription before chatting.', 'reauthorization-required');
    }
    if (!registration.tokens.scopes.includes(REQUIRED_PLAN_SCOPE)) {
      throw new ChatGPTAuthError('Enable ChatGPT plan usage for PulsarWiki before chatting.', 'plan-permission-required');
    }
    if (registration.tokens.expiresAt > this.now() + REFRESH_LEEWAY_MS) return registration.tokens.accessToken;
    return this.refreshAccessToken();
  }

  async listModels({ force = false } = {}) {
    const registration = this.store.registration();
    if (!registration) throw new ChatGPTAuthError('Connect your ChatGPT subscription before choosing a model.', 'reauthorization-required');
    if (!force && this.modelCache && this.modelCache.subject === registration.subject && this.modelCache.expiresAt > this.now()) {
      return this.modelCache.models.map(model => ({ ...model }));
    }
    const accessToken = await this.accessToken();
    let response;
    try {
      response = await this.fetch(`${RESOURCE}/models`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
    } catch {
      throw new ChatGPTAuthError('The ChatGPT model list is temporarily unavailable.', 'model-catalog-unavailable');
    }
    const payload = await responsePayload(response);
    if (!response.ok) {
      const remoteCode = oauthErrorCode(payload);
      if (response.status === 401 || remoteCode === 'subscription_sharing_invalid_user') {
        this.store.clearTokens();
        this.modelCache = null;
        throw new ChatGPTAuthError('Your ChatGPT session is no longer valid. Sign in again.', 'reauthorization-required');
      }
      if (['chatpass_v2_scope_not_authorized', 'chatpass_v2_invalid_authorization_context'].includes(remoteCode)) {
        throw new ChatGPTAuthError('Reconnect and allow ChatGPT plan usage for PulsarWiki.', 'plan-permission-required');
      }
      if (response.status === 403 || remoteCode === 'subscription_sharing_user_not_eligible') {
        throw new ChatGPTAuthError(
          'ChatGPT plan usage is unavailable for this account, workspace, region, or policy.',
          'subscription-not-eligible'
        );
      }
      if (response.status === 429 || remoteCode === 'subscription_sharing_usage_limit_exceeded') {
        throw new ChatGPTAuthError(
          'The ChatGPT plan or PulsarWiki usage limit has been reached. Review usage in ChatGPT settings.',
          'subscription-limit-reached'
        );
      }
      throw new ChatGPTAuthError('The ChatGPT model list is temporarily unavailable.', 'model-catalog-unavailable');
    }
    const seen = new Set();
    const models = (Array.isArray(payload.models) ? payload.models : [])
      .filter(model => {
        if (model?.visibility !== 'list' || typeof model.slug !== 'string' || !model.slug || seen.has(model.slug)) return false;
        seen.add(model.slug);
        return true;
      })
      .map(model => ({ id: model.slug, name: stringValue(model.display_name, 256) || model.slug }));
    if (!models.length) throw new ChatGPTAuthError('This ChatGPT subscription has no available models for PulsarWiki.', 'no-models-available');
    if (!models.some(model => model.id === registration.selectedModel)) {
      this.store.saveRegistration({ ...registration, selectedModel: models[0].id });
    }
    this.modelCache = { subject: registration.subject, expiresAt: this.now() + MODEL_CACHE_MS, models };
    return models.map(model => ({ ...model }));
  }

  async selectModel(model) {
    if (typeof model !== 'string' || !model.trim()) throw new ChatGPTAuthError('Choose an available ChatGPT model.', 'invalid-model');
    const models = await this.listModels({ force: true });
    const selected = models.find(candidate => candidate.id === model.trim());
    if (!selected) throw new ChatGPTAuthError('That model is not available to the connected ChatGPT subscription.', 'invalid-model');
    const registration = this.store.registration();
    this.store.saveRegistration({ ...registration, selectedModel: selected.id });
    return this.status();
  }

  async inferenceConfig() {
    const models = await this.listModels();
    const registration = this.store.registration();
    const selected = models.find(model => model.id === registration?.selectedModel) || models[0];
    const accessToken = await this.accessToken();
    return { accessToken, model: selected.id };
  }

  async status() {
    let registration = this.store.registration();
    let models = [];
    let error = null;
    if (registration?.tokens?.accessToken && registration.tokens.scopes.includes(REQUIRED_PLAN_SCOPE)) {
      try { models = await this.listModels(); } catch (failure) {
        error = {
          code: failure instanceof ChatGPTAuthError ? failure.code : 'model-catalog-unavailable',
          message: failure instanceof ChatGPTAuthError ? failure.message : 'The ChatGPT model list is temporarily unavailable.',
        };
        registration = this.store.registration();
      }
    }
    const connected = Boolean(registration?.tokens?.accessToken && registration?.tokens?.refreshToken);
    const planEnabled = Boolean(connected && registration.tokens.scopes.includes(REQUIRED_PLAN_SCOPE));
    const selectedModel = models.some(model => model.id === registration?.selectedModel) ? registration.selectedModel : null;
    return {
      connected,
      savedAccount: Boolean(registration),
      reauthorizationRequired: Boolean(registration && !connected),
      planEnabled,
      ready: Boolean(connected && planEnabled && selectedModel),
      account: registration ? { name: registration.name || null, email: registration.email || null } : null,
      models,
      selectedModel,
      error,
    };
  }

  async revoke(refreshToken, clientId) {
    const discovery = await this.discoveryDocument();
    if (!discovery.revocation_endpoint) throw new ChatGPTAuthError('OpenAI did not publish a session revocation endpoint.', 'revocation-unavailable');
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetch(discovery.revocation_endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', client_id: clientId }),
        });
        if (response.ok) return true;
        if (response.status < 500) return false;
        lastError = new Error('temporary revocation failure');
      } catch (error) {
        lastError = error;
      }
      if (attempt < 2) await sleep(100 * (attempt + 1));
    }
    if (lastError) return false;
    return false;
  }

  async disconnect() {
    const registration = this.store.registration();
    let revocationConfirmed = true;
    if (registration?.tokens?.refreshToken) {
      try { revocationConfirmed = await this.revoke(registration.tokens.refreshToken, registration.clientId); } catch { revocationConfirmed = false; }
    }
    if (registration) this.store.clearTokens();
    this.modelCache = null;
    return { ...(await this.status()), revocationConfirmed };
  }

  async forgetAccount() {
    const disconnected = await this.disconnect();
    this.store.forgetAccount();
    this.modelCache = null;
    return { ...(await this.status()), revocationConfirmed: disconnected.revocationConfirmed };
  }

  invalidateSession() {
    if (this.store.registration()) this.store.clearTokens();
    this.modelCache = null;
  }
}

module.exports = {
  ChatGPTAuthError,
  ChatGPTAuthService,
  ChatGPTCredentialStore,
  REQUIRED_PLAN_SCOPE,
  defaultCredentialPath,
  scopeList,
};
