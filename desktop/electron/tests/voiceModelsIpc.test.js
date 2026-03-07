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
