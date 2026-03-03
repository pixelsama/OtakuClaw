import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const THEME_MODE_LIGHT = 'light';
export const THEME_MODE_DARK = 'dark';
export const THEME_MODE_SYSTEM = 'system';

const THEME_MODE_STORAGE_KEY = 'app.themeMode';
const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';

function isBrowser() {
  return typeof window !== 'undefined';
}

function getSystemThemeMode() {
  if (!isBrowser() || typeof window.matchMedia !== 'function') {
    return THEME_MODE_LIGHT;
  }

  return window.matchMedia(THEME_MEDIA_QUERY).matches ? THEME_MODE_DARK : THEME_MODE_LIGHT;
}

function normalizeThemeMode(value) {
  if (value === THEME_MODE_LIGHT || value === THEME_MODE_DARK || value === THEME_MODE_SYSTEM) {
    return value;
  }
  return THEME_MODE_SYSTEM;
}

function getStoredThemeMode() {
  if (!isBrowser()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
    return raw ? normalizeThemeMode(raw) : null;
  } catch {
    return null;
  }
}

function getInitialThemeMode() {
  return getStoredThemeMode() || THEME_MODE_SYSTEM;
}

const ThemeModeContext = createContext({
  themeMode: THEME_MODE_SYSTEM,
  resolvedThemeMode: THEME_MODE_LIGHT,
  setThemeMode: () => {},
});

export function ThemeModeProvider({ children }) {
  const [themeMode, setThemeModeState] = useState(getInitialThemeMode);
  const [systemThemeMode, setSystemThemeMode] = useState(getSystemThemeMode);

  useEffect(() => {
    if (!isBrowser() || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQueryList = window.matchMedia(THEME_MEDIA_QUERY);

    const handleChange = (event) => {
      setSystemThemeMode(event.matches ? THEME_MODE_DARK : THEME_MODE_LIGHT);
    };

    setSystemThemeMode(mediaQueryList.matches ? THEME_MODE_DARK : THEME_MODE_LIGHT);

    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleChange);
      return () => {
        mediaQueryList.removeEventListener('change', handleChange);
      };
    }

    mediaQueryList.addListener(handleChange);
    return () => {
      mediaQueryList.removeListener(handleChange);
    };
  }, []);

  const setThemeMode = useCallback((nextMode) => {
    const normalized = normalizeThemeMode(nextMode);
    setThemeModeState(normalized);

    if (!isBrowser()) {
      return;
    }

    try {
      window.localStorage.setItem(THEME_MODE_STORAGE_KEY, normalized);
    } catch {
      // ignore storage failures
    }
  }, []);

  const resolvedThemeMode = themeMode === THEME_MODE_SYSTEM ? systemThemeMode : themeMode;

  const contextValue = useMemo(
    () => ({
      themeMode,
      resolvedThemeMode,
      setThemeMode,
    }),
    [themeMode, resolvedThemeMode, setThemeMode],
  );

  return <ThemeModeContext.Provider value={contextValue}>{children}</ThemeModeContext.Provider>;
}

export function useThemeMode() {
  return useContext(ThemeModeContext);
}
