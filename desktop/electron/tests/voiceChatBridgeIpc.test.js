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

async function waitFor(predicate, { timeoutMs = 1000, intervalMs = 5 } = {}) {
  const startAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startAt > timeoutMs) {
      throw new Error('wait_for_timeout');
    }

    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }
}

test('asr-final automatically starts chat stream through shared ipc pipeline', async () => {
  const ipcMain = createIpcMainMock();
  const voiceEvents = [];
  const chatEvents = [];
  const autoStarts = [];
  let voiceControl = null;

  const chatControl = registerChatStreamIpc({
    ipcMain,
    getSettings: () => ({ baseUrl: 'http://example.com', token: 'x', agentId: 'main' }),
    emitEvent: (event) => {
      chatEvents.push(event);
      if (!voiceControl) {
        return;
      }

      if (event.type === 'segment-ready' && event.payload) {
        voiceControl.enqueueSegmentReady?.(event.payload);
      } else if (event.type === 'done' || event.type === 'error') {
        const payload = event.payload || {};
        voiceControl.markTurnDone?.({
          sessionId: payload.sessionId,
          turnId: payload.turnId || event.streamId,
          aborted: event.type === 'error' || Boolean(payload.aborted),
          reason: event.type === 'error' ? 'turn_error' : '',
        });
      }
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

  voiceControl = registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => {
      voiceEvents.push(event);
    },
    createAsrServiceImpl: () => ({
      transcribe: async () => ({ text: 'hello voice' }),
    }),
    createTtsServiceImpl: () => ({
      synthesize: async ({ onChunk }) => {
        await onChunk({
          audioChunk: Buffer.from([1, 2, 3, 4]),
          codec: 'pcm_s16le',
          sampleRate: 24000,
        });
      },
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
  await waitFor(() =>
    voiceEvents.some((event) => event.type === 'segment-tts-finished'),
  );

  assert.equal(autoStarts.length, 1);
  assert.equal(autoStarts[0].sessionId, 'voice-session-1');
  assert.equal(autoStarts[0].text, 'hello voice');

  const chatEventTypes = chatEvents.map((event) => event.type);
  assert.deepEqual(chatEventTypes, ['text-delta', 'segment-ready', 'done']);
  assert.equal(chatEvents[0].payload.content, 'echo:hello voice');
  assert.equal(chatEvents[1].payload.text, 'echo:hello voice');
  assert.equal(chatEvents[2].payload.sessionId, 'voice-session-1');
  assert.equal(chatEvents[2].payload.turnId, chatEvents[2].streamId);

  const hasAsrFinalEvent = voiceEvents.some(
    (event) => event.type === 'asr-final' && event.text === 'hello voice',
  );
  assert.equal(hasAsrFinalEvent, true);

  const segmentReadyPayload = chatEvents.find((event) => event.type === 'segment-ready')?.payload;
  const ttsStarted = voiceEvents.find((event) => event.type === 'segment-tts-started');
  const ttsFinished = voiceEvents.find((event) => event.type === 'segment-tts-finished');
  assert.equal(ttsStarted?.segmentId, segmentReadyPayload?.segmentId);
  assert.equal(ttsFinished?.segmentId, segmentReadyPayload?.segmentId);
  assert.equal(
    voiceEvents.some((event) => event.type === 'tts-chunk' && event.segmentId === segmentReadyPayload?.segmentId),
    true,
  );
});
