const assert = require('node:assert/strict');
const test = require('node:test');

const {
  mapAcpEventToChatEvent,
  normalizeAcpBackendSettings,
  isPermissionRequestEvent,
  extractPermissionRequest,
} = require('../services/chat/acp/acpEventMapper');

test('maps text and terminal ACP events into chat envelope events', () => {
  const text = mapAcpEventToChatEvent(
    { type: 'response.output_text.delta', payload: { content: 'hello' } },
    { source: 'codex' },
  );
  assert.deepEqual(text, {
    type: 'text-delta',
    payload: {
      content: 'hello',
      source: 'codex',
    },
  });

  const done = mapAcpEventToChatEvent(
    { type: 'response.completed', payload: { finishReason: 'stop' } },
    { source: 'codex' },
  );
  assert.equal(done?.type, 'done');
  assert.equal(done?.payload?.finishReason, 'stop');

  const error = mapAcpEventToChatEvent(
    { type: 'response.failed', payload: { code: 'upstream_error', message: 'boom', status: 500 } },
    { source: 'codex' },
  );
  assert.equal(error?.type, 'error');
  assert.equal(error?.payload?.code, 'upstream_error');
  assert.equal(error?.payload?.status, 500);
});

test('maps ACP usage, artifact and tool activity events', () => {
  const usage = mapAcpEventToChatEvent({
    type: 'usage',
    payload: { inputTokens: 10, outputTokens: 20 },
  });
  assert.equal(usage?.type, 'usage');
  assert.equal(usage?.payload?.inputTokens, 10);

  const artifact = mapAcpEventToChatEvent({
    type: 'artifact',
    payload: { kind: 'file', path: '/tmp/result.txt' },
  });
  assert.equal(artifact?.type, 'artifact');
  assert.equal(artifact?.payload?.path, '/tmp/result.txt');

  const tool = mapAcpEventToChatEvent({
    type: 'tool-call',
    payload: { toolName: 'read_file' },
  });
  assert.equal(tool?.type, 'agent-state');
  assert.equal(tool?.payload?.businessState, 'researching');
});

test('detects and extracts permission requests', () => {
  const event = {
    type: 'permission-request',
    payload: {
      requestId: 'perm-1',
      permission: 'exec',
      toolName: 'exec',
      reason: 'need shell command',
    },
  };

  assert.equal(isPermissionRequestEvent(event), true);
  assert.deepEqual(extractPermissionRequest(event), {
    requestId: 'perm-1',
    permission: 'exec',
    toolName: 'exec',
    reason: 'need shell command',
  });
});

test('normalizes ACP backend settings with http/websocket transports', () => {
  const httpSettings = normalizeAcpBackendSettings({
    permissionMode: 'allow',
    runner: {
      transport: 'http',
      endpoint: 'http://127.0.0.1:8787/acp',
      headers: {
        Authorization: 'Bearer token',
      },
    },
  });
  assert.equal(httpSettings.runner.transport, 'http');
  assert.equal(httpSettings.runner.endpoint, 'http://127.0.0.1:8787/acp');
  assert.equal(httpSettings.runner.headers.Authorization, 'Bearer token');

  const wsSettings = normalizeAcpBackendSettings({
    runner: {
      transport: 'ws',
      url: 'ws://127.0.0.1:8787/acp',
    },
  });
  assert.equal(wsSettings.runner.transport, 'websocket');
  assert.equal(wsSettings.runner.url, 'ws://127.0.0.1:8787/acp');
});
