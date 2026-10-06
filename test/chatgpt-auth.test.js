'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ChatGPTAuthError,
  ChatGPTAuthService,
  ChatGPTCredentialStore,
  REQUIRED_PLAN_SCOPE,
  defaultCredentialPath,
} = require('../agent/chatgpt-auth');

const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
const DISCOVERY_URL = 'https://auth.openai.com/.well-known/openid-configuration';
const MODELS_URL = 'https://api.openai.com/v1/models';

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); },
  };
}

function temporaryCredentialStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsarwiki-auth-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new ChatGPTCredentialStore({ filePath: path.join(directory, 'connection.json') });
}

function tokenRegistration(overrides = {}) {
  const { tokens: tokenOverrides, ...registrationOverrides } = overrides;
  return {
    clientId: 'saved-client',
    subject: 'subject-1',
    issuer: 'https://auth.openai.com',
    email: 'person@example.com',
    name: 'Pulsar Person',
    selectedModel: 'model-b',
    tokens: {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      idToken: 'id-secret',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3_600_000,
      scopes: ['openid', REQUIRED_PLAN_SCOPE],
      ...tokenOverrides,
    },
    ...registrationOverrides,
  };
}

test('credential persistence is atomic, stable, and owner-only where supported', t => {
  const store = temporaryCredentialStore(t);
  const firstHostId = store.ensureHostId();
  const second = new ChatGPTCredentialStore({ filePath: store.filePath });
  assert.match(firstHostId, /^urn:uuid:/);
  assert.equal(second.ensureHostId(), firstHostId);

  store.saveRegistration(tokenRegistration());
  const files = fs.readdirSync(path.dirname(store.filePath));
  assert.deepEqual(files, ['connection.json']);
  const reloaded = new ChatGPTCredentialStore({ filePath: store.filePath });
  assert.equal(reloaded.registration().subject, 'subject-1');
  if (process.platform !== 'win32') assert.equal(fs.statSync(store.filePath).mode & 0o777, 0o600);

  fs.writeFileSync(store.filePath, '{not-json', 'utf8');
  const corrupted = new ChatGPTCredentialStore({ filePath: store.filePath });
  assert.throws(() => corrupted.load(), error => error instanceof ChatGPTAuthError && error.code === 'credential-store-error');
});

test('OS-specific credential paths use the current user configuration directory', () => {
  assert.equal(defaultCredentialPath({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Local' }, home: 'C:\\Home' }), 'C:\\Local\\PulsarWiki\\chatgpt-auth.json');
  assert.equal(defaultCredentialPath({ platform: 'darwin', env: {}, home: '/Users/me' }), '/Users/me/Library/Application Support/PulsarWiki/chatgpt-auth.json');
  assert.equal(defaultCredentialPath({ platform: 'linux', env: { XDG_CONFIG_HOME: '/config' }, home: '/home/me' }), '/config/pulsarwiki/chatgpt-auth.json');
});

test('initial authorization uses PKCE, state, nonce, required scopes, and sanitized public state', async t => {
  const store = temporaryCredentialStore(t);
  const requests = [];
  const service = new ChatGPTAuthService({
    store,
    verifyIdToken: async (_token, verification) => ({
      sub: 'subject-1', iss: 'https://auth.openai.com', nonce: verification.nonce,
      email: 'person@example.com', name: 'Pulsar Person',
    }),
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (url === TOKEN_URL) return jsonResponse(200, {
        client_id: 'generated-client',
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        id_token: 'id-secret',
        expires_in: 3600,
        scope: `openid profile email offline_access resource.invoke ${REQUIRED_PLAN_SCOPE}`,
      });
      if (url === MODELS_URL) return jsonResponse(200, { models: [
        { slug: 'model-b', display_name: 'Model B', visibility: 'list' },
        { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
        { slug: 'model-a', display_name: 'Model A', visibility: 'list' },
      ] });
      throw new Error('unexpected URL ' + url);
    },
  });

  const authorization = new URL(service.startAuthorization({ port: 4567 }));
  assert.equal(authorization.origin, 'https://auth.openai.com');
  assert.equal(authorization.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.match(authorization.searchParams.get('ext_agent_host_id'), /^urn:uuid:/);
  assert.equal(authorization.searchParams.get('redirect_uri'), 'http://127.0.0.1:4567/auth/chatgpt/callback');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorization.searchParams.get('code_challenge'));
  assert.ok(authorization.searchParams.get('state'));
  assert.ok(authorization.searchParams.get('nonce'));
  assert.equal(authorization.searchParams.get('scope'), 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct');

  const status = await service.handleCallback({
    state: authorization.searchParams.get('state'),
    code: 'authorization-code',
    client_id: 'generated-client',
  });
  assert.equal(status.ready, true);
  assert.equal(status.selectedModel, 'model-b');
  assert.deepEqual(status.models.map(model => model.id), ['model-b', 'model-a']);
  const exchange = new URLSearchParams(requests.find(request => request.url === TOKEN_URL).options.body);
  assert.equal(exchange.get('client_id'), 'generated-client');
  assert.equal(exchange.get('grant_type'), 'authorization_code');
  assert.ok(exchange.get('code_verifier'));
  assert.equal(requests.find(request => request.url === MODELS_URL).options.headers.Authorization, 'Bearer access-secret');

  const publicJson = JSON.stringify(status);
  for (const secret of ['access-secret', 'refresh-secret', 'id-secret', 'generated-client', 'subject-1', REQUIRED_PLAN_SCOPE]) {
    assert.equal(publicJson.includes(secret), false);
  }
  await assert.rejects(
    service.handleCallback({ state: authorization.searchParams.get('state'), code: 'replay', client_id: 'generated-client' }),
    error => error.code === 'invalid-state'
  );
});

test('callback state expires after ten minutes and is single-use on declined consent', async t => {
  const store = temporaryCredentialStore(t);
  let now = 1_000;
  const service = new ChatGPTAuthService({ store, now: () => now, fetchImpl: async () => { throw new Error('must not fetch'); } });
  const expired = new URL(service.startAuthorization({ port: 4567 }));
  now += 10 * 60 * 1000 + 1;
  await assert.rejects(
    service.handleCallback({ state: expired.searchParams.get('state'), code: 'late', client_id: 'client' }),
    error => error.code === 'authorization-expired'
  );

  const declined = new URL(service.startAuthorization({ port: 4567 }));
  await assert.rejects(
    service.handleCallback({ state: declined.searchParams.get('state'), error: 'access_denied' }),
    error => error.code === 'access-denied'
  );
  await assert.rejects(
    service.handleCallback({ state: declined.searchParams.get('state'), error: 'access_denied' }),
    error => error.code === 'invalid-state'
  );
});

test('returning authorization rejects client and account mismatches', async t => {
  const store = temporaryCredentialStore(t);
  store.ensureHostId();
  store.saveRegistration(tokenRegistration());
  const tokenFetch = async url => url === TOKEN_URL
    ? jsonResponse(200, { access_token: 'new-access', refresh_token: 'new-refresh', id_token: 'new-id', expires_in: 3600, scope: REQUIRED_PLAN_SCOPE })
    : jsonResponse(200, { models: [{ slug: 'model-b', display_name: 'Model B', visibility: 'list' }] });
  const service = new ChatGPTAuthService({
    store,
    fetchImpl: tokenFetch,
    verifyIdToken: async (_token, verification) => ({ sub: 'other-subject', nonce: verification.nonce }),
  });
  let authorization = new URL(service.startAuthorization({ port: 4567 }));
  assert.equal(authorization.searchParams.get('client_id'), 'saved-client');
  await assert.rejects(
    service.handleCallback({ state: authorization.searchParams.get('state'), code: 'code', client_id: 'other-client' }),
    error => error.code === 'client-mismatch'
  );

  authorization = new URL(service.startAuthorization({ port: 4567 }));
  await assert.rejects(
    service.handleCallback({ state: authorization.searchParams.get('state'), code: 'code' }),
    error => error.code === 'account-mismatch'
  );
});

test('ID-token claims and plan permission are enforced', async t => {
  const store = temporaryCredentialStore(t);
  const service = new ChatGPTAuthService({
    store,
    verifyIdToken: async () => ({ sub: 'subject-1', nonce: 'wrong-nonce' }),
    fetchImpl: async url => {
      if (url === TOKEN_URL) return jsonResponse(200, {
        access_token: 'access', refresh_token: 'refresh', id_token: 'id', expires_in: 3600, scope: 'openid profile email',
      });
      throw new Error('model list must not be requested');
    },
  });
  let authorization = new URL(service.startAuthorization({ port: 4567 }));
  await assert.rejects(
    service.handleCallback({ state: authorization.searchParams.get('state'), code: 'code', client_id: 'generated-client' }),
    error => error.code === 'invalid-nonce'
  );

  const missingScope = new ChatGPTAuthService({
    store: temporaryCredentialStore(t),
    verifyIdToken: async (_token, verification) => ({ sub: 'subject-1', nonce: verification.nonce }),
    fetchImpl: async url => {
      if (url === TOKEN_URL) return jsonResponse(200, {
        access_token: 'access', refresh_token: 'refresh', id_token: 'id', expires_in: 3600, scope: 'openid profile email',
      });
      throw new Error('model list must not be requested');
    },
  });
  authorization = new URL(missingScope.startAuthorization({ port: 4567 }));
  const status = await missingScope.handleCallback({ state: authorization.searchParams.get('state'), code: 'code', client_id: 'generated-client' });
  assert.equal(status.connected, true);
  assert.equal(status.planEnabled, false);
  assert.equal(status.ready, false);
  await assert.rejects(missingScope.accessToken(), error => error.code === 'plan-permission-required');
});

test('refresh-token rotation is serialized and terminal invalid_grant preserves the saved account', async t => {
  const store = temporaryCredentialStore(t);
  store.ensureHostId();
  store.saveRegistration(tokenRegistration({ tokens: { expiresAt: 0 } }));
  let refreshCalls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const service = new ChatGPTAuthService({
    store,
    fetchImpl: async url => {
      assert.equal(url, TOKEN_URL);
      refreshCalls += 1;
      await pending;
      return jsonResponse(200, {
        access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, scope: `openid ${REQUIRED_PLAN_SCOPE}`,
      });
    },
  });
  const first = service.accessToken();
  const second = service.accessToken();
  release();
  assert.deepEqual(await Promise.all([first, second]), ['rotated-access', 'rotated-access']);
  assert.equal(refreshCalls, 1);
  assert.equal(store.registration().tokens.refreshToken, 'rotated-refresh');

  store.saveRegistration(tokenRegistration({ tokens: { expiresAt: 0 } }));
  const invalid = new ChatGPTAuthService({
    store,
    fetchImpl: async () => jsonResponse(400, { error: 'invalid_grant', error_description: 'do not expose' }),
  });
  await assert.rejects(invalid.accessToken(), error => error.code === 'reauthorization-required' && !error.message.includes('do not expose'));
  const status = await invalid.status();
  assert.equal(status.savedAccount, true);
  assert.equal(status.connected, false);
  assert.equal(status.reauthorizationRequired, true);
});

test('model catalog preserves order, retains selections, rejects unknown slugs, and falls back when removed', async t => {
  const store = temporaryCredentialStore(t);
  store.ensureHostId();
  store.saveRegistration(tokenRegistration({ selectedModel: null }));
  let catalog = [
    { slug: 'model-a', display_name: 'Model A', visibility: 'list' },
    { slug: 'model-b', display_name: 'Model B', visibility: 'list' },
    { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
    { slug: 'model-a', display_name: 'Duplicate', visibility: 'list' },
  ];
  const service = new ChatGPTAuthService({ store, fetchImpl: async url => {
    assert.equal(url, MODELS_URL);
    return jsonResponse(200, { models: catalog });
  } });

  assert.deepEqual((await service.listModels()).map(model => model.id), ['model-a', 'model-b']);
  assert.equal(store.registration().selectedModel, 'model-a');
  await service.selectModel('model-b');
  assert.equal(store.registration().selectedModel, 'model-b');
  await assert.rejects(service.selectModel('unknown'), error => error.code === 'invalid-model');
  catalog = [{ slug: 'model-c', display_name: 'Model C', visibility: 'list' }];
  await service.listModels({ force: true });
  assert.equal(store.registration().selectedModel, 'model-c');
});

test('model catalog maps subscription admission failures to safe recovery states', async t => {
  const cases = [
    [403, { error: { code: 'subscription_sharing_user_not_eligible' } }, 'subscription-not-eligible'],
    [429, { error: { code: 'subscription_sharing_usage_limit_exceeded' } }, 'subscription-limit-reached'],
    [403, { error: { code: 'chatpass_v2_scope_not_authorized' } }, 'plan-permission-required'],
    [503, { detail: 'private upstream diagnostic' }, 'model-catalog-unavailable'],
  ];
  for (const [status, payload, expectedCode] of cases) {
    const store = temporaryCredentialStore(t);
    store.ensureHostId();
    store.saveRegistration(tokenRegistration());
    const service = new ChatGPTAuthService({ store, fetchImpl: async () => jsonResponse(status, payload) });
    await assert.rejects(service.listModels(), error => (
      error.code === expectedCode && !error.message.includes('private upstream diagnostic')
    ));
  }
});

test('disconnect revokes tokens but retains registration; forgetting removes it', async t => {
  const store = temporaryCredentialStore(t);
  store.ensureHostId();
  store.saveRegistration(tokenRegistration());
  let revocations = 0;
  const service = new ChatGPTAuthService({ store, fetchImpl: async (url, options = {}) => {
    if (url === DISCOVERY_URL) return jsonResponse(200, {
      issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/.well-known/jwks.json', revocation_endpoint: 'https://auth.openai.com/revoke',
    });
    if (url === 'https://auth.openai.com/revoke') {
      revocations += 1;
      assert.equal(options.method, 'POST');
      return jsonResponse(200, {});
    }
    throw new Error('unexpected URL ' + url);
  } });

  const disconnected = await service.disconnect();
  assert.equal(disconnected.savedAccount, true);
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.revocationConfirmed, true);
  assert.equal(store.registration().selectedModel, 'model-b');

  store.saveRegistration(tokenRegistration());
  const forgotten = await service.forgetAccount();
  assert.equal(forgotten.savedAccount, false);
  assert.equal(store.registration(), null);
  assert.equal(revocations, 2);
});
