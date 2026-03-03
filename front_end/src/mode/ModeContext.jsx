import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { desktopBridge } from '../services/desktopBridge.js';
import { notifyWithHandshake } from './useModeHandshake.js';

export const MODE_WINDOW = 'window';
export const MODE_PET = 'pet';

const defaultModeValue = {
  mode: MODE_WINDOW,
  isPetMode: false,
  setMode: async () => ({ ok: false, mode: MODE_WINDOW }),
};

const ModeContext = createContext(defaultModeValue);

export function normalizeMode(mode) {
  return mode === MODE_PET ? MODE_PET : MODE_WINDOW;
}

export function createModeController({ desktopMode, bridge, onMode }) {
  const safeBridge = bridge || {};
  const disposerList = [];

  if (desktopMode && typeof safeBridge.onPreChanged === 'function') {
    const detach = safeBridge.onPreChanged((nextMode) => {
      const normalizedMode = normalizeMode(nextMode);
      onMode(normalizedMode);
      notifyWithHandshake(safeBridge.notifyRendererReady, normalizedMode);
    });
    disposerList.push(detach);
  }

  if (desktopMode && typeof safeBridge.onChanged === 'function') {
    const detach = safeBridge.onChanged((nextMode) => {
      const normalizedMode = normalizeMode(nextMode);
      onMode(normalizedMode);
      notifyWithHandshake(safeBridge.notifyModeRendered, normalizedMode);
    });
    disposerList.push(detach);
  }

  return {
    async init() {
      if (!desktopMode || typeof safeBridge.getCurrent !== 'function') {
        onMode(MODE_WINDOW);
        return MODE_WINDOW;
      }

      try {
        const result = await safeBridge.getCurrent();
        const normalizedMode = normalizeMode(result?.mode);
        onMode(normalizedMode);
        return normalizedMode;
      } catch (error) {
        console.error('Failed to load current window mode:', error);
        onMode(MODE_WINDOW);
        return MODE_WINDOW;
      }
    },
    async setMode(nextMode) {
      const normalizedMode = normalizeMode(nextMode);

      if (!desktopMode || typeof safeBridge.set !== 'function') {
        onMode(normalizedMode);
        return { ok: false, mode: normalizedMode };
      }

      try {
        return await safeBridge.set(normalizedMode);
      } catch (error) {
        console.error('Failed to switch window mode:', error);
        return { ok: false, mode: normalizedMode };
      }
    },
    dispose() {
      disposerList.forEach((dispose) => {
        if (typeof dispose === 'function') {
          dispose();
        }
      });
    },
  };
}

export function ModeProvider({
  children,
  desktopMode = desktopBridge.isDesktop(),
  bridge = desktopBridge.mode,
}) {
  const [mode, setMode] = useState(MODE_WINDOW);
  const controllerRef = useRef(null);

  useEffect(() => {
    const controller = createModeController({
      desktopMode,
      bridge,
      onMode: setMode,
    });

    controllerRef.current = controller;
    void controller.init();

    return () => {
      controller.dispose();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [bridge, desktopMode]);

  const setModeSafely = useCallback((nextMode) => {
    const controller = controllerRef.current;
    if (!controller) {
      return Promise.resolve({ ok: false, mode: normalizeMode(nextMode) });
    }

    return controller.setMode(nextMode);
  }, []);

  const value = useMemo(
    () => ({
      mode,
      isPetMode: mode === MODE_PET,
      setMode: setModeSafely,
    }),
    [mode, setModeSafely],
  );

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useModeContext() {
  return useContext(ModeContext);
}
