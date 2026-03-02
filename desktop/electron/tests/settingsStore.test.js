const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { SettingsStore } = require('../services/settingsStore');

class FakeSecretStore {
  constructor({ available = true, token = null, throwOnGet = false, throwOnSet = false, throwOnDelete = false } = {}) {
    this.available = available;
    this.token = token;
    this.throwOnGet = throwOnGet;
    this.throwOnSet = throwOnSet;
    this.throwOnDelete = throwOnDelete;
  }

  isAvailable() {
    return this.available;
  }

  async getToken() {
    if (this.throwOnGet) {
      throw new Error('secure_get_failed');
    }
    return this.token;
  }

  async setToken(token) {
    if (this.throwOnSet) {
      throw new Error('secure_set_failed');
    }
    if (!this.available) {
      return false;
    }

    this.token = token;
    return true;
  }

  async deleteToken() {
    if (this.throwOnDelete) {
      throw new Error('secure_delete_failed');
    }
    if (!this.available) {
      return false;
    }

    this.token = null;
    return true;
  }
}

async function setupTempStore({ fileContent, secretStore } = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-store-test-'));
  const app = {
    getPath() {
      return tmpDir;
    },
  };

  if (fileContent) {
    await fs.writeFile(path.join(tmpDir, 'openclaw-settings.json'), JSON.stringify(fileContent), 'utf-8');
  }

  const store = new SettingsStore(app, secretStore);
  await store.init();

  return {
    store,
    tmpDir,
  };
}

test('migrates legacy token from settings file into secret store', async () => {
  const secretStore = new FakeSecretStore({ available: true, token: null });
  const { store, tmpDir } = await setupTempStore({
    fileContent: {
      baseUrl: 'http://127.0.0.1:18789',
      agentId: 'main',
      token: 'legacy-token',
    },
    secretStore,
  });

  const publicSettings = store.getPublic();
  assert.equal(publicSettings.hasToken, true);
  assert.equal(publicSettings.hasSecureStorage, true);

  const fileRaw = await fs.readFile(path.join(tmpDir, 'openclaw-settings.json'), 'utf-8');
  const persisted = JSON.parse(fileRaw);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'token'), false);

  assert.equal(store.getForMain().token, 'legacy-token');
  assert.equal(secretStore.token, 'legacy-token');
});

test('falls back to plain token when secure storage is unavailable', async () => {
  const secretStore = new FakeSecretStore({ available: false, token: null });
  const { store, tmpDir } = await setupTempStore({
    secretStore,
  });

  await store.save({ token: 'plain-token' });

  const publicSettings = store.getPublic();
  assert.equal(publicSettings.hasToken, true);
  assert.equal(publicSettings.hasSecureStorage, false);

  const fileRaw = await fs.readFile(path.join(tmpDir, 'openclaw-settings.json'), 'utf-8');
  const persisted = JSON.parse(fileRaw);
  assert.equal(persisted.token, 'plain-token');
});

test('preserves stored token when save payload does not include token', async () => {
  const secretStore = new FakeSecretStore({ available: true, token: 'saved-token' });
  const { store } = await setupTempStore({
    fileContent: {
      baseUrl: 'http://127.0.0.1:18789',
      agentId: 'main',
    },
    secretStore,
  });

  await store.save({ baseUrl: 'http://localhost:3001', agentId: 'agent-x' });

  assert.equal(store.getForMain().token, 'saved-token');
  assert.equal(store.getForMain().baseUrl, 'http://localhost:3001');
  assert.equal(store.getForMain().agentId, 'agent-x');
});

test('clears stored token explicitly', async () => {
  const secretStore = new FakeSecretStore({ available: true, token: 'saved-token' });
  const { store } = await setupTempStore({ secretStore });

  await store.save({ clearToken: true });

  assert.equal(store.getPublic().hasToken, false);
  assert.equal(store.getForMain().token, '');
  assert.equal(secretStore.token, null);
});

test('falls back when secure storage throws at runtime', async () => {
  const secretStore = new FakeSecretStore({
    available: true,
    token: null,
    throwOnGet: true,
    throwOnSet: true,
  });
  const { store, tmpDir } = await setupTempStore({ secretStore });

  await store.save({ token: 'fallback-token' });

  assert.equal(store.getPublic().hasSecureStorage, false);
  assert.equal(store.getForMain().token, 'fallback-token');

  const fileRaw = await fs.readFile(path.join(tmpDir, 'openclaw-settings.json'), 'utf-8');
  const persisted = JSON.parse(fileRaw);
  assert.equal(persisted.token, 'fallback-token');
});
