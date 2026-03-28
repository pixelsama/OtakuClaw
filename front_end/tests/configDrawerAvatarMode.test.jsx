import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConfigDrawer from '../src/components/config/ConfigDrawer.jsx';

globalThis.React = React;

vi.mock('../src/components/config/AgentRoleSettingsPanel.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'agent-role-settings-panel-mock' }),
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

function renderDrawer() {
  return renderToStaticMarkup(
    React.createElement(ConfigDrawer, {
      open: true,
      isPetMode: false,
      isNarrowViewport: false,
      onClose: () => {},
      desktopMode: false,
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

describe('ConfigDrawer tabs after avatar-tab removal', () => {
  it('renders agent role panel by default and no avatar tab', () => {
    const html = renderDrawer();
    expect(html).toContain('data-testid="agent-role-settings-panel-mock"');
    expect(html).not.toContain('app.tab.avatar');
  });

  it('still renders core settings tabs', () => {
    const html = renderDrawer();
    expect(html).toContain('app.tab.agentRoles');
    expect(html).toContain('app.tab.backendResources');
    expect(html).toContain('app.tab.voice');
    expect(html).toContain('app.tab.preferences');
  });
});
