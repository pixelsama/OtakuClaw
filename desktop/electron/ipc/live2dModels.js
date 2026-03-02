const { dialog } = require('electron');

function normalizeImportError(error) {
  if (!error) {
    return '导入模型失败。';
  }

  if (error.code === 'ENOENT') {
    if (process.platform === 'win32') {
      return '导入失败：系统 PowerShell 不可用，无法解压 zip。';
    }
    return '导入失败：未找到 unzip 命令，无法解压 zip。';
  }

  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  return '导入模型失败。';
}

function registerLive2DModelsIpc({ ipcMain, getWindow, modelLibrary }) {
  ipcMain.handle('live2d-models:list', async () => {
    const models = await modelLibrary.listModels();
    return { models };
  });

  ipcMain.handle('live2d-models:import-zip', async () => {
    const browserWindow = getWindow?.();
    const result = await dialog.showOpenDialog(browserWindow || undefined, {
      title: '导入 Live2D 模型压缩包',
      properties: ['openFile'],
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return {
        ok: false,
        canceled: true,
      };
    }

    try {
      const imported = await modelLibrary.importZip(result.filePaths[0]);
      const models = await modelLibrary.listModels();
      return {
        ok: true,
        imported,
        models,
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'live2d_model_import_failed',
          message: normalizeImportError(error),
        },
      };
    }
  });

  return () => {
    ipcMain.removeHandler('live2d-models:list');
    ipcMain.removeHandler('live2d-models:import-zip');
  };
}

module.exports = {
  registerLive2DModelsIpc,
};
