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
  officePresenceProducer,
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

  ipcMain.handle('office-state:presence', async (_event, request = {}) => {
    try {
      return officePresenceProducer?.publishPresence?.(request)
        || officeStateStore.upsert?.(request);
    } catch (error) {
      return {
        ok: false,
        error: toOfficeStateIpcError(error),
      };
    }
  });

  ipcMain.handle('office-state:heartbeat', async (_event, request = {}) => {
    try {
      return officePresenceProducer?.heartbeat?.(request)
        || officeStateStore.update?.(request);
    } catch (error) {
      return {
        ok: false,
        error: toOfficeStateIpcError(error),
      };
    }
  });

  ipcMain.handle('office-state:remove', async (_event, request = {}) => {
    try {
      return officePresenceProducer?.removePresence?.(request)
        || officeStateStore.update?.(request);
    } catch (error) {
      return {
        ok: false,
        error: toOfficeStateIpcError(error),
      };
    }
  });

  ipcMain.handle('office-state:set-active', async (_event, request = {}) => {
    try {
      return officePresenceProducer?.setActiveAgent?.(request)
        || officeStateStore.setActiveAgent?.(request?.agentId || request?.activeAgentId || request?.id, request)
        || officeStateStore.update?.(request);
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
    ipcMain.removeHandler('office-state:presence');
    ipcMain.removeHandler('office-state:heartbeat');
    ipcMain.removeHandler('office-state:remove');
    ipcMain.removeHandler('office-state:set-active');
  };
}

module.exports = {
  registerOfficeStateIpc,
};
