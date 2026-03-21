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

test('office state store upsertAgents preserves active agent and can promote explicitly', () => {
  const store = createOfficeStateStore({
    initialState: {
      revision: 8,
      activeAgentId: 'agent-2',
      agents: [
        {
          id: 'agent-2',
          name: 'Support',
          role: 'support',
        },
      ],
    },
  });

  const result = store.upsertAgents([
    {
      id: 'agent-1',
      name: 'Claw',
      role: 'lead',
    },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.state.revision, 9);
  assert.equal(result.state.activeAgentId, 'agent-2');
  assert.equal(result.state.agents.length, 2);

  const promoted = store.setActiveAgent('agent-1');
  assert.equal(promoted.ok, true);
  assert.equal(promoted.changed, true);
  assert.equal(promoted.state.activeAgentId, 'agent-1');
  assert.equal(promoted.state.revision, 10);
});

test('office state store removes agents and falls back to a remaining agent', () => {
  const store = createOfficeStateStore({
    initialState: {
      revision: 12,
      activeAgentId: 'agent-2',
      agents: [
        {
          id: 'agent-1',
          name: 'Claw',
        },
        {
          id: 'agent-2',
          name: 'Support',
        },
      ],
    },
  });

  const result = store.removeAgent('agent-2');

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.state.agents.length, 1);
  assert.equal(result.state.agents[0].id, 'agent-1');
  assert.equal(result.state.activeAgentId, 'agent-1');
  assert.equal(result.state.revision, 13);
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

  const presenceResult = store.applyConversationEvent({
    channel: 'office',
    type: 'presence-upsert',
    payload: {
      agents: [
        {
          id: 'agent-3',
          name: 'Observer',
        },
      ],
    },
  });

  assert.equal(presenceResult.ok, true);
  assert.equal(presenceResult.state.agents.some((agent) => agent.id === 'agent-3'), true);
});
