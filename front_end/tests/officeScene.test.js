import { describe, expect, it } from 'vitest';
import {
  derivePrimaryOfficeAgent,
  normalizeOfficeState,
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
});
