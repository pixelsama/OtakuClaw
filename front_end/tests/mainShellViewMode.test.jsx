import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MainShell from '../src/shells/MainShell.jsx';
import { normalizeOfficeState, resolveOfficeSceneState } from '../src/components/office/officeSceneConfig.js';

globalThis.React = React;

vi.mock('../src/components/live2d/Live2DViewer.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'live2d-viewer-mock' }),
}));

vi.mock('../src/components/subtitle/SubtitleBar.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'subtitle-bar-mock' }),
}));

vi.mock('../src/components/window/WindowTitleBar.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'window-title-bar-mock' }),
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
      ...props,
    }),
  );
}

describe('MainShell window view mode', () => {
  it('shows the view switcher when an office scene is available', () => {
    const html = renderMainShell();
    expect(html).toContain('Live2D');
    expect(html).toContain('Pixel Room');
  });

  it('renders the live2d view by default', () => {
    const html = renderMainShell();
    expect(html).toContain('data-testid="live2d-viewer-mock"');
    expect(html).not.toContain('office-scene-page');
  });

  it('renders the office page when initialized in office mode', () => {
    const html = renderMainShell({ initialWindowViewMode: 'office' });
    expect(html).toContain('office-scene-page');
    expect(html).not.toContain('data-testid="live2d-viewer-mock"');
  });
});
