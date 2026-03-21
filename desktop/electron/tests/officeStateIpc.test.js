const assert = require('node:assert/strict');
const test = require('node:test');

const { registerOfficeStateIpc } = require('../ipc/officeState');

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

test('office state ipc delegates get/upsert/update to the store', async () => {
  const ipcMain = createIpcMainMock();
  const calls = [];
  let currentState = {
    revision: 3,
    activeAgentId: 'agent-1',
    agents: [
      {
        id: 'agent-1',
        name: 'Claw',
      },
    ],
  };

  registerOfficeStateIpc({
    ipcMain,
    officeStateStore: {
      getState() {
        calls.push('getState');
        return currentState;
      },
      upsert(request) {
        calls.push(['upsert', request]);
        currentState = {
          ...currentState,
          revision: currentState.revision + 1,
          agents: [
            ...currentState.agents,
            {
              id: request.agent.id,
              name: request.agent.name,
            },
          ],
        };
        return {
          ok: true,
          changed: true,
          state: currentState,
        };
      },
      update(request) {
        calls.push(['update', request]);
        currentState = {
          ...currentState,
          revision: currentState.revision + 1,
          activeAgentId: request.activeAgentId || currentState.activeAgentId,
        };
        return {
          ok: true,
          changed: true,
          state: currentState,
        };
      },
    },
    officePresenceProducer: {
      publishPresence(request) {
        calls.push(['presence', request]);
        currentState = {
          ...currentState,
          revision: currentState.revision + 1,
          agents: request.agents || currentState.agents,
        };
        return {
          ok: true,
          changed: true,
          state: currentState,
        };
      },
      heartbeat(request) {
        calls.push(['heartbeat', request]);
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
      removePresence(request) {
        calls.push(['remove', request]);
        currentState = {
          ...currentState,
          revision: currentState.revision + 1,
          agents: currentState.agents.filter((agent) => agent.id !== request.agentId),
        };
        return {
          ok: true,
          changed: true,
          state: currentState,
        };
      },
      setActiveAgent(request) {
        calls.push(['setActive', request]);
        currentState = {
          ...currentState,
          revision: currentState.revision + 1,
          activeAgentId: request.agentId,
        };
        return {
          ok: true,
          changed: true,
          state: currentState,
        };
      },
    },
  });

  const stateResult = await ipcMain.invoke('office-state:get');
  assert.equal(stateResult.ok, true);
  assert.equal(stateResult.state.revision, 3);

  const upsertResult = await ipcMain.invoke('office-state:upsert', {
    agent: {
      id: 'agent-2',
      name: 'Assistant',
    },
  });
  assert.equal(upsertResult.ok, true);
  assert.equal(upsertResult.state.revision, 4);

  const updateResult = await ipcMain.invoke('office-state:update', {
    activeAgentId: 'agent-2',
  });
  assert.equal(updateResult.ok, true);
  assert.equal(updateResult.state.activeAgentId, 'agent-2');

  const presenceResult = await ipcMain.invoke('office-state:presence', {
    agents: [
      {
        id: 'agent-3',
        name: 'Presence Agent',
      },
    ],
  });
  assert.equal(presenceResult.ok, true);
  assert.equal(presenceResult.state.agents[0].id, 'agent-3');

  const heartbeatResult = await ipcMain.invoke('office-state:heartbeat', {
    agentIds: ['agent-3'],
  });
  assert.equal(heartbeatResult.ok, true);

  const setActiveResult = await ipcMain.invoke('office-state:set-active', {
    agentId: 'agent-3',
  });
  assert.equal(setActiveResult.ok, true);
  assert.equal(setActiveResult.state.activeAgentId, 'agent-3');

  const removeResult = await ipcMain.invoke('office-state:remove', {
    agentId: 'agent-3',
  });
  assert.equal(removeResult.ok, true);
  assert.equal(removeResult.state.agents.length, 0);

  assert.deepEqual(calls, [
    'getState',
    ['upsert', {
      agent: {
        id: 'agent-2',
        name: 'Assistant',
      },
    }],
    ['update', {
      activeAgentId: 'agent-2',
    }],
    ['presence', {
      agents: [
        {
          id: 'agent-3',
          name: 'Presence Agent',
        },
      ],
    }],
    ['heartbeat', {
      agentIds: ['agent-3'],
    }],
    ['setActive', {
      agentId: 'agent-3',
    }],
    ['remove', {
      agentId: 'agent-3',
    }],
  ]);
});
