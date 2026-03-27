const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONVERSATION_ENVELOPE_SCHEMA_VERSION,
  createConversationEnvelopeEvent,
  validateConversationEnvelopeEvent,
} = require('../contracts/conversationEnvelopeContract');

test('conversation envelope contract injects schema version and defaults', () => {
  const event = createConversationEnvelopeEvent({
    channel: 'chat',
    type: 'text-delta',
    payload: {
      content: 'hello',
    },
  });

  assert.equal(event.schemaVersion, CONVERSATION_ENVELOPE_SCHEMA_VERSION);
  assert.equal(event.channel, 'chat');
  assert.equal(event.type, 'text-delta');
  assert.equal(event.sessionId, 'default');
  assert.ok(typeof event.timestamp === 'string' && event.timestamp.length > 0);

  const validation = validateConversationEnvelopeEvent(event);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);
});

test('conversation envelope contract rejects unsupported channels', () => {
  const event = createConversationEnvelopeEvent({
    schemaVersion: CONVERSATION_ENVELOPE_SCHEMA_VERSION,
    channel: 'legacy-chat-stream',
    type: 'text-delta',
    payload: {},
  });

  const validation = validateConversationEnvelopeEvent(event);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((item) => item.includes('unsupported channel')));
});
