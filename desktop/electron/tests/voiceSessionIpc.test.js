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

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => emitted.push(event),
    emitFlowControl: (event) => flowEvents.push(event),
    autoTtsOnAsrFinal: true,
    createAsrServiceImpl: () => ({
      transcribe: async () => ({ text: 'hello world' }),
    }),
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
  await ipcMain.invoke('voice:audio:chunk', {
    sessionId: 's4',
    seq: 1,
    chunkId: 1,
    pcmChunk: Buffer.from([1, 2, 3, 4]),
    sampleRate: 16000,
    channels: 1,
    sampleFormat: 'pcm_s16le',
    isSpeech: true,
  });

  const commitPromise = ipcMain.invoke('voice:input:commit', {
    sessionId: 's4',
    finalSeq: 1,
  });

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

  const committed = await commitPromise;
  assert.equal(committed.ok, true);
  const ttsChunkEvents = emitted.filter((event) => event.type === 'tts-chunk');
  assert.equal(ttsChunkEvents.length, 3);
  assert.equal(Buffer.isBuffer(ttsChunkEvents[0].audioChunk), false);
  assert.ok(ttsChunkEvents[0].audioChunk instanceof Uint8Array);
  assert.equal(flowEvents[0]?.action, 'pause');
  assert.equal(flowEvents[1]?.action, 'resume');
});

test('voice session survives event emitter exception during tts chunk delivery', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];
  let throwOnFirstTtsChunk = true;

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => {
      emitted.push(event);
      if (event.type === 'tts-chunk' && throwOnFirstTtsChunk) {
        throwOnFirstTtsChunk = false;
        throw new Error('renderer_send_failed');
      }
    },
    autoTtsOnAsrFinal: true,
    createAsrServiceImpl: () => ({
      transcribe: async () => ({ text: 'hello' }),
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
  });

  await ipcMain.invoke('voice:session:start', { sessionId: 's-emit-err', mode: 'vad' });
  await ipcMain.invoke('voice:audio:chunk', {
    sessionId: 's-emit-err',
    seq: 1,
    chunkId: 1,
    pcmChunk: Buffer.from([1, 2]),
    sampleRate: 16000,
    channels: 1,
    sampleFormat: 'pcm_s16le',
    isSpeech: true,
  });

  const committed = await ipcMain.invoke('voice:input:commit', {
    sessionId: 's-emit-err',
    finalSeq: 1,
  });
  assert.equal(committed.ok, true);
  assert.equal(emitted.some((event) => event.type === 'done' && event.stage === 'transcribing'), true);
});

test('voice tts emits timeout error when playback ack is missing', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => emitted.push(event),
    autoTtsOnAsrFinal: true,
    ttsBackpressureTimeoutMs: 50,
    createAsrServiceImpl: () => ({
      transcribe: async () => ({ text: 'timeout check' }),
    }),
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
  await ipcMain.invoke('voice:audio:chunk', {
    sessionId: 's5',
    seq: 1,
    chunkId: 1,
    pcmChunk: Buffer.from([1, 2]),
    sampleRate: 16000,
    channels: 1,
    sampleFormat: 'pcm_s16le',
    isSpeech: true,
  });

  const committed = await ipcMain.invoke('voice:input:commit', {
    sessionId: 's5',
    finalSeq: 1,
  });
  assert.equal(committed.ok, true);

  await waitFor(
    () => emitted.some((event) => event.type === 'error' && event.code === 'voice_tts_backpressure_timeout'),
    { timeoutMs: 1200 },
  );

  const timeoutError = emitted.find((event) => event.type === 'error' && event.code === 'voice_tts_backpressure_timeout');
  assert.equal(timeoutError?.stage, 'speaking');
});

test('voice tts stop aborts speaking without emitting error', async () => {
  const ipcMain = createIpcMainMock();
  const emitted = [];

  registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (event) => emitted.push(event),
    autoTtsOnAsrFinal: true,
    createAsrServiceImpl: () => ({
      transcribe: async () => ({ text: 'manual stop' }),
    }),
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
  await ipcMain.invoke('voice:audio:chunk', {
    sessionId: 's6',
    seq: 1,
    chunkId: 1,
    pcmChunk: Buffer.from([1, 2]),
    sampleRate: 16000,
    channels: 1,
    sampleFormat: 'pcm_s16le',
    isSpeech: true,
  });

  const commitPromise = ipcMain.invoke('voice:input:commit', {
    sessionId: 's6',
    finalSeq: 1,
  });

  await waitFor(() => emitted.some((event) => event.type === 'tts-chunk'));
  const stopResult = await ipcMain.invoke('voice:tts:stop', {
    sessionId: 's6',
    reason: 'manual',
  });
  assert.equal(stopResult.ok, true);

  const committed = await commitPromise;
  assert.equal(committed.ok, true);

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
