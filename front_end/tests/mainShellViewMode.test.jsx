import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MainShell from '../src/shells/MainShell.jsx';
import { normalizeOfficeState, resolveOfficeSceneState } from '../src/components/office/officeSceneConfig.js';

globalThis.React = React;

vi.mock('../src/components/avatar/AvatarRenderer.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'live2d-viewer-mock' }),
}));

vi.mock('../src/components/subtitle/SubtitleBar.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'subtitle-bar-mock' }),
}));

vi.mock('../src/components/window/WindowTitleBar.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'window-title-bar-mock' }),
}));

vi.mock('../src/shells/ImmersiveLive2DShell.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'immersive-shell-mock' }),
}));

vi.mock('../src/shells/RoomStudioShell.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'room-studio-shell-mock' }),
}));

vi.mock('../src/i18n/I18nContext.jsx', () => ({
  useI18n: () => ({ t: (key) => key }),
}));

function createOfficeScene() {
  return resolveOfficeSceneState({
    officeState: normalizeOfficeState({
      revision: 1,
      activeAgentId: 'main',
      agents: [
        {
          agentId: 'main',
          displayName: 'OtakuClaw',
          businessState: 'writing',
          detail: 'Replying now.',
        },
      ],
    }),
  });
}

function renderMainShell(props = {}) {
  return renderToStaticMarkup(
    React.createElement(MainShell, {
      desktopMode: false,
      platform: 'darwin',
      live2dViewerRef: { current: null },
      currentModelPath: '',
      motions: [],
      expressions: [],
      onModelLoaded: () => {},
      onModelError: () => {},
      subtitleText: '',
      onOpenConfigPanel: () => {},
      onSwitchToPetMode: () => {},
      onWindowControl: () => {},
      showChatPanel: false,
      onOpenChatPanel: () => {},
      showVoicePermissionWarning: false,
      voicePermissionWarningText: '',
      officeScene: createOfficeScene(),
      officeEditor: {
        themeId: 'star-office-classic',
        themeOptions: [
          { id: 'star-office-classic', label: 'Star Office Classic' },
          { id: 'star-office-minimal', label: 'Star Office Minimal' },
        ],
        previewMode: 'live',
        furniture: [
          {
            id: 'desk',
            label: 'Desk',
            hidden: false,
            isVisible: true,
            left: 6.3,
            top: 43.1,
            visibleWhenStates: [],
          },
        ],
        onPreviewModeChange: () => {},
        onThemeChange: () => {},
        onFurnitureHiddenChange: () => {},
        onFurniturePositionChange: () => {},
        onFurnitureReset: () => {},
        onFurnitureEnabledChange: () => {},
      },
      ...props,
    }),
  );
}

describe('MainShell window view mode', () => {
  it('renders the office page by default when an office scene is available', () => {
    const html = renderMainShell();
    expect(html).toContain('office-room--browse');
    expect(html).not.toContain('data-testid="live2d-viewer-mock"');
    expect(html).toContain('Decorate');
    expect(html).not.toContain('Pixel room editor');
    expect(html).not.toContain('data-testid="room-studio-shell-mock"');
  });

  it('renders the office page when initialized in office mode', () => {
    const html = renderMainShell({ initialWindowViewMode: 'office' });
    expect(html).toContain('office-room--browse');
    expect(html).not.toContain('data-testid="live2d-viewer-mock"');
    expect(html).toContain('Decorate');
    expect(html).not.toContain('Pixel room editor');
  });

  it('renders the dedicated room editor mode when initialized in office-edit mode', () => {
    const html = renderMainShell({ initialWindowViewMode: 'office-edit' });
    expect(html).toContain('data-testid="room-studio-shell-mock"');
    expect(html).not.toContain('data-testid="live2d-viewer-mock"');
    expect(html).not.toContain('office-room--browse');
  });

  it('renders the immersive shell when initialized in immersive mode', () => {
    const html = renderMainShell({ initialWindowViewMode: 'immersive' });
    expect(html).toContain('data-testid="immersive-shell-mock"');
    expect(html).not.toContain('data-testid="live2d-viewer-mock"');
    expect(html).not.toContain('office-room--browse');
  });
});
