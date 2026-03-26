const { dialog } = require('electron');

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toPixelPackError(error) {
  if (error && typeof error === 'object') {
    return {
      code: typeof error.code === 'string' && error.code ? error.code : 'pixel_pack_unknown_error',
      message:
        typeof error.message === 'string' && error.message
          ? error.message
          : 'Pixel pack request failed.',
      validation: error.validation || null,
    };
  }

  return {
    code: 'pixel_pack_unknown_error',
    message: 'Pixel pack request failed.',
    validation: null,
  };
}

function getPackSelection(payload = {}, settingsStore) {
  const currentSettings = settingsStore?.getForMain?.() || {};
  const activePixelPack = currentSettings?.ui?.pixelPack || {};
  const packId = normalizeText(
    payload.packId || payload.pixelPackId || payload.activePackId || activePixelPack.activePackId,
  );
  const version = normalizeText(
    payload.version || payload.activeVersion || activePixelPack.activeVersion,
  );

  return {
    packId,
    version,
  };
}

function getExplicitPackSelection(payload = {}) {
  return {
    packId: normalizeText(payload.packId || payload.pixelPackId),
    version: normalizeText(payload.version),
  };
}

async function chooseZipPath(getWindow, dialogModule, title, payload = {}) {
  if (typeof payload.zipPath === 'string' && payload.zipPath.trim()) {
    return payload.zipPath.trim();
  }

  const browserWindow = getWindow?.();
  const result = await dialogModule.showOpenDialog(browserWindow || undefined, {
    title,
    properties: ['openFile'],
    filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return '';
  }

  return result.filePaths[0] || '';
}

async function chooseExportPath(getWindow, dialogModule, defaultPath, payload = {}) {
  if (typeof payload.destinationPath === 'string' && payload.destinationPath.trim()) {
    return payload.destinationPath.trim();
  }

  const browserWindow = getWindow?.();
  const result = await dialogModule.showSaveDialog(browserWindow || undefined, {
    title: '导出 Pixel Pack',
    defaultPath,
    filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
  });

  if (result.canceled || !result.filePath) {
    return '';
  }

  return result.filePath;
}

function attachValidation(result) {
  return {
    validation: result,
    manifest: result?.manifest || null,
    pack: result?.pack || null,
  };
}

function registerPixelPacksIpc({
  ipcMain,
  getWindow,
  pixelPackLibrary,
  dialogModule = dialog,
}) {
  ipcMain.handle('pixel-packs:list', async () => {
    try {
      const result = await pixelPackLibrary.listPacks();
      return {
        ok: true,
        ...result,
      };
    } catch (error) {
      return {
        ok: false,
        error: toPixelPackError(error),
      };
    }
  });

  ipcMain.handle('pixel-packs:validate', async (_event, payload = {}) => {
    try {
      const explicitSelection = getExplicitPackSelection(payload);
      if (explicitSelection.packId && explicitSelection.version) {
        const validation = await pixelPackLibrary.validatePack(
          explicitSelection.packId,
          explicitSelection.version,
        );
        return {
          ok: true,
          ...attachValidation(validation),
        };
      }

      const zipPath = await chooseZipPath(getWindow, dialogModule, '选择 Pixel Pack ZIP', payload);
      if (!zipPath) {
        return {
          ok: false,
          canceled: true,
        };
      }

      const validation = await pixelPackLibrary.validateZip(zipPath);
      return {
        ok: true,
        zipPath,
        ...attachValidation(validation),
      };
    } catch (error) {
      return {
        ok: false,
        error: toPixelPackError(error),
      };
    }
  });

  ipcMain.handle('pixel-packs:import-zip', async (_event, payload = {}) => {
    try {
      const zipPath = await chooseZipPath(getWindow, dialogModule, '导入 Pixel Pack ZIP', payload);
      if (!zipPath) {
        return {
          ok: false,
          canceled: true,
        };
      }

      const imported = await pixelPackLibrary.importZip(zipPath);
      return {
        ok: true,
        zipPath,
        ...imported,
      };
    } catch (error) {
      return {
        ok: false,
        error: toPixelPackError(error),
      };
    }
  });

  ipcMain.handle('pixel-packs:activate', async (_event, payload = {}) => {
    try {
      const selection = getExplicitPackSelection(payload);
      if (!selection.packId || !selection.version) {
        return {
          ok: false,
          error: {
            code: 'pixel_pack_invalid_target',
            message: 'Pack id and version are required.',
            validation: null,
          },
        };
      }

      const activated = await pixelPackLibrary.activatePack(selection.packId, selection.version);
      return {
        ok: true,
        ...activated,
      };
    } catch (error) {
      return {
        ok: false,
        error: toPixelPackError(error),
      };
    }
  });

  ipcMain.handle('pixel-packs:remove', async (_event, payload = {}) => {
    try {
      const selection = getPackSelection(payload, pixelPackLibrary.settingsStore);
      if (!selection.packId || !selection.version) {
        return {
          ok: false,
          error: {
            code: 'pixel_pack_invalid_target',
            message: 'Pack id and version are required.',
            validation: null,
          },
        };
      }

      const removed = await pixelPackLibrary.removePack(selection.packId, selection.version);
      return {
        ok: true,
        ...removed,
      };
    } catch (error) {
      return {
        ok: false,
        error: toPixelPackError(error),
      };
    }
  });

  ipcMain.handle('pixel-packs:export-zip', async (_event, payload = {}) => {
    try {
      const selection = getPackSelection(payload, pixelPackLibrary.settingsStore);
      if (!selection.packId || !selection.version) {
        return {
          ok: false,
          error: {
            code: 'pixel_pack_invalid_target',
            message: 'Pack id and version are required.',
            validation: null,
          },
        };
      }

      const defaultFileName = `${selection.packId}-${selection.version}.zip`;
      const destinationPath = await chooseExportPath(
        getWindow,
        dialogModule,
        defaultFileName,
        payload,
      );
      if (!destinationPath) {
        return {
          ok: false,
          canceled: true,
        };
      }

      const exported = await pixelPackLibrary.exportPack(
        selection.packId,
        selection.version,
        destinationPath,
      );
      return {
        ok: true,
        ...exported,
      };
    } catch (error) {
      return {
        ok: false,
        error: toPixelPackError(error),
      };
    }
  });

  ipcMain.handle('pixel-packs:get-active-manifest', async () => {
    try {
      const result = await pixelPackLibrary.getActiveManifest();
      return {
        ok: true,
        ...result,
      };
    } catch (error) {
      return {
        ok: false,
        error: toPixelPackError(error),
      };
    }
  });

  return () => {
    ipcMain.removeHandler('pixel-packs:list');
    ipcMain.removeHandler('pixel-packs:validate');
    ipcMain.removeHandler('pixel-packs:import-zip');
    ipcMain.removeHandler('pixel-packs:activate');
    ipcMain.removeHandler('pixel-packs:remove');
    ipcMain.removeHandler('pixel-packs:export-zip');
    ipcMain.removeHandler('pixel-packs:get-active-manifest');
  };
}

module.exports = {
  registerPixelPacksIpc,
  toPixelPackError,
};
