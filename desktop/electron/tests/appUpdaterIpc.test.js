const assert = require('node:assert/strict');
const test = require('node:test');

const { registerAppUpdaterIpc } = require('../ipc/appUpdater');

function createIpcMainMock() {
  const handlers = new Map();

  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
    async invoke(channel, payload) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`Missing handler for ${channel}`);
      }
      return handler({}, payload);
    },
  };
}

test('app-updater ipc delegates check/download/install and exposes state', async () => {
  const ipcMain = createIpcMainMock();
  const calls = [];

  registerAppUpdaterIpc({
    ipcMain,
    appUpdaterService: {
      getState() {
        return {
          status: 'idle',
          available: false,
          downloaded: false,
          supported: true,
        };
      },
      async checkForUpdates() {
        calls.push('check');
        return { ok: true, updateInfo: { version: '0.0.2' } };
      },
      async downloadUpdate() {
        calls.push('download');
        return { ok: true };
      },
      installUpdate() {
        calls.push('install');
        return { ok: true };
      },
    },
  });

  const stateResult = await ipcMain.invoke('app-updater:get-state');
  assert.equal(stateResult.ok, true);
  assert.equal(stateResult.state.supported, true);

  const checkResult = await ipcMain.invoke('app-updater:check');
  assert.equal(checkResult.ok, true);
  assert.equal(checkResult.updateInfo.version, '0.0.2');

  const downloadResult = await ipcMain.invoke('app-updater:download');
  assert.equal(downloadResult.ok, true);

  const installResult = await ipcMain.invoke('app-updater:install');
  assert.equal(installResult.ok, true);
  assert.deepEqual(calls, ['check', 'download', 'install']);
});
