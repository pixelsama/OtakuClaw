import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RoomStudioShell from '../src/shells/RoomStudioShell.jsx';

globalThis.React = React;

vi.mock('../src/components/office/OfficeScene.jsx', () => ({
  default: (props) => React.createElement('div', {
    'data-testid': 'room-scene-mock',
    'data-presentation-mode': props.presentationMode,
    'data-has-editor': String(Boolean(props.editor)),
  }),
}));

vi.mock('../src/components/office/OfficeSceneEditor.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'room-editor-mock' }),
}));

describe('RoomStudioShell', () => {
  it('renders the room in browse mode alongside the dedicated editor workspace', () => {
    const html = renderToStaticMarkup(
      React.createElement(RoomStudioShell, {
        scene: {
          title: 'Pixel Room',
          subtitle: 'Studio view',
        },
        editor: {
          themeId: 'star-office-classic',
          furniture: [],
        },
        desktopMode: true,
        compact: false,
        onBackToRoom: () => {},
        onAgentClick: () => {},
      }),
    );

    expect(html).toContain('room-studio-shell');
    expect(html).toContain('返回房间');
    expect(html).toContain('data-testid="room-scene-mock"');
    expect(html).toContain('data-presentation-mode="browse"');
    expect(html).toContain('data-has-editor="false"');
    expect(html).toContain('data-testid="room-editor-mock"');
  });
});
