const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CROSS_FEATURE_CONTRACT_CHECKLIST,
} = require('../contracts/crossFeatureContractChecklist');
const { createChatBackendManager } = require('../services/chat/backendManager');

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('cross-feature checklist invoke/event channels stay wired in preload bridge', () => {
  const preloadPath = path.resolve(__dirname, '../preload.js');
  const preloadSource = fs.readFileSync(preloadPath, 'utf8');

  for (const channel of CROSS_FEATURE_CONTRACT_CHECKLIST.ipcInvokeChannels) {
    const invokePattern = new RegExp(`invoke\\('${escapeRegExp(channel)}'`);
    assert.match(preloadSource, invokePattern, `Missing invoke channel in preload: ${channel}`);
  }

  for (const channel of CROSS_FEATURE_CONTRACT_CHECKLIST.ipcEventChannels) {
    const eventPattern = new RegExp(`onChannel\\('${escapeRegExp(channel)}'`);
    assert.match(preloadSource, eventPattern, `Missing event channel in preload: ${channel}`);
  }
});

test('cross-feature checklist chat backends remain registered', async () => {
  const manager = createChatBackendManager();
  for (const backend of CROSS_FEATURE_CONTRACT_CHECKLIST.chatBackends) {
    assert.doesNotThrow(() => manager.requireBackend(backend));
  }
  await manager.dispose();
});

test('cross-feature checklist deprecations include parseable sunset date', () => {
  for (const entry of CROSS_FEATURE_CONTRACT_CHECKLIST.conversationEnvelope.legacyMirrorDeprecations) {
    assert.ok(typeof entry.channel === 'string' && entry.channel);
    assert.ok(typeof entry.replacement === 'string' && entry.replacement);
    assert.ok(typeof entry.sunsetDate === 'string' && entry.sunsetDate);
    assert.ok(Number.isFinite(Date.parse(`${entry.sunsetDate}T00:00:00Z`)));
  }
});
