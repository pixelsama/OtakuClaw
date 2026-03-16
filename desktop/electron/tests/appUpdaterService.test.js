const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { AppUpdaterService } = require('../services/appUpdaterService');

function createAppMock({ isPackaged = true } = {}) {
  return {
    isPackaged,
    getPath(name) {
      if (name === 'exe') {
        return '/Applications/OtakuClaw.app/Contents/MacOS/OtakuClaw';
      }
      return '';
    },
  };
}

function createAutoUpdaterMock() {
  const updater = new EventEmitter();
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.checkForUpdates = async () => ({ updateInfo: { version: '0.2.1-beta.5' } });
  updater.downloadUpdate = async () => ({ ok: true });
  updater.quitAndInstallCalls = 0;
  updater.quitAndInstall = () => {
    updater.quitAndInstallCalls += 1;
  };
  return updater;
}

test('AppUpdaterService marks ad-hoc mac builds as unsupported', async () => {
  const autoUpdater = createAutoUpdaterMock();
  const service = new AppUpdaterService({
    app: createAppMock(),
    autoUpdater,
    platform: 'darwin',
    macSignatureProbe: () => ({
      supported: false,
      reason: 'mac_unsigned_build',
    }),
  });

  assert.equal(service.getState().supported, false);
  assert.equal(service.getState().supportReason, 'mac_unsigned_build');

  const checkResult = await service.checkForUpdates();
  assert.deepEqual(checkResult, {
    ok: false,
    reason: 'mac_unsigned_build',
  });

  const installResult = service.installUpdate();
  assert.deepEqual(installResult, {
    ok: false,
    reason: 'mac_unsigned_build',
  });
  assert.equal(autoUpdater.quitAndInstallCalls, 0);
});

test('AppUpdaterService resets downloaded state after updater error event', async () => {
  const autoUpdater = createAutoUpdaterMock();
  const service = new AppUpdaterService({
    app: createAppMock(),
    autoUpdater,
    platform: 'darwin',
    macSignatureProbe: () => ({
      supported: true,
      reason: '',
    }),
  });

  autoUpdater.emit('update-downloaded', { version: '0.2.1-beta.5' });
  assert.equal(service.getState().downloaded, true);
  assert.equal(service.getState().status, 'downloaded');

  autoUpdater.emit('error', new Error('code signature validation failed'));
  assert.equal(service.getState().downloaded, false);
  assert.equal(service.getState().status, 'error');
  assert.equal(service.getState().error?.message, 'code signature validation failed');
});
