const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { GlobalPttManager } = require('../services/voice/globalPttManager');

function createWorkerMock() {
  const worker = new EventEmitter();
  worker.connected = true;
  worker.stderr = new EventEmitter();
  worker.sent = [];
  worker.send = (message) => {
    worker.sent.push(message);
  };
  worker.disconnect = () => {
    worker.connected = false;
  };
  return worker;
}

test('global ptt manager forwards worker status and commands', () => {
  const statuses = [];
  const commands = [];
  const worker = createWorkerMock();

  const manager = new GlobalPttManager({
    emitStatus: (payload) => statuses.push(payload),
    emitCommand: (payload) => commands.push(payload),
    forkImpl: () => worker,
  });

  manager.updateSettings({ voice: { pttHotkey: 'SPACE' } });
  manager.start();
  worker.emit('message', { type: 'ready' });
  worker.emit('message', { type: 'status', available: true, error: '' });
  worker.emit('message', { type: 'command', action: 'start' });
  worker.emit('message', { type: 'command', action: 'stop' });

  assert.equal(worker.sent.some((message) => message.type === 'start'), true);
  assert.deepEqual(commands, [
    { action: 'start', hotkey: 'SPACE' },
    { action: 'stop', hotkey: 'SPACE' },
  ]);
  assert.equal(statuses.at(-1).available, true);
});

test('global ptt manager reports worker crash without crashing main flow', () => {
  const statuses = [];
  const worker = createWorkerMock();

  const manager = new GlobalPttManager({
    emitStatus: (payload) => statuses.push(payload),
    forkImpl: () => worker,
  });

  manager.start();
  worker.emit('message', { type: 'ready' });
  worker.emit('message', { type: 'status', available: true, error: '' });
  worker.emit('exit', null, 'SIGABRT');

  assert.equal(statuses.at(-1).available, false);
  assert.match(statuses.at(-1).error, /ptt_worker_exited/);
});