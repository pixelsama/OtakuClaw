import { useEffect, useState } from 'react';
import { desktopBridge } from '../../services/desktopBridge.js';

export function usePlatformInfo({ desktopMode }) {
  const [platform, setPlatform] = useState(() =>
    desktopMode ? desktopBridge.window.getPlatformSync() : 'unknown',
  );

  useEffect(() => {
    if (!desktopMode) {
      return;
    }

    let mounted = true;
    const loadPlatform = async () => {
      try {
        const result = await desktopBridge.window.getPlatform();
        if (!mounted) {
          return;
        }

        setPlatform(result?.platform || 'unknown');
      } catch (error) {
        console.error('Failed to load platform info:', error);
      }
    };

    void loadPlatform();

    return () => {
      mounted = false;
    };
  }, [desktopMode]);

  return platform;
}
