const assert = require('node:assert/strict');
const test = require('node:test');

const { registerValueStateIpc } = require('../ipc/valueState');
const { createValueProposalService } = require('../services/valueState/valueProposalService');
const { createValueStateStore } = require('../services/valueState/valueStateStore');

function createIpcMainMock() {
  const handlers = new Map();

  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
    async invoke(channel, payload) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`Missing handler for ${channel}`);
      }
      return handler({}, payload);
    },
  };
}

test('value state store clamps stat updates and appends history', () => {
  const store = createValueStateStore();

  const result = store.applyStatUpdates({
    agentId: 'agent-a',
    characterId: 'character-a',
    routeKey: 'agent-a:nanobot:shared',
    sessionId: 'session-1',
    turnId: 'turn-1',
    source: 'conversation',
    statUpdates: [
      {
        stat: 'mood',
        delta: 20,
        reason: 'positive feedback',
        confidence: 0.9,
      },
      {
        stat: 'affinity',
        delta: 9,
        reason: 'positive feedback',
        confidence: 0.9,
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.result.appliedUpdates.length, 2);
  assert.equal(result.result.appliedUpdates[0].appliedDelta, 8);
  assert.equal(result.result.appliedUpdates[1].appliedDelta, 3);
  assert.equal(result.state.entities[0].stats.mood.value, 8);
  assert.equal(result.state.entities[0].stats.affinity.value, 103);
  assert.equal(result.state.history.length, 2);
  assert.equal(result.state.history[0].routeKey, 'agent-a:nanobot:shared');
});

test('value proposal service extracts structured stat updates from chat events', () => {
  const store = createValueStateStore();
  const service = createValueProposalService({
    valueStateStore: store,
  });

  const result = service.applyConversationEvent({
    channel: 'chat',
    agentId: 'agent-a',
    backend: 'nanobot',
    routeKey: 'agent-a:nanobot:shared',
    sessionId: 'session-1',
    turnId: 'turn-2',
    type: 'stat-updates',
    payload: {
      stat_updates: [
        {
          stat: 'mood',
          delta: -4,
          reason: 'user seemed distracted',
          confidence: 0.8,
        },
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.state.entities[0].stats.mood.value, -4);
  assert.equal(result.state.history[0].source, 'chat');
});

test('value state ipc delegates get upsert and propose handlers', async () => {
  const ipcMain = createIpcMainMock();
  const calls = [];
  let currentState = {
    revision: 1,
    entities: [],
    history: [],
  };

  registerValueStateIpc({
    ipcMain,
    valueStateStore: {
      getState() {
        calls.push('getState');
        return currentState;
      },
      upsertEntity(request) {
        calls.push(['upsert', request]);
        currentState = {
          ...currentState,
          revision: currentState.revision + 1,
        };
        return {
          ok: true,
          changed: true,
          state: currentState,
        };
      },
      applyStatUpdates(request) {
        calls.push(['applyStatUpdates', request]);
        currentState = {
          ...currentState,
          revision: currentState.revision + 1,
        };
        return {
          ok: true,
          changed: true,
          state: currentState,
        };
      },
    },
    valueProposalService: {
      applyProposal(request) {
        calls.push(['proposal', request]);
        currentState = {
          ...currentState,
          revision: currentState.revision + 1,
        };
        return {
          ok: true,
          changed: true,
          state: currentState,
        };
      },
    },
  });

  const stateResult = await ipcMain.invoke('value-state:get');
  assert.equal(stateResult.ok, true);
  assert.equal(stateResult.state.revision, 1);

  const upsertResult = await ipcMain.invoke('value-state:upsert', {
    agentId: 'agent-a',
    characterId: 'character-a',
  });
  assert.equal(upsertResult.ok, true);

  const proposeResult = await ipcMain.invoke('value-state:propose', {
    agentId: 'agent-a',
    characterId: 'character-a',
    statUpdates: [
      {
        stat: 'mood',
        delta: 1,
      },
    ],
  });
  assert.equal(proposeResult.ok, true);

  const updateResult = await ipcMain.invoke('value-state:update', {
    agentId: 'agent-a',
    characterId: 'character-a',
    statUpdates: [
      {
        stat: 'affinity',
        delta: 1,
      },
    ],
  });
  assert.equal(updateResult.ok, true);

  assert.deepEqual(calls, [
    'getState',
    ['upsert', {
      agentId: 'agent-a',
      characterId: 'character-a',
    }],
    ['proposal', {
      agentId: 'agent-a',
      characterId: 'character-a',
      statUpdates: [
        {
          stat: 'mood',
          delta: 1,
        },
      ],
    }],
    ['applyStatUpdates', {
      agentId: 'agent-a',
      characterId: 'character-a',
      statUpdates: [
        {
          stat: 'affinity',
          delta: 1,
        },
      ],
    }],
  ]);
});
