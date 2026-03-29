import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentRoleSettingsPanel, { normalizeAgentPixelRoom } from '../src/components/config/AgentRoleSettingsPanel.jsx';
import { normalizePixelPackCharacterOptions } from '../src/components/office/pixelPack.js';

globalThis.React = React;

vi.mock('../src/components/avatar/StaticAvatarControls.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'static-avatar-controls-mock' }),
}));

vi.mock('../src/components/avatar/AvatarRenderer.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'avatar-renderer-mock' }),
}));

vi.mock('../src/components/config/AgentRoleLive2DPreviewEditor.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'live2d-preview-editor-mock' }),
}));

vi.mock('../src/services/desktopBridge.js', () => ({
  desktopBridge: {
    isDesktop: () => false,
  },
}));

vi.mock('../src/i18n/I18nContext.jsx', () => ({
  useI18n: () => ({ t: (key) => key }),
}));

function renderPanel(props = {}) {
  return renderToStaticMarkup(
    React.createElement(AgentRoleSettingsPanel, {
      agentRoleConfig: { agents: [], activeAgentId: '' },
      defaultBackend: 'nanobot',
      onUpsertAgent: () => {},
      onRemoveAgent: () => {},
      onStaticAvatarPacksChange: () => {},
      ...props,
    }),
  );
}

describe('AgentRoleSettingsPanel', () => {
  it('shows only the create-first button when there are no configured agents', () => {
    const html = renderPanel();
    expect(html).toContain('agent-role-create-first-button');
    expect(html).toContain('agent.role.addAgent');
    expect(html).not.toContain('agent.role.deleteModeEnter');
  });

  it('shows per-agent secondary entries and delete-mode entry when agents exist', () => {
    const html = renderPanel({
      agentRoleConfig: {
        agents: [
          {
            agentId: 'agent-alpha',
            displayName: 'Agent Alpha',
            role: 'support',
            businessState: 'idle',
            backend: 'nanobot',
          },
        ],
      },
    });
    expect(html).toContain('Agent Alpha');
    expect(html).toContain('agent-alpha');
    expect(html).toContain('agent.role.deleteModeEnter');
    expect(html).not.toContain('agent-role-create-first-button');
  });

  it('normalizes pixel room selection while preserving overrides', () => {
    expect(normalizeAgentPixelRoom({
      characterId: '  star ',
      overrides: { pose: 'sit', anchor: 'desk' },
    })).toEqual({
      characterId: 'star',
      overrides: { pose: 'sit', anchor: 'desk' },
    });
  });

  it('passes the pixel room character option count into the draft form', () => {
    const html = renderPanel({
      pixelRoomCharacterOptions: [
        { characterId: 'star', label: 'Star' },
      ],
    });

    expect(html).toContain('data-pixel-room-character-count="1"');
  });

  it('normalizes pixel pack character options from manifest maps', () => {
    expect(normalizePixelPackCharacterOptions({
      star: { label: 'Star' },
      bug: { name: 'Bug' },
    })).toEqual([
      { characterId: 'star', label: 'Star', description: '' },
      { characterId: 'bug', label: 'Bug', description: '' },
    ]);
  });
});
