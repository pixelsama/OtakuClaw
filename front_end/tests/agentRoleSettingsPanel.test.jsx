import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentRoleSettingsPanel from '../src/components/config/AgentRoleSettingsPanel.jsx';

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
});

