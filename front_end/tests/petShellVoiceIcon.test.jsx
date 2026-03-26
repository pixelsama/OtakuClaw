import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PetShell from '../src/shells/PetShell.jsx';

globalThis.React = React;

vi.mock('../src/components/avatar/AvatarRenderer.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'live2d-viewer-mock' }),
}));

vi.mock('../src/components/subtitle/SubtitleBar.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'subtitle-bar-mock' }),
}));

vi.mock('../src/i18n/I18nContext.jsx', () => ({
  useI18n: () => ({ t: (key) => key }),
}));

function renderPetShellWithVoiceEnabled(voiceEnabled) {
  return renderToStaticMarkup(
    React.createElement(PetShell, {
      desktopMode: false,
      platform: 'darwin',
      live2dViewerRef: { current: null },
      currentModelPath: '',
      motions: [],
      expressions: [],
      onModelLoaded: () => {},
      onModelError: () => {},
      subtitleText: '',
      onSwitchToWindowMode: () => {},
      bindPetHover: () => ({}),
      setPetHover: () => {},
      textComposerProps: {
        voiceEnabled,
        voiceToggleDisabled: false,
      },
      showChatPanel: false,
      onOpenChatPanel: () => {},
      onCloseChatPanel: () => {},
      onQuickCapture: () => {},
      captureDraft: null,
      onClearCaptureDraft: () => {},
      showVoicePermissionWarning: false,
      voicePermissionWarningText: '',
    }),
  );
}

describe('PetShell voice icon mapping', () => {
  it('shows MicIcon when voice is enabled', () => {
    const html = renderPetShellWithVoiceEnabled(true);
    expect(html).toContain('data-testid="MicIcon"');
    expect(html).not.toContain('data-testid="MicOffIcon"');
  });

  it('shows MicOffIcon when voice is disabled', () => {
    const html = renderPetShellWithVoiceEnabled(false);
    expect(html).toContain('data-testid="MicOffIcon"');
    expect(html).not.toContain('data-testid="MicIcon"');
  });
});
