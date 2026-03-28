import { describe, expect, it } from 'vitest';
import { resolveContainedStageSize } from '../src/components/office/OfficeScene.jsx';
import {
  buildOfficeDisplayState,
  derivePrimaryOfficeAgent,
  normalizeOfficeState,
  reduceOfficeActivityHint,
  resolveOfficeSceneEditorState,
  resolveOfficeSceneState,
} from '../src/components/office/officeSceneConfig.js';
import {
  OFFICE_SCENE_ASSET_REGISTRY,
  resolveOfficeOccupantSprite,
  resolveOfficeSceneAsset,
} from '../src/components/office/officeSceneAssets.js';
import { buildOfficeSceneAssetRegistry } from '../src/components/office/pixelPack.js';

const OFFICE_AGENT_CASES = [
  {
    label: 'main',
    activeAgentId: 'main',
    displayName: 'OtakuClaw',
    role: 'primary',
  },
  {
    label: 'agent-alpha',
    activeAgentId: 'agent-alpha',
    displayName: 'Agent Alpha',
    role: 'support',
  },
];

describe('resolveContainedStageSize', () => {
  it('fits the 16:9 office scene inside wide windows without cropping', () => {
    expect(resolveContainedStageSize({ containerWidth: 960, containerHeight: 648 })).toEqual({
      width: 960,
      height: 540,
    });
  });

  it('fits the 16:9 office scene inside tall windows without cropping', () => {
    const size = resolveContainedStageSize({ containerWidth: 720, containerHeight: 900 });
    expect(size.width).toBe(720);
    expect(size.height).toBe(405);
  });
});

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

describe('normalizeOfficeState', () => {
  it('preserves optional mood and affinity fields for future value overlays', () => {
    const state = normalizeOfficeState({
      revision: 1,
      activeAgentId: 'main',
      agents: [
        {
          agentId: 'main',
          displayName: 'Main',
          businessState: 'idle',
          detail: 'Standing by.',
          backend: 'nanobot',
          profileId: 'profile-main',
          routeKey: 'main:nanobot:session-1',
          sessionId: 'session-1',
          sessionNamespace: 'session-1',
          turnId: 'turn-1',
          mood: 12,
          affinity: '330',
          stats: {
            trust: 8,
          },
          valueState: {
            revision: 3,
          },
        },
      ],
    });

    expect(state.agents[0].mood).toBe(12);
    expect(state.agents[0].affinity).toBe(330);
    expect(state.agents[0].stats).toEqual({
      trust: 8,
    });
    expect(state.agents[0].backend).toBe('nanobot');
    expect(state.agents[0].profileId).toBe('profile-main');
    expect(state.agents[0].routeKey).toBe('main:nanobot:session-1');
    expect(state.agents[0].sessionId).toBe('session-1');
    expect(state.agents[0].sessionNamespace).toBe('session-1');
    expect(state.agents[0].turnId).toBe('turn-1');
    expect(state.agents[0].valueState).toEqual({
      revision: 3,
    });
  });

  it('normalizes main and non-main agent rows without losing identity metadata', () => {
    for (const scenario of OFFICE_AGENT_CASES) {
      const state = normalizeOfficeState({
        revision: 1,
        activeAgentId: scenario.activeAgentId,
        agents: [
          {
            agentId: scenario.activeAgentId,
            displayName: scenario.displayName,
            businessState: 'idle',
            detail: 'Standing by.',
            role: scenario.role,
            backend: scenario.activeAgentId === 'main' ? 'nanobot' : 'codex',
            profileId: `${scenario.activeAgentId}-profile`,
            routeKey: `${scenario.activeAgentId}:nanobot:session-1`,
            sessionId: 'session-1',
            sessionNamespace: 'session-1',
            turnId: 'turn-1',
            mood: 12,
            affinity: '330',
            stats: {
              trust: 8,
            },
            valueState: {
              revision: 3,
            },
          },
        ],
      });

      expect(state.activeAgentId).toBe(scenario.activeAgentId);
      expect(state.agents[0]).toMatchObject({
        agentId: scenario.activeAgentId,
        id: scenario.activeAgentId,
        displayName: scenario.displayName,
        role: scenario.role,
        isPrimary: true,
      });
    }
  });

  it('keeps empty and invalid office state inputs stable', () => {
    const emptyState = normalizeOfficeState({
      revision: 0,
      activeAgentId: '',
      agents: [],
    });
    const invalidState = normalizeOfficeState({
      revision: 'invalid',
      activeAgentId: ' ',
      agents: null,
    });

    expect(emptyState.activeAgentId).toBe('main');
    expect(emptyState.agents).toHaveLength(1);
    expect(emptyState.agents[0].agentId).toBe('main');
    expect(invalidState.activeAgentId).toBe('main');
    expect(invalidState.agents).toHaveLength(1);
    expect(invalidState.agents[0].agentId).toBe('main');
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

  it('keeps the primary occupant selection and layout stable for main and non-main active agents', () => {
    for (const scenario of OFFICE_AGENT_CASES) {
      const scene = resolveOfficeSceneState({
        officeState: normalizeOfficeState({
          revision: 2,
          activeAgentId: scenario.activeAgentId,
          agents: [
            { agentId: scenario.activeAgentId, displayName: scenario.displayName, businessState: 'writing', detail: 'Replying now.' },
            { agentId: scenario.activeAgentId === 'main' ? 'voice' : 'support', displayName: scenario.activeAgentId === 'main' ? 'Voice' : 'Support', businessState: 'syncing', detail: 'Preparing audio.' },
            { agentId: scenario.activeAgentId === 'main' ? 'watcher' : 'observer', displayName: scenario.activeAgentId === 'main' ? 'Watcher' : 'Observer', businessState: 'idle', detail: 'Standing by.' },
          ],
        }),
      });

      expect(scene.primaryAgent.agentId).toBe(scenario.activeAgentId);
      expect(scene.occupants.find((agent) => agent.agentId === scenario.activeAgentId)?.areaId).toBe('desk');
      expect(scene.occupants.some((agent) => agent.agentId === scene.primaryAgent.agentId)).toBe(true);
    }
  });

  it('renders gracefully for empty and invalid office state inputs', () => {
    const emptyScene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 0,
        activeAgentId: '',
        agents: [],
      }),
    });
    const invalidScene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 'invalid',
        activeAgentId: undefined,
        agents: null,
      }),
    });

    expect(emptyScene.primaryAgent.agentId).toBe('main');
    expect(emptyScene.occupants).toHaveLength(1);
    expect(invalidScene.primaryAgent.agentId).toBe('main');
    expect(invalidScene.occupants).toHaveLength(1);
  });

  it('keeps route-aware agent metadata on scene occupants for immersive actions', () => {
    const scene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 2,
        activeAgentId: 'main',
        agents: [
          {
            agentId: 'main',
            displayName: 'Main',
            businessState: 'writing',
            detail: 'Replying now.',
            routeKey: 'main:nanobot:session-1',
            sessionId: 'session-1',
            turnId: 'turn-1',
          },
        ],
      }),
    });

    expect(scene.occupants[0].routeKey).toBe('main:nanobot:session-1');
    expect(scene.occupants[0].sessionId).toBe('session-1');
    expect(scene.occupants[0].turnId).toBe('turn-1');
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
    expect(scene.config.furniture.find((item) => item.id === 'memoBoard')).toMatchObject({
      assetKey: 'memoBoard',
      assetUrl: expect.any(String),
      aspectRatio: '4 / 3',
      isVisible: true,
    });
    expect(scene.config.furniture.find((item) => item.id === 'coffee')).toMatchObject({
      layers: [
        { id: 'coffee-shadow', assetKey: 'coffeeMachineShadow' },
        { id: 'coffee-machine', assetKey: 'coffeeMachine', animation: { fromFrame: 0, toFrame: 94, fps: 12.5 } },
      ],
    });
  });

  it('prefers active pack art but falls back to built-in assets when a pack omits artwork', () => {
    const pixelPackState = {
      activePack: {
        id: 'pack-alpha',
        manifest: {
          assets: {
            starOfficeBackdrop: {
              url: '/packs/alpha/backdrop.webp',
            },
            desk: {
              url: '/packs/alpha/desk.webp',
            },
            starWorking: {
              url: '/packs/alpha/star-working.webp',
            },
          },
        },
      },
    };
    const assetRegistry = buildOfficeSceneAssetRegistry(OFFICE_SCENE_ASSET_REGISTRY, pixelPackState);
    const scene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 1,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'writing', detail: 'Standing by.' },
        ],
      }),
      assetRegistry,
    });

    expect(scene.config.backdrop.assetUrl).toBe('/packs/alpha/backdrop.webp');
    expect(scene.config.furniture.find((item) => item.id === 'desk')?.assetUrl).toBe('/packs/alpha/desk.webp');
    expect(resolveOfficeOccupantSprite(scene.primaryAgent, assetRegistry)).toMatchObject({
      assetKey: 'starWorking',
      assetUrl: '/packs/alpha/star-working.webp',
    });
    expect(resolveOfficeSceneAsset('coffeeMachineShadow', assetRegistry)).toEqual(resolveOfficeSceneAsset('coffeeMachineShadow'));
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
    expect(idleScene.config.furniture.find((item) => item.id === 'syncBeacon')?.isVisible).toBe(false);
    expect(errorScene.config.furniture.find((item) => item.id === 'syncBeacon')?.isVisible).toBe(false);
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
      expect.arrayContaining(['poster', 'memoBoard', 'plantLeft', 'plantCenter', 'serverroom', 'flowers', 'cat', 'plantBedroom']),
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
    expect(syncingScene.config.furniture.find((item) => item.id === 'syncBeacon')).toMatchObject({
      isVisible: true,
      layers: [
        {
          id: 'syncBeacon',
          assetKey: 'syncAnimation',
          animation: { fromFrame: 1, toFrame: 47, fps: 12 },
        },
      ],
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

describe('resolveOfficeOccupantSprite', () => {
  it('prefers animated guest art for non-primary occupants and keeps static fallback available', () => {
    const guestSprite = resolveOfficeOccupantSprite({
      agentId: 'guest-7',
      isPrimary: false,
    });

    expect(guestSprite).toMatchObject({
      variant: 'guest-animated',
      cols: 4,
      rows: 2,
      animation: { fromFrame: 0, toFrame: 7, fps: 8 },
    });
    expect(guestSprite.assetUrl).toContain('guest_anim_');
  });

  it('keeps the primary occupant on the working/idle art path', () => {
    const primarySprite = resolveOfficeOccupantSprite({
      agentId: 'main',
      isPrimary: true,
      businessState: 'idle',
    });

    expect(primarySprite.variant).toBe('idle');
    expect(primarySprite.assetUrl).toBeTruthy();
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
      width: 20,
      defaultWidth: 20,
      defaultZIndex: 7,
      defaultOpacity: 1,
      defaultLeft: 52.3,
      defaultTop: 20,
      layers: [
        {
          id: 'sofa-shadow',
          assetKey: 'sofaShadow',
          defaultAssetKey: 'sofaShadow',
        },
        {
          id: 'sofa',
          assetKey: 'sofa',
          defaultAssetKey: 'sofa',
        },
      ],
    });
    expect(editor.furniture.find((item) => item.id === 'sofa-shadow')).toBeUndefined();
    expect(editor.furniture.find((item) => item.id === 'bug')).toMatchObject({
      ruleLabel: 'Error-only',
      visibleWhenStates: ['error'],
      defaultVisibleWhenStates: ['error'],
    });
    expect(editor.furniture.find((item) => item.id === 'cat')).toMatchObject({
      ruleLabel: 'State furniture',
      variantStates: ['error', 'syncing'],
    });
    expect(editor.catalog.find((item) => item.id === 'serverroom')).toMatchObject({
      category: 'status',
      enabled: false,
      defaultEnabled: false,
      ruleLabel: 'State furniture',
    });
    expect(editor.catalog.find((item) => item.id === 'guestStandee1')).toMatchObject({
      category: 'companions',
      enabled: false,
      defaultEnabled: false,
      ruleLabel: 'Always',
    });
    expect(editor.catalogCategories.map((item) => item.id)).toEqual(
      expect.arrayContaining(['all', 'workstation', 'status', 'plants', 'companions']),
    );
    expect(editor.availableStates).toEqual(
      expect.arrayContaining(['idle', 'writing', 'researching', 'executing', 'syncing', 'error']),
    );
    expect(editor.assetOptions.find((item) => item.assetKey === 'desk')).toMatchObject({
      assetKey: 'desk',
      cols: 1,
      rows: 1,
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

  it('allows themes to remove default furniture and add extra catalog objects', () => {
    const scene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 1,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'syncing', detail: 'Syncing assets.' },
        ],
      }),
      sceneConfig: {
        themeId: 'star-office-minimal',
        enabledFurnitureIds: ['serverroom', 'syncBeacon'],
        disabledFurnitureIds: ['desk'],
      },
    });

    expect(scene.config.furniture.find((item) => item.id === 'desk')).toBeUndefined();
    expect(scene.config.furniture.find((item) => item.id === 'serverroom')).toBeTruthy();
    expect(scene.config.furniture.find((item) => item.id === 'syncBeacon')).toMatchObject({
      isVisible: true,
    });
    expect(scene.config.furniture.find((item) => item.id === 'guestStandee2')).toBeUndefined();
  });

  it('allows extra companion standees to be added from the catalog', () => {
    const scene = resolveOfficeSceneState({
      officeState: normalizeOfficeState({
        revision: 1,
        activeAgentId: 'main',
        agents: [
          { agentId: 'main', displayName: 'Main', businessState: 'idle', detail: 'Standing by.' },
        ],
      }),
      sceneConfig: {
        themeId: 'star-office-minimal',
        enabledFurnitureIds: ['guestStandee2'],
      },
    });

    expect(scene.config.furniture.find((item) => item.id === 'guestStandee2')).toMatchObject({
      assetKey: 'guestRole2',
      isVisible: true,
      layers: [
        {
          id: 'guestStandee2',
          assetKey: 'guestRole2',
          animation: { frames: [0, 1], fps: 3 },
        },
      ],
    });
  });
});

describe('buildOfficeDisplayState', () => {
  it('forces the primary agent into error mode during error preview without mutating support agents', () => {
    for (const scenario of OFFICE_AGENT_CASES) {
      const officeState = buildOfficeDisplayState({
        officeState: normalizeOfficeState({
          revision: 2,
          activeAgentId: scenario.activeAgentId,
          agents: [
            {
              agentId: scenario.activeAgentId,
              displayName: scenario.displayName,
              businessState: 'writing',
              detail: 'Replying now.',
            },
            {
              agentId: scenario.activeAgentId === 'main' ? 'voice' : 'support',
              displayName: scenario.activeAgentId === 'main' ? 'Voice' : 'Support',
              businessState: 'syncing',
              detail: 'Preparing audio.',
            },
          ],
        }),
        primaryAgent: {
          agentId: scenario.activeAgentId,
          displayName: scenario.displayName,
          businessState: 'writing',
          detail: 'Replying now.',
        },
        previewMode: 'error',
      });

      expect(officeState.activeAgentId).toBe('main');
      if (scenario.activeAgentId === 'main') {
        expect(officeState.agents.find((agent) => agent.agentId === scenario.activeAgentId)).toMatchObject({
          businessState: 'error',
          detail: 'Previewing error-state furniture.',
        });
      } else {
        expect(officeState.agents.find((agent) => agent.agentId === scenario.activeAgentId)).toMatchObject({
          businessState: 'writing',
          detail: 'Replying now.',
        });
      }
      expect(officeState.agents.find((agent) => agent.agentId !== scenario.activeAgentId)).toMatchObject({
        businessState: 'syncing',
        detail: 'Preparing audio.',
      });
    }
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
