function toVoiceModelError(error) {
  if (error && typeof error === 'object') {
    return {
      code: error.code || 'voice_model_unknown_error',
      message: typeof error.message === 'string' && error.message ? error.message : 'Voice model request failed.',
    };
  }

  return {
    code: 'voice_model_unknown_error',
    message: 'Voice model request failed.',
  };
}

function registerVoiceModelsIpc({
  ipcMain,
  voiceModelLibrary,
  emitDownloadProgress,
  emitTaskProgress,
  taskManager = null,
  onSelectionChanged,
}) {
  const notifySelectionChanged = (payload = {}) => {
    if (typeof onSelectionChanged !== 'function') {
      return;
    }

    Promise.resolve(onSelectionChanged(payload)).catch((error) => {
      console.warn('Failed to refresh warmed voice runtime after model selection change:', error);
    });
  };


  const emitProgressPayload = (progressPayload) => {
    if (typeof emitDownloadProgress === 'function') {
      emitDownloadProgress(progressPayload);
    }
  };

  const createVoiceInstallTask = async ({
    taskType,
    payload,
    resourceLocks,
    run,
  }) => {
    if (!taskManager) {
      const result = await run({ signal: null, taskId: '' });
      return { task: null, result };
    }

    return taskManager.createTask({
      taskType,
      payload,
      resourceLocks,
      resumable: true,
    }, async ({ signal, taskId, setCheckpoint }) => {
      setCheckpoint('running');
      const result = await run({ signal, taskId });
      setCheckpoint('state_persisted');
      return result;
    });
  };

  ipcMain.handle('voice-models:catalog', async () => {
    return {
      ok: true,
      items: voiceModelLibrary.listCatalog(),
    };
  });

  ipcMain.handle('voice-models:list', async () => {
    return {
      ok: true,
      ...voiceModelLibrary.listBundles(),
    };
  });

  ipcMain.handle('voice-models:install-catalog', async (_event, payload = {}) => {
    try {
      const taskResult = await createVoiceInstallTask({
        taskType: 'voice-model-install',
        payload: {
          catalogId: payload.catalogId,
          installAsr: payload.installAsr,
          installTts: payload.installTts,
        },
        resourceLocks: [
          `voice-catalog:${payload.catalogId || 'unknown'}`,
          'voice-state',
        ],
        run: ({ signal, taskId }) => voiceModelLibrary.installCatalogBundle(
          {
            catalogId: payload.catalogId,
            installAsr: payload.installAsr,
            installTts: payload.installTts,
          },
          {
            signal,
            onProgress: (progressPayload) => {
              emitProgressPayload(progressPayload);
              emitTaskProgress?.({
                ...(progressPayload || {}),
                taskId: taskId || progressPayload?.taskId,
                taskType: 'voice-model-install',
                resourceLocks: ['voice-state'],
              });
            },
          },
        ),
      });

      notifySelectionChanged();
      return {
        ok: true,
        ...(taskResult.result || {}),
        task: taskResult.task,
      };
    } catch (error) {
      console.error('voice-models:install-catalog failed:', error);
      return {
        ok: false,
        error: toVoiceModelError(error),
      };
    }
  });

  ipcMain.handle('voice-models:select', async (_event, payload = {}) => {
    try {
      await voiceModelLibrary.selectBundles(payload);
      notifySelectionChanged();
      return {
        ok: true,
        ...voiceModelLibrary.listBundles(),
      };
    } catch (error) {
      return {
        ok: false,
        error: toVoiceModelError(error),
      };
    }
  });

  ipcMain.handle('voice-models:download', async (_event, payload = {}) => {
    try {
      const taskResult = await createVoiceInstallTask({
        taskType: 'voice-model-download',
        payload,
        resourceLocks: [
          `voice-bundle:${payload.bundleId || payload.bundleName || 'custom'}`,
          'voice-state',
        ],
        run: ({ signal, taskId }) => voiceModelLibrary.downloadBundle(payload, {
          signal,
          onProgress: (progressPayload) => {
            emitProgressPayload(progressPayload);
            emitTaskProgress?.({
              ...(progressPayload || {}),
              taskId: taskId || progressPayload?.taskId,
              taskType: 'voice-model-download',
              resourceLocks: ['voice-state'],
            });
          },
        }),
      });

      notifySelectionChanged();
      return {
        ok: true,
        ...(taskResult.result || {}),
        task: taskResult.task,
      };
    } catch (error) {
      console.error('voice-models:download failed:', error);
      return {
        ok: false,
        error: toVoiceModelError(error),
      };
    }
  });

  ipcMain.handle('voice-models:remove', async (_event, payload = {}) => {
    try {
      const result = await voiceModelLibrary.removeBundle(payload);
      notifySelectionChanged();
      return {
        ok: true,
        ...result,
      };
    } catch (error) {
      return {
        ok: false,
        error: toVoiceModelError(error),
      };
    }
  });


  ipcMain.handle('download-task:list', async () => ({
    ok: true,
    items: taskManager?.listTasks?.() || [],
  }));

  ipcMain.handle('download-task:cancel', async (_event, payload = {}) => {
    if (!taskManager) {
      return { ok: false, error: { code: 'download_task_not_enabled', message: 'Download task manager is not enabled.' } };
    }
    const task = await taskManager.cancelTask(payload.taskId);
    return { ok: true, task };
  });

  return () => {
    ipcMain.removeHandler('voice-models:catalog');
    ipcMain.removeHandler('voice-models:list');
    ipcMain.removeHandler('voice-models:install-catalog');
    ipcMain.removeHandler('voice-models:select');
    ipcMain.removeHandler('voice-models:download');
    ipcMain.removeHandler('voice-models:remove');
    ipcMain.removeHandler('download-task:list');
    ipcMain.removeHandler('download-task:cancel');
  };
}

module.exports = {
  registerVoiceModelsIpc,
};
