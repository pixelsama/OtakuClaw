const CONVERSATION_ENVELOPE_SCHEMA_VERSION = '2026-03-27.v1';

const LEGACY_MIRROR_DEPRECATIONS = Object.freeze([
  {
    channel: 'chat:stream:event',
    replacement: 'conversation:event (channel=chat)',
    sunsetDate: '2026-06-30',
  },
  {
    channel: 'voice:event',
    replacement: 'conversation:event (channel=voice)',
    sunsetDate: '2026-06-30',
  },
]);

const ALLOWED_ENVELOPE_CHANNELS = new Set(['chat', 'voice', 'system', 'office', 'value']);

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || fallback;
}

function normalizePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function createConversationEnvelopeEvent(source = {}) {
  const raw = source && typeof source === 'object' ? source : {};
  const knownKeys = new Set([
    'schemaVersion',
    'timestamp',
    'channel',
    'agentId',
    'backend',
    'routeKey',
    'sessionId',
    'sessionNamespace',
    'profileId',
    'turnId',
    'streamId',
    'type',
    'payload',
  ]);

  const extras = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !knownKeys.has(key)),
  );

  return {
    ...extras,
    schemaVersion: normalizeText(raw.schemaVersion, CONVERSATION_ENVELOPE_SCHEMA_VERSION),
    timestamp: normalizeText(raw.timestamp, new Date().toISOString()),
    channel: normalizeText(raw.channel, 'chat'),
    agentId: normalizeText(raw.agentId, ''),
    backend: normalizeText(raw.backend, ''),
    routeKey: normalizeText(raw.routeKey, ''),
    sessionId: normalizeText(raw.sessionId, 'default'),
    sessionNamespace: normalizeText(raw.sessionNamespace, ''),
    profileId: normalizeText(raw.profileId, ''),
    turnId: normalizeText(raw.turnId, ''),
    streamId: normalizeText(raw.streamId, ''),
    type: normalizeText(raw.type, ''),
    payload: normalizePayload(raw.payload),
  };
}

function validateConversationEnvelopeEvent(event = {}) {
  const safeEvent = event && typeof event === 'object' ? event : {};
  const errors = [];

  if (!normalizeText(safeEvent.schemaVersion, '')) {
    errors.push('schemaVersion is required');
  }

  if (!normalizeText(safeEvent.type, '')) {
    errors.push('type is required');
  }

  const channel = normalizeText(safeEvent.channel, '');
  if (!channel) {
    errors.push('channel is required');
  } else if (!ALLOWED_ENVELOPE_CHANNELS.has(channel)) {
    errors.push(`unsupported channel: ${channel}`);
  }

  if (
    safeEvent.payload != null
    && (typeof safeEvent.payload !== 'object' || Array.isArray(safeEvent.payload))
  ) {
    errors.push('payload must be a plain object');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

module.exports = {
  CONVERSATION_ENVELOPE_SCHEMA_VERSION,
  LEGACY_MIRROR_DEPRECATIONS,
  ALLOWED_ENVELOPE_CHANNELS,
  createConversationEnvelopeEvent,
  validateConversationEnvelopeEvent,
};
