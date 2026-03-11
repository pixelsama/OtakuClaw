const assert = require('node:assert/strict');
const test = require('node:test');

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

function createAbortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
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

test('voice session start -> chunk -> commit emits state and asr events', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => emitted.push(event),
    createAsrServiceImpl: () => ({
      transcribe: async ({ onPartial }) => {
        onPartial('hel');
        return { text: 'hello' };
      },
    }),
  });

  const started = await ipcMain.invoke('voice:session:start', {
    sessionId: 's1',
    mode: 'vad',
  });
  assert.equal(started.ok, true);
  assert.equal(started.status, 'listening');

  const chunkResult = await ipcMain.invoke('voice:audio:chunk', {
    sessionId: 's1',
    seq: 1,
    chunkId: 1,
    pcmChunk: Buffer.from([1, 2, 3, 4]),
    sampleRate: 16000,
    channels: 1,
    sampleFormat: 'pcm_s16le',
    isSpeech: true,
  });
  assert.equal(chunkResult.ok, true);

  const committed = await ipcMain.invoke('voice:input:commit', {
    sessionId: 's1',
    finalSeq: 1,
  });
  assert.equal(committed.ok, true);
  assert.equal(committed.text, 'hello');

  const eventTypes = emitted.map((event) => event.type);
  assert.deepEqual(eventTypes, ['state', 'state', 'asr-partial', 'asr-final', 'done', 'state']);
  assert.equal(emitted[3].text, 'hello');
});

test('voice commit respects autoStartChat flag when invoking onAsrFinal callback', async () => {
  const ipcMain = createIpcMainMock();
  const callbackCalls = [];

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: () => {},
    onAsrFinal: async ({ sessionId, text }) => {
      callbackCalls.push({ sessionId, text });
    },
    createAsrServiceImpl: () => ({
      transcribe: async () => ({ text: 'hello' }),
    }),
  });

  await ipcMain.invoke('voice:session:start', {
    sessionId: 'asr-auto-start-flag-s1',
    mode: 'vad',
  });

  await ipcMain.invoke('voice:audio:chunk', {
    sessionId: 'asr-auto-start-flag-s1',
    seq: 1,
    chunkId: 1,
    pcmChunk: Buffer.from([1, 2, 3, 4]),
    sampleRate: 16000,
    channels: 1,
    sampleFormat: 'pcm_s16le',
    isSpeech: true,
  });

  const firstCommit = await ipcMain.invoke('voice:input:commit', {
    sessionId: 'asr-auto-start-flag-s1',
    finalSeq: 1,
    autoStartChat: false,
  });
  assert.equal(firstCommit.ok, true);
  assert.equal(callbackCalls.length, 0);

  await ipcMain.invoke('voice:audio:chunk', {
    sessionId: 'asr-auto-start-flag-s1',
    seq: 2,
    chunkId: 2,
    pcmChunk: Buffer.from([5, 6, 7, 8]),
    sampleRate: 16000,
    channels: 1,
    sampleFormat: 'pcm_s16le',
    isSpeech: true,
  });

  const secondCommit = await ipcMain.invoke('voice:input:commit', {
    sessionId: 'asr-auto-start-flag-s1',
    finalSeq: 2,
  });
  assert.equal(secondCommit.ok, true);
  assert.equal(callbackCalls.length, 1);
  assert.deepEqual(callbackCalls[0], {
    sessionId: 'asr-auto-start-flag-s1',
    text: 'hello',
  });
});

test('voice session start triggers background asr warmup when available', async () => {
  const ipcMain = createIpcMainMock();
  let warmupCalls = 0;

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: () => {},
    createAsrServiceImpl: () => ({
      async warmup() {
        warmupCalls += 1;
      },
      async transcribe() {
        return { text: '' };
      },
    }),
  });

  await ipcMain.invoke('voice:session:start', {
    sessionId: 'warmup-s1',
    mode: 'vad',
  });

  await waitFor(() => warmupCalls >= 1);
  assert.equal(warmupCalls, 1);
});

test('voice runtime warmup reloads cached asr and tts services', async () => {
  const ipcMain = createIpcMainMock();
  const lifecycle = [];
  let envVersion = 1;

  const control = registerVoiceSessionIpc({
    ipcMain,
    emitEvent: () => {},
    resolveVoiceEnv: () => ({
      VOICE_ASR_PROVIDER: 'python',
      VOICE_TTS_PROVIDER: 'python',
      VOICE_ENV_VERSION: String(envVersion),
    }),
    createAsrServiceImpl: ({ env }) => ({
      async warmup() {
        lifecycle.push(`asr:warmup:${env.VOICE_ENV_VERSION}`);
      },
      async dispose() {
        lifecycle.push(`asr:dispose:${env.VOICE_ENV_VERSION}`);
      },
      async transcribe() {
        return { text: '' };
      },
    }),
    createTtsServiceImpl: ({ env }) => ({
      async warmup() {
        lifecycle.push(`tts:warmup:${env.VOICE_ENV_VERSION}`);
      },
      async dispose() {
        lifecycle.push(`tts:dispose:${env.VOICE_ENV_VERSION}`);
      },
      async synthesize() {
        return { sampleRate: 24000, sampleCount: 0 };
      },
    }),
  });

  await control.warmupRuntime({
    reload: true,
    warmAsr: true,
    warmTts: true,
  });

  envVersion = 2;
  await control.warmupRuntime({
    reload: true,
    warmAsr: true,
    warmTts: true,
  });

  assert.deepEqual(lifecycle, [
    'asr:warmup:1',
    'tts:warmup:1',
    'asr:dispose:1',
    'tts:dispose:1',
    'asr:warmup:2',
    'tts:warmup:2',
  ]);

  control();
});

test('voice warmup ipc reports already-warmed asr runtime on repeated requests', async () => {
  const ipcMain = createIpcMainMock();
  let asrWarmupCalls = 0;

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: () => {},
    createAsrServiceImpl: () => ({
      async warmup() {
        asrWarmupCalls += 1;
      },
      async transcribe() {
        return { text: '' };
      },
    }),
    createTtsServiceImpl: () => ({
      async synthesize() {
        return { sampleRate: 24000, sampleCount: 0 };
      },
    }),
  });

  const first = await ipcMain.invoke('voice:warmup', {
    warmAsr: true,
    warmTts: false,
  });
  const second = await ipcMain.invoke('voice:warmup', {
    warmAsr: true,
    warmTts: false,
  });

  assert.equal(first.ok, true);
  assert.equal(first.alreadyWarmAsr, false);
  assert.equal(first.warmedAsr, true);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyWarmAsr, true);
  assert.equal(second.warmedAsr, false);
  assert.equal(asrWarmupCalls, 1);
});

test('voice playback ack emits flow-control pause/resume', async () => {
  const ipcMain = createIpcMainMock();
  const flowEvents = [];

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: () => {},
    emitFlowControl: (event) => flowEvents.push(event),
  });

  await ipcMain.invoke('voice:session:start', { sessionId: 's2' });
  await ipcMain.invoke('voice:playback:ack', {
    sessionId: 's2',
    ackSeq: 1,
    bufferedMs: 2500,
  });
  await ipcMain.invoke('voice:playback:ack', {
    sessionId: 's2',
    ackSeq: 2,
    bufferedMs: 300,
  });

  assert.equal(flowEvents.length, 2);
  assert.equal(flowEvents[0].action, 'pause');
  assert.equal(flowEvents[1].action, 'resume');
});

test('voice commit is serialized and does not mix chunks across turns', async () => {
  const ipcMain = createIpcMainMock();
  const chunkSeqsPerCommit = [];
  let resolveFirstCommit;

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: () => {},
    createAsrServiceImpl: () => ({
      transcribe: async ({ audioChunks }) => {
        chunkSeqsPerCommit.push(audioChunks.map((chunk) => chunk.seq));
        if (chunkSeqsPerCommit.length === 1) {
          return new Promise((resolve) => {
            resolveFirstCommit = () => resolve({ text: 'first' });
          });
        }

        return { text: 'second' };
      },
    }),
  });

  await ipcMain.invoke('voice:session:start', {
    sessionId: 's3',
    mode: 'vad',
  });

  await ipcMain.invoke('voice:audio:chunk', {
    sessionId: 's3',
    seq: 1,
    chunkId: 1,
    pcmChunk: Buffer.from([1, 2]),
    sampleRate: 16000,
    channels: 1,
    sampleFormat: 'pcm_s16le',
    isSpeech: true,
  });

  const firstCommitPromise = ipcMain.invoke('voice:input:commit', {
    sessionId: 's3',
    finalSeq: 1,
  });
  await Promise.resolve();

  await ipcMain.invoke('voice:audio:chunk', {
    sessionId: 's3',
    seq: 2,
    chunkId: 2,
    pcmChunk: Buffer.from([3, 4]),
    sampleRate: 16000,
    channels: 1,
    sampleFormat: 'pcm_s16le',
    isSpeech: true,
  });

  const overlappingCommit = await ipcMain.invoke('voice:input:commit', {
    sessionId: 's3',
    finalSeq: 2,
  });
  assert.equal(overlappingCommit.ok, false);
  assert.equal(overlappingCommit.reason, 'transcribing_in_progress');

  resolveFirstCommit();
  const firstCommit = await firstCommitPromise;
  assert.equal(firstCommit.ok, true);
  assert.equal(firstCommit.text, 'first');

  const secondCommit = await ipcMain.invoke('voice:input:commit', {
    sessionId: 's3',
    finalSeq: 2,
  });
  assert.equal(secondCommit.ok, true);
  assert.equal(secondCommit.text, 'second');

  assert.deepEqual(chunkSeqsPerCommit, [[1], [2]]);
});

test('voice tts backpressure pauses and resumes chunk delivery', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];
  const flowEvents = [];

  const voiceControl = registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => emitted.push(event),
    emitFlowControl: (event) => flowEvents.push(event),
    createAsrServiceImpl: () => ({ warmup: async () => {}, transcribe: async () => ({ text: '' }) }),
    createTtsServiceImpl: () => ({
      synthesize: async ({ signal, onChunk }) => {
        await onChunk({
          audioChunk: Buffer.from([1, 2, 3, 4]),
          codec: 'pcm_s16le',
          sampleRate: 24000,
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (signal.aborted) {
          throw createAbortError();
        }
        await onChunk({
          audioChunk: Buffer.from([5, 6, 7, 8]),
          codec: 'pcm_s16le',
          sampleRate: 24000,
        });
        await onChunk({
          audioChunk: Buffer.from([9, 10, 11, 12]),
          codec: 'pcm_s16le',
          sampleRate: 24000,
        });
      },
    }),
  });

  await ipcMain.invoke('voice:session:start', {
    sessionId: 's4',
    mode: 'vad',
  });

  const enqueueResult = voiceControl.enqueueSegmentReady({
    sessionId: 's4',
    turnId: 'turn-s4-1',
    segmentId: 'turn-s4-1:0',
    index: 0,
    text: 'hello world',
    final: true,
  });
  assert.equal(enqueueResult.ok, true);
  const markDoneResult = voiceControl.markTurnDone({
    sessionId: 's4',
    turnId: 'turn-s4-1',
  });
  assert.equal(markDoneResult.ok, true);

  const queueDrainPromise = waitFor(
    () => emitted.filter((event) => event.type === 'segment-tts-finished').length >= 1,
    { timeoutMs: 2000 },
  );

  await waitFor(() => emitted.filter((event) => event.type === 'tts-chunk').length >= 1);
  await ipcMain.invoke('voice:playback:ack', {
    sessionId: 's4',
    ackSeq: 1,
    bufferedMs: 2600,
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(emitted.filter((event) => event.type === 'tts-chunk').length, 1);

  await ipcMain.invoke('voice:playback:ack', {
    sessionId: 's4',
    ackSeq: 1,
    bufferedMs: 200,
  });

  await queueDrainPromise;
  const ttsChunkEvents = emitted.filter((event) => event.type === 'tts-chunk');
  assert.equal(ttsChunkEvents.length, 3);
  assert.equal(Buffer.isBuffer(ttsChunkEvents[0].audioChunk), false);
  assert.ok(ttsChunkEvents[0].audioChunk instanceof Uint8Array);
  assert.equal(flowEvents[0]?.action, 'pause');
  assert.equal(flowEvents[1]?.action, 'resume');
});

test('voice segment playback auto-creates an internal session for text-only output', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  const voiceControl = registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => emitted.push(event),
    createAsrServiceImpl: () => ({ warmup: async () => {}, transcribe: async () => ({ text: '' }) }),
    createTtsServiceImpl: () => ({
      synthesize: async ({ onChunk }) => {
        await onChunk({
          audioChunk: Buffer.from([1, 2, 3, 4]),
          codec: 'pcm_s16le',
          sampleRate: 24000,
        });
      },
    }),
  });

  const enqueueResult = voiceControl.enqueueSegmentReady({
    sessionId: 'text-composer',
    turnId: 'turn-text-1',
    segmentId: 'turn-text-1:0',
    index: 0,
    text: 'text output should speak without manual voice session',
    final: true,
  });
  assert.equal(enqueueResult.ok, true);

  const markDoneResult = voiceControl.markTurnDone({
    sessionId: 'text-composer',
    turnId: 'turn-text-1',
  });
  assert.equal(markDoneResult.ok, true);

  await waitFor(() =>
    emitted.some((event) => event.type === 'segment-tts-finished' && event.segmentId === 'turn-text-1:0'),
  );

  assert.equal(emitted.some((event) => event.type === 'state' && event.sessionId === 'text-composer'), false);
  assert.equal(
    emitted.some((event) => event.type === 'tts-chunk' && event.sessionId === 'text-composer'),
    true,
  );
});

test('voice session start upgrades an internal playback session into a ui-owned session', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  const voiceControl = registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => emitted.push(event),
    createAsrServiceImpl: () => ({ warmup: async () => {}, transcribe: async () => ({ text: '' }) }),
    createTtsServiceImpl: () => ({
      synthesize: async ({ onChunk }) => {
        await onChunk({
          audioChunk: Buffer.from([1, 2, 3, 4]),
          codec: 'pcm_s16le',
          sampleRate: 24000,
        });
      },
    }),
  });

  voiceControl.enqueueSegmentReady({
    sessionId: 'text-composer',
    turnId: 'turn-upgrade-1',
    segmentId: 'turn-upgrade-1:0',
    index: 0,
    text: 'upgrade session ownership',
    final: true,
  });

  const started = await ipcMain.invoke('voice:session:start', {
    sessionId: 'text-composer',
    mode: 'vad',
  });

  assert.equal(started.ok, true);
  assert.equal(started.status, 'speaking');
  assert.equal(
    emitted.some((event) => event.type === 'state' && event.sessionId === 'text-composer' && event.status === 'speaking'),
    true,
  );
});

test('voice session survives event emitter exception during tts chunk delivery', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];
  let throwOnFirstTtsChunk = true;

  const voiceControl = registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => {
      emitted.push(event);
      if (event.type === 'tts-chunk' && throwOnFirstTtsChunk) {
        throwOnFirstTtsChunk = false;
        throw new Error('renderer_send_failed');
      }
    },
    createAsrServiceImpl: () => ({ warmup: async () => {}, transcribe: async () => ({ text: '' }) }),
    createTtsServiceImpl: () => ({
      synthesize: async ({ onChunk }) => {
        await onChunk({
          audioChunk: Buffer.from([1, 2, 3, 4]),
          codec: 'pcm_s16le',
          sampleRate: 24000,
        });
      },
    }),
  });

  await ipcMain.invoke('voice:session:start', { sessionId: 's-emit-err', mode: 'vad' });
  const enqueueResult = voiceControl.enqueueSegmentReady({
    sessionId: 's-emit-err',
    turnId: 'turn-emit-err-1',
    segmentId: 'turn-emit-err-1:0',
    index: 0,
    text: 'hello',
    final: true,
  });
  assert.equal(enqueueResult.ok, true);
  const markDoneResult = voiceControl.markTurnDone({
    sessionId: 's-emit-err',
    turnId: 'turn-emit-err-1',
  });
  assert.equal(markDoneResult.ok, true);

  await waitFor(
    () => emitted.some((event) => event.type === 'segment-tts-finished' && event.segmentId === 'turn-emit-err-1:0'),
    { timeoutMs: 1500 },
  );
});

test('voice tts emits timeout error when playback ack is missing', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  const voiceControl = registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => emitted.push(event),
    ttsBackpressureTimeoutMs: 50,
    createAsrServiceImpl: () => ({ warmup: async () => {}, transcribe: async () => ({ text: '' }) }),
    createTtsServiceImpl: () => ({
      synthesize: async ({ signal, onChunk }) => {
        await onChunk({
          audioChunk: Buffer.from([1, 2, 3, 4]),
          codec: 'pcm_s16le',
          sampleRate: 24000,
        });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 500);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(createAbortError());
            },
            { once: true },
          );
        });
      },
    }),
  });

  await ipcMain.invoke('voice:session:start', { sessionId: 's5', mode: 'vad' });

  const enqueueResult = voiceControl.enqueueSegmentReady({
    sessionId: 's5',
    turnId: 'turn-s5-1',
    segmentId: 'turn-s5-1:0',
    index: 0,
    text: 'timeout check',
    final: true,
  });
  assert.equal(enqueueResult.ok, true);
  const markDoneResult = voiceControl.markTurnDone({
    sessionId: 's5',
    turnId: 'turn-s5-1',
  });
  assert.equal(markDoneResult.ok, true);

  await waitFor(
    () => emitted.some((event) => event.type === 'segment-tts-failed' && event.code === 'voice_tts_backpressure_timeout'),
    { timeoutMs: 1200 },
  );

  const timeoutError = emitted.find((event) => event.type === 'segment-tts-failed' && event.code === 'voice_tts_backpressure_timeout');
  assert.equal(timeoutError?.segmentId, 'turn-s5-1:0');
});

test('voice tts stop aborts speaking without emitting error', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  const voiceControl = registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => emitted.push(event),
    createAsrServiceImpl: () => ({ warmup: async () => {}, transcribe: async () => ({ text: '' }) }),
    createTtsServiceImpl: () => ({
      synthesize: async ({ signal, onChunk }) => {
        await onChunk({
          audioChunk: Buffer.from([1, 2, 3, 4]),
          codec: 'pcm_s16le',
          sampleRate: 24000,
        });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 1000);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(createAbortError());
            },
            { once: true },
          );
        });
      },
    }),
  });

  await ipcMain.invoke('voice:session:start', { sessionId: 's6', mode: 'vad' });
  const enqueueResult = voiceControl.enqueueSegmentReady({
    sessionId: 's6',
    turnId: 'turn-s6-1',
    segmentId: 'turn-s6-1:0',
    index: 0,
    text: 'manual stop',
    final: true,
  });
  assert.equal(enqueueResult.ok, true);
  const markDoneResult = voiceControl.markTurnDone({
    sessionId: 's6',
    turnId: 'turn-s6-1',
  });
  assert.equal(markDoneResult.ok, true);

  await waitFor(() => emitted.some((event) => event.type === 'tts-chunk' && event.segmentId === 'turn-s6-1:0'));
  const stopResult = await ipcMain.invoke('voice:tts:stop', {
    sessionId: 's6',
    reason: 'manual',
  });
  assert.equal(stopResult.ok, true);

  await waitFor(
    () => emitted.some((event) => event.type === 'segment-tts-failed' && event.segmentId === 'turn-s6-1:0'),
    { timeoutMs: 1500 },
  );

  const hasSpeakingError = emitted.some(
    (event) => event.type === 'error' && event.stage === 'speaking',
  );
  assert.equal(hasSpeakingError, false);
  const speakingDone = emitted.find(
    (event) => event.type === 'done' && event.stage === 'speaking' && event.aborted,
  );
  assert.ok(Boolean(speakingDone));
});

test('segment queue emits started/finished lifecycle with stable segmentId', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  const voiceControl = registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => emitted.push(event),
    createTtsServiceImpl: () => ({
      synthesize: async ({ onChunk }) => {
        await onChunk({
          audioChunk: Buffer.from([1, 2, 3, 4]),
          codec: 'pcm_s16le',
          sampleRate: 24000,
        });
      },
    }),
  });

  await ipcMain.invoke('voice:session:start', { sessionId: 'seg-s1', mode: 'vad' });

  const segmentA = {
    sessionId: 'seg-s1',
    turnId: 'turn-1',
    segmentId: 'turn-1:0',
    index: 0,
    text: '第一句。',
    final: true,
  };
  const segmentB = {
    sessionId: 'seg-s1',
    turnId: 'turn-1',
    segmentId: 'turn-1:1',
    index: 1,
    text: '第二句。',
    final: true,
  };

  const enqueueA = voiceControl.enqueueSegmentReady(segmentA);
  const enqueueB = voiceControl.enqueueSegmentReady(segmentB);
  assert.equal(enqueueA.ok, true);
  assert.equal(enqueueB.ok, true);

  const markDone = voiceControl.markTurnDone({
    sessionId: 'seg-s1',
    turnId: 'turn-1',
  });
  assert.equal(markDone.ok, true);

  await waitFor(
    () => emitted.filter((event) => event.type === 'segment-tts-finished').length >= 2,
    { timeoutMs: 1500 },
  );

  const startedSegments = emitted
    .filter((event) => event.type === 'segment-tts-started')
    .map((event) => event.segmentId);
  const finishedSegments = emitted
    .filter((event) => event.type === 'segment-tts-finished')
    .map((event) => event.segmentId);

  assert.deepEqual(startedSegments, ['turn-1:0', 'turn-1:1']);
  assert.deepEqual(finishedSegments, ['turn-1:0', 'turn-1:1']);
  assert.equal(
    emitted.some((event) => event.type === 'tts-chunk' && event.segmentId === 'turn-1:0'),
    true,
  );
});

test('voice:tts:stop aborts current and pending segment playback with failed terminal state', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  const voiceControl = registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => emitted.push(event),
    createTtsServiceImpl: () => ({
      synthesize: async ({ signal, onChunk }) => {
        await onChunk({
          audioChunk: Buffer.from([1, 2, 3, 4]),
          codec: 'pcm_s16le',
          sampleRate: 24000,
        });

        if (signal.aborted) {
          throw createAbortError();
        }

        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 1000);
          const onAbort = () => {
            clearTimeout(timer);
            reject(createAbortError());
          };
          signal.addEventListener(
            'abort',
            onAbort,
            { once: true },
          );
          if (signal.aborted) {
            onAbort();
          }
        });
      },
    }),
  });

  await ipcMain.invoke('voice:session:start', { sessionId: 'seg-stop-s1', mode: 'vad' });

  voiceControl.enqueueSegmentReady({
    sessionId: 'seg-stop-s1',
    turnId: 'turn-stop-1',
    segmentId: 'turn-stop-1:0',
    index: 0,
    text: '第一句。',
    final: true,
  });
  voiceControl.enqueueSegmentReady({
    sessionId: 'seg-stop-s1',
    turnId: 'turn-stop-1',
    segmentId: 'turn-stop-1:1',
    index: 1,
    text: '第二句。',
    final: true,
  });
  voiceControl.markTurnDone({
    sessionId: 'seg-stop-s1',
    turnId: 'turn-stop-1',
  });

  await waitFor(
    () => emitted.some((event) => event.type === 'segment-tts-started' && event.segmentId === 'turn-stop-1:0'),
    { timeoutMs: 1000 },
  );

  const stopResult = await ipcMain.invoke('voice:tts:stop', {
    sessionId: 'seg-stop-s1',
    reason: 'manual',
  });
  assert.equal(stopResult.ok, true);

  await waitFor(
    () => emitted.filter((event) => event.type === 'segment-tts-failed').length >= 2,
    { timeoutMs: 1500 },
  );

  const failedById = emitted
    .filter((event) => event.type === 'segment-tts-failed')
    .reduce((acc, event) => {
      acc.set(event.segmentId, event);
      return acc;
    }, new Map());

  assert.equal(failedById.get('turn-stop-1:0')?.aborted, true);
  assert.equal(failedById.get('turn-stop-1:1')?.aborted, true);
});

test('voice segment trace list returns lifecycle timing for latest segments', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  const voiceControl = registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => emitted.push(event),
    createTtsServiceImpl: () => ({
      synthesize: async ({ onChunk }) => {
        await onChunk({
          audioChunk: Buffer.from([1, 2, 3, 4]),
          codec: 'pcm_s16le',
          sampleRate: 24000,
        });
      },
    }),
  });

  await ipcMain.invoke('voice:session:start', { sessionId: 'trace-s1', mode: 'vad' });
  voiceControl.enqueueSegmentReady({
    sessionId: 'trace-s1',
    turnId: 'trace-turn-1',
    segmentId: 'trace-turn-1:0',
    index: 0,
    text: '第一句。',
    final: true,
  });
  voiceControl.markTurnDone({
    sessionId: 'trace-s1',
    turnId: 'trace-turn-1',
  });

  await waitFor(
    () => emitted.some((event) => event.type === 'segment-tts-finished' && event.segmentId === 'trace-turn-1:0'),
    { timeoutMs: 1500 },
  );

  const tracesResult = await ipcMain.invoke('voice:segment:trace:list', {
    sessionId: 'trace-s1',
    limit: 20,
  });
  assert.equal(tracesResult.ok, true);
  assert.ok(Array.isArray(tracesResult.items));
  assert.equal(tracesResult.items.length >= 1, true);

  const trace = tracesResult.items.find((item) => item.segmentId === 'trace-turn-1:0');
  assert.ok(Boolean(trace));
  assert.equal(trace.status, 'finished');
  assert.equal(typeof trace.readyAt, 'number');
  assert.equal(typeof trace.startedAt, 'number');
  assert.equal(typeof trace.finishedAt, 'number');
  assert.equal(trace.readyAt > 0, true);
  assert.equal(trace.startedAt >= trace.readyAt, true);
  assert.equal(trace.finishedAt >= trace.startedAt, true);
});

test('voice diagnostics asr returns latency and transcript', async () => {
  const ipcMain = createIpcMainMock();
  let receivedAudioBytes = 0;

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: () => {},
    createAsrServiceImpl: () => ({
      transcribe: async ({ audioChunks, onPartial }) => {
        receivedAudioBytes = audioChunks[0]?.pcmChunk?.length || 0;
        onPartial?.('diag-partial');
        return { text: 'diag-final' };
      },
    }),
  });

  const result = await ipcMain.invoke('voice:diagnostics:asr', {
    pcmChunk: Buffer.from([1, 2, 3, 4]),
    sampleRate: 16000,
    channels: 1,
    sampleFormat: 'pcm_s16le',
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, 'diag-final');
  assert.equal(result.partialCount, 1);
  assert.equal(result.sampleRate, 16000);
  assert.equal(result.sampleFormat, 'pcm_s16le');
  assert.equal(result.audioBytes, 4);
  assert.equal(receivedAudioBytes, 4);
  assert.equal(typeof result.latencyMs, 'number');
  assert.equal(result.latencyMs >= 0, true);
});

test('voice diagnostics tts returns first-chunk and total latency', async () => {
  const ipcMain = createIpcMainMock();

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: () => {},
    resolveVoiceEnv: () => ({
      VOICE_TTS_PROVIDER: 'python',
    }),
    createTtsServiceImpl: () => ({
      synthesize: async ({ onChunk }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        await onChunk({
          audioChunk: Buffer.from([1, 2, 3, 4]),
          codec: 'pcm_s16le',
          sampleRate: 24000,
        });
        await onChunk({
          audioChunk: Buffer.from([5, 6, 7, 8, 9, 10]),
          codec: 'pcm_s16le',
          sampleRate: 24000,
        });
        return {
          sampleRate: 24000,
          sampleCount: 480,
        };
      },
    }),
  });

  const result = await ipcMain.invoke('voice:diagnostics:tts', {
    text: 'hello',
    includeAudio: true,
  });

  assert.equal(result.ok, true);
  assert.equal(typeof result.firstChunkLatencyMs, 'number');
  assert.equal(result.firstChunkLatencyMs >= 0, true);
  assert.equal(typeof result.latencyMs, 'number');
  assert.equal(result.latencyMs >= result.firstChunkLatencyMs, true);
  assert.equal(result.chunkCount, 2);
  assert.equal(result.totalBytes, 10);
  assert.equal(result.sampleRate, 24000);
  assert.equal(result.sampleCount, 480);
  assert.equal(result.outputDurationMs > 0, true);
  assert.equal(typeof result.pcmS16LeBase64, 'string');
  assert.equal(result.pcmS16LeBase64.length > 0, true);
  assert.equal(result.codec, 'pcm_s16le');
});

test('voice diagnostics tts rejects missing or mock provider configuration', async () => {
  const ipcMain = createIpcMainMock();
  let synthesizeCalled = false;

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: () => {},
    resolveVoiceEnv: () => ({
      VOICE_TTS_PROVIDER: 'mock',
    }),
    createTtsServiceImpl: () => ({
      synthesize: async () => {
        synthesizeCalled = true;
        return {};
      },
    }),
  });

  const result = await ipcMain.invoke('voice:diagnostics:tts', {
    text: 'hello',
    includeAudio: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'voice_tts_provider_not_configured');
  assert.equal(synthesizeCalled, false);
});

test('voice diagnostics tts does not expose non-pcm_s16le preview audio', async () => {
  const ipcMain = createIpcMainMock();

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: () => {},
    resolveVoiceEnv: () => ({
      VOICE_TTS_PROVIDER: 'sherpa-onnx',
    }),
    createTtsServiceImpl: () => ({
      synthesize: async ({ onChunk }) => {
        await onChunk({
          audioChunk: Buffer.from([1, 2, 3, 4]),
          codec: 'pcm_f32le',
          sampleRate: 24000,
        });
        return {
          sampleRate: 24000,
          sampleCount: 1,
        };
      },
    }),
  });

  const result = await ipcMain.invoke('voice:diagnostics:tts', {
    text: 'hello',
    includeAudio: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.codec, 'pcm_f32le');
  assert.equal(result.pcmS16LeBase64, undefined);
});
