const assert = require('node:assert/strict');
const test = require('node:test');

const { registerChatStreamIpc } = require('../ipc/chatStream');
const { registerVoiceSessionIpc } = require('../ipc/voiceSession');

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

test('asr-final automatically starts chat stream through shared ipc pipeline', async () => {
  const ipcMain = createIpcMainMock();
  const voiceEvents = [];
  const chatEvents = [];
  const autoStarts = [];

  const chatControl = registerChatStreamIpc({
    ipcMain,
    getSettings: () => ({ baseUrl: 'http://example.com', token: 'x', agentId: 'main' }),
    emitEvent: (event) => {
      chatEvents.push(event);
    },
    startStream: async ({ content, onEvent }) => {
      onEvent({
        type: 'text-delta',
        payload: { content: `echo:${content}` },
      });
      onEvent({
        type: 'done',
        payload: { source: 'openclaw' },
      });
    },
  });

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => {
      voiceEvents.push(event);
    },
    createAsrServiceImpl: () => ({
      transcribe: async () => ({ text: 'hello voice' }),
    }),
    onAsrFinal: async ({ sessionId, text }) => {
      autoStarts.push({ sessionId, text });
      await chatControl.start({
        sessionId,
        content: text,
        options: { source: 'voice-asr' },
      });
    },
  });

  const started = await ipcMain.invoke('voice:session:start', {
    sessionId: 'voice-session-1',
    mode: 'vad',
  });
  assert.equal(started.ok, true);

  const chunkResult = await ipcMain.invoke('voice:audio:chunk', {
    sessionId: 'voice-session-1',
    seq: 1,
    chunkId: 1,
    pcmChunk: Buffer.from([1, 2, 3, 4]),
    sampleRate: 16000,
    channels: 1,
    sampleFormat: 'pcm_s16le',
    isSpeech: true,
  });
  assert.equal(chunkResult.ok, true);

  const commitResult = await ipcMain.invoke('voice:input:commit', {
    sessionId: 'voice-session-1',
    finalSeq: 1,
  });
  assert.equal(commitResult.ok, true);
  assert.equal(commitResult.text, 'hello voice');

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(autoStarts.length, 1);
  assert.equal(autoStarts[0].sessionId, 'voice-session-1');
  assert.equal(autoStarts[0].text, 'hello voice');

  const chatEventTypes = chatEvents.map((event) => event.type);
  assert.deepEqual(chatEventTypes, ['text-delta', 'segment-ready', 'done']);
  assert.equal(chatEvents[0].payload.content, 'echo:hello voice');
  assert.equal(chatEvents[1].payload.text, 'echo:hello voice');

  const hasAsrFinalEvent = voiceEvents.some(
    (event) => event.type === 'asr-final' && event.text === 'hello voice',
  );
  assert.equal(hasAsrFinalEvent, true);
});
