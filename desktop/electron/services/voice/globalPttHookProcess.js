const { normalizePttHotkey } = require('./globalPttManager');

let hook = null;
let keyMap = null;
let hotkey = 'F8';
let keycode = 0;
let pressed = false;
let started = false;
let onKeyDown = null;
let onKeyUp = null;

function send(message) {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

function currentStatus(error = '') {
  return {
    type: 'status',
    available: Boolean(started && keycode),
    hotkey,
    error,
  };
}

function resolveKeycode(nextHotkey) {
  if (!keyMap) {
    return 0;
  }
  if (nextHotkey === 'SPACE') {
    return keyMap.Space || 0;
  }
  return keyMap[nextHotkey] || 0;
}

function ensureHook() {
  if (hook && keyMap) {
    return true;
  }

  const loaded = require('uiohook-napi');
  hook = loaded.uIOhook;
  keyMap = loaded.UiohookKey;
  keycode = resolveKeycode(hotkey);
  return Boolean(hook && keyMap);
}

function configure(nextHotkey) {
  hotkey = normalizePttHotkey(nextHotkey);
  keycode = resolveKeycode(hotkey);
  send(currentStatus(''));
}

function startHook() {
  if (started) {
    send(currentStatus(''));
    return;
  }

  if (!ensureHook()) {
    send(currentStatus('ptt_hook_module_unavailable'));
    return;
  }

  onKeyDown = (event = {}) => {
    if (!keycode || event.keycode !== keycode || pressed) {
      return;
    }
    pressed = true;
    send({ type: 'command', action: 'start', hotkey });
  };

  onKeyUp = (event = {}) => {
    if (!keycode || event.keycode !== keycode || !pressed) {
      return;
    }
    pressed = false;
    send({ type: 'command', action: 'stop', hotkey });
  };

  hook.on('keydown', onKeyDown);
  hook.on('keyup', onKeyUp);
  hook.start();
  started = true;
  send(currentStatus(''));
}

function stopHook() {
  if (hook && typeof hook.removeListener === 'function') {
    if (onKeyDown) {
      hook.removeListener('keydown', onKeyDown);
    }
    if (onKeyUp) {
      hook.removeListener('keyup', onKeyUp);
    }
  }

  if (hook && started) {
    hook.stop();
  }

  onKeyDown = null;
  onKeyUp = null;
  pressed = false;
  started = false;
  send(currentStatus(''));
}

process.on('message', (message = {}) => {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'init') {
    hotkey = normalizePttHotkey(message.hotkey);
    send({ type: 'ready' });
    return;
  }

  if (message.type === 'configure') {
    configure(message.hotkey);
    return;
  }

  if (message.type === 'start') {
    startHook();
    return;
  }

  if (message.type === 'stop') {
    stopHook();
  }
});

process.on('disconnect', () => {
  try {
    stopHook();
  } catch {
    // noop
  }
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  send(currentStatus(error?.message || 'ptt_worker_uncaught_exception'));
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  send(currentStatus(error?.message || 'ptt_worker_unhandled_rejection'));
  process.exit(1);
});