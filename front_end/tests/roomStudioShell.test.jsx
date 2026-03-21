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
  default: (props) => React.createElement('div', {
    'data-testid': 'room-editor-mock',
    'data-selected-furniture-id': props.selectedFurnitureId || '',
  }),
}));

describe('RoomStudioShell', () => {
  it('renders the dedicated room studio workspace shell around the editable room scene', () => {
    const html = renderToStaticMarkup(
      React.createElement(RoomStudioShell, {
        scene: {
          title: 'Pixel Room',
          subtitle: 'Studio view',
          caption: 'Tune the furniture layout.',
          primaryAgent: {
            displayName: 'OtakuClaw',
          },
          agentCount: 1,
        },
        editor: {
          themeId: 'star-office-classic',
          themeOptions: [
            { id: 'star-office-classic', label: 'Star Office Classic' },
          ],
          furniture: [
            { id: 'desk', hidden: false },
            { id: 'plant', hidden: true },
          ],
        },
        desktopMode: true,
        compact: false,
        onBackToRoom: () => {},
      }),
    );

    expect(html).toContain('room-studio-shell');
    expect(html).toContain('ROOM STUDIO');
    expect(html).toContain('返回房间');
    expect(html).toContain('data-testid="room-scene-mock"');
    expect(html).toContain('data-presentation-mode="browse"');
    expect(html).toContain('data-has-editor="false"');
    expect(html).toContain('data-testid="room-editor-mock"');
    expect(html).toContain('data-selected-furniture-id="desk"');
    expect(html).toContain('Star Office Classic');
    expect(html).toContain('1/2 furniture visible');
    expect(html).toContain('OtakuClaw');
  });
});
