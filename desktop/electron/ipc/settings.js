const { dialog } = require('electron');
const { createChatBackendManager } = require('../services/chat/backendManager');

const DEFAULT_CONNECTION_TEST_TIMEOUT_MS = 70_000;

function normalizeTimeoutMs(value, fallback = DEFAULT_CONNECTION_TEST_TIMEOUT_MS) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 5 * 60 * 1000);
}

function registerSettingsIpc({
  ipcMain,
  settingsStore,
  getWindow,
  dialogModule = dialog,
  backendManager = createChatBackendManager(),
}) {
  ipcMain.handle('settings:get', async () => settingsStore.getPublic());

  ipcMain.handle('settings:save', async (_event, partialSettings = {}) => {
    return settingsStore.save(partialSettings);
  });

  ipcMain.handle('settings:test', async (_event, overrideSettings = {}) => {
    let backend = 'nanobot';
    const timeoutMs = normalizeTimeoutMs(overrideSettings?.timeoutMs);
    const controller = new AbortController();
    let timeoutId = null;
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        resolve({
          ok: false,
          error: {
            code: 'chat_backend_test_timeout',
            message: `连接测试超时（>${Math.floor(timeoutMs / 1000)}s），请重试。`,
          },
        });
      }, timeoutMs);
    });

    try {
      const settings = settingsStore.merge(overrideSettings);
      backend = backendManager.resolveBackendName({
        settings,
        requestBackend: overrideSettings?.backend || overrideSettings?.chatBackend,
      });

      const result = await Promise.race([
        backendManager.testConnection({
          backend,
          settings,
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
      return result;
    } catch (error) {
      if (error?.name === 'AbortError') {
        return {
          ok: false,
          error: {
            code: 'chat_backend_test_timeout',
            message: `连接测试超时（>${Math.floor(timeoutMs / 1000)}s），请重试。`,
          },
        };
      }
      return {
        ok: false,
        error: backendManager.mapError(error, { backend }),
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  });

  ipcMain.handle('settings:nanobot:pick-workspace', async () => {
    const browserWindow = getWindow?.();
    const currentSettings = settingsStore.getPublic?.() || {};
    const defaultPath =
      typeof currentSettings?.nanobot?.workspace === 'string'
        ? currentSettings.nanobot.workspace.trim()
        : '';

    const result = await dialogModule.showOpenDialog(browserWindow || undefined, {
      title: '选择 Nanobot Workspace',
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return {
        ok: false,
        canceled: true,
        path: '',
      };
    }

    return {
      ok: true,
      canceled: false,
      path: result.filePaths[0] || '',
    };
  });

  return () => {
    ipcMain.removeHandler('settings:get');
    ipcMain.removeHandler('settings:save');
    ipcMain.removeHandler('settings:test');
    ipcMain.removeHandler('settings:nanobot:pick-workspace');
  };
}

module.exports = {
  registerSettingsIpc,
};
