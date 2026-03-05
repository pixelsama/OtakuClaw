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

  assert.deepEqual(
    emitted.map((event) => event.type),
    ['text-delta', 'segment-ready', 'done'],
  );
  assert.equal(emitted[0].payload.content, 'hello');
  assert.equal(emitted[0].payload.inputSource, 'text-composer');
  assert.equal(emitted[1].payload.text, 'hello');
  assert.equal(emitted[1].payload.inputSource, 'text-composer');
  assert.equal(emitted[2].payload.sessionId, 's1');
  assert.equal(emitted[2].payload.turnId, emitted[2].streamId);
  assert.equal(emitted[2].payload.inputSource, 'text-composer');
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

test('chat stream emits mapped error when backend resolution fails', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  registerChatStreamIpc({
    ipcMain,
    getSettings: () => ({ baseUrl: 'http://example.com', token: 'x', agentId: 'main' }),
    emitEvent: (event) => emitted.push(event),
    backendManager: {
      resolveBackendName: () => {
        const error = new Error('Unsupported chat backend: nanobot');
        error.code = 'chat_backend_unsupported';
        throw error;
      },
      mapError: (error) => ({
        code: error.code || 'chat_backend_error',
        message: error.message || 'backend error',
      }),
    },
  });

  await ipcMain.invoke('chat:stream:start', {
    sessionId: 's1',
    content: 'hello',
    backend: 'nanobot',
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, 'error');
  assert.equal(emitted[0].payload.code, 'chat_backend_unsupported');
});

test('chat stream respects explicit backend override', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];
  let usedBackend = null;

  registerChatStreamIpc({
    ipcMain,
    getSettings: () => ({ chatBackend: 'openclaw' }),
    emitEvent: (event) => emitted.push(event),
    startStream: async ({ backend, onEvent }) => {
      usedBackend = backend;
      onEvent({ type: 'done', payload: { source: backend } });
    },
  });

  await ipcMain.invoke('chat:stream:start', {
    sessionId: 's1',
    content: 'hello',
    backend: 'nanobot',
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(usedBackend, 'nanobot');
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, 'done');
  assert.equal(emitted[0].payload.source, 'nanobot');
});

test('chat stream segment-ready follows sentence boundaries across deltas', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  registerChatStreamIpc({
    ipcMain,
    getSettings: () => ({ baseUrl: 'http://example.com', token: 'x', agentId: 'main' }),
    emitEvent: (event) => emitted.push(event),
    startStream: async ({ onEvent }) => {
      onEvent({ type: 'text-delta', payload: { content: '你好。世界' } });
      onEvent({ type: 'text-delta', payload: { content: '！' } });
      onEvent({ type: 'done', payload: { source: 'openclaw' } });
    },
  });

  await ipcMain.invoke('chat:stream:start', {
    sessionId: 's1',
    content: 'hello',
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const segments = emitted
    .filter((event) => event.type === 'segment-ready')
    .map((event) => event.payload.text);
  assert.deepEqual(segments, ['你好。', '世界！']);
});

test('chat stream forwards request input source metadata', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  registerChatStreamIpc({
    ipcMain,
    getSettings: () => ({ baseUrl: 'http://example.com', token: 'x', agentId: 'main' }),
    emitEvent: (event) => emitted.push(event),
    startStream: async ({ onEvent }) => {
      onEvent({ type: 'text-delta', payload: { content: 'voice line' } });
      onEvent({ type: 'done', payload: { source: 'nanobot' } });
    },
  });

  await ipcMain.invoke('chat:stream:start', {
    sessionId: 'voice-session',
    content: 'hello',
    options: { source: 'voice-asr' },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  const deltaEvent = emitted.find((event) => event.type === 'text-delta');
  const doneEvent = emitted.find((event) => event.type === 'done');
  assert.equal(deltaEvent?.payload?.inputSource, 'voice-asr');
  assert.equal(doneEvent?.payload?.inputSource, 'voice-asr');
});
