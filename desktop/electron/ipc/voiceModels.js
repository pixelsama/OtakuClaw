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
}) {
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
        { catalogId: payload.catalogId },
        {
          onProgress: (progressPayload) => {
            if (typeof emitDownloadProgress === 'function') {
              emitDownloadProgress(progressPayload);
            }
          },
        },
      );

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

  ipcMain.handle('voice-models:select', async (_event, payload = {}) => {
    try {
      await voiceModelLibrary.selectBundle(payload.bundleId);
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
  };
}

module.exports = {
  registerVoiceModelsIpc,
};
