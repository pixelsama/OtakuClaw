const { dialog } = require('electron');

function toStaticAvatarError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'static_avatar_unknown_error';
  const message = typeof error?.message === 'string' && error.message.trim()
    ? error.message.trim()
    : '静态角色资源请求失败。';

  return {
    code,
    message,
  };
}

function registerStaticAvatarsIpc({
  ipcMain,
  getWindow,
  avatarLibrary,
  dialogModule = dialog,
}) {
  ipcMain.handle('static-avatars:list', async () => {
    try {
      const packs = await avatarLibrary.listPacks();
      return {
        ok: true,
        packs,
      };
    } catch (error) {
      return {
        ok: false,
        packs: [],
        error: toStaticAvatarError(error),
      };
    }
  });

  ipcMain.handle('static-avatars:import-zip', async () => {
    const browserWindow = getWindow?.();
    const result = await dialogModule.showOpenDialog(browserWindow || undefined, {
      title: '导入静态角色资源包 ZIP',
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
      const importedResult = await avatarLibrary.importZip(result.filePaths[0]);
      return {
        ok: true,
        canceled: false,
        imported: importedResult.imported,
        packs: importedResult.packs,
      };
    } catch (error) {
      return {
        ok: false,
        canceled: false,
        error: toStaticAvatarError(error),
      };
    }
  });

  ipcMain.handle('static-avatars:remove', async (_event, payload = {}) => {
    try {
      const result = await avatarLibrary.removePack(payload?.packId || payload?.id || '');
      return {
        ok: true,
        removedPackId: result.removedPackId,
        packs: result.packs,
      };
    } catch (error) {
      return {
        ok: false,
        error: toStaticAvatarError(error),
      };
    }
  });

  return () => {
    ipcMain.removeHandler('static-avatars:list');
    ipcMain.removeHandler('static-avatars:import-zip');
    ipcMain.removeHandler('static-avatars:remove');
  };
}

module.exports = {
  registerStaticAvatarsIpc,
};
