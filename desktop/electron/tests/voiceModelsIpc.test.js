const assert = require('node:assert/strict');
const test = require('node:test');

const { registerVoiceModelsIpc } = require('../ipc/voiceModels');

function createIpcMainMock() {
  const handlers = new Map();

  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
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

async function waitFor(predicate, { timeoutMs = 1000, intervalMs = 5 } = {}) {
  const startAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startAt > timeoutMs) {
      throw new Error('wait_for_timeout');
    }

    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }
}

test('voice-models select triggers background runtime refresh callback', async () => {
  const ipcMain = createIpcMainMock();
  const selectionChanges = [];

  registerVoiceModelsIpc({
    ipcMain,
    voiceModelLibrary: {
      async listCatalog() {
        return [];
      },
      listBundles() {
        return {
          bundles: [],
          selectedAsrBundleId: 'asr-next',
          selectedTtsBundleId: 'tts-next',
        };
      },
      async selectBundles(payload) {
        selectionChanges.push(`select:${payload.asrBundleId || ''}:${payload.ttsBundleId || ''}`);
      },
    },
    onSelectionChanged: async () => {
      selectionChanges.push('refresh');
    },
  });

  const result = await ipcMain.invoke('voice-models:select', {
    asrBundleId: 'asr-next',
    ttsBundleId: 'tts-next',
  });

  assert.equal(result.ok, true);
  await waitFor(() => selectionChanges.includes('refresh'));
  assert.deepEqual(selectionChanges, ['select:asr-next:tts-next', 'refresh']);
});

test('voice-models install-catalog triggers background runtime refresh callback', async () => {
  const ipcMain = createIpcMainMock();
  const calls = [];

  registerVoiceModelsIpc({
    ipcMain,
    voiceModelLibrary: {
      listCatalog() {
        return [];
      },
      listBundles() {
        return {
          bundles: [],
          selectedAsrBundleId: '',
          selectedTtsBundleId: 'tts-next',
        };
      },
      async installCatalogBundle() {
        calls.push('install');
        return {
          bundles: [],
          selectedAsrBundleId: '',
          selectedTtsBundleId: 'tts-next',
        };
      },
    },
    onSelectionChanged: async () => {
      calls.push('refresh');
    },
  });

  const result = await ipcMain.invoke('voice-models:install-catalog', {
    catalogId: 'builtin-tts-qwen3-0.6b-8bit-v1',
    installAsr: false,
    installTts: true,
  });

  assert.equal(result.ok, true);
  await waitFor(() => calls.includes('refresh'));
  assert.deepEqual(calls, ['install', 'refresh']);
});

test('voice-models remove triggers background runtime refresh callback', async () => {
  const ipcMain = createIpcMainMock();
  const calls = [];

  registerVoiceModelsIpc({
    ipcMain,
    voiceModelLibrary: {
      listCatalog() {
        return [];
      },
      listBundles() {
        return {
          bundles: [],
          selectedAsrBundleId: '',
          selectedTtsBundleId: '',
        };
      },
      async removeBundle(payload) {
        calls.push(`remove:${payload.bundleId || ''}`);
        return {
          removedBundleId: payload.bundleId || '',
          bundles: [],
          selectedAsrBundleId: '',
          selectedTtsBundleId: '',
        };
      },
    },
    onSelectionChanged: async () => {
      calls.push('refresh');
    },
  });

  const result = await ipcMain.invoke('voice-models:remove', {
    bundleId: 'bundle-1',
  });

  assert.equal(result.ok, true);
  await waitFor(() => calls.includes('refresh'));
  assert.deepEqual(calls, ['remove:bundle-1', 'refresh']);
});

test('voice-models install-catalog logs full error object on failure', async () => {
  const ipcMain = createIpcMainMock();
  const expectedError = new Error('install failed');
  expectedError.code = 'voice_model_install_failed';
  const originalConsoleError = console.error;
  const consoleErrors = [];
  console.error = (...args) => {
    consoleErrors.push(args);
  };

  try {
    registerVoiceModelsIpc({
      ipcMain,
      voiceModelLibrary: {
        listCatalog() {
          return [];
        },
        async installCatalogBundle() {
          throw expectedError;
        },
      },
    });

    const result = await ipcMain.invoke('voice-models:install-catalog', {
      catalogId: 'builtin-tts-edge-v1',
      installAsr: false,
      installTts: true,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, 'voice_model_install_failed');
    assert.equal(result.error?.message, 'install failed');
    assert.equal(consoleErrors.length, 1);
    assert.equal(consoleErrors[0][0], 'voice-models:install-catalog failed:');
    assert.equal(consoleErrors[0][1], expectedError);
  } finally {
    console.error = originalConsoleError;
  }
});
