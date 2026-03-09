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
