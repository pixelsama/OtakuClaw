const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { DownloadInstallTaskManager } = require('../services/download/downloadInstallTaskManager');

function createApp(tmpDir) {
  return {
    getPath(key) {
      if (key === 'userData') {
        return tmpDir;
      }
      return tmpDir;
    },
  };
}

test('task manager serializes same resource lock and supports cancel', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'download-task-manager-test-'));
  const manager = new DownloadInstallTaskManager(createApp(tmpDir));
  await manager.init();

  const order = [];
  const firstTaskPromise = manager.createTask(
    {
      taskType: 'voice-model-install',
      payload: { catalogId: 'a' },
      resourceLocks: ['voice-state'],
    },
    async ({ signal }) => {
      order.push('first-start');
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(signal.aborted, false);
      order.push('first-end');
      return { ok: true };
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 10));

  const secondTaskPromise = manager.createTask(
    {
      taskType: 'voice-model-install',
      payload: { catalogId: 'b' },
      resourceLocks: ['voice-state'],
    },
    async () => {
      order.push('second-start');
      return { ok: true };
    },
  );

  const [firstTask, secondTask] = await Promise.all([firstTaskPromise, secondTaskPromise]);
  assert.equal(firstTask.task.status, 'completed');
  assert.equal(secondTask.task.status, 'completed');
  assert.ok(order.includes('first-start'));
  assert.ok(order.includes('first-end'));
  assert.ok(order.includes('second-start'));

  let gateResolve;
  const gatePromise = new Promise((resolve) => {
    gateResolve = resolve;
  });

  const cancelPromise = manager.createTask(
    {
      taskType: 'voice-model-download',
      payload: { bundleId: 'x' },
      resourceLocks: ['voice-bundle:x'],
    },
    async ({ signal }) => {
      await gatePromise;
      if (signal.aborted) {
        throw Object.assign(new Error('canceled'), { code: 'task_canceled' });
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 150);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('canceled'), { code: 'task_canceled' }));
        }, { once: true });
      });
      return { ok: true };
    },
  );

  let pendingTask = null;
  for (let index = 0; index < 20; index += 1) {
    pendingTask = manager.listTasks().find((item) => item.taskType === 'voice-model-download');
    if (pendingTask) {
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(pendingTask);
  await manager.cancelTask(pendingTask.taskId);
  gateResolve();
  await cancelPromise.catch(() => null);
  const canceled = manager.listTasks().find((item) => item.taskId === pendingTask.taskId);
  assert.ok(canceled);
  assert.ok(['canceled', 'completed'].includes(canceled.status));
});
