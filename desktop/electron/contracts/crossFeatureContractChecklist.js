const { CONVERSATION_ENVELOPE_SCHEMA_VERSION, LEGACY_MIRROR_DEPRECATIONS } = require('./conversationEnvelopeContract');

const CROSS_FEATURE_CONTRACT_CHECKLIST = Object.freeze({
  version: '2026-03-27.v1',
  chatBackends: ['nanobot', 'claude-code', 'codex'],
  ipcInvokeChannels: [
    'conversation:submit-user-text',
    'conversation:abort-active',
    'conversation:permission:resolve',
    'voice:session:start',
    'voice:audio:chunk',
    'voice:input:commit',
    'voice:session:stop',
    'voice:playback:ack',
    'voice-models:catalog',
    'nanobot-runtime:status',
    'acp-runner:status',
    'settings:get',
    'settings:save',
    'capture:select-region',
    'office-state:get',
    'value-state:get',
  ],
  ipcEventChannels: [
    'conversation:event',
    'voice:flow-control',
    'office-state:changed',
    'value-state:changed',
    'app-updater:state',
  ],
  conversationEnvelope: {
    schemaVersion: CONVERSATION_ENVELOPE_SCHEMA_VERSION,
    channels: ['chat', 'voice', 'system', 'office', 'value'],
    legacyMirrorDeprecations: LEGACY_MIRROR_DEPRECATIONS,
  },
  featureSets: [
    'chat-conversation',
    'voice-runtime',
    'python-runtime-env',
    'nanobot-runtime-skills',
    'acp-runners',
    'live2d-static-avatar-pixelpack',
    'office-value-state',
    'screenshot-capture',
    'window-pet-mode',
    'settings-download-updater',
  ],
});

module.exports = {
  CROSS_FEATURE_CONTRACT_CHECKLIST,
};
