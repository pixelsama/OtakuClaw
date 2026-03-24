const { screen } = require('electron');

const MODE_WINDOW = 'window';
const MODE_PET = 'pet';

function isValidMode(mode) {
  return mode === MODE_WINDOW || mode === MODE_PET;
}

class WindowModeManager {
  constructor({
    platform = process.platform,
    modeSwitchHandshakeTimeoutMs = 400,
    modeRenderedFallbackTimeoutMs = 1200,
  } = {}) {
    this.platform = platform;
    this.isMac = platform === 'darwin';
    this.modeSwitchHandshakeTimeoutMs = Number.isFinite(modeSwitchHandshakeTimeoutMs)
      ? Math.max(100, Math.floor(modeSwitchHandshakeTimeoutMs))
      : 400;
    this.modeRenderedFallbackTimeoutMs = Number.isFinite(modeRenderedFallbackTimeoutMs)
      ? Math.max(200, Math.floor(modeRenderedFallbackTimeoutMs))
      : 1200;

    this.window = null;
    this.currentMode = MODE_WINDOW;
    this.pendingMode = null;
    this.pendingTimer = null;
    this.pendingOpacityRecoveryTimer = null;
    this.waitingForRenderedAck = false;

    this.windowedBounds = null;
    this.hoveringComponents = new Set();
    this.forceIgnoreMouse = false;
  }

  attachWindow(window) {
    this.window = window;
    this.applyWindowMode();
  }

  detachWindow() {
    this.window = null;
    this.clearPendingTimer();
    this.clearPendingOpacityRecoveryTimer();
    this.waitingForRenderedAck = false;
  }

  getMode() {
    return this.currentMode;
  }

  getForceIgnoreMouse() {
    return this.forceIgnoreMouse;
  }

  requestModeChange(mode) {
    if (!isValidMode(mode)) {
      return this.currentMode;
    }

    if (!this.window || this.window.isDestroyed()) {
      return this.currentMode;
    }

    if (this.pendingMode === mode) {
      return mode;
    }

    if (this.currentMode === mode) {
      this.emitModeChanged(mode);
      return mode;
    }

    this.pendingMode = mode;
    this.waitingForRenderedAck = false;
    this.clearPendingOpacityRecoveryTimer();
    this.window.setOpacity(0);
    this.window.webContents.send('pet:pre-mode-changed', { mode });

    // Fallback: if renderer handshake does not arrive, continue mode switch.
    this.clearPendingTimer();
    this.pendingTimer = setTimeout(() => {
      if (this.pendingMode === mode) {
        this.applyPendingMode(mode);
      }
    }, this.modeSwitchHandshakeTimeoutMs);

    return mode;
  }

  applyPendingMode(rendererReadyMode) {
    if (!this.pendingMode) {
      return null;
    }

    if (rendererReadyMode && rendererReadyMode !== this.pendingMode) {
      return null;
    }

    const nextMode = this.pendingMode;
    this.pendingMode = null;
    this.clearPendingTimer();
    this.currentMode = nextMode;

    if (nextMode === MODE_PET) {
      this.applyPetMode();
    } else {
      this.applyWindowMode();
    }

    this.waitingForRenderedAck = true;
    this.armOpacityRecoveryFallback();

    this.emitModeChanged(nextMode);

    return nextMode;
  }

  notifyModeRendered() {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    this.waitingForRenderedAck = false;
    this.clearPendingOpacityRecoveryTimer();
    this.window.setOpacity(1);
  }

  updateComponentHover(componentId, isHovering) {
    if (this.currentMode !== MODE_PET) {
      return;
    }

    if (!componentId) {
      return;
    }

    if (isHovering) {
      this.hoveringComponents.add(componentId);
    } else {
      this.hoveringComponents.delete(componentId);
    }

    if (!this.forceIgnoreMouse) {
      this.applyIgnoreMouseState();
    }
  }

  toggleForceIgnoreMouse() {
    this.forceIgnoreMouse = !this.forceIgnoreMouse;
    this.applyIgnoreMouseState();
    this.emitForceIgnoreMouseChanged();

    return this.forceIgnoreMouse;
  }

  setIgnoreMouseEvents(ignore) {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    if (ignore) {
      this.window.setIgnoreMouseEvents(true, { forward: true });
      return;
    }

    this.window.setIgnoreMouseEvents(false);
  }

  applyWindowMode() {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    const window = this.window;

    window.setAlwaysOnTop(false);
    window.setSkipTaskbar(false);
    window.setResizable(true);
    window.setFocusable(true);
    window.setMovable(true);
    window.setIgnoreMouseEvents(false);

    if (this.windowedBounds) {
      window.setBounds(this.windowedBounds);
    }

    this.hoveringComponents.clear();
    this.forceIgnoreMouse = false;
    this.emitForceIgnoreMouseChanged();
  }

  applyPetMode() {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    const window = this.window;
    this.windowedBounds = window.getBounds();

    if (window.isFullScreen()) {
      window.setFullScreen(false);
    }

    window.setBounds(this.getCombinedDisplayBounds());
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setSkipTaskbar(true);
    window.setResizable(false);
    window.setFocusable(false);
    window.setMovable(true);

    this.hoveringComponents.clear();
    this.applyIgnoreMouseState();
  }

  applyIgnoreMouseState() {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    if (this.currentMode !== MODE_PET && this.pendingMode !== MODE_PET) {
      this.setIgnoreMouseEvents(false);
      return;
    }

    const shouldIgnore = this.forceIgnoreMouse || this.hoveringComponents.size === 0;
    this.setIgnoreMouseEvents(shouldIgnore);

    if (this.isMac) {
      // In pet mode, use lower top level while interacting so macOS IME candidate window can appear above.
      this.window.setAlwaysOnTop(true, shouldIgnore ? 'screen-saver' : 'floating');
    }

    this.window.setFocusable(!shouldIgnore);
  }

  emitModeChanged(mode) {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    this.window.webContents.send('pet:mode-changed', { mode });
  }

  emitForceIgnoreMouseChanged() {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    this.window.webContents.send('pet:force-ignore-mouse-changed', {
      forceIgnoreMouse: this.forceIgnoreMouse,
    });
  }

  getCombinedDisplayBounds() {
    const displays = screen.getAllDisplays();
    const minX = Math.min(...displays.map((item) => item.bounds.x));
    const minY = Math.min(...displays.map((item) => item.bounds.y));
    const maxX = Math.max(...displays.map((item) => item.bounds.x + item.bounds.width));
    const maxY = Math.max(...displays.map((item) => item.bounds.y + item.bounds.height));

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  clearPendingTimer() {
    if (!this.pendingTimer) {
      return;
    }

    clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }

  armOpacityRecoveryFallback() {
    this.clearPendingOpacityRecoveryTimer();

    this.pendingOpacityRecoveryTimer = setTimeout(() => {
      if (!this.waitingForRenderedAck) {
        return;
      }
      if (!this.window || this.window.isDestroyed()) {
        return;
      }

      this.window.setOpacity(1);
      this.waitingForRenderedAck = false;
      this.pendingOpacityRecoveryTimer = null;
    }, this.modeRenderedFallbackTimeoutMs);
  }

  clearPendingOpacityRecoveryTimer() {
    if (!this.pendingOpacityRecoveryTimer) {
      return;
    }

    clearTimeout(this.pendingOpacityRecoveryTimer);
    this.pendingOpacityRecoveryTimer = null;
  }
}

module.exports = {
  MODE_WINDOW,
  MODE_PET,
  WindowModeManager,
};
