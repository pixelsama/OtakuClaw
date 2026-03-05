const assert = require('node:assert/strict');
const test = require('node:test');

const { createChatSegmentEmitter } = require('../services/chat/segmenter');

test('chat segment emitter splits by sentence punctuation', () => {
  const segments = [];
  const emitter = createChatSegmentEmitter({
    streamId: 'stream-1',
    sessionId: 'session-1',
    emitReady: (segment) => {
      segments.push(segment);
    },
  });

  emitter.ingestDelta('你好。世界');
  emitter.ingestDelta('！');
  emitter.flushRemaining();

  assert.deepEqual(
    segments.map((item) => item.text),
    ['你好。', '世界！'],
  );
  assert.deepEqual(
    segments.map((item) => item.segmentId),
    ['stream-1:0', 'stream-1:1'],
  );
});

test('chat segment emitter flushes long content by max chars', () => {
  const segments = [];
  const emitter = createChatSegmentEmitter({
    streamId: 'stream-2',
    sessionId: 'session-2',
    maxChars: 4,
    emitReady: (segment) => {
      segments.push(segment);
    },
  });

  emitter.ingestDelta('abcdefg');
  emitter.flushRemaining();

  assert.deepEqual(
    segments.map((item) => item.text),
    ['abcd', 'efg'],
  );
});
