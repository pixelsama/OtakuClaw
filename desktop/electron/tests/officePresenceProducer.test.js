const assert = require('node:assert/strict');
const test = require('node:test');

const { createOfficeStateStore } = require('../services/officeStateStore');
const { createOfficePresenceProducer } = require('../services/officePresenceProducer');

test('office presence producer publishes presence without overriding active agent unless requested', () => {
  const store = createOfficeStateStore({
    initialState: {
      revision: 2,
      activeAgentId: 'main',
      agents: [
        {
          id: 'main',
          name: 'OtakuClaw',
        },
      ],
    },
  });
  const producer = createOfficePresenceProducer({
    officeStateStore: store,
    setIntervalFn: null,
    clearIntervalFn: null,
  });

  const result = producer.publishPresence({
    agents: [
      {
        id: 'agent-1',
        name: 'Scout',
        businessState: 'researching',
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.activeAgentId, 'main');
  assert.equal(result.state.agents.length, 2);

  const promoted = producer.publishPresence({
    activeAgentId: 'agent-1',
    agents: [
      {
        id: 'agent-1',
        name: 'Scout',
        businessState: 'executing',
      },
    ],
  });

  assert.equal(promoted.state.activeAgentId, 'agent-1');
  producer.dispose();
});

test('office presence producer heartbeats and expires leased agents', () => {
  let now = Date.parse('2026-03-21T10:00:00.000Z');
  const store = createOfficeStateStore();
  const producer = createOfficePresenceProducer({
    officeStateStore: store,
    now: () => now,
    setIntervalFn: null,
    clearIntervalFn: null,
  });

  producer.publishPresence({
    source: 'test-runner',
    ttlMs: 1000,
    agents: [
      {
        id: 'agent-lease',
        name: 'Lease Agent',
      },
    ],
  });

  now += 500;
  const heartbeatResult = producer.heartbeat({
    source: 'test-runner',
    ttlMs: 1000,
    agentId: 'agent-lease',
  });
  assert.equal(heartbeatResult.ok, true);
  assert.equal(heartbeatResult.state.agents.some((agent) => agent.id === 'agent-lease'), true);

  now += 1200;
  const cleanupResult = producer.cleanupExpiredPresence();
  assert.equal(cleanupResult.ok, true);
  assert.equal(cleanupResult.state.agents.some((agent) => agent.id === 'agent-lease'), false);
  producer.dispose();
});

test('office presence producer routes office conversation events through lifecycle helpers', () => {
  const store = createOfficeStateStore();
  const producer = createOfficePresenceProducer({
    officeStateStore: store,
    setIntervalFn: null,
    clearIntervalFn: null,
  });

  const presenceResult = producer.applyConversationEvent({
    channel: 'office',
    type: 'presence-upsert',
    payload: {
      activeAgentId: 'agent-1',
      agents: [
        {
          id: 'agent-1',
          name: 'Observer',
        },
      ],
    },
  });
  assert.equal(presenceResult.ok, true);
  assert.equal(presenceResult.state.activeAgentId, 'agent-1');

  const removeResult = producer.applyConversationEvent({
    channel: 'office',
    type: 'agent-remove',
    payload: {
      agentId: 'agent-1',
    },
  });
  assert.equal(removeResult.ok, true);
  assert.equal(removeResult.state.agents.length, 0);
  producer.dispose();
});
