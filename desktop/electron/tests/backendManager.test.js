const assert = require('node:assert/strict');
const test = require('node:test');

const { ChatBackendManager } = require('../services/chat/backendManager');

function createBackend(name, overrides = {}) {
  return {
    name,
    validateSettings: overrides.validateSettings || (() => {}),
    testConnection: overrides.testConnection || (async () => ({ ok: true })),
    startStream: overrides.startStream || (async () => {}),
    mapError:
      overrides.mapError ||
      ((error) => ({
        code: `${name}_error`,
        message: error?.message || 'backend error',
      })),
    dispose: overrides.dispose || (async () => {}),
  };
}

test('backend manager resolves backend with request precedence', () => {
  const manager = new ChatBackendManager({
    backends: [createBackend('openclaw'), createBackend('nanobot')],
  });

  assert.equal(manager.resolveBackendName({ settings: {} }), 'nanobot');
  assert.equal(manager.resolveBackendName({ settings: { chatBackend: 'nanobot' } }), 'nanobot');
  assert.equal(
    manager.resolveBackendName({
      settings: { chatBackend: 'openclaw' },
      requestBackend: 'nanobot',
    }),
    'nanobot',
  );
});

test('backend manager delegates startStream and testConnection to selected backend', async () => {
  let streamPayload = null;
  let tested = false;

  const manager = new ChatBackendManager({
    backends: [
      createBackend('nanobot', {
        startStream: async (payload) => {
          streamPayload = payload;
          payload.onEvent({ type: 'done', payload: { source: 'nanobot' } });
        },
        testConnection: async () => {
          tested = true;
          return { ok: true, latencyMs: 5 };
        },
      }),
    ],
  });

  const events = [];
  const connection = await manager.testConnection({
    backend: 'nanobot',
    settings: { baseUrl: 'http://127.0.0.1:18789' },
  });

  await manager.startStream({
    backend: 'nanobot',
    settings: { baseUrl: 'http://127.0.0.1:18789' },
    sessionId: 's1',
    content: 'hello',
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });

  assert.equal(tested, true);
  assert.equal(connection.ok, true);
  assert.equal(streamPayload.sessionId, 's1');
  assert.equal(streamPayload.content, 'hello');
  assert.equal(events[0].type, 'done');
});

test('backend manager reports unsupported backend with stable error code', () => {
  const manager = new ChatBackendManager({
    backends: [createBackend('openclaw')],
  });

  assert.throws(
    () => manager.resolveBackendName({ requestBackend: 'nanobot' }),
    (error) => error && error.code === 'chat_backend_unsupported',
  );
});

test('backend manager includes nanobot backend by default', () => {
  const manager = new ChatBackendManager();
  assert.equal(manager.resolveBackendName({ settings: { chatBackend: 'nanobot' } }), 'nanobot');
});
