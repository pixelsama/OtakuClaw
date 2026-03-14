function toUpdaterIpcError(error) {
  if (error && typeof error === 'object') {
    return {
      code: error.code || 'app_updater_ipc_error',
      message:
        typeof error.message === 'string' && error.message
          ? error.message
          : 'Auto updater IPC request failed.',
    };
  }

  return {
    code: 'app_updater_ipc_error',
    message: 'Auto updater IPC request failed.',
  };
}

function registerAppUpdaterIpc({
  ipcMain,
  appUpdaterService,
}) {
  ipcMain.handle('app-updater:get-state', async () => {
    const state = appUpdaterService?.getState?.() || {
      status: 'idle',
      available: false,
      downloaded: false,
      supported: false,
    };

    return {
      ok: true,
      state,
    };
  });

  ipcMain.handle('app-updater:check', async () => {
    try {
      return await appUpdaterService.checkForUpdates();
    } catch (error) {
      return {
        ok: false,
        error: toUpdaterIpcError(error),
      };
    }
  });

  ipcMain.handle('app-updater:download', async () => {
    try {
      return await appUpdaterService.downloadUpdate();
    } catch (error) {
      return {
        ok: false,
        error: toUpdaterIpcError(error),
      };
    }
  });

  ipcMain.handle('app-updater:install', async () => {
    try {
      return appUpdaterService.installUpdate();
    } catch (error) {
      return {
        ok: false,
        error: toUpdaterIpcError(error),
      };
    }
  });

  return () => {
    ipcMain.removeHandler('app-updater:get-state');
    ipcMain.removeHandler('app-updater:check');
    ipcMain.removeHandler('app-updater:download');
    ipcMain.removeHandler('app-updater:install');
  };
}

module.exports = {
  registerAppUpdaterIpc,
};
