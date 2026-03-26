import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AvatarRenderer from '../src/components/avatar/AvatarRenderer.jsx';

globalThis.React = React;

vi.mock('../src/components/live2d/Live2DViewer.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'live2d-viewer-mock' }),
}));

vi.mock('../src/components/avatar/StaticAvatarViewer.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'static-avatar-viewer-mock' }),
}));

describe('AvatarRenderer', () => {
  it('renders Live2D viewer in live2d mode', () => {
    const html = renderToStaticMarkup(
      React.createElement(AvatarRenderer, {
        renderMode: 'live2d',
        modelPath: '/models/hiyori.model3.json',
      }),
    );

    expect(html).toContain('data-testid="live2d-viewer-mock"');
    expect(html).not.toContain('data-testid="static-avatar-viewer-mock"');
  });

  it('renders static avatar viewer in static mode', () => {
    const html = renderToStaticMarkup(
      React.createElement(AvatarRenderer, {
        renderMode: 'static',
        staticPack: {
          packId: 'demo-pack',
          states: {
            idle: 'openclaw-avatar:///demo/assets/idle.webp',
          },
        },
      }),
    );

    expect(html).toContain('data-testid="static-avatar-viewer-mock"');
    expect(html).not.toContain('data-testid="live2d-viewer-mock"');
  });
});
