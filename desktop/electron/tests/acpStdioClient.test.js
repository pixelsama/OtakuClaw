const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const {
  runAcpStdioStream,
} = require('../services/chat/acp/acpStdioClient');

class FakeChildProcess extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killed = false;
  }

  kill(signal = 'SIGTERM') {
    if (this.killed) {
      return false;
    }
    this.killed = true;
    this.emit('exit', 0, signal);
    return true;
  }
}

function createSpawnHarness() {
  const child = new FakeChildProcess();
  const spawnFn = () => {
    setImmediate(() => child.emit('spawn'));
    return child;
  };
  return { child, spawnFn };
}

async function collectStdinLines(stdin, waitMs = 5) {
  const chunks = [];
  stdin.on('data', (buffer) => {
    chunks.push(buffer.toString('utf-8'));
  });
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return chunks.join('').split('\n').map((line) => line.trim()).filter(Boolean);
}

test('acp stdio client emits a single terminal done event', async () => {
  const { child, spawnFn } = createSpawnHarness();
  const events = [];

  setTimeout(() => {
    child.stdout.write(`${JSON.stringify({ type: 'done', payload: { finishReason: 'completed' } })}\n`);
    child.stdout.write(`${JSON.stringify({ type: 'done', payload: { finishReason: 'completed' } })}\n`);
  }, 10);

  await runAcpStdioStream({
    backend: 'codex',
    settings: {
      runner: {
        command: 'fake-codex-acp',
      },
      timeoutMs: 2000,
      permissionMode: 'deny',
    },
    sessionId: 's1',
    content: 'hello',
    onEvent: (event) => events.push(event),
    spawnFn,
  });

  assert.equal(events.filter((event) => event.type === 'done').length, 1);
});

test('acp stdio client resolves abort to done{aborted:true}', async () => {
  const { spawnFn } = createSpawnHarness();
  const events = [];
  const controller = new AbortController();

  setTimeout(() => controller.abort(), 10);

  await runAcpStdioStream({
    backend: 'claude-code',
    settings: {
      runner: {
        command: 'fake-claude-acp',
      },
      timeoutMs: 2000,
      permissionMode: 'deny',
    },
    sessionId: 's1',
    content: 'abort-me',
    signal: controller.signal,
    onEvent: (event) => events.push(event),
    spawnFn,
  });

  const terminal = events.find((event) => event.type === 'done');
  assert.equal(Boolean(terminal), true);
  assert.equal(Boolean(terminal?.payload?.aborted), true);
});

test('acp stdio client applies deny permission policy by default', async () => {
  const { child, spawnFn } = createSpawnHarness();
  const events = [];

  setTimeout(() => {
    child.stdout.write(`${JSON.stringify({
      type: 'permission-request',
      payload: {
        requestId: 'perm-1',
        permission: 'exec',
        toolName: 'exec',
      },
    })}\n`);
    child.stdout.write(`${JSON.stringify({ type: 'done', payload: { finishReason: 'completed' } })}\n`);
  }, 10);

  await runAcpStdioStream({
    backend: 'codex',
    settings: {
      runner: {
        command: 'fake-codex-acp',
      },
      timeoutMs: 2000,
      permissionMode: 'deny',
    },
    sessionId: 's1',
    content: 'hello',
    onEvent: (event) => events.push(event),
    spawnFn,
  });

  const lines = await collectStdinLines(child.stdin, 20);
  const responses = lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((payload) => payload.type === 'permission-response');
  assert.equal(responses.length, 1);
  assert.equal(responses[0].decision, 'deny');

  const done = events.find((event) => event.type === 'done');
  assert.equal(Boolean(done), true);
});

test('acp stdio client maps upstream error payloads', async () => {
  const { child, spawnFn } = createSpawnHarness();
  const events = [];

  setTimeout(() => {
    child.stdout.write(`${JSON.stringify({
      type: 'error',
      payload: {
        code: 'upstream_failed',
        message: 'boom',
        status: 500,
      },
    })}\n`);
  }, 10);

  await runAcpStdioStream({
    backend: 'codex',
    settings: {
      runner: {
        command: 'fake-codex-acp',
      },
      timeoutMs: 2000,
      permissionMode: 'deny',
    },
    sessionId: 's1',
    content: 'hello',
    onEvent: (event) => events.push(event),
    spawnFn,
  });

  const error = events.find((event) => event.type === 'error');
  assert.equal(Boolean(error), true);
  assert.equal(error?.payload?.code, 'upstream_failed');
  assert.equal(error?.payload?.status, 500);
});
