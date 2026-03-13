const path = require('node:path');
const {
  BrowserWindow,
  desktopCapturer,
  screen,
  systemPreferences,
} = require('electron');

const CAPTURE_SELECTION_TIMEOUT_MS = 3 * 60 * 1000;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRect(selection = {}, bounds = {}) {
  const maxWidth = Math.max(0, Number(bounds.width) || 0);
  const maxHeight = Math.max(0, Number(bounds.height) || 0);
  if (!maxWidth || !maxHeight) {
    return null;
  }

  const startX = clamp(Number(selection.startX) || 0, 0, maxWidth);
  const startY = clamp(Number(selection.startY) || 0, 0, maxHeight);
  const endX = clamp(Number(selection.endX) || 0, 0, maxWidth);
  const endY = clamp(Number(selection.endY) || 0, 0, maxHeight);

  const x = Math.floor(Math.min(startX, endX));
  const y = Math.floor(Math.min(startY, endY));
  const width = Math.floor(Math.abs(endX - startX));
  const height = Math.floor(Math.abs(endY - startY));
  if (width < 2 || height < 2) {
    return null;
  }

  return { x, y, width, height };
}

class ScreenshotSelectionService {
  constructor(app, {
    screenshotCaptureService,
    getOverlayPreloadPath,
    getRendererDevUrl,
    browserWindowFactory = (options) => new BrowserWindow(options),
    desktopCapturerModule = desktopCapturer,
    screenModule = screen,
    systemPreferencesModule = systemPreferences,
    platform = process.platform,
  } = {}) {
    this.app = app;
    this.screenshotCaptureService = screenshotCaptureService;
    this.getOverlayPreloadPath = getOverlayPreloadPath;
    this.getRendererDevUrl = getRendererDevUrl;
    this.browserWindowFactory = browserWindowFactory;
    this.desktopCapturer = desktopCapturerModule;
    this.screen = screenModule;
    this.systemPreferences = systemPreferencesModule;
    this.platform = platform;

    this.activeSession = null;
  }

  hasActiveSession() {
    return Boolean(this.activeSession);
  }

  async startSelection(ownerWindow) {
    if (this.activeSession) {
      return {
        ok: false,
        canceled: false,
        reason: 'capture_in_progress',
      };
    }

    if (!ownerWindow || ownerWindow.isDestroyed()) {
      return {
        ok: false,
        canceled: false,
        reason: 'window_unavailable',
      };
    }

    const targetDisplay = this.screen.getDisplayMatching(ownerWindow.getBounds());
    const ownerState = {
      wasVisible: ownerWindow.isVisible(),
      wasFocused: typeof ownerWindow.isFocused === 'function' ? ownerWindow.isFocused() : false,
    };

    const session = {
      ownerWindow,
      overlayWindow: null,
      display: targetDisplay,
      ownerState,
      snapshotImage: null,
      snapshotDataUrl: '',
      snapshotSize: { width: 0, height: 0 },
      resolveResult: null,
      settled: false,
    };
    this.activeSession = session;

    let sessionTimeoutId = null;

    try {
      if (ownerState.wasVisible) {
        ownerWindow.hide();
      }

      await delay(160);
      const snapshot = await this.captureDisplay(targetDisplay);
      session.snapshotImage = snapshot.image;
      session.snapshotDataUrl = snapshot.dataUrl;
      session.snapshotSize = snapshot.size;

      const resultPromise = new Promise((resolve) => {
        session.resolveResult = resolve;
      });
      sessionTimeoutId = setTimeout(() => {
        if (this.activeSession !== session) {
          return;
        }
        void this.finishSession({
          ok: false,
          canceled: true,
          reason: 'capture_selection_timeout',
        });
      }, CAPTURE_SELECTION_TIMEOUT_MS);
      try {
        session.overlayWindow = await this.createOverlayWindow(targetDisplay);
      } catch (error) {
        await this.finishSession({
          ok: false,
          canceled: false,
          reason: error?.message || 'capture_overlay_failed',
        });
      }

      const result = await resultPromise;

      return result;
    } catch (error) {
      await this.finishSession();
      return {
        ok: false,
        canceled: false,
        reason: error?.message || 'capture_not_supported',
      };
    } finally {
      if (sessionTimeoutId) {
        clearTimeout(sessionTimeoutId);
      }
    }
  }

  async captureDisplay(display) {
    const width = Math.max(1, Math.round((display?.bounds?.width || 1) * (display?.scaleFactor || 1)));
    const height = Math.max(1, Math.round((display?.bounds?.height || 1) * (display?.scaleFactor || 1)));
    const sources = await this.desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
      fetchWindowIcons: false,
    });

    if (!Array.isArray(sources) || !sources.length) {
      throw new Error(this.resolveCaptureUnavailableReason());
    }

    const matchedSource = sources.find((source) => source.display_id === String(display?.id || '')) || sources[0];
    if (!matchedSource?.thumbnail || matchedSource.thumbnail.isEmpty()) {
      throw new Error(this.resolveCaptureUnavailableReason());
    }

    return {
      image: matchedSource.thumbnail,
      dataUrl: matchedSource.thumbnail.toDataURL(),
      size: matchedSource.thumbnail.getSize(),
    };
  }

  resolveCaptureUnavailableReason() {
    if (
      this.platform === 'darwin'
      && this.systemPreferences
      && typeof this.systemPreferences.getMediaAccessStatus === 'function'
    ) {
      try {
        const status = String(this.systemPreferences.getMediaAccessStatus('screen') || '').toLowerCase();
        if (status === 'denied' || status === 'restricted' || status === 'not-determined') {
          return 'capture_permission_denied';
        }
      } catch {
        // Ignore runtime/platform capability checks and fall back to generic reason.
      }
    }

    return 'capture_not_supported';
  }

  async createOverlayWindow(display) {
    const preload = typeof this.getOverlayPreloadPath === 'function'
      ? this.getOverlayPreloadPath()
      : path.join(__dirname, '..', 'preload.js');
    const overlayWindow = this.browserWindowFactory({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      show: false,
      frame: false,
      transparent: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: true,
      skipTaskbar: true,
      focusable: true,
      alwaysOnTop: true,
      backgroundColor: '#000000',
      fullscreenable: false,
      titleBarStyle: 'hidden',
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWindow.webContents.once('did-finish-load', () => {
      if (overlayWindow.isDestroyed()) {
        return;
      }
      overlayWindow.focus();
      overlayWindow.webContents.focus();
    });
    overlayWindow.once('ready-to-show', () => {
      overlayWindow.show();
      overlayWindow.focus();
      overlayWindow.webContents.focus();
    });

    overlayWindow.on('closed', () => {
      if (!this.activeSession || this.activeSession.overlayWindow !== overlayWindow) {
        return;
      }

      void this.cancelSelection({
        sender: null,
        reason: 'capture_canceled',
      });
    });

    if (this.app.isPackaged) {
      const filePath = path.join(this.app.getAppPath(), 'front_end', 'dist', 'screenshot-overlay.html');
      await overlayWindow.loadFile(filePath);
    } else {
      const baseUrl = typeof this.getRendererDevUrl === 'function' ? this.getRendererDevUrl() : 'http://127.0.0.1:3000';
      await overlayWindow.loadURL(`${baseUrl.replace(/\/$/, '')}/screenshot-overlay.html`);
    }

    return overlayWindow;
  }

  getOverlaySession(senderFrame) {
    const session = this.activeSession;
    if (!session || !session.overlayWindow || session.overlayWindow.isDestroyed()) {
      return {
        ok: false,
        reason: 'capture_session_unavailable',
      };
    }

    if (senderFrame && senderFrame !== session.overlayWindow.webContents) {
      return {
        ok: false,
        reason: 'capture_session_unavailable',
      };
    }

    return {
      ok: true,
      imageUrl: session.snapshotDataUrl,
      displayBounds: {
        ...session.display.bounds,
      },
      imageSize: {
        ...session.snapshotSize,
      },
    };
  }

  async confirmSelection({ sender, selection }) {
    const session = this.activeSession;
    if (!session || !session.overlayWindow || session.overlayWindow.isDestroyed()) {
      return {
        ok: false,
        reason: 'capture_session_unavailable',
      };
    }

    if (sender && sender !== session.overlayWindow.webContents) {
      return {
        ok: false,
        reason: 'capture_session_unavailable',
      };
    }

    const normalizedSelection = normalizeRect(selection, session.display.bounds);
    if (!normalizedSelection) {
      return {
        ok: false,
        reason: 'capture_selection_invalid',
      };
    }

    const scaleX = session.snapshotSize.width / session.display.bounds.width;
    const scaleY = session.snapshotSize.height / session.display.bounds.height;
    const cropRect = {
      x: clamp(Math.floor(normalizedSelection.x * scaleX), 0, Math.max(0, session.snapshotSize.width - 1)),
      y: clamp(Math.floor(normalizedSelection.y * scaleY), 0, Math.max(0, session.snapshotSize.height - 1)),
      width: clamp(Math.max(1, Math.floor(normalizedSelection.width * scaleX)), 1, session.snapshotSize.width),
      height: clamp(Math.max(1, Math.floor(normalizedSelection.height * scaleY)), 1, session.snapshotSize.height),
    };

    cropRect.width = Math.min(cropRect.width, session.snapshotSize.width - cropRect.x);
    cropRect.height = Math.min(cropRect.height, session.snapshotSize.height - cropRect.y);

    const croppedImage = session.snapshotImage.crop(cropRect);
    const dataUrl = croppedImage.toDataURL();
    const saveResult = await this.screenshotCaptureService.saveCapture({
      dataUrl,
      name: `screenshot-${Date.now()}.png`,
    });

    const result = {
      ...saveResult,
      previewUrl: dataUrl,
    };

    setImmediate(() => {
      void this.finishSession(result);
    });
    return {
      ok: true,
    };
  }

  async cancelSelection({ sender, reason = 'capture_canceled' } = {}) {
    const session = this.activeSession;
    if (!session) {
      return {
        ok: false,
        reason: 'capture_session_unavailable',
      };
    }

    if (sender && session.overlayWindow && sender !== session.overlayWindow.webContents) {
      return {
        ok: false,
        reason: 'capture_session_unavailable',
      };
    }

    const finalize = () => this.finishSession({
      ok: false,
      canceled: true,
      reason,
    });

    if (sender) {
      setImmediate(() => {
        void finalize();
      });
    } else {
      await finalize();
    }

    return {
      ok: true,
    };
  }

  async finishSession(result = null) {
    const session = this.activeSession;
    if (!session) {
      return;
    }

    this.activeSession = null;
    session.settled = true;

    if (session.overlayWindow && !session.overlayWindow.isDestroyed()) {
      session.overlayWindow.removeAllListeners('closed');
      session.overlayWindow.close();
    }

    if (session.ownerWindow && !session.ownerWindow.isDestroyed() && session.ownerState.wasVisible) {
      if (typeof session.ownerWindow.showInactive === 'function') {
        session.ownerWindow.showInactive();
      } else {
        session.ownerWindow.show();
      }

      if (session.ownerState.wasFocused && typeof session.ownerWindow.focus === 'function') {
        session.ownerWindow.focus();
      }
    }

    if (typeof session.resolveResult === 'function') {
      session.resolveResult(result || {
        ok: false,
        canceled: true,
        reason: 'capture_canceled',
      });
    }
  }
}

module.exports = {
  ScreenshotSelectionService,
};
