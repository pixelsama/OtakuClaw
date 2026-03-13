const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUNDLED_ACCOUNT_NAME,
  DASHSCOPE_ACCOUNT_NAME,
  KeytarSecretStore,
  NANOBOT_ACCOUNT_NAME,
  OPENCLAW_ACCOUNT_NAME,
} = require('../services/secretStore');

const SERVICE_NAME = 'otakuclaw-desktop';

function createMockKeytar(initialEntries = {}) {
  const storage = new Map();
  const getCalls = [];
  const setCalls = [];
  const deleteCalls = [];
  const findCalls = [];

  Object.entries(initialEntries).forEach(([account, password]) => {
    storage.set(`${SERVICE_NAME}:${account}`, password);
  });

  return {
    getCalls,
    setCalls,
    deleteCalls,
    findCalls,
    getPassword: async (service, account) => {
      getCalls.push([service, account]);
      return storage.get(`${service}:${account}`) || null;
    },
    setPassword: async (service, account, value) => {
      setCalls.push([service, account, value]);
      storage.set(`${service}:${account}`, value);
      return true;
    },
    deletePassword: async (service, account) => {
      deleteCalls.push([service, account]);
      storage.delete(`${service}:${account}`);
      return true;
    },
    findCredentials: async (service) => {
      findCalls.push(service);
      const prefix = `${service}:`;
      return [...storage.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({
          account: key.slice(prefix.length),
          password: value,
        }));
    },
  };
}

function createSecretStoreWithMockKeytar(mockKeytar) {
  const store = new KeytarSecretStore();
  store.loadKeytar = () => mockKeytar;
  return store;
}

test('stores multiple secrets inside a single bundled keychain account', async () => {
  const keytar = createMockKeytar();
  const store = createSecretStoreWithMockKeytar(keytar);

  const stored = await store.updateSecrets({
    set: {
      [OPENCLAW_ACCOUNT_NAME]: 'openclaw-token',
      [NANOBOT_ACCOUNT_NAME]: 'nanobot-api-key',
      [DASHSCOPE_ACCOUNT_NAME]: 'dashscope-api-key',
    },
  });

  assert.equal(stored, true);
  assert.equal(keytar.setCalls.length, 1);
  assert.equal(keytar.setCalls[0][1], BUNDLED_ACCOUNT_NAME);

  const bundledPayload = JSON.parse(keytar.setCalls[0][2]);
  assert.equal(bundledPayload[OPENCLAW_ACCOUNT_NAME], 'openclaw-token');
  assert.equal(bundledPayload[NANOBOT_ACCOUNT_NAME], 'nanobot-api-key');
  assert.equal(bundledPayload[DASHSCOPE_ACCOUNT_NAME], 'dashscope-api-key');

  const loaded = await store.getSecrets([OPENCLAW_ACCOUNT_NAME, NANOBOT_ACCOUNT_NAME, DASHSCOPE_ACCOUNT_NAME]);
  assert.equal(loaded[OPENCLAW_ACCOUNT_NAME], 'openclaw-token');
  assert.equal(loaded[NANOBOT_ACCOUNT_NAME], 'nanobot-api-key');
  assert.equal(loaded[DASHSCOPE_ACCOUNT_NAME], 'dashscope-api-key');
});

test('does not read legacy per-account entries when bundle entry is missing', async () => {
  const keytar = createMockKeytar({
    [OPENCLAW_ACCOUNT_NAME]: 'legacy-openclaw-token',
    [NANOBOT_ACCOUNT_NAME]: 'legacy-nanobot-key',
  });
  const store = createSecretStoreWithMockKeytar(keytar);

  const firstRead = await store.getSecrets([OPENCLAW_ACCOUNT_NAME, NANOBOT_ACCOUNT_NAME]);
  assert.equal(firstRead[OPENCLAW_ACCOUNT_NAME], null);
  assert.equal(firstRead[NANOBOT_ACCOUNT_NAME], null);
  assert.equal(keytar.findCalls.length, 0);
  assert.equal(keytar.setCalls.length, 0);
});

test('does not fall back to legacy entries after bundled account exists', async () => {
  const keytar = createMockKeytar({
    [OPENCLAW_ACCOUNT_NAME]: 'legacy-openclaw-token',
  });
  const store = createSecretStoreWithMockKeytar(keytar);

  await store.setSecret(OPENCLAW_ACCOUNT_NAME, 'new-openclaw-token');
  await store.deleteSecret(OPENCLAW_ACCOUNT_NAME);

  const token = await store.getSecret(OPENCLAW_ACCOUNT_NAME);
  assert.equal(token, null);
  assert.equal(keytar.findCalls.length, 0);
});
