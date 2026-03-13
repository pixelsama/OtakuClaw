const assert = require('node:assert/strict');
const test = require('node:test');

const { registerSettingsIpc } = require('../ipc/settings');

function createIpcMainMock() {
  const handlers = new Map();

  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    async invoke(channel, payload) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`Missing handler for ${channel}`);
      }
      return handler({}, payload);
    },
  };
}

test('settings:test delegates to backend manager', async () => {
  const ipcMain = createIpcMainMock();

  const settingsStore = {
    getPublic: () => ({ baseUrl: 'http://127.0.0.1:18789', agentId: 'main', hasToken: true }),
    merge: (override = {}) => ({
      baseUrl: override.baseUrl || 'http://127.0.0.1:18789',
      agentId: override.agentId || 'main',
      token: override.token || 'token-x',
      chatBackend: override.chatBackend || 'nanobot',
    }),
    save: async (payload) => payload,
  };

  const backendManager = {
    resolveBackendName: ({ requestBackend, settings }) => requestBackend || settings.chatBackend || 'nanobot',
    testConnection: async ({ backend }) => ({ ok: true, backend }),
    mapError: (error) => ({ code: 'mapped_error', message: error.message }),
  };

  registerSettingsIpc({
    ipcMain,
    settingsStore,
    backendManager,
  });

  const result = await ipcMain.invoke('settings:test', {
    chatBackend: 'nanobot',
  });

  assert.equal(result.ok, true);
  assert.equal(result.backend, 'nanobot');
});

test('settings:test returns mapped error when backend test fails', async () => {
  const ipcMain = createIpcMainMock();

  const settingsStore = {
    getPublic: () => ({ hasToken: true }),
    merge: () => ({ chatBackend: 'nanobot' }),
    save: async (payload) => payload,
  };

  const backendManager = {
    resolveBackendName: () => 'nanobot',
    testConnection: async () => {
      throw new Error('boom');
    },
    mapError: () => ({ code: 'nanobot_unreachable', message: 'boom' }),
  };

  registerSettingsIpc({
    ipcMain,
    settingsStore,
    backendManager,
  });

  const result = await ipcMain.invoke('settings:test', {});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'nanobot_unreachable');
});

test('settings:test returns timeout error when backend test hangs', async () => {
  const ipcMain = createIpcMainMock();

  const settingsStore = {
    getPublic: () => ({ hasToken: true }),
    merge: () => ({ chatBackend: 'nanobot' }),
    save: async (payload) => payload,
  };

  const backendManager = {
    resolveBackendName: () => 'nanobot',
    testConnection: async () => new Promise(() => {}),
    mapError: () => ({ code: 'nanobot_unreachable', message: 'unreachable' }),
  };

  registerSettingsIpc({
    ipcMain,
    settingsStore,
    backendManager,
  });

  const result = await ipcMain.invoke('settings:test', {
    timeoutMs: 20,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'chat_backend_test_timeout');
});

test('settings:nanobot:pick-workspace returns selected directory path', async () => {
  const ipcMain = createIpcMainMock();

  registerSettingsIpc({
    ipcMain,
    settingsStore: {
      getPublic: () => ({
        nanobot: {
          workspace: '/tmp/nanobot-workspace',
        },
      }),
    },
    backendManager: {
      resolveBackendName: () => 'nanobot',
      testConnection: async () => ({ ok: true }),
      mapError: (error) => ({ code: 'mapped_error', message: error?.message || 'error' }),
    },
    getWindow: () => ({ id: 1 }),
    dialogModule: {
      showOpenDialog: async (_window, options) => {
        assert.equal(options.defaultPath, '/tmp/nanobot-workspace');
        assert.deepEqual(options.properties, ['openDirectory', 'createDirectory']);
        return {
          canceled: false,
          filePaths: ['/tmp/selected-workspace'],
        };
      },
    },
  });

  const result = await ipcMain.invoke('settings:nanobot:pick-workspace');
  assert.equal(result.ok, true);
  assert.equal(result.path, '/tmp/selected-workspace');
});
