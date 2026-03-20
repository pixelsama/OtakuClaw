import { describe, expect, it } from 'vitest';
import {
  buildOfficeDisplayState,
  derivePrimaryOfficeAgent,
  normalizeOfficeState,
  reduceOfficeActivityHint,
  resolveOfficeSceneEditorState,
  resolveOfficeSceneState,
} from '../src/components/office/officeSceneConfig.js';

describe('derivePrimaryOfficeAgent', () => {
  it('maps streaming state to writing and download activity to syncing', () => {
    const writingAgent = derivePrimaryOfficeAgent({
      isStreaming: true,
      detail: 'Streaming a reply.',
    });
    const syncingAgent = derivePrimaryOfficeAgent({
      activeDownloadTasks: [{ title: 'Installing runtime' }],
    });

    expect(writingAgent.businessState).toBe('writing');
    expect(syncingAgent.businessState).toBe('syncing');
    expect(syncingAgent.detail).toContain('Installing runtime');
  });

  it('prioritizes explicit errors', () => {
    const agent = derivePrimaryOfficeAgent({
      isStreaming: true,
      errorMessage: 'Bridge failed',
    });

    expect(agent.businessState).toBe('error');
    expect(agent.detail).toBe('Bridge failed');
  });

  it('uses structured activity state ahead of generic streaming', () => {
    const agent = derivePrimaryOfficeAgent({
      isStreaming: true,
      activityState: 'researching',
      activityDetail: 'Searching for references.',
      detail: 'The assistant is actively responding.',
    });

    expect(agent.businessState).toBe('researching');
    expect(agent.detail).toBe('Searching for references.');
  });

  it('keeps syncing ahead of structured activity hints', () => {
    const agent = derivePrimaryOfficeAgent({
      isStreaming: true,
      activityState: 'executing',
      activityDetail: 'Running a local command.',
      activeDownloadTasks: [{ title: 'Installing runtime' }],
    });

    expect(agent.businessState).toBe('syncing');
    expect(agent.detail).toContain('Installing runtime');
  });
});

describe('resolveOfficeSceneState', () => {
  it('positions multiple agents into configured room areas', () => {
    const scene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 2,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'writing', detail: 'Replying now.' },
          { agentId: 'voice', displayName: 'Voice', businessState: 'syncing', detail: 'Preparing audio.' },
          { agentId: 'watcher', displayName: 'Watcher', businessState: 'idle', detail: 'Standing by.' },
        ],
      }),
    });

    expect(scene.occupants).toHaveLength(3);
    expect(scene.primaryAgent.agentId).toBe('main');
    expect(scene.occupants.find((agent) => agent.agentId === 'main')?.areaId).toBe('desk');
    expect(scene.occupants.find((agent) => agent.agentId === 'voice')?.areaId).toBe('syncDock');
    expect(scene.occupants.find((agent) => agent.agentId === 'watcher')?.areaId).toBe('lounge');
  });

  it('resolves backdrop and furniture assets from configurable scene data', () => {
    const scene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 1,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'idle', detail: 'Standing by.' },
        ],
      }),
    });

    expect(scene.config.backdrop.assetKey).toBe('starOfficeBackdrop');
    expect(scene.config.backdrop.assetUrl).toBeTruthy();
    expect(scene.config.furniture.find((item) => item.id === 'desk')).toMatchObject({
      assetKey: 'desk',
      assetUrl: expect.any(String),
      aspectRatio: '276 / 214',
      isVisible: true,
    });
    expect(scene.config.furniture.find((item) => item.id === 'poster')).toMatchObject({
      assetKey: 'posters',
      cols: 4,
      rows: 8,
      frameIndex: 6,
      isVisible: true,
    });
  });

  it('supports conditional furniture visibility from business states', () => {
    const idleScene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 1,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'idle', detail: 'Standing by.' },
        ],
      }),
    });

    const errorScene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 1,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'error', detail: 'Bug found.' },
        ],
      }),
    });

    expect(idleScene.config.furniture.find((item) => item.id === 'bug')?.isVisible).toBe(false);
    expect(errorScene.config.furniture.find((item) => item.id === 'bug')?.isVisible).toBe(true);
  });

  it('expands the default theme from the furniture catalog', () => {
    const scene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 1,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'idle', detail: 'Standing by.' },
        ],
      }),
    });

    expect(scene.config.themeId).toBe('star-office-classic');
    expect(scene.config.themeLabel).toBe('Star Office Classic');
    expect(scene.config.furniture.map((item) => item.id)).toContain('coffee');
    expect(scene.config.furniture.map((item) => item.id)).toEqual(
      expect.arrayContaining(['poster', 'plantLeft', 'plantCenter', 'serverroom', 'flowers', 'cat', 'plantBedroom']),
    );
    expect(scene.config.furniture.find((item) => item.id === 'sofa')).toMatchObject({
      layers: [
        { id: 'sofa-shadow', assetKey: 'sofaShadow' },
        { id: 'sofa', assetKey: 'sofa' },
      ],
    });
  });

  it('supports theme switching and furniture overrides without changing the renderer', () => {
    const minimalScene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 1,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'idle', detail: 'Standing by.' },
        ],
      }),
      sceneConfig: {
        themeId: 'star-office-minimal',
        furnitureOverrides: {
          sofa: {
            left: 49,
            top: 18,
          },
        },
      },
    });

    expect(minimalScene.config.themeId).toBe('star-office-minimal');
    expect(minimalScene.config.furniture.find((item) => item.id === 'coffee')).toBeUndefined();
    expect(minimalScene.config.furniture.find((item) => item.id === 'plantCenter')).toBeUndefined();
    expect(minimalScene.config.furniture.find((item) => item.id === 'sofa')).toMatchObject({
      left: 49,
      top: 18,
    });
  });

  it('applies stateful furniture variants for reachable business states', () => {
    const syncingScene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 1,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'syncing', detail: 'Syncing assets.' },
        ],
      }),
    });

    const errorScene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 1,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'error', detail: 'Bug found.' },
        ],
      }),
    });

    expect(syncingScene.config.furniture.find((item) => item.id === 'serverroom')).toMatchObject({
      activeVariantState: 'syncing',
      frameIndex: 18,
    });
    expect(syncingScene.config.furniture.find((item) => item.id === 'cat')).toMatchObject({
      activeVariantState: 'syncing',
      frameIndex: 8,
    });
    expect(errorScene.config.furniture.find((item) => item.id === 'flowers')).toMatchObject({
      activeVariantState: 'error',
      frameIndex: 14,
    });
  });

  it('supports manual furniture hiding through layout overrides', () => {
    const scene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 1,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'idle', detail: 'Standing by.' },
        ],
      }),
      sceneConfig: {
        themeId: 'star-office-classic',
        furnitureOverrides: {
          desk: {
            hidden: true,
          },
        },
      },
    });

    expect(scene.config.furniture.find((item) => item.id === 'desk')).toMatchObject({
      hidden: true,
      isVisible: false,
    });
  });
});

describe('resolveOfficeSceneEditorState', () => {
  it('exposes theme options and editable furniture state for the current layout', () => {
    const editor = resolveOfficeSceneEditorState({
      sceneConfig: {
        themeId: 'star-office-minimal',
        furnitureOverrides: {
          sofa: {
            left: 48.5,
            top: 19.4,
            hidden: true,
          },
        },
      },
      officeState: normalizeOfficeState({
        revision: 1,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'idle', detail: 'Standing by.' },
        ],
      }),
    });

    expect(editor.themeId).toBe('star-office-minimal');
    expect(editor.themeOptions.map((item) => item.id)).toContain('star-office-classic');
    expect(editor.furniture.find((item) => item.id === 'sofa')).toMatchObject({
      label: 'Sofa',
      hidden: true,
      isVisible: false,
      ruleLabel: 'Always',
      left: 48.5,
      top: 19.4,
      defaultLeft: 52.3,
      defaultTop: 20,
    });
    expect(editor.furniture.find((item) => item.id === 'sofa-shadow')).toBeUndefined();
    expect(editor.furniture.find((item) => item.id === 'bug')).toMatchObject({
      ruleLabel: 'Error-only',
    });
    expect(editor.furniture.find((item) => item.id === 'cat')).toMatchObject({
      ruleLabel: 'State furniture',
    });
  });

  it('marks state-variant furniture in the classic theme editor list', () => {
    const editor = resolveOfficeSceneEditorState({
      sceneConfig: {
        themeId: 'star-office-classic',
      },
      officeState: normalizeOfficeState({
        revision: 1,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'idle', detail: 'Standing by.' },
        ],
      }),
    });

    expect(editor.furniture.find((item) => item.id === 'serverroom')).toMatchObject({
      ruleLabel: 'State furniture',
    });
  });
});

describe('buildOfficeDisplayState', () => {
  it('forces the primary agent into error mode during error preview without mutating support agents', () => {
    const officeState = buildOfficeDisplayState({
      officeState: normalizeOfficeState({
        revision: 2,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'writing', detail: 'Replying now.' },
          { agentId: 'voice', displayName: 'Voice', businessState: 'syncing', detail: 'Preparing audio.' },
        ],
      }),
      primaryAgent: {
        agentId: 'main',
        displayName: 'Main',
        businessState: 'writing',
        detail: 'Replying now.',
      },
      previewMode: 'error',
    });

    expect(officeState.agents.find((agent) => agent.agentId === 'main')).toMatchObject({
      businessState: 'error',
      detail: 'Previewing error-state furniture.',
    });
    expect(officeState.agents.find((agent) => agent.agentId === 'voice')).toMatchObject({
      businessState: 'syncing',
      detail: 'Preparing audio.',
    });
  });
});

describe('reduceOfficeActivityHint', () => {
  it('tracks agent-state, transitions to writing on final text, and clears on done', () => {
    const activity = reduceOfficeActivityHint(null, {
      channel: 'chat',
      type: 'agent-state',
      streamId: 'stream-1',
      payload: {
        businessState: 'executing',
        detail: 'Running a local command.',
      },
    });

    expect(activity).toEqual({
      streamId: 'stream-1',
      businessState: 'executing',
      detail: 'Running a local command.',
      updatedAt: expect.any(String),
    });

    const writing = reduceOfficeActivityHint(activity, {
      channel: 'chat',
      type: 'text-delta',
      streamId: 'stream-1',
      payload: {
        content: 'Result is ready.',
        final: true,
      },
    });

    expect(writing).toEqual({
      streamId: 'stream-1',
      businessState: 'writing',
      detail: '',
      updatedAt: expect.any(String),
    });

    expect(
      reduceOfficeActivityHint(writing, {
        channel: 'chat',
        type: 'done',
        streamId: 'stream-1',
        payload: {},
      }),
    ).toBeNull();
  });
});
