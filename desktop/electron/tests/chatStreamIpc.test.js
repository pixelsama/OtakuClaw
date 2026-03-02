const assert = require('node:assert/strict');
const test = require('node:test');

const { registerChatStreamIpc } = require('../ipc/chatStream');

function createIpcMainMock() {
  const handlers = new Map();

  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
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

test('chat stream emits text-delta and done events', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  registerChatStreamIpc({
    ipcMain,
    getSettings: () => ({ baseUrl: 'http://example.com', token: 'x', agentId: 'main' }),
    emitEvent: (event) => emitted.push(event),
    startStream: async ({ onEvent }) => {
      onEvent({ type: 'text-delta', payload: { content: 'hello' } });
      onEvent({ type: 'done', payload: { source: 'openclaw' } });
    },
  });

  await ipcMain.invoke('chat:stream:start', {
    sessionId: 's1',
    content: 'hello',
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].type, 'text-delta');
  assert.equal(emitted[0].payload.content, 'hello');
  assert.equal(emitted[1].type, 'done');
});

test('chat stream abort emits done with aborted flag', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  registerChatStreamIpc({
    ipcMain,
    getSettings: () => ({ baseUrl: 'http://example.com', token: 'x', agentId: 'main' }),
    emitEvent: (event) => emitted.push(event),
    startStream: async ({ signal }) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    },
  });

  const started = await ipcMain.invoke('chat:stream:start', {
    sessionId: 's1',
    content: 'hello',
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  await ipcMain.invoke('chat:stream:abort', { streamId: started.streamId });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, 'done');
  assert.equal(emitted[0].payload.aborted, true);
});
