const assert = require('node:assert/strict');
const test = require('node:test');

const { WindowModeManager } = require('../window/windowModeManager');

function createFakeWindow() {
  const sent = [];
  const state = {
    bounds: { x: 100, y: 100, width: 1200, height: 800 },
    ignoreMouse: false,
    alwaysOnTop: false,
  };

  return {
    state,
    sent,
    isDestroyed() {
      return false;
    },
    setOpacity() {},
    setBounds(next) {
      state.bounds = { ...next };
    },
    getBounds() {
      return { ...state.bounds };
    },
    isFullScreen() {
      return false;
    },
    setFullScreen() {},
    setAlwaysOnTop(value) {
      state.alwaysOnTop = value;
    },
    setSkipTaskbar() {},
    setResizable() {},
    setFocusable() {},
    setMovable() {},
    setIgnoreMouseEvents(ignore) {
      state.ignoreMouse = ignore;
    },
    webContents: {
      send(channel, payload) {
        sent.push({ channel, payload });
      },
    },
  };
}

test('window mode manager switches to pet mode through handshake', () => {
  const manager = new WindowModeManager();
  manager.getCombinedDisplayBounds = () => ({ x: 0, y: 0, width: 1920, height: 1080 });

  const fakeWindow = createFakeWindow();
  manager.attachWindow(fakeWindow);

  manager.requestModeChange('pet');
  assert.equal(fakeWindow.sent.at(-1).channel, 'pet:pre-mode-changed');

  manager.applyPendingMode('pet');
  assert.equal(manager.getMode(), 'pet');
  assert.equal(fakeWindow.state.alwaysOnTop, true);
  assert.equal(fakeWindow.state.ignoreMouse, true);
  assert.equal(fakeWindow.sent.at(-1).channel, 'pet:mode-changed');
});

test('hover in pet mode disables mouse passthrough unless forced', () => {
  const manager = new WindowModeManager();
  manager.getCombinedDisplayBounds = () => ({ x: 0, y: 0, width: 1920, height: 1080 });

  const fakeWindow = createFakeWindow();
  manager.attachWindow(fakeWindow);
  manager.requestModeChange('pet');
  manager.applyPendingMode('pet');

  manager.updateComponentHover('live2d', true);
  assert.equal(fakeWindow.state.ignoreMouse, false);

  manager.toggleForceIgnoreMouse();
  assert.equal(fakeWindow.state.ignoreMouse, true);

  manager.toggleForceIgnoreMouse();
  assert.equal(fakeWindow.state.ignoreMouse, false);

  manager.updateComponentHover('live2d', false);
  assert.equal(fakeWindow.state.ignoreMouse, true);
});
