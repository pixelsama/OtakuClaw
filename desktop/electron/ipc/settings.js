const { testOpenClawConnection, toClientError } = require('../services/openclawClient');

function registerSettingsIpc({ ipcMain, settingsStore }) {
  ipcMain.handle('settings:get', async () => settingsStore.getPublic());

  ipcMain.handle('settings:save', async (_event, partialSettings = {}) => {
    return settingsStore.save(partialSettings);
  });

  ipcMain.handle('settings:test', async (_event, overrideSettings = {}) => {
    try {
      const settings = settingsStore.merge(overrideSettings);
      return await testOpenClawConnection({ settings });
    } catch (error) {
      return {
        ok: false,
        error: toClientError(error),
      };
    }
  });
}

module.exports = {
  registerSettingsIpc,
};
