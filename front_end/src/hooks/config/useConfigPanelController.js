import { useCallback, useEffect, useRef, useState } from 'react';

const CLOSE_PANEL_SYNC_DELAY_MS = 260;

export function useConfigPanelController({ isPetMode, live2dViewerRef }) {
  const configPanelWindowResizedRef = useRef(false);
  const closePanelSyncTimeoutRef = useRef(null);
  const [showConfigPanel, setShowConfigPanel] = useState(false);

  const openConfigPanel = useCallback(() => {
    configPanelWindowResizedRef.current = false;
    setShowConfigPanel(true);
  }, []);

  const closeConfigPanel = useCallback(() => {
    const shouldSyncCanvas = configPanelWindowResizedRef.current;
    configPanelWindowResizedRef.current = false;
    setShowConfigPanel(false);

    if (!shouldSyncCanvas) {
      return;
    }

    if (closePanelSyncTimeoutRef.current) {
      window.clearTimeout(closePanelSyncTimeoutRef.current);
    }

    closePanelSyncTimeoutRef.current = window.setTimeout(() => {
      closePanelSyncTimeoutRef.current = null;
      live2dViewerRef.current?.syncCanvasSize?.();
    }, CLOSE_PANEL_SYNC_DELAY_MS);
  }, [live2dViewerRef]);

  useEffect(() => {
    if (!isPetMode) {
      return;
    }

    configPanelWindowResizedRef.current = false;
    if (closePanelSyncTimeoutRef.current) {
      window.clearTimeout(closePanelSyncTimeoutRef.current);
      closePanelSyncTimeoutRef.current = null;
    }

    setShowConfigPanel(false);
  }, [isPetMode]);

  useEffect(() => {
    if (!showConfigPanel || isPetMode) {
      return undefined;
    }

    const markWindowResized = () => {
      configPanelWindowResizedRef.current = true;
    };

    window.addEventListener('resize', markWindowResized);
    return () => {
      window.removeEventListener('resize', markWindowResized);
    };
  }, [isPetMode, showConfigPanel]);

  useEffect(
    () => () => {
      if (closePanelSyncTimeoutRef.current) {
        window.clearTimeout(closePanelSyncTimeoutRef.current);
      }
    },
    [],
  );

  return {
    showConfigPanel,
    openConfigPanel,
    closeConfigPanel,
  };
}
