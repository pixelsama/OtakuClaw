import { describe, expect, it } from 'vitest';
import {
  derivePrimaryOfficeAgent,
  normalizeOfficeState,
  reduceOfficeActivityHint,
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
