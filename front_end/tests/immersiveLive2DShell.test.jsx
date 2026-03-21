import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ImmersiveLive2DShell, { resolveImmersiveBackgroundPreset } from '../src/shells/ImmersiveLive2DShell.jsx';

globalThis.React = React;

vi.mock('../src/components/live2d/Live2DViewer.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'live2d-viewer-mock' }),
}));

describe('resolveImmersiveBackgroundPreset', () => {
  it('maps room areas to immersive backdrop presets', () => {
    expect(resolveImmersiveBackgroundPreset('desk')).toMatchObject({
      id: 'studio-workbench',
      label: 'Workbench',
    });
    expect(resolveImmersiveBackgroundPreset('syncDock')).toMatchObject({
      id: 'studio-sync',
      label: 'Sync Dock',
    });
    expect(resolveImmersiveBackgroundPreset('unknown-area')).toMatchObject({
      id: 'studio-default',
      label: 'Studio Default',
    });
  });
});

describe('ImmersiveLive2DShell', () => {
  it('renders the immersion rail, model stage, and value summary', () => {
    const html = renderToStaticMarkup(
      React.createElement(ImmersiveLive2DShell, {
        desktopMode: false,
        platform: 'darwin',
        currentModelPath: '/models/star.model3.json',
        motions: [],
        expressions: [],
        immersiveContext: {
          agentId: 'main',
          agent: {
            agentId: 'main',
            displayName: 'OtakuClaw',
            stats: {
              mood: { value: 12 },
              affinity: { value: 330 },
            },
          },
          sourceAreaId: 'desk',
          sourceAreaLabel: 'Desk',
          sourceAreaDetail: 'Deep desk focus',
        },
        valueSnapshot: {
          stats: {
            mood: { value: 12 },
            affinity: { value: 330 },
          },
        },
        onOpenChatPanel: () => {},
        onBackToRoom: () => {},
        onActionRequested: () => {},
      }),
    );

    expect(html).toContain('data-testid="live2d-viewer-mock"');
    expect(html).toContain('对话');
    expect(html).toContain('互动动作');
    expect(html).toContain('喂食');
    expect(html).toContain('返回房间');
    expect(html).toContain('Workbench');
    expect(html).toContain('Mood 12');
    expect(html).toContain('Affinity 330');
  });
});
