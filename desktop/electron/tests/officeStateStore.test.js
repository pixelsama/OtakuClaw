const assert = require('node:assert/strict');
const test = require('node:test');

const { createOfficeStateStore } = require('../services/officeStateStore');

test('office state store upserts agents, updates active agent, and bumps revision', () => {
  const store = createOfficeStateStore();
  const snapshots = [];

  const unsubscribe = store.subscribe((state, mutation) => {
    snapshots.push({
      state,
      mutation,
    });
  });

  const first = store.upsert({
    activeAgentId: 'agent-1',
    agent: {
      id: 'agent-1',
      name: 'Claw',
      role: 'support',
    },
  });

  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.equal(first.state.revision, 1);
  assert.equal(first.state.activeAgentId, 'agent-1');
  assert.equal(first.state.agents.length, 1);
  assert.equal(first.state.agents[0].name, 'Claw');

  const second = store.update({
    activeAgentId: 'agent-2',
    agent: {
      id: 'agent-1',
      role: 'lead',
    },
  });

  assert.equal(second.ok, true);
  assert.equal(second.changed, true);
  assert.equal(second.state.revision, 2);
  assert.equal(second.state.activeAgentId, 'agent-2');
  assert.equal(second.state.agents[0].role, 'lead');

  const unchanged = store.update({
    activeAgentId: 'agent-2',
    agent: {
      id: 'agent-1',
      role: 'lead',
    },
  });

  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.state.revision, 2);

  unsubscribe();

  assert.equal(snapshots.length >= 3, true);
  assert.equal(snapshots[0].mutation.type, 'snapshot');
  assert.equal(snapshots[1].mutation.type, 'upsert');
  assert.equal(snapshots[2].mutation.type, 'update');
});

test('office state store applies office conversation events', () => {
  const store = createOfficeStateStore({
    initialState: {
      revision: 5,
      activeAgentId: 'agent-1',
      agents: [
        {
          id: 'agent-1',
          name: 'Old name',
        },
      ],
    },
  });

  const upsertResult = store.applyConversationEvent({
    channel: 'office',
    type: 'upsert',
    payload: {
      agent: {
        id: 'agent-2',
        name: 'Assistant',
      },
    },
  });

  assert.equal(upsertResult.ok, true);
  assert.equal(upsertResult.state.revision, 6);
  assert.equal(upsertResult.state.agents.length, 2);

  const updateResult = store.applyConversationEvent({
    channel: 'office',
    type: 'set-active-agent',
    payload: {
      activeAgentId: 'agent-2',
    },
  });

  assert.equal(updateResult.ok, true);
  assert.equal(updateResult.state.activeAgentId, 'agent-2');
  assert.equal(updateResult.state.revision, 7);
});
