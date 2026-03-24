const assert = require('node:assert/strict');
const test = require('node:test');

const { WindowModeManager } = require('../window/windowModeManager');

function createFakeWindow() {
  const sent = [];
  const state = {
    bounds: { x: 100, y: 100, width: 1200, height: 800 },
    ignoreMouse: false,
    alwaysOnTop: false,
    opacity: 1,
  };

  return {
    state,
    sent,
    isDestroyed() {
      return false;
    },
    setOpacity(value) {
      state.opacity = value;
    },
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

  const initialBounds = fakeWindow.getBounds();

  manager.requestModeChange('pet');
  assert.equal(fakeWindow.sent.at(-1).channel, 'pet:pre-mode-changed');

  manager.applyPendingMode('pet');
  assert.equal(manager.getMode(), 'pet');
  assert.equal(fakeWindow.state.alwaysOnTop, true);
  assert.equal(fakeWindow.state.ignoreMouse, true);
  assert.equal(fakeWindow.state.opacity, 0);
  assert.deepEqual(fakeWindow.getBounds(), { x: 0, y: 0, width: 1920, height: 1080 });
  assert.equal(fakeWindow.sent.at(-1).channel, 'pet:mode-changed');

  manager.notifyModeRendered();
  assert.equal(fakeWindow.state.opacity, 1);

  manager.requestModeChange('window');
  manager.applyPendingMode('window');
  assert.equal(manager.getMode(), 'window');
  assert.deepEqual(fakeWindow.getBounds(), initialBounds);
});

test('window mode manager recovers opacity when renderer rendered ack is missing', async () => {
  const manager = new WindowModeManager({
    modeSwitchHandshakeTimeoutMs: 10,
    modeRenderedFallbackTimeoutMs: 30,
  });
  manager.getCombinedDisplayBounds = () => ({ x: 0, y: 0, width: 1920, height: 1080 });

  const fakeWindow = createFakeWindow();
  manager.attachWindow(fakeWindow);

  manager.requestModeChange('pet');
  assert.equal(fakeWindow.state.opacity, 0);

  await new Promise((resolve) => setTimeout(resolve, 420));

  assert.equal(manager.getMode(), 'pet');
  assert.equal(fakeWindow.state.opacity, 1);
});
