import { useEffect } from 'react';
import { MODE_PET } from '../../mode/ModeContext.jsx';
import { desktopBridge } from '../../services/desktopBridge.js';

export function normalizePetCursorContext(context) {
  if (!context?.ok || context.mode !== MODE_PET) {
    return null;
  }

  const { cursor, desktopBounds } = context;
  const width = desktopBounds?.width ?? 0;
  const height = desktopBounds?.height ?? 0;
  if (!cursor || width <= 0 || height <= 0) {
    return null;
  }

  const normalizedX = ((cursor.x - desktopBounds.x) / width) * 2.0 - 1.0;
  const normalizedY = -(((cursor.y - desktopBounds.y) / height) * 2.0 - 1.0);
  return {
    normalizedX,
    normalizedY,
  };
}

export function usePetCursorTracking({
  desktopMode,
  isPetMode,
  live2dViewerRef,
  intervalMs = 33,
}) {
  useEffect(() => {
    if (!desktopMode || !isPetMode) {
      return undefined;
    }

    let disposed = false;
    let timerId = null;

    const pollGlobalCursor = async () => {
      try {
        const context = await desktopBridge.window.getCursorContext();
        if (disposed) {
          return;
        }

        const normalizedCursor = normalizePetCursorContext(context);
        if (!normalizedCursor) {
          return;
        }

        live2dViewerRef.current?.setPointerNormalized?.(
          normalizedCursor.normalizedX,
          normalizedCursor.normalizedY,
        );
      } catch {
        // noop
      } finally {
        if (!disposed) {
          timerId = window.setTimeout(() => {
            void pollGlobalCursor();
          }, intervalMs);
        }
      }
    };

    void pollGlobalCursor();

    return () => {
      disposed = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
  }, [desktopMode, intervalMs, isPetMode, live2dViewerRef]);
}
