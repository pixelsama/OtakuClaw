function toAcpRunnerError(error) {
  if (error && typeof error === 'object') {
    return {
      code: error.code || 'acp_runner_unknown_error',
      message:
        typeof error.message === 'string' && error.message
          ? error.message
          : 'ACP runner request failed.',
    };
  }

  return {
    code: 'acp_runner_unknown_error',
    message: 'ACP runner request failed.',
  };
}

function normalizeBackend(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'codex') {
    return 'codex';
  }
  if (normalized === 'claude-code' || normalized === 'claude code' || normalized === 'claudecode' || normalized === 'claude_code') {
    return 'claude-code';
  }
  return '';
}

function toSettingsKey(backend) {
  return backend === 'codex' ? 'codex' : 'claudeCode';
}

function registerAcpRunnerRuntimeIpc({
  ipcMain,
  acpRunnerRuntimeManager,
  settingsStore,
  emitProgress,
}) {
  ipcMain.handle('acp-runner:status', async (_event, payload = {}) => {
    const backend = normalizeBackend(payload?.backend);
    return acpRunnerRuntimeManager.getStatus({
      backend,
    });
  });

  ipcMain.handle('acp-runner:install', async (_event, payload = {}) => {
    const backend = normalizeBackend(payload?.backend);
    if (!backend) {
      return {
        ok: false,
        error: {
          code: 'acp_runner_backend_invalid',
          message: 'Unsupported ACP backend.',
        },
      };
    }

    try {
      const result = await acpRunnerRuntimeManager.installRunner({
        backend,
        force: Boolean(payload?.force),
        onProgress: (progressPayload) => {
          if (typeof emitProgress === 'function') {
            emitProgress(progressPayload);
          }
        },
      });

      const commandPath = typeof result?.commandPath === 'string' ? result.commandPath.trim() : '';
      if (commandPath && settingsStore && typeof settingsStore.save === 'function') {
        const settingsKey = toSettingsKey(backend);
        await settingsStore.save({
          [settingsKey]: {
            runner: {
              command: commandPath,
            },
          },
        });
      }

      return {
        ok: true,
        ...result,
      };
    } catch (error) {
      return {
        ok: false,
        error: toAcpRunnerError(error),
      };
    }
  });

  return () => {
    ipcMain.removeHandler('acp-runner:status');
    ipcMain.removeHandler('acp-runner:install');
  };
}

module.exports = {
  registerAcpRunnerRuntimeIpc,
};
