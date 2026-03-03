const assert = require('node:assert/strict');
const test = require('node:test');

const { WindowModeManager } = require('../window/windowModeManager');

function createFakeWindow() {
  const state = {
    bounds: { x: 100, y: 100, width: 1200, height: 800 },
    ignoreMouse: false,
  };

  return {
    state,
    sent: [],
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
    setAlwaysOnTop() {},
    setSkipTaskbar() {},
    setResizable() {},
    setFocusable() {},
    setMovable() {},
    setIgnoreMouseEvents(ignore) {
      state.ignoreMouse = ignore;
    },
    webContents: {
      send() {},
    },
  };
}

test('mouse passthrough follows hover set in pet mode', () => {
  const manager = new WindowModeManager();
  manager.getCombinedDisplayBounds = () => ({ x: 0, y: 0, width: 1920, height: 1080 });

  const fakeWindow = createFakeWindow();
  manager.attachWindow(fakeWindow);
  manager.requestModeChange('pet');
  manager.applyPendingMode('pet');

  assert.equal(fakeWindow.state.ignoreMouse, true);

  manager.updateComponentHover('live2d', true);
  assert.equal(fakeWindow.state.ignoreMouse, false);

  manager.updateComponentHover('live2d', false);
  assert.equal(fakeWindow.state.ignoreMouse, true);
});

test('force ignore mouse overrides hover state', () => {
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
});
