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
