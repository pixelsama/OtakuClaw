function toOfficeStateIpcError(error) {
  if (error && typeof error === 'object') {
    return {
      code: error.code || 'office_state_ipc_error',
      message:
        typeof error.message === 'string' && error.message
          ? error.message
          : 'Office state IPC request failed.',
    };
  }

  return {
    code: 'office_state_ipc_error',
    message: 'Office state IPC request failed.',
  };
}

function registerOfficeStateIpc({
  ipcMain,
  officeStateStore,
} = {}) {
  if (!ipcMain || !officeStateStore) {
    return () => {};
  }

  ipcMain.handle('office-state:get', async () => ({
    ok: true,
    state: officeStateStore.getState(),
  }));

  ipcMain.handle('office-state:upsert', async (_event, request = {}) => {
    try {
      return officeStateStore.upsert(request);
    } catch (error) {
      return {
        ok: false,
        error: toOfficeStateIpcError(error),
      };
    }
  });

  ipcMain.handle('office-state:update', async (_event, request = {}) => {
    try {
      return officeStateStore.update(request);
    } catch (error) {
      return {
        ok: false,
        error: toOfficeStateIpcError(error),
      };
    }
  });

  return () => {
    ipcMain.removeHandler('office-state:get');
    ipcMain.removeHandler('office-state:upsert');
    ipcMain.removeHandler('office-state:update');
  };
}

module.exports = {
  registerOfficeStateIpc,
};
