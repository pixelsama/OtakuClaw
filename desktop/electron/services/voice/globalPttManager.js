function normalizePttHotkey(value) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (normalized === ' ' || normalized === 'SPACE') {
    return 'SPACE';
  }
  if (/^F([1-9]|1[0-2])$/.test(normalized)) {
    return normalized;
  }
  return 'F8';
}

class GlobalPttManager {
  constructor({ emitCommand, emitStatus, logger = console } = {}) {
    this.emitCommand = typeof emitCommand === 'function' ? emitCommand : () => {};
    this.emitStatus = typeof emitStatus === 'function' ? emitStatus : () => {};
    this.logger = logger;
    this.hotkey = 'F8';
    this.keycode = 0;
    this.pressed = false;
    this.started = false;
    this.module = null;
    this.keyMap = null;
    this.onKeyDown = null;
    this.onKeyUp = null;
  }

  updateSettings(settings = {}) {
    this.hotkey = normalizePttHotkey(settings?.voice?.pttHotkey);
    this.keycode = this.resolveKeycode(this.hotkey);
    this.emitCurrentStatus();
  }

  emitCurrentStatus(extra = {}) {
    this.emitStatus({
      available: Boolean(this.started && this.keycode),
      hotkey: this.hotkey,
      ...extra,
    });
  }

  resolveKeycode(hotkey) {
    if (!this.keyMap) {
      return 0;
    }
    if (hotkey === 'SPACE') {
      return this.keyMap.Space || 0;
    }
    return this.keyMap[hotkey] || 0;
  }

  ensureModule() {
    if (this.module) {
      return true;
    }

    try {
      const loaded = require('uiohook-napi');
      this.module = loaded.uIOhook;
      this.keyMap = loaded.UiohookKey;
      this.keycode = this.resolveKeycode(this.hotkey);
      return Boolean(this.module && this.keyMap);
    } catch (error) {
      this.logger.warn('Failed to load global PTT hook module:', error);
      this.emitCurrentStatus({
        available: false,
        error: error?.message || 'ptt_hook_module_unavailable',
      });
      return false;
    }
  }

  start() {
    if (this.started) {
      this.emitCurrentStatus();
      return;
    }
    if (!this.ensureModule()) {
      return;
    }

    this.onKeyDown = (event = {}) => {
      if (!this.keycode || event.keycode !== this.keycode || this.pressed) {
        return;
      }
      this.pressed = true;
      this.emitCommand({ action: 'start', hotkey: this.hotkey });
    };

    this.onKeyUp = (event = {}) => {
      if (!this.keycode || event.keycode !== this.keycode || !this.pressed) {
        return;
      }
      this.pressed = false;
      this.emitCommand({ action: 'stop', hotkey: this.hotkey });
    };

    this.module.on('keydown', this.onKeyDown);
    this.module.on('keyup', this.onKeyUp);

    try {
      this.module.start();
      this.started = true;
      this.emitCurrentStatus();
    } catch (error) {
      this.logger.warn('Failed to start global PTT hook:', error);
      if (typeof this.module.removeListener === 'function') {
        this.module.removeListener('keydown', this.onKeyDown);
        this.module.removeListener('keyup', this.onKeyUp);
      }
      this.onKeyDown = null;
      this.onKeyUp = null;
      this.emitCurrentStatus({
        available: false,
        error: error?.message || 'ptt_hook_start_failed',
      });
    }
  }

  stop() {
    if (!this.module) {
      return;
    }

    if (typeof this.module.removeListener === 'function') {
      if (this.onKeyDown) {
        this.module.removeListener('keydown', this.onKeyDown);
      }
      if (this.onKeyUp) {
        this.module.removeListener('keyup', this.onKeyUp);
      }
    }

    try {
      if (this.started) {
        this.module.stop();
      }
    } catch (error) {
      this.logger.warn('Failed to stop global PTT hook:', error);
    }

    this.started = false;
    this.pressed = false;
    this.onKeyDown = null;
    this.onKeyUp = null;
    this.emitCurrentStatus({ available: false });
  }
}

module.exports = {
  GlobalPttManager,
  normalizePttHotkey,
};
