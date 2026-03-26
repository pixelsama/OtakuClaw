import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConfigDrawer from '../src/components/config/ConfigDrawer.jsx';

globalThis.React = React;

vi.mock('../src/components/controls/Live2DControls.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'live2d-controls-mock' }),
}));

vi.mock('../src/components/avatar/StaticAvatarControls.jsx', () => ({
  default: ({ renderMode }) => React.createElement('div', {
    'data-testid': 'static-avatar-controls-mock',
    'data-render-mode': renderMode,
  }),
}));

vi.mock('../src/components/config/VoiceSettingsPanel.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'voice-settings-panel-mock' }),
}));

vi.mock('../src/i18n/I18nContext.jsx', () => ({
  LANGUAGE_EN_US: 'en-US',
  LANGUAGE_ZH_CN: 'zh-CN',
  useI18n: () => ({
    language: 'zh-CN',
    setLanguage: () => {},
    t: (key) => key,
  }),
}));

vi.mock('../src/theme/ThemeModeContext.jsx', () => ({
  THEME_MODE_DARK: 'dark',
  THEME_MODE_LIGHT: 'light',
  THEME_MODE_SYSTEM: 'system',
  useThemeMode: () => ({
    themeMode: 'system',
    setThemeMode: () => {},
  }),
}));

function renderDrawer(avatarRenderMode) {
  return renderToStaticMarkup(
    React.createElement(ConfigDrawer, {
      open: true,
      isPetMode: false,
      isNarrowViewport: false,
      onClose: () => {},
      modelLoaded: false,
      desktopMode: false,
      live2dViewerRef: { current: null },
      avatarRenderMode,
      selectedStaticAvatarId: '',
      staticAvatarScale: 1,
      staticAvatarHitTest: { mode: 'alpha', alphaThreshold: 10 },
      onAvatarRenderModeChange: () => {},
      onSelectedStaticAvatarChange: () => {},
      onStaticAvatarScaleChange: () => {},
      onStaticAvatarHitTestChange: () => {},
      onStaticAvatarPacksChange: () => {},
      onModelChange: () => {},
      onMotionsUpdate: () => {},
      onExpressionsUpdate: () => {},
      chatBackendSettings: {
        chatBackend: 'nanobot',
        nanobot: {
          enabled: false,
          hasApiKey: false,
        },
      },
      onChatBackendChange: () => {},
      onNanobotSettingChange: () => {},
      onAcpBackendSettingChange: () => {},
    }),
  );
}

describe('ConfigDrawer avatar mode section', () => {
  it('renders avatar controls and hides live2d-only controls in static mode', () => {
    const html = renderDrawer('static');
    expect(html).toContain('data-testid="static-avatar-controls-mock"');
    expect(html).not.toContain('data-testid="live2d-controls-mock"');
    expect(html).toContain('data-render-mode="static"');
  });

  it('renders live2d controls when mode is live2d', () => {
    const html = renderDrawer('live2d');
    expect(html).toContain('data-testid="static-avatar-controls-mock"');
    expect(html).toContain('data-testid="live2d-controls-mock"');
    expect(html).toContain('data-render-mode="live2d"');
  });
});
