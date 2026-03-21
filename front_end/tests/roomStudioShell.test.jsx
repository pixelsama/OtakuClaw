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
    expect(html).toContain('Room Studio');
    expect(html).toContain('Back to Room');
    expect(html).toContain('data-testid="room-scene-mock"');
    expect(html).toContain('data-presentation-mode="workspace"');
    expect(html).toContain('data-has-editor="true"');
    expect(html).toContain('Edit Mode');
    expect(html).toContain('Pixel Room');
    expect(html).toContain('Drag props to reposition');
  });
});
