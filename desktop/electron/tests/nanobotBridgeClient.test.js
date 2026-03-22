const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');

const { createNanobotBridgeClient } = require('../services/chat/nanobot/nanobotBridgeClient');

function createFakeChildProcess() {
  const child = new EventEmitter();
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    destroyed: false,
    write() {},
  };
  child.kill = () => {
    child.killed = true;
    child.emit('exit', null, 'SIGTERM');
  };
  return child;
}

test('nanobot bridge client rejects immediately when bridge exits before ready', async () => {
  const debugEvents = [];
  const client = createNanobotBridgeClient({
    scriptPath: __filename,
    spawnImpl: () => {
      const child = createFakeChildProcess();
      setImmediate(() => {
        child.emit('exit', 2, null);
      });
      return child;
    },
    emitDebugLog: (event) => {
      debugEvents.push(event);
    },
  });

  await assert.rejects(
    Promise.race([
      client.testConnection({ config: {} }),
      delay(200).then(() => {
        throw new Error('bridge did not reject before timeout');
      }),
    ]),
    {
      code: 'nanobot_unreachable',
      message: /Nanobot bridge exited \(code=2, signal=none\)\./,
    },
  );

  assert.equal(debugEvents.some((event) => event.stage === 'bridge-timeout'), false);
});

test('nanobot bridge client times out test request and sends abort', async () => {
  const writes = [];
  const child = createFakeChildProcess();
  child.stdin.write = (chunk) => {
    writes.push(String(chunk || '').trim());
  };

  const client = createNanobotBridgeClient({
    scriptPath: __filename,
    spawnImpl: () => {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('{"type":"ready"}\n'));
      });
      return child;
    },
    env: {
      ...process.env,
      NANOBOT_TEST_TIMEOUT_MS: '30',
    },
  });

  await assert.rejects(
    client.testConnection({
      config: {
        provider: 'openrouter',
        model: 'qwen/qwen3.5-flash-02-23',
        apiKey: 'x',
      },
    }),
    {
      code: 'nanobot_test_timeout',
    },
  );

  assert.equal(writes.some((line) => line.includes('"type":"abort"')), true);
  await client.dispose();
});

test('nanobot bridge client resolves direct request text and supports abort', async () => {
  const writes = [];
  const child = createFakeChildProcess();
  child.stdin.write = (chunk) => {
    const line = String(chunk || '').trim();
    writes.push(line);

    let payload = null;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }

    if (payload.type === 'direct') {
      setImmediate(() => {
        child.stdout.emit(
          'data',
          Buffer.from(
            `${JSON.stringify({
              type: 'direct-result',
              requestId: payload.requestId,
              ok: true,
              text: 'direct ok',
            })}\n`,
          ),
        );
      });
    }
  };

  const client = createNanobotBridgeClient({
    scriptPath: __filename,
    spawnImpl: () => {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('{"type":"ready"}\n'));
      });
      return child;
    },
  });

  const directResult = await client.invokeDirect({
    config: {
      provider: 'openrouter',
      model: 'qwen/qwen3.5-flash-02-23',
      apiKey: 'x',
    },
    content: 'hello direct',
    sessionId: 'session-1',
  });

  assert.equal(directResult.ok, true);
  assert.equal(directResult.text, 'direct ok');
  assert.equal(writes.some((line) => line.includes('"type":"direct"')), true);
  await client.dispose();

  const abortWrites = [];
  const abortChild = createFakeChildProcess();
  abortChild.stdin.write = (chunk) => {
    const line = String(chunk || '').trim();
    abortWrites.push(line);
    let payload = null;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }

    if (payload.type === 'direct') {
      setImmediate(() => {
        abortController.abort();
      });
    }
  };

  const abortController = new AbortController();
  const abortClient = createNanobotBridgeClient({
    scriptPath: __filename,
    spawnImpl: () => {
      setImmediate(() => {
        abortChild.stdout.emit('data', Buffer.from('{"type":"ready"}\n'));
      });
      return abortChild;
    },
  });

  await assert.rejects(
    abortClient.direct({
      config: {
        provider: 'openrouter',
        model: 'qwen/qwen3.5-flash-02-23',
        apiKey: 'x',
      },
      content: 'please abort',
      signal: abortController.signal,
    }),
    (error) => error && error.name === 'AbortError',
  );

  assert.equal(abortWrites.some((line) => line.includes('"type":"abort"')), true);
  await abortClient.dispose();
});
