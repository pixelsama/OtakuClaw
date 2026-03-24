import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PetShell from '../src/shells/PetShell.jsx';

globalThis.React = React;

let capturedDraggableConfig = null;

vi.mock('../src/hooks/pet/usePetDraggable.js', () => ({
  usePetDraggable: (config) => {
    capturedDraggableConfig = config;
    return {
      isDragging: false,
      dragStyle: {},
      dragBindings: {},
    };
  },
}));

vi.mock('../src/components/avatar/AvatarRenderer.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'avatar-renderer-mock' }),
}));

vi.mock('../src/components/subtitle/SubtitleBar.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'subtitle-bar-mock' }),
}));

vi.mock('../src/i18n/I18nContext.jsx', () => ({
  useI18n: () => ({ t: (key) => key }),
}));

function renderPetShell(refCurrent) {
  capturedDraggableConfig = null;
  renderToStaticMarkup(
    React.createElement(PetShell, {
      desktopMode: true,
      platform: 'darwin',
      live2dViewerRef: { current: refCurrent },
      avatarRenderMode: 'static',
      selectedStaticAvatar: {
        packId: 'demo-pack',
        states: {
          idle: 'openclaw-avatar:///demo/assets/idle.webp',
        },
      },
      staticAvatarScale: 1,
      staticAvatarHitTest: {
        mode: 'alpha',
        alphaThreshold: 10,
      },
      avatarBusinessState: 'idle',
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
        voiceEnabled: false,
        voiceToggleDisabled: true,
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

describe('PetShell static avatar hit test compatibility', () => {
  it('uses renderer isPointOnModel when starting drag in static mode', () => {
    renderPetShell({
      isPointOnModel: () => true,
      getManager: () => ({
        isModelLoaded: true,
        setModelScale: () => {},
      }),
    });

    expect(typeof capturedDraggableConfig?.canStartDrag).toBe('function');
    expect(capturedDraggableConfig.canStartDrag({ clientX: 10, clientY: 12 })).toBe(true);
  });

  it('returns false when renderer hit test misses', () => {
    renderPetShell({
      isPointOnModel: () => false,
      getManager: () => ({
        isModelLoaded: true,
        setModelScale: () => {},
      }),
    });

    expect(capturedDraggableConfig.canStartDrag({ clientX: 10, clientY: 12 })).toBe(false);
  });
});
