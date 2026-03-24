#!/usr/bin/env node
/**
 * Phase 3 regression script: backend switch and interrupt recovery.
 *
 * Usage:
 *   node docs/scripts/regression_backend_switch_and_abort.js
 */

const assert = require('node:assert/strict');

const { registerChatStreamIpc } = require('../../desktop/electron/ipc/chatStream');
const { createConversationRuntime } = require('../../desktop/electron/services/chat/conversationRuntime');
const { ChatBackendManager } = require('../../desktop/electron/services/chat/backendManager');

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

function createFakeBackend(name, metrics) {
  return {
    name,
    validateSettings() {},
    async testConnection() {
      return { ok: true };
    },
    async startStream({ sessionId, content, signal, onEvent }) {
      const normalizedContent = typeof content === 'string' ? content.trim() : '';
      metrics.started.push({
        backend: name,
        sessionId,
        content: normalizedContent,
      });

      if (normalizedContent.startsWith('long')) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            onEvent({
              type: 'text-delta',
              payload: {
                source: name,
                content: `${name}:${normalizedContent}:completed`,
              },
            });
            onEvent({
              type: 'done',
              payload: {
                source: name,
                finishReason: 'completed',
              },
            });
            resolve();
          }, 5_000);

          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            metrics.aborted.push({
              backend: name,
              sessionId,
              content: normalizedContent,
            });
            const error = new Error('stream aborted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
        return;
      }

      onEvent({
        type: 'text-delta',
        payload: {
          source: name,
          content: `${name}:${normalizedContent}`,
        },
      });
      onEvent({
        type: 'done',
        payload: {
          source: name,
          finishReason: 'completed',
        },
      });
    },
    mapError(error) {
      if (error?.name === 'AbortError') {
        return {
          code: 'aborted',
          message: 'stream aborted',
        };
      }
      return {
        code: `${name}_error`,
        message: error?.message || `${name} error`,
      };
    },
  };
}

async function waitFor(check, timeoutMs = 3000, intervalMs = 10) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms while waiting for condition.`);
}

async function run() {
  const sessionId = 'phase3-regression';
  const emittedConversationEvents = [];
  const backendMetrics = {
    started: [],
    aborted: [],
  };

  const backendManager = new ChatBackendManager({
    backends: [
      createFakeBackend('nanobot', backendMetrics),
      createFakeBackend('codex', backendMetrics),
      createFakeBackend('claude-code', backendMetrics),
    ],
  });
  const ipcMain = createIpcMainMock();

  let conversationRuntime = null;
  const chatControl = registerChatStreamIpc({
    ipcMain,
    getSettings: () => ({
      chatBackend: 'nanobot',
      nanobot: { enabled: true },
      codex: { enabled: true },
      claudeCode: { enabled: true },
    }),
    backendManager,
    emitEvent: (payload) => {
      conversationRuntime?.onChatStreamEvent?.(payload);
    },
  });

  conversationRuntime = createConversationRuntime({
    startChatStream: async (request = {}) => chatControl.start(request),
    abortChatStream: async ({ streamId } = {}) => chatControl.abort({ streamId }),
    emitConversationEvent: (event) => {
      emittedConversationEvents.push(event);
    },
  });

  console.log('[phase3] Step 1/4: start long nanobot stream');
  const first = await conversationRuntime.submitUserText({
    sessionId,
    content: 'long-nanobot',
    backend: 'nanobot',
    policy: 'latest-wins',
  });
  assert.equal(first.ok, true);
  assert.ok(first.streamId);

  console.log('[phase3] Step 2/4: switch to codex and verify mixed-backend turn completes');
  const second = await conversationRuntime.submitUserText({
    sessionId,
    content: 'codex-fast',
    backend: 'codex',
    policy: 'latest-wins',
  });
  assert.equal(second.ok, true);
  assert.ok(second.streamId);
  assert.notEqual(second.streamId, first.streamId);

  await waitFor(() => {
    const secondDone = emittedConversationEvents.find((event) =>
      event.channel === 'chat'
      && event.streamId === second.streamId
      && event.type === 'done'
      && !event.payload?.aborted);
    return Boolean(secondDone);
  });

  console.log('[phase3] Step 3/4: abort active session and verify interrupt recovery prerequisites');
  const aborted = await conversationRuntime.abortActive({
    sessionId,
    reason: 'phase3-regression',
  });
  assert.equal(aborted.ok, true);
  assert.ok(Array.isArray(aborted.aborted));

  await waitFor(() => {
    const firstAbortedByBackend = backendMetrics.aborted.some((item) =>
      item.backend === 'nanobot' && item.content === 'long-nanobot');
    return Boolean(firstAbortedByBackend);
  });

  console.log('[phase3] Step 4/4: verify recovery by starting a new claude-code stream');
  const fourth = await conversationRuntime.submitUserText({
    sessionId,
    content: 'claude-recovered',
    backend: 'claude-code',
    policy: 'latest-wins',
  });
  assert.equal(fourth.ok, true);
  assert.ok(fourth.streamId);

  await waitFor(() =>
    emittedConversationEvents.some((event) =>
      event.channel === 'chat'
      && event.streamId === fourth.streamId
      && event.type === 'done'
      && !event.payload?.aborted));

  const streamStartEvents = emittedConversationEvents.filter(
    (event) => event.channel === 'chat' && event.type === 'stream-start',
  );
  assert.ok(streamStartEvents.some((event) => event.streamId === first.streamId && event.backend === 'nanobot'));
  assert.ok(streamStartEvents.some((event) => event.streamId === second.streamId && event.backend === 'codex'));
  assert.ok(streamStartEvents.some((event) => event.streamId === fourth.streamId && event.backend === 'claude-code'));

  assert.ok(
    backendMetrics.aborted.some((item) => item.backend === 'nanobot' && item.content === 'long-nanobot'),
    'expected nanobot long stream to be aborted by abortActive',
  );

  await conversationRuntime.dispose();
  chatControl();

  console.log('[phase3] PASS: backend switch + interrupt recovery regression checks passed.');
}

run().catch((error) => {
  console.error('[phase3] FAIL:', error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
