const assert = require('node:assert/strict');
const test = require('node:test');

const { createConversationRuntime } = require('../services/chat/conversationRuntime');

test('conversation runtime latest-wins aborts previous active stream in same session', async () => {
  const startedRequests = [];
  const aborted = [];
  let streamSeq = 0;
  const runtime = createConversationRuntime({
    startChatStream: async (request = {}) => {
      streamSeq += 1;
      startedRequests.push(request);
      return {
        ok: true,
        streamId: `stream-${streamSeq}`,
      };
    },
    abortChatStream: async ({ streamId }) => {
      aborted.push(streamId);
      return { ok: true };
    },
    emitConversationEvent: () => {},
  });

  const first = await runtime.submitUserText({
    sessionId: 's1',
    content: 'hello',
  });
  assert.equal(first.ok, true);
  assert.equal(first.streamId, 'stream-1');

  const second = await runtime.submitUserText({
    sessionId: 's1',
    content: 'world',
  });
  assert.equal(second.ok, true);
  assert.equal(second.streamId, 'stream-2');

  assert.deepEqual(aborted, ['stream-1']);
  assert.equal(startedRequests.length, 2);
});

test('conversation runtime latest-wins aborts previous active stream across backend switches', async () => {
  const startedRequests = [];
  const aborted = [];
  let streamSeq = 0;
  const runtime = createConversationRuntime({
    startChatStream: async (request = {}) => {
      streamSeq += 1;
      startedRequests.push(request);
      return {
        ok: true,
        streamId: `stream-${streamSeq}`,
        backend: request.backend,
      };
    },
    abortChatStream: async ({ streamId }) => {
      aborted.push(streamId);
      return { ok: true };
    },
    emitConversationEvent: () => {},
  });

  const first = await runtime.submitUserText({
    sessionId: 's-cross',
    agentId: 'main',
    backend: 'nanobot',
    content: 'long request',
    policy: 'latest-wins',
  });
  assert.equal(first.ok, true);
  assert.equal(first.streamId, 'stream-1');

  const second = await runtime.submitUserText({
    sessionId: 's-cross',
    agentId: 'main',
    backend: 'codex',
    content: 'short request',
    policy: 'latest-wins',
  });
  assert.equal(second.ok, true);
  assert.equal(second.streamId, 'stream-2');

  assert.equal(startedRequests.length, 2);
  assert.notEqual(startedRequests[0].routeKey, startedRequests[1].routeKey);
  assert.deepEqual(aborted, ['stream-1']);
});

test('conversation runtime queue policy starts next request after terminal event', async () => {
  const started = [];
  let streamSeq = 0;
  const runtime = createConversationRuntime({
    startChatStream: async (request = {}) => {
      streamSeq += 1;
      started.push({
        ...request,
        streamId: `stream-${streamSeq}`,
      });
      return {
        ok: true,
        streamId: `stream-${streamSeq}`,
      };
    },
    abortChatStream: async () => ({ ok: true }),
    emitConversationEvent: () => {},
  });

  const first = await runtime.submitUserText({
    sessionId: 'queue-session',
    content: 'first',
    policy: 'queue',
  });
  assert.equal(first.ok, true);
  assert.equal(first.streamId, 'stream-1');

  const queuedPromise = runtime.submitUserText({
    sessionId: 'queue-session',
    content: 'second',
    policy: 'queue',
  });

  let queuedResolved = false;
  queuedPromise.then(() => {
    queuedResolved = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(queuedResolved, false);

  runtime.onChatStreamEvent({
    streamId: 'stream-1',
    type: 'done',
    payload: {
      sessionId: 'queue-session',
      turnId: 'stream-1',
    },
  });

  const second = await queuedPromise;
  assert.equal(second.ok, true);
  assert.equal(second.streamId, 'stream-2');
  assert.equal(started.length, 2);
  assert.equal(started[1].content, 'second');
});

test('conversation runtime mirrors chat and voice events to conversation:event envelope', async () => {
  const emitted = [];
  const runtime = createConversationRuntime({
    startChatStream: async () => ({ ok: true, streamId: 'stream-1' }),
    abortChatStream: async () => ({ ok: true }),
    emitConversationEvent: (payload) => emitted.push(payload),
  });

  runtime.onChatStreamEvent({
    streamId: 'stream-c1',
    type: 'text-delta',
    payload: {
      content: 'hello',
    },
  });
  runtime.onVoiceEvent({
    type: 'segment-tts-started',
    sessionId: 'v1',
    segmentId: 'turn-1:0',
  });

  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].channel, 'chat');
  assert.equal(emitted[0].streamId, 'stream-c1');
  assert.equal(emitted[0].type, 'text-delta');
  assert.equal(emitted[0].payload.content, 'hello');
  assert.equal(emitted[0].schemaVersion, '2026-03-27.v1');
  assert.ok(typeof emitted[0].timestamp === 'string' && emitted[0].timestamp);

  assert.equal(emitted[1].channel, 'voice');
  assert.equal(emitted[1].type, 'segment-tts-started');
  assert.equal(emitted[1].segmentId, 'turn-1:0');
  assert.ok(typeof emitted[1].timestamp === 'string' && emitted[1].timestamp);
});

test('conversation runtime isolates streams by routeKey and enriches chat envelopes', async () => {
  const emitted = [];
  const aborted = [];
  const startedRequests = [];
  let streamSeq = 0;
  const runtime = createConversationRuntime({
    startChatStream: async (request = {}) => {
      streamSeq += 1;
      startedRequests.push(request);
      return {
        ok: true,
        streamId: `stream-${streamSeq}`,
        backend: request.backend,
      };
    },
    abortChatStream: async ({ streamId }) => {
      aborted.push(streamId);
      return { ok: true };
    },
    emitConversationEvent: (payload) => emitted.push(payload),
  });

  const first = await runtime.submitUserText({
    sessionId: 'shared-session',
    agentId: 'agent-a',
    backend: 'nanobot',
    content: 'hello',
  });
  const second = await runtime.submitUserText({
    sessionId: 'shared-session',
    agentId: 'agent-b',
    backend: 'nanobot',
    content: 'world',
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(aborted.length, 0);
  assert.equal(startedRequests.length, 2);
  assert.notEqual(startedRequests[0].routeKey, startedRequests[1].routeKey);

  runtime.onChatStreamEvent({
    streamId: first.streamId,
    type: 'text-delta',
    payload: {
      content: 'hello',
    },
  });

  const textDeltaEvent = emitted.find((event) => event.type === 'text-delta');
  assert.equal(textDeltaEvent.channel, 'chat');
  assert.equal(textDeltaEvent.agentId, 'agent-a');
  assert.equal(textDeltaEvent.backend, 'nanobot');
  assert.equal(textDeltaEvent.routeKey, startedRequests[0].routeKey);
  assert.equal(textDeltaEvent.payload.routeKey, startedRequests[0].routeKey);
  assert.equal(textDeltaEvent.payload.turnId, first.streamId);

  await runtime.dispose();
});

test('conversation runtime supports synthetic fast-path turns without backend stream', async () => {
  const emitted = [];
  const started = [];
  const settled = [];
  const runtime = createConversationRuntime({
    startChatStream: async () => {
      throw new Error('backend should not start for synthetic turn');
    },
    abortChatStream: async () => ({ ok: true }),
    emitConversationEvent: (payload) => emitted.push(payload),
    prepareTurn: async ({ request }) => ({
      request,
      needsBackend: false,
      reply: '你好呀，我在这儿。',
      turnId: 'fast-turn-1',
    }),
    onTurnStarted: async (payload) => {
      started.push(payload);
    },
    onTurnSettled: async (payload) => {
      settled.push(payload);
    },
  });

  const result = await runtime.submitUserText({
    sessionId: 'fast-session',
    agentId: 'agent-fast',
    backend: 'nanobot',
    content: 'hi',
  });

  assert.equal(result.ok, true);
  assert.equal(result.synthetic, true);
  assert.equal(result.streamId, 'fast-turn-1');
  assert.equal(emitted.map((event) => event.type).join(','), 'stream-start,text-delta,done');
  assert.equal(emitted[1].payload.content, '你好呀，我在这儿。');
  assert.equal(started.length, 1);
  assert.equal(started[0].synthetic, true);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].text, '你好呀，我在这儿。');
});

test('conversation runtime latest-wins suppresses stale synthetic turn after async prepare', async () => {
  const emitted = [];
  const runtime = createConversationRuntime({
    startChatStream: async () => {
      throw new Error('backend should not start for synthetic turn');
    },
    abortChatStream: async () => ({ ok: true }),
    emitConversationEvent: (payload) => emitted.push(payload),
    prepareTurn: async ({ request }) => {
      await new Promise((resolve) => setTimeout(resolve, request.content === 'first' ? 40 : 5));
      return {
        needsBackend: false,
        reply: `reply:${request.content}`,
        turnId: `fast-${request.content}`,
      };
    },
  });

  const firstPromise = runtime.submitUserText({
    sessionId: 'race-session',
    content: 'first',
    policy: 'latest-wins',
  });
  const secondPromise = runtime.submitUserText({
    sessionId: 'race-session',
    content: 'second',
    policy: 'latest-wins',
  });

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(first.ok, false);
  assert.equal(first.reason, 'superseded_by_latest');
  assert.equal(second.ok, true);
  assert.deepEqual(
    emitted.filter((event) => event.type === 'text-delta').map((event) => event.payload.content),
    ['reply:second'],
  );
});
