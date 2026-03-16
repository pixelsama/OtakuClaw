const { spawnSync } = require('node:child_process');

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

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function extractCodesignField(output, key) {
  const normalizedOutput = normalizeText(output);
  if (!normalizedOutput || !key) {
    return '';
  }

  const pattern = new RegExp(`^${key}=([^\\n\\r]+)$`, 'm');
  const match = normalizedOutput.match(pattern);
  return normalizeText(match?.[1]);
}

function resolveAppBundlePath(app, fallbackExecPath = process.execPath) {
  const candidatePaths = [];

  if (app && typeof app.getPath === 'function') {
    try {
      candidatePaths.push(app.getPath('exe'));
    } catch {
      // noop
    }
  }
  candidatePaths.push(fallbackExecPath);

  for (const candidate of candidatePaths) {
    const normalizedCandidate = normalizeText(candidate);
    if (!normalizedCandidate) {
      continue;
    }

    if (normalizedCandidate.endsWith('.app')) {
      return normalizedCandidate;
    }

    const markerIndex = normalizedCandidate.lastIndexOf('.app/');
    if (markerIndex >= 0) {
      return normalizedCandidate.slice(0, markerIndex + '.app'.length);
    }
  }

  return '';
}

function probeMacUpdaterSignatureSupport({
  app,
  spawnSyncImpl = spawnSync,
} = {}) {
  const appBundlePath = resolveAppBundlePath(app);
  if (!appBundlePath) {
    return {
      supported: false,
      reason: 'mac_unsigned_build',
    };
  }

  const result = spawnSyncImpl('codesign', ['-dvv', appBundlePath], {
    encoding: 'utf8',
  });
  if (result?.error || result?.status !== 0) {
    return {
      supported: false,
      reason: 'mac_unsigned_build',
    };
  }

  const rawOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
  const signature = extractCodesignField(rawOutput, 'Signature').toLowerCase();
  if (signature.includes('adhoc')) {
    return {
      supported: false,
      reason: 'mac_unsigned_build',
    };
  }

  return {
    supported: true,
    reason: '',
  };
}

class AppUpdaterService {
  constructor({
    app,
    autoUpdater = null,
    emitState,
    logger = console,
    platform = process.platform,
    macSignatureProbe = probeMacUpdaterSignatureSupport,
  } = {}) {
    this.app = app;
    this.autoUpdater = resolveAutoUpdater(autoUpdater);
    this.emitState = typeof emitState === 'function' ? emitState : () => {};
    this.logger = logger || console;
    this.platform = normalizeText(platform) || process.platform;
    this.macSignatureProbe = typeof macSignatureProbe === 'function'
      ? macSignatureProbe
      : probeMacUpdaterSignatureSupport;
    this.supportState = this.resolveSupportState();
    this.listeners = [];
    this.state = {
      status: 'idle',
      updateInfo: null,
      progress: null,
      checkedAt: '',
      error: null,
      available: false,
      downloaded: false,
      supported: this.supportState.supported,
      supportReason: this.supportState.reason,
    };

    this.initUpdater();
  }

  resolveSupportState() {
    if (!this.autoUpdater) {
      return {
        supported: false,
        reason: 'updater_unavailable',
      };
    }

    if (!this.app || typeof this.app.isPackaged !== 'boolean' || !this.app.isPackaged) {
      return {
        supported: false,
        reason: 'app_not_packaged',
      };
    }

    if (this.platform === 'darwin') {
      try {
        const macSignatureSupport = this.macSignatureProbe({
          app: this.app,
        });
        if (!macSignatureSupport?.supported) {
          return {
            supported: false,
            reason:
              normalizeText(macSignatureSupport?.reason)
              || 'mac_unsigned_build',
          };
        }
      } catch (error) {
        this.logger.warn?.('Failed to probe macOS app signature support:', error);
      }
    }

    return {
      supported: true,
      reason: '',
    };
  }

  isSupported() {
    return Boolean(this.supportState?.supported);
  }

  getSupportReason() {
    return normalizeText(this.supportState?.reason);
  }

  getUnsupportedResult() {
    return {
      ok: false,
      reason: this.getSupportReason() || 'updater_unavailable',
    };
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
        downloaded: false,
        progress: null,
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
      supportReason: this.getSupportReason(),
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
      supportReason: normalizeText(this.state.supportReason),
    };
  }

  async checkForUpdates() {
    if (!this.isSupported()) {
      return this.getUnsupportedResult();
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
    if (!this.isSupported()) {
      return this.getUnsupportedResult();
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
    if (!this.isSupported()) {
      return this.getUnsupportedResult();
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
  probeMacUpdaterSignatureSupport,
  resolveAppBundlePath,
  toUpdaterError,
};
