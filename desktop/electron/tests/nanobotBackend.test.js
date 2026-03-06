const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NanobotBackendAdapter,
  sanitizeNanobotDisplayText,
  sliceIncrementalNanobotText,
  shouldForwardNanobotProgress,
} = require('../services/chat/backends/nanobotBackend');

test('nanobot backend validates required settings', () => {
  const backend = new NanobotBackendAdapter({
    bridgeClient: {
      start: async () => {},
      testConnection: async () => ({ ok: true }),
      dispose: async () => {},
    },
  });

  assert.throws(
    () => backend.validateSettings({ nanobot: { enabled: false } }),
    (error) => error && error.code === 'nanobot_not_enabled',
  );

  assert.throws(
    () =>
      backend.validateSettings({
        nanobot: {
          enabled: true,
          provider: 'openrouter',
          model: 'anthropic/claude-opus-4-5',
          apiKey: '',
        },
      }),
    (error) => error && error.code === 'nanobot_missing_config',
  );
});

test('nanobot backend starts stream through bridge and injects source', async () => {
  const calls = [];
  const backend = new NanobotBackendAdapter({
    bridgeClient: {
      start: async (payload) => {
        calls.push(payload);
        payload.onEvent({
          type: 'text-delta',
          payload: { content: 'hello' },
        });
        payload.onEvent({
          type: 'done',
          payload: {},
        });
      },
      testConnection: async () => ({ ok: true }),
      dispose: async () => {},
    },
  });

  const events = [];
  await backend.startStream({
    settings: {
      nanobot: {
        enabled: true,
        workspace: '/tmp/nanobot-workspace',
        provider: 'openrouter',
        model: 'anthropic/claude-opus-4-5',
        apiKey: 'sk-or-test',
      },
    },
    sessionId: 's1',
    content: 'hello',
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.provider, 'openrouter');
  assert.equal(calls[0].config.apiKey, 'sk-or-test');
  assert.equal(events[0].payload.source, 'nanobot');
  assert.equal(events[1].payload.source, 'nanobot');
});

test('nanobot backend maps generic errors to nanobot_unreachable', () => {
  const backend = new NanobotBackendAdapter({
    bridgeClient: {
      start: async () => {},
      testConnection: async () => ({ ok: true }),
      dispose: async () => {},
    },
  });

  const mapped = backend.mapError(new Error('bridge down'));
  assert.equal(mapped.code, 'nanobot_unreachable');
  assert.equal(mapped.message, 'bridge down');
});

test('nanobot backend strips tool-call traces from text delta payload', async () => {
  const backend = new NanobotBackendAdapter({
    bridgeClient: {
      start: async (payload) => {
        payload.onEvent({
          type: 'text-delta',
          payload: {
            content: 'Tool call: read_file({"path":"x"})\n这是回复正文。',
          },
        });
        payload.onEvent({
          type: 'done',
          payload: {},
        });
      },
      testConnection: async () => ({ ok: true }),
      dispose: async () => {},
    },
  });

  const events = [];
  await backend.startStream({
    settings: {
      nanobot: {
        enabled: true,
        provider: 'openrouter',
        model: 'anthropic/claude-opus-4-5',
        apiKey: 'sk-or-test',
      },
    },
    sessionId: 's2',
    content: 'hello',
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'text-delta');
  assert.equal(events[0].payload.content, '这是回复正文。');
  assert.equal(events[1].type, 'done');
});

test('nanobot backend drops text delta when payload only contains tool-call traces', async () => {
  const backend = new NanobotBackendAdapter({
    bridgeClient: {
      start: async (payload) => {
        payload.onEvent({
          type: 'text-delta',
          payload: {
            content: 'write_file({"path":"x","content":"y"})',
          },
        });
        payload.onEvent({
          type: 'done',
          payload: {},
        });
      },
      testConnection: async () => ({ ok: true }),
      dispose: async () => {},
    },
  });

  const events = [];
  await backend.startStream({
    settings: {
      nanobot: {
        enabled: true,
        provider: 'openrouter',
        model: 'anthropic/claude-opus-4-5',
        apiKey: 'sk-or-test',
      },
    },
    sessionId: 's3',
    content: 'hello',
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'done');
});

test('nanobot backend emits debug logs for request, sanitize and forward stages', async () => {
  const debugLogs = [];
  const backend = new NanobotBackendAdapter({
    emitDebugLog: (payload) => debugLogs.push(payload),
    bridgeClient: {
      start: async (payload) => {
        payload.onEvent({
          type: 'text-delta',
          payload: {
            content: 'Tool call: read_file({"path":"x"})\n这是回复正文。',
          },
        });
        payload.onEvent({
          type: 'done',
          payload: {},
        });
      },
      testConnection: async () => ({ ok: true }),
      dispose: async () => {},
    },
  });

  await backend.startStream({
    settings: {
      nanobot: {
        enabled: true,
        provider: 'openrouter',
        model: 'anthropic/claude-opus-4-5',
        apiKey: 'sk-or-test',
      },
    },
    sessionId: 's4',
    content: 'hello nanobot',
    signal: new AbortController().signal,
    onEvent: () => {},
  });

  assert.ok(debugLogs.some((entry) => entry.stage === 'start-request'));
  assert.ok(debugLogs.some((entry) => entry.stage === 'text-delta-sanitized'));
  assert.ok(debugLogs.some((entry) => entry.stage === 'event-forwarded'));
  const startRequest = debugLogs.find((entry) => entry.stage === 'start-request');
  assert.equal(startRequest?.details?.config?.apiKey, '[redacted]');
});

test('nanobot backend forwards progress before final reply and avoids duplicate overlap', async () => {
  const backend = new NanobotBackendAdapter({
    bridgeClient: {
      start: async (payload) => {
        payload.onEvent({
          type: 'progress',
          payload: {
            content: '我来看看喵。',
          },
        });
        payload.onEvent({
          type: 'text-delta',
          payload: {
            content: '我来看看喵。你现在有 5 个工具可用。',
          },
        });
        payload.onEvent({
          type: 'done',
          payload: {},
        });
      },
      testConnection: async () => ({ ok: true }),
      dispose: async () => {},
    },
  });

  const events = [];
  await backend.startStream({
    settings: {
      nanobot: {
        enabled: true,
        provider: 'openrouter',
        model: 'anthropic/claude-opus-4-5',
        apiKey: 'sk-or-test',
      },
    },
    sessionId: 's-progress',
    content: '帮我看看',
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });

  assert.deepEqual(
    events.map((event) => [event.type, event.payload.content || '']),
    [
      ['text-delta', '我来看看喵。'],
      ['text-delta', '你现在有 5 个工具可用。'],
      ['done', ''],
    ],
  );
});

test('nanobot backend hides tool hints from user-facing stream', async () => {
  const backend = new NanobotBackendAdapter({
    bridgeClient: {
      start: async (payload) => {
        payload.onEvent({
          type: 'tool-hint',
          payload: {
            content: 'read_file("MEMORY.md")',
          },
        });
        payload.onEvent({
          type: 'text-delta',
          payload: {
            content: '我先看看你的资料。',
          },
        });
        payload.onEvent({
          type: 'done',
          payload: {},
        });
      },
      testConnection: async () => ({ ok: true }),
      dispose: async () => {},
    },
  });

  const events = [];
  await backend.startStream({
    settings: {
      nanobot: {
        enabled: true,
        provider: 'openrouter',
        model: 'anthropic/claude-opus-4-5',
        apiKey: 'sk-or-test',
      },
    },
    sessionId: 's-tool-hint',
    content: 'hello',
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'text-delta');
  assert.equal(events[0].payload.content, '我先看看你的资料。');
});

test('sanitizeNanobotDisplayText keeps regular content and removes known tool-call lines', () => {
  const input = [
    '  Tool call: list_dir({"path":"./memory"})',
    '你好，这是正文。',
    'edit_file({"path":"a.txt"})',
    '第二行正文',
  ].join('\n');

  const output = sanitizeNanobotDisplayText(input);
  assert.equal(output, '你好，这是正文。\n第二行正文');
});

test('sliceIncrementalNanobotText removes overlapping prefix already visible to user', () => {
  assert.equal(
    sliceIncrementalNanobotText('我来看看喵。', '我来看看喵。你现在有 5 个工具可用。'),
    '你现在有 5 个工具可用。',
  );
  assert.equal(
    sliceIncrementalNanobotText('你好', '我来帮你看看'),
    '我来帮你看看',
  );
});

test('shouldForwardNanobotProgress hides internal-looking progress blocks', () => {
  assert.equal(shouldForwardNanobotProgress('Thinking [abc]: inspect memory'), false);
  assert.equal(shouldForwardNanobotProgress('我来看看喵。'), true);
});
