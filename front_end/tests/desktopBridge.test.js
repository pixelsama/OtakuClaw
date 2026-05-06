import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopBridge } from '../src/services/desktopBridge.js';

const originalWindow = globalThis.window;

afterEach(() => {
  if (typeof originalWindow === 'undefined') {
    delete globalThis.window;
    return;
  }
  globalThis.window = originalWindow;
});

describe('desktopBridge voice model selection', () => {
  it('omits undefined selection fields from the IPC payload', async () => {
    const select = vi.fn(async (payload) => ({ ok: true, payload }));
    globalThis.window = {
      desktop: {
        isElectron: true,
        voiceModels: {
          select,
        },
      },
    };

    const result = await desktopBridge.voiceModels.select({
      asrBundleId: 'asr-bundle',
    });

    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith({
      asrBundleId: 'asr-bundle',
    });
    expect(result.ok).toBe(true);
  });
});

describe('desktopBridge scenic guide knowledge API', () => {
  it('routes scenic guide knowledge queries to the desktop preload API', async () => {
    const getKnowledgeSummary = vi.fn(async () => ({ ok: true, knowledgeSummary: { knowledgeBlockCount: 94 } }));
    const listSpots = vi.fn(async (payload) => ({ ok: true, spots: [{ spotId: 'LS-011' }], payload }));
    const listRoutes = vi.fn(async (payload) => ({ ok: true, routes: [{ routeId: 'official-family-4h' }], payload }));
    const listKnowledgeBlocks = vi.fn(async (payload) => ({ ok: true, knowledgeBlocks: [], payload }));
    const askQuestion = vi.fn(async (payload) => ({
      ok: true,
      answer: '根据官方资料，灵山大佛是景区标志性景观。',
      sources: [],
      payload,
    }));
    globalThis.window = {
      desktop: {
        isElectron: true,
        scenicGuide: {
          getKnowledgeSummary,
          listSpots,
          listRoutes,
          listKnowledgeBlocks,
          askQuestion,
        },
      },
    };

    await expect(desktopBridge.scenicGuide.getKnowledgeSummary()).resolves.toEqual({
      ok: true,
      knowledgeSummary: { knowledgeBlockCount: 94 },
    });
    await expect(desktopBridge.scenicGuide.listSpots({ query: '灵山大佛' })).resolves.toEqual({
      ok: true,
      spots: [{ spotId: 'LS-011' }],
      payload: { query: '灵山大佛' },
    });
    await expect(desktopBridge.scenicGuide.listRoutes({ query: '亲子' })).resolves.toEqual({
      ok: true,
      routes: [{ routeId: 'official-family-4h' }],
      payload: { query: '亲子' },
    });
    await expect(desktopBridge.scenicGuide.listKnowledgeBlocks({ query: '九龙灌浴' })).resolves.toEqual({
      ok: true,
      knowledgeBlocks: [],
      payload: { query: '九龙灌浴' },
    });
    await expect(desktopBridge.scenicGuide.askQuestion({ question: '灵山大佛有什么特色？' })).resolves.toEqual({
      ok: true,
      answer: '根据官方资料，灵山大佛是景区标志性景观。',
      sources: [],
      payload: { question: '灵山大佛有什么特色？' },
    });
  });

  it('returns empty scenic guide knowledge fallbacks in web mode', async () => {
    globalThis.window = {};

    await expect(desktopBridge.scenicGuide.getKnowledgeSummary()).resolves.toEqual({
      ok: true,
      knowledgeSummary: null,
    });
    await expect(desktopBridge.scenicGuide.listSpots({ query: '灵山大佛' })).resolves.toEqual({
      ok: true,
      spots: [],
    });
    await expect(desktopBridge.scenicGuide.listRoutes({ query: '亲子' })).resolves.toEqual({
      ok: true,
      routes: [],
    });
    await expect(desktopBridge.scenicGuide.listKnowledgeBlocks({ query: '九龙灌浴' })).resolves.toEqual({
      ok: true,
      knowledgeBlocks: [],
    });
    await expect(desktopBridge.scenicGuide.askQuestion({ question: '灵山大佛有什么特色？' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'desktop_scenic_guide_unavailable',
        message: 'Scenic guide question answering is only available in the desktop app.',
      },
    });
  });
});

describe('desktopBridge conversation-only routing', () => {
  it('returns unavailable when conversation submit API is missing', async () => {
    globalThis.window = {
      desktop: {
        isElectron: true,
      },
    };

    const result = await desktopBridge.conversation.submitUserText({
      sessionId: 's1',
      content: 'hello',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'desktop_conversation_unavailable',
    });
  });

  it('routes chat.onEvent through conversation:event channel=chat', () => {
    const unsubscribe = vi.fn();
    let listener = null;
    globalThis.window = {
      desktop: {
        isElectron: true,
        conversation: {
          onEvent: vi.fn((handler) => {
            listener = handler;
            return unsubscribe;
          }),
        },
      },
    };

    const chatHandler = vi.fn();
    const off = desktopBridge.chat.onEvent(chatHandler);
    listener?.({
      channel: 'voice',
      type: 'asr-final',
      text: 'ignored',
    });
    listener?.({
      channel: 'chat',
      streamId: 'stream-1',
      type: 'text-delta',
      payload: { content: 'hello' },
    });

    expect(chatHandler).toHaveBeenCalledTimes(1);
    expect(chatHandler).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'chat',
      streamId: 'stream-1',
      type: 'text-delta',
      payload: { content: 'hello' },
    }));
    off();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('routes voice.onEvent through conversation:event channel=voice', () => {
    const unsubscribe = vi.fn();
    let listener = null;
    globalThis.window = {
      desktop: {
        isElectron: true,
        conversation: {
          onEvent: vi.fn((handler) => {
            listener = handler;
            return unsubscribe;
          }),
        },
      },
    };

    const voiceHandler = vi.fn();
    const off = desktopBridge.voice.onEvent(voiceHandler);
    listener?.({
      channel: 'chat',
      streamId: 'stream-2',
      type: 'text-delta',
      payload: { content: 'ignored' },
    });
    listener?.({
      channel: 'voice',
      type: 'asr-final',
      sessionId: 'voice-session-1',
      text: 'hello',
      timestamp: '2026-03-07T00:00:00.000Z',
    });

    expect(voiceHandler).toHaveBeenCalledTimes(1);
    expect(voiceHandler).toHaveBeenCalledWith({
      type: 'asr-final',
      sessionId: 'voice-session-1',
      text: 'hello',
      timestamp: '2026-03-07T00:00:00.000Z',
    });
    off();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('routes voice.onToggleRequest through voice toggle channel', () => {
    const unsubscribe = vi.fn();
    let listener = null;
    globalThis.window = {
      desktop: {
        isElectron: true,
        voice: {
          onToggleRequest: vi.fn((handler) => {
            listener = handler;
            return unsubscribe;
          }),
        },
      },
    };

    const toggleHandler = vi.fn();
    const off = desktopBridge.voice.onToggleRequest(toggleHandler);

    listener?.({
      source: 'global-shortcut',
      accelerator: 'CommandOrControl+Shift+Space',
    });

    expect(toggleHandler).toHaveBeenCalledTimes(1);
    expect(toggleHandler).toHaveBeenCalledWith({
      source: 'global-shortcut',
      accelerator: 'CommandOrControl+Shift+Space',
    });

    off();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('preserves conversation metadata and fans out stat updates to value state listeners', async () => {
    const unsubscribe = vi.fn();
    let listener = null;
    globalThis.window = {
      desktop: {
        isElectron: true,
        conversation: {
          onEvent: vi.fn((handler) => {
            listener = handler;
            return unsubscribe;
          }),
        },
      },
    };

    await desktopBridge.valueState.setState({
      revision: 0,
      updatedAt: '',
      agentId: '',
      routeKey: '',
      sessionId: '',
      stats: {},
      lastEvent: null,
    });

    const valueEvents = [];
    const offValue = desktopBridge.valueState.onEvent((event) => {
      valueEvents.push(event);
    });
    valueEvents.length = 0;

    const conversationEvents = [];
    const offConversation = desktopBridge.conversation.onEvent((event) => {
      conversationEvents.push(event);
    });

    listener?.({
      channel: 'system',
      type: 'stat-updated',
      agentId: 'main',
      backend: 'nanobot',
      routeKey: 'main:nanobot:default',
      sessionId: 'session-1',
      turnId: 'turn-1',
      timestamp: '2026-03-21T00:00:00.000Z',
      payload: {
        stats: {
          mood: 12,
          affinity: 330,
        },
      },
    });

    expect(conversationEvents).toHaveLength(1);
    expect(conversationEvents[0]).toEqual(expect.objectContaining({
      channel: 'system',
      type: 'stat-updated',
      agentId: 'main',
      backend: 'nanobot',
      routeKey: 'main:nanobot:default',
      sessionId: 'session-1',
      turnId: 'turn-1',
    }));

    expect(valueEvents).toHaveLength(1);
    expect(valueEvents[0]).toEqual(expect.objectContaining({
      channel: 'value',
      type: 'state-changed',
      payload: expect.objectContaining({
        revision: 1,
        agentId: 'main',
        routeKey: 'main:nanobot:default',
        sessionId: 'session-1',
        stats: {
          mood: 12,
          affinity: 330,
        },
        lastEvent: expect.objectContaining({
          channel: 'value',
          type: 'stat-updated',
        }),
      }),
    }));

    const valueState = await desktopBridge.valueState.getState();
    expect(valueState.stats).toEqual({
      mood: 12,
      affinity: 330,
    });

    await desktopBridge.valueState.setState({
      revision: 0,
      updatedAt: '',
      agentId: '',
      routeKey: '',
      sessionId: '',
      stats: {},
      lastEvent: null,
    });

    offConversation();
    offValue();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('desktopBridge office bridge', () => {
  it('keeps a local office fallback store when preload office API is unavailable', async () => {
    globalThis.window = {
      desktop: {
        isElectron: true,
      },
    };

    const snapshots = [];
    const off = desktopBridge.office.onEvent((event) => {
      snapshots.push(event.payload);
    });

    const updated = await desktopBridge.office.upsertAgent({
      agentId: 'main',
      displayName: 'OtakuClaw',
      businessState: 'writing',
      detail: 'Streaming a reply.',
    });

    expect(updated.activeAgentId).toBe('main');
    expect(updated.agents[0].businessState).toBe('writing');
    expect(snapshots.at(-1)?.agents[0]?.businessState).toBe('writing');

    off();
  });

  it('preserves the current active agent when upserting additional agents', async () => {
    globalThis.window = {
      desktop: {
        isElectron: true,
      },
    };

    const updated = await desktopBridge.office.upsertAgents(
      [
        {
          agentId: 'agent-alpha',
          displayName: 'Alpha',
          businessState: 'idle',
        },
        {
          agentId: 'agent-beta',
          displayName: 'Beta',
          businessState: 'syncing',
        },
      ],
      {
        activeAgentId: 'agent-beta',
      },
    );

    const refreshed = await desktopBridge.office.upsertAgent({
      agentId: 'agent-alpha',
      displayName: 'Alpha',
      businessState: 'writing',
      detail: 'Updating notes.',
    });

    expect(updated.activeAgentId).toBe('agent-beta');
    expect(refreshed.activeAgentId).toBe('agent-beta');
    expect(refreshed.agents.find((agent) => agent.agentId === 'agent-alpha')?.businessState).toBe('writing');
    expect(refreshed.agents.find((agent) => agent.agentId === 'agent-beta')?.businessState).toBe('syncing');
  });

  it('uses semantic preload office presence methods when available', async () => {
    const publishPresence = vi.fn(async (payload) => ({
      ok: true,
      state: {
        revision: 1,
        activeAgentId: 'agent-beta',
        agents: payload.agents,
      },
    }));
    const heartbeat = vi.fn(async () => ({
      ok: true,
      state: {
        revision: 2,
        activeAgentId: 'agent-beta',
        agents: [{ agentId: 'agent-beta', businessState: 'idle' }],
      },
    }));
    const setActive = vi.fn(async (payload) => ({
      ok: true,
      state: {
        revision: 3,
        activeAgentId: payload.agentId,
        agents: [{ agentId: payload.agentId, businessState: 'idle' }],
      },
    }));
    const remove = vi.fn(async () => ({
      ok: true,
      state: {
        revision: 4,
        activeAgentId: 'main',
        agents: [{ agentId: 'main', businessState: 'idle' }],
      },
    }));

    globalThis.window = {
      desktop: {
        isElectron: true,
        office: {
          publishPresence,
          heartbeat,
          setActive,
          remove,
        },
      },
    };

    const published = await desktopBridge.office.publishPresence({
      source: 'test',
      activeAgentId: 'agent-beta',
      agents: [
        {
          agentId: 'agent-beta',
          displayName: 'Beta',
          businessState: 'idle',
        },
      ],
    });
    const heartbeatState = await desktopBridge.office.heartbeat({
      agentId: 'agent-beta',
      ttlMs: 1000,
    });
    const activeState = await desktopBridge.office.setActiveAgent('agent-beta');
    const removedState = await desktopBridge.office.removeAgent('agent-beta');

    expect(publishPresence).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(setActive).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(published.activeAgentId).toBe('agent-beta');
    expect(heartbeatState.activeAgentId).toBe('agent-beta');
    expect(activeState.activeAgentId).toBe('agent-beta');
    expect(removedState.activeAgentId).toBe('main');
  });

  it('routes office.onEvent through preload office changed channel', () => {
    const unsubscribe = vi.fn();
    let listener = null;
    globalThis.window = {
      desktop: {
        isElectron: true,
        office: {
          onChanged: vi.fn((handler) => {
            listener = handler;
            return unsubscribe;
          }),
        },
      },
    };

    const officeHandler = vi.fn();
    const off = desktopBridge.office.onEvent(officeHandler);

    listener?.({
      state: {
        revision: 2,
        activeAgentId: 'main',
        agents: [{ agentId: 'main', businessState: 'syncing' }],
      },
      mutation: { type: 'update' },
    });

    expect(officeHandler).toHaveBeenCalledTimes(1);
    expect(officeHandler).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'office',
      type: 'update',
      payload: expect.objectContaining({
        revision: 2,
        activeAgentId: 'main',
        agents: [
          expect.objectContaining({
            agentId: 'main',
            businessState: 'syncing',
          }),
        ],
      }),
    }));

    off();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('desktopBridge settings bridge', () => {
  it('normalizes office scene layout from desktop settings payloads', async () => {
    globalThis.window = {
      desktop: {
        isElectron: true,
        settings: {
          get: vi.fn(async () => ({
            ui: {
              officeSceneLayout: {
                themeId: 'star-office-minimal',
                furnitureOverrides: {
                  sofa: {
                    left: 47.5,
                  },
                },
              },
            },
          })),
        },
      },
    };

    const settings = await desktopBridge.settings.get();

    expect(settings.ui.officeSceneLayout).toEqual({
      themeId: 'star-office-minimal',
      furnitureOverrides: {
        sofa: {
          left: 47.5,
        },
      },
    });
  });

  it('persists office scene layout in web fallback storage', async () => {
    const storage = new Map();
    globalThis.window = {
      localStorage: {
        getItem: vi.fn((key) => (storage.has(key) ? storage.get(key) : null)),
        setItem: vi.fn((key, value) => {
          storage.set(key, value);
        }),
      },
    };

    const saved = await desktopBridge.settings.save({
      ui: {
        officeSceneLayout: {
          themeId: 'star-office-minimal',
          furnitureOverrides: {
            desk: {
              width: 24,
            },
          },
        },
      },
    });

    expect(saved.ui.officeSceneLayout).toEqual({
      themeId: 'star-office-minimal',
      furnitureOverrides: {
        desk: {
          width: 24,
        },
      },
    });
    expect(JSON.parse(storage.get('openclaw.settings')).ui.officeSceneLayout).toEqual({
      themeId: 'star-office-minimal',
      furnitureOverrides: {
        desk: {
          width: 24,
        },
      },
    });
  });
});

describe('desktopBridge app updater bridge', () => {
  it('returns fallback state when app updater API is unavailable', async () => {
    globalThis.window = {
      desktop: {
        isElectron: true,
      },
    };

    const result = await desktopBridge.appUpdater.getState();
    expect(result).toEqual({
      ok: true,
      state: {
        status: 'idle',
        available: false,
        downloaded: false,
        supported: false,
        supportReason: 'desktop_app_updater_unavailable',
      },
    });
  });

  it('delegates check action to preload appUpdater API', async () => {
    const check = vi.fn(async () => ({ ok: true }));
    globalThis.window = {
      desktop: {
        isElectron: true,
        appUpdater: {
          check,
        },
      },
    };

    const result = await desktopBridge.appUpdater.check();
    expect(result).toEqual({ ok: true });
    expect(check).toHaveBeenCalledTimes(1);
  });
});
