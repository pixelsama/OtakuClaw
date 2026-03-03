import React from 'react';
import ReactDOM from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import App from './App.jsx';
import {
  THEME_MODE_DARK,
  ThemeModeProvider,
  useThemeMode,
} from './theme/ThemeModeContext.jsx';
import './styles.css';

function ThemedApp() {
  const { resolvedThemeMode } = useThemeMode();

  const theme = React.useMemo(
    () =>
      createTheme({
        palette: {
          mode: resolvedThemeMode,
          primary: {
            main: resolvedThemeMode === THEME_MODE_DARK ? '#60a5fa' : '#1976d2',
          },
          background: {
            default: 'transparent',
            paper: resolvedThemeMode === THEME_MODE_DARK ? '#101826' : '#ffffff',
          },
        },
        shape: {
          borderRadius: 12,
        },
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              html: {
                backgroundColor: 'transparent',
              },
              body: {
                backgroundColor: 'transparent',
              },
              '#root': {
                backgroundColor: 'transparent',
              },
            },
          },
        },
      }),
    [resolvedThemeMode],
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeModeProvider>
      <ThemedApp />
    </ThemeModeProvider>
  </React.StrictMode>,
);
