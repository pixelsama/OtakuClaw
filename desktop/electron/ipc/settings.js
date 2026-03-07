const { createChatBackendManager } = require('../services/chat/backendManager');

function registerSettingsIpc({
  ipcMain,
  settingsStore,
  backendManager = createChatBackendManager(),
  onSaved,
}) {
  ipcMain.handle('settings:get', async () => settingsStore.getPublic());

  ipcMain.handle('settings:save', async (_event, partialSettings = {}) => {
    const saved = await settingsStore.save(partialSettings);
    if (typeof onSaved === 'function') {
      await onSaved(saved);
    }
    return saved;
  });

  ipcMain.handle('settings:test', async (_event, overrideSettings = {}) => {
    let backend = 'openclaw';

    try {
      const settings = settingsStore.merge(overrideSettings);
      backend = backendManager.resolveBackendName({
        settings,
        requestBackend: overrideSettings?.backend || overrideSettings?.chatBackend,
      });

      return await backendManager.testConnection({
        backend,
        settings,
      });
    } catch (error) {
      return {
        ok: false,
        error: backendManager.mapError(error, { backend }),
      };
    }
  });
}

module.exports = {
  registerSettingsIpc,
};
