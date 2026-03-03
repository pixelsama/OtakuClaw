import { describe, it, expect, vi } from 'vitest';
import { createModeController, MODE_PET, MODE_WINDOW } from '../src/mode/ModeContext.jsx';

function waitForHandshake() {
  return new Promise((resolve) => {
    setTimeout(resolve, 12);
  });
}

function createBridgeMock() {
  let preChangedHandler = null;
  let changedHandler = null;

  const bridge = {
    getCurrent: vi.fn(async () => ({ mode: MODE_WINDOW })),
    set: vi.fn(async (mode) => ({ ok: true, mode })),
    onPreChanged: vi.fn((handler) => {
      preChangedHandler = handler;
      return () => {
        preChangedHandler = null;
      };
    }),
    onChanged: vi.fn((handler) => {
      changedHandler = handler;
      return () => {
        changedHandler = null;
      };
    }),
    notifyRendererReady: vi.fn(),
    notifyModeRendered: vi.fn(),
  };

  return {
    bridge,
    emitPreChanged(mode) {
      preChangedHandler?.(mode);
    },
    emitChanged(mode) {
      changedHandler?.(mode);
    },
  };
}

describe('ModeContext controller', () => {
  it('setMode calls bridge and mode-changed event updates state', async () => {
    const bridgeMock = createBridgeMock();
    const modeHistory = [];

    const controller = createModeController({
      desktopMode: true,
      bridge: bridgeMock.bridge,
      onMode: (mode) => modeHistory.push(mode),
    });

    await controller.init();
    await controller.setMode(MODE_PET);

    expect(bridgeMock.bridge.set).toHaveBeenCalledWith(MODE_PET);

    bridgeMock.emitPreChanged(MODE_PET);
    bridgeMock.emitChanged(MODE_PET);
    await waitForHandshake();

    expect(modeHistory.at(-1)).toBe(MODE_PET);
    expect(bridgeMock.bridge.notifyRendererReady).toHaveBeenCalledWith(MODE_PET);
    expect(bridgeMock.bridge.notifyModeRendered).toHaveBeenCalledWith(MODE_PET);

    controller.dispose();
  });
});
