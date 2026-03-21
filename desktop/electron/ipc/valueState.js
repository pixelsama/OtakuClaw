function toValueStateIpcError(error) {
  if (error && typeof error === 'object') {
    return {
      code: error.code || 'value_state_ipc_error',
      message:
        typeof error.message === 'string' && error.message
          ? error.message
          : 'Value state IPC request failed.',
    };
  }

  return {
    code: 'value_state_ipc_error',
    message: 'Value state IPC request failed.',
  };
}

function registerValueStateIpc({
  ipcMain,
  valueStateStore,
  valueProposalService,
} = {}) {
  if (!ipcMain || !valueStateStore) {
    return () => {};
  }

  ipcMain.handle('value-state:get', async (_event, request = {}) => {
    try {
      return {
        ok: true,
        state: valueStateStore.getState(request),
      };
    } catch (error) {
      return {
        ok: false,
        error: toValueStateIpcError(error),
      };
    }
  });

  ipcMain.handle('value-state:upsert', async (_event, request = {}) => {
    try {
      return valueStateStore.upsertEntity(request);
    } catch (error) {
      return {
        ok: false,
        error: toValueStateIpcError(error),
      };
    }
  });

  ipcMain.handle('value-state:propose', async (_event, request = {}) => {
    try {
      if (!valueProposalService || typeof valueProposalService.applyProposal !== 'function') {
        return {
          ok: false,
          error: {
            code: 'value_state_proposal_unavailable',
            message: 'Value state proposal service is unavailable.',
          },
        };
      }

      return valueProposalService.applyProposal(request);
    } catch (error) {
      return {
        ok: false,
        error: toValueStateIpcError(error),
      };
    }
  });

  ipcMain.handle('value-state:update', async (_event, request = {}) => {
    try {
      return valueStateStore.applyStatUpdates(request);
    } catch (error) {
      return {
        ok: false,
        error: toValueStateIpcError(error),
      };
    }
  });

  ipcMain.handle('value-state:apply-interaction', async (_event, request = {}) => {
    try {
      if (!valueProposalService || typeof valueProposalService.applyInteraction !== 'function') {
        return {
          ok: false,
          error: {
            code: 'value_state_interaction_unavailable',
            message: 'Value state interaction service is unavailable.',
          },
        };
      }

      return valueProposalService.applyInteraction(request);
    } catch (error) {
      return {
        ok: false,
        error: toValueStateIpcError(error),
      };
    }
  });

  return () => {
    ipcMain.removeHandler('value-state:get');
    ipcMain.removeHandler('value-state:upsert');
    ipcMain.removeHandler('value-state:propose');
    ipcMain.removeHandler('value-state:update');
    ipcMain.removeHandler('value-state:apply-interaction');
  };
}

module.exports = {
  registerValueStateIpc,
};
