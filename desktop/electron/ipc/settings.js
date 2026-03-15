const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog, shell } = require('electron');
const { createChatBackendManager } = require('../services/chat/backendManager');

const DEFAULT_CONNECTION_TEST_TIMEOUT_MS = 70_000;

function normalizeTimeoutMs(value, fallback = DEFAULT_CONNECTION_TEST_TIMEOUT_MS) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 5 * 60 * 1000);
}

function normalizePath(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toWorkspaceError(error, fallbackCode = 'nanobot_workspace_invalid') {
  const code = typeof error?.code === 'string' ? error.code : fallbackCode;
  if (code === 'ENOENT') {
    return {
      code: 'nanobot_workspace_not_found',
      message: '工作区不存在，请拖入已存在的文件夹。',
    };
  }
  if (code === 'ENOTDIR') {
    return {
      code: 'nanobot_workspace_not_directory',
      message: '工作区必须是文件夹，不能是文件。',
    };
  }
  return {
    code,
    message: typeof error?.message === 'string' && error.message
      ? error.message
      : '无法处理 Nanobot 工作区。',
  };
}

async function resolveExistingDirectoryPath(targetPath) {
  const normalized = normalizePath(targetPath);
  if (!normalized) {
    const error = new Error('工作区路径不能为空。');
    error.code = 'nanobot_workspace_empty_path';
    throw error;
  }

  const absolutePath = path.resolve(normalized);
  const realPath = await fs.realpath(absolutePath);
  const stats = await fs.stat(realPath);
  if (!stats.isDirectory()) {
    const error = new Error('工作区必须是文件夹，不能是文件。');
    error.code = 'ENOTDIR';
    throw error;
  }
  return realPath;
}

async function ensureDirectoryPath(targetPath) {
  const normalized = normalizePath(targetPath);
  if (!normalized) {
    const error = new Error('工作区路径不能为空。');
    error.code = 'nanobot_workspace_empty_path';
    throw error;
  }

  const absolutePath = path.resolve(normalized);
  await fs.mkdir(absolutePath, { recursive: true });
  return resolveExistingDirectoryPath(absolutePath);
}

function registerSettingsIpc({
  ipcMain,
  settingsStore,
  getWindow,
  dialogModule = dialog,
  shellModule = shell,
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

  ipcMain.handle('settings:nanobot:open-workspace', async () => {
    try {
      const currentSettings = settingsStore.getPublic?.() || {};
      const workspacePath = await ensureDirectoryPath(currentSettings?.nanobot?.workspace);
      const openResult = await shellModule.openPath(workspacePath);
      if (openResult) {
        return {
          ok: false,
          error: {
            code: 'nanobot_workspace_open_failed',
            message: openResult,
          },
        };
      }

      return {
        ok: true,
        path: workspacePath,
      };
    } catch (error) {
      return {
        ok: false,
        error: toWorkspaceError(error, 'nanobot_workspace_open_failed'),
      };
    }
  });

  return () => {
    ipcMain.removeHandler('settings:get');
    ipcMain.removeHandler('settings:save');
    ipcMain.removeHandler('settings:test');
    ipcMain.removeHandler('settings:nanobot:pick-workspace');
    ipcMain.removeHandler('settings:nanobot:open-workspace');
  };
}

module.exports = {
  registerSettingsIpc,
};
