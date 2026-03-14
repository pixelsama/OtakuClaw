function toUpdaterError(error) {
  if (error && typeof error === 'object') {
    return {
      code: error.code || 'app_updater_error',
      message:
        typeof error.message === 'string' && error.message
          ? error.message
          : 'Auto update request failed.',
    };
  }

  return {
    code: 'app_updater_error',
    message: 'Auto update request failed.',
  };
}

function resolveAutoUpdater(explicitAutoUpdater = null) {
  if (explicitAutoUpdater && typeof explicitAutoUpdater === 'object') {
    return explicitAutoUpdater;
  }

  try {
    const moduleExports = require('electron-updater');
    if (moduleExports?.autoUpdater && typeof moduleExports.autoUpdater === 'object') {
      return moduleExports.autoUpdater;
    }
  } catch {
    // noop
  }

  return null;
}

class AppUpdaterService {
  constructor({
    app,
    autoUpdater = null,
    emitState,
    logger = console,
  } = {}) {
    this.app = app;
    this.autoUpdater = resolveAutoUpdater(autoUpdater);
    this.emitState = typeof emitState === 'function' ? emitState : () => {};
    this.logger = logger || console;
    this.listeners = [];
    this.state = {
      status: 'idle',
      updateInfo: null,
      progress: null,
      checkedAt: '',
      error: null,
      available: false,
      downloaded: false,
      supported: this.isSupported(),
    };

    this.initUpdater();
  }

  isSupported() {
    return Boolean(
      this.app
      && typeof this.app.isPackaged === 'boolean'
      && this.app.isPackaged
      && this.autoUpdater,
    );
  }

  initUpdater() {
    if (!this.autoUpdater) {
      return;
    }

    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;

    this.bind('checking-for-update', () => {
      this.updateState({
        status: 'checking',
        error: null,
        progress: null,
        downloaded: false,
      });
    });

    this.bind('update-available', (updateInfo = null) => {
      this.updateState({
        status: 'available',
        available: true,
        downloaded: false,
        updateInfo,
        checkedAt: new Date().toISOString(),
        error: null,
      });
    });

    this.bind('update-not-available', (updateInfo = null) => {
      this.updateState({
        status: 'idle',
        available: false,
        downloaded: false,
        updateInfo,
        checkedAt: new Date().toISOString(),
        progress: null,
        error: null,
      });
    });

    this.bind('download-progress', (progress = {}) => {
      this.updateState({
        status: 'downloading',
        progress: {
          percent: Number.isFinite(progress?.percent) ? progress.percent : 0,
          bytesPerSecond: Number.isFinite(progress?.bytesPerSecond) ? progress.bytesPerSecond : 0,
          transferred: Number.isFinite(progress?.transferred) ? progress.transferred : 0,
          total: Number.isFinite(progress?.total) ? progress.total : 0,
        },
        error: null,
      });
    });

    this.bind('update-downloaded', (updateInfo = null) => {
      this.updateState({
        status: 'downloaded',
        downloaded: true,
        available: true,
        updateInfo,
        progress: null,
        error: null,
      });
    });

    this.bind('error', (error) => {
      this.logger.warn?.('Auto updater event error:', error);
      this.updateState({
        status: 'error',
        error: toUpdaterError(error),
      });
    });
  }

  bind(eventName, handler) {
    if (!this.autoUpdater || typeof this.autoUpdater.on !== 'function') {
      return;
    }

    this.autoUpdater.on(eventName, handler);
    this.listeners.push([eventName, handler]);
  }

  updateState(partial = {}) {
    this.state = {
      ...this.state,
      ...partial,
      supported: this.isSupported(),
    };
    this.emitState(this.getState());
  }

  getState() {
    return {
      ...this.state,
      updateInfo: this.state.updateInfo && typeof this.state.updateInfo === 'object'
        ? { ...this.state.updateInfo }
        : this.state.updateInfo,
      progress: this.state.progress && typeof this.state.progress === 'object'
        ? { ...this.state.progress }
        : this.state.progress,
      error: this.state.error && typeof this.state.error === 'object'
        ? { ...this.state.error }
        : this.state.error,
    };
  }

  async checkForUpdates() {
    if (!this.autoUpdater) {
      return {
        ok: false,
        reason: 'updater_unavailable',
      };
    }

    if (!this.app?.isPackaged) {
      return {
        ok: false,
        reason: 'app_not_packaged',
      };
    }

    try {
      this.updateState({ status: 'checking', error: null });
      const result = await this.autoUpdater.checkForUpdates();
      return {
        ok: true,
        updateInfo: result?.updateInfo || null,
      };
    } catch (error) {
      const mappedError = toUpdaterError(error);
      this.updateState({ status: 'error', error: mappedError });
      return {
        ok: false,
        error: mappedError,
      };
    }
  }

  async downloadUpdate() {
    if (!this.autoUpdater) {
      return {
        ok: false,
        reason: 'updater_unavailable',
      };
    }

    if (!this.app?.isPackaged) {
      return {
        ok: false,
        reason: 'app_not_packaged',
      };
    }

    try {
      this.updateState({ status: 'downloading', error: null });
      await this.autoUpdater.downloadUpdate();
      return {
        ok: true,
      };
    } catch (error) {
      const mappedError = toUpdaterError(error);
      this.updateState({ status: 'error', error: mappedError });
      return {
        ok: false,
        error: mappedError,
      };
    }
  }

  installUpdate() {
    if (!this.autoUpdater) {
      return {
        ok: false,
        reason: 'updater_unavailable',
      };
    }

    if (!this.app?.isPackaged) {
      return {
        ok: false,
        reason: 'app_not_packaged',
      };
    }

    if (!this.state.downloaded) {
      return {
        ok: false,
        reason: 'update_not_downloaded',
      };
    }

    try {
      this.autoUpdater.quitAndInstall(false, true);
      return {
        ok: true,
      };
    } catch (error) {
      const mappedError = toUpdaterError(error);
      this.updateState({ status: 'error', error: mappedError });
      return {
        ok: false,
        error: mappedError,
      };
    }
  }

  dispose() {
    if (!this.autoUpdater || typeof this.autoUpdater.removeListener !== 'function') {
      this.listeners = [];
      return;
    }

    for (const [eventName, handler] of this.listeners) {
      this.autoUpdater.removeListener(eventName, handler);
    }
    this.listeners = [];
  }
}

module.exports = {
  AppUpdaterService,
  toUpdaterError,
};
