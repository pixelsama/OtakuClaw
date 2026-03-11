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
      const result = await voiceModelLibrary.installCatalogBundle(
        {
          catalogId: payload.catalogId,
          installAsr: payload.installAsr,
          installTts: payload.installTts,
        },
        {
          onProgress: (progressPayload) => {
            if (typeof emitDownloadProgress === 'function') {
              emitDownloadProgress(progressPayload);
            }
          },
        },
      );

      notifySelectionChanged();
      return {
        ok: true,
        ...result,
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
      const result = await voiceModelLibrary.downloadBundle(payload, {
        onProgress: (progressPayload) => {
          if (typeof emitDownloadProgress === 'function') {
            emitDownloadProgress(progressPayload);
          }
        },
      });

      notifySelectionChanged();
      return {
        ok: true,
        ...result,
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

  return () => {
    ipcMain.removeHandler('voice-models:catalog');
    ipcMain.removeHandler('voice-models:list');
    ipcMain.removeHandler('voice-models:install-catalog');
    ipcMain.removeHandler('voice-models:select');
    ipcMain.removeHandler('voice-models:download');
    ipcMain.removeHandler('voice-models:remove');
  };
}

module.exports = {
  registerVoiceModelsIpc,
};
