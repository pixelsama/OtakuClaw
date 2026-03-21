const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const EventEmitter = require('node:events');

const { ResourceLockManager } = require('./resourceLockManager');

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

class DownloadInstallTaskManager extends EventEmitter {
  constructor(app, { lockManager = null } = {}) {
    super();
    this.app = app;
    this.lockManager = lockManager || new ResourceLockManager();
    this.tasksDir = path.join(this.app.getPath('userData'), 'download-tasks');
    this.tasksFilePath = path.join(this.tasksDir, 'tasks.json');
    this.tasks = new Map();
    this.controllers = new Map();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) {
      return;
    }
    await fs.mkdir(this.tasksDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.tasksFilePath, 'utf-8');
      const items = JSON.parse(raw);
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!item?.taskId) {
            continue;
          }
          const status = item.status === 'running' || item.status === 'canceling' ? 'recovering' : item.status;
          this.tasks.set(item.taskId, {
            ...item,
            status,
            canCancel: false,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to read task journal:', error);
      }
    }
    await this.persist();
    this.initialized = true;
  }

  listTasks() {
    return [...this.tasks.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createTask({ taskType, payload = {}, resourceLocks = [], resumable = true }, runner) {
    await this.init();
    const taskId = `${sanitizeText(taskType) || 'download-task'}-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const task = {
      taskId,
      taskType: sanitizeText(taskType) || 'unknown',
      payload,
      resourceLocks: Array.isArray(resourceLocks) ? resourceLocks.filter(Boolean) : [],
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      checkpoint: '',
      lastError: null,
      attempt: 0,
      resumable: Boolean(resumable),
      canCancel: false,
    };
    this.tasks.set(taskId, task);
    await this.persist();
    this.emitProgress(task);
    return this.runTask(taskId, runner);
  }

  async runTask(taskId, runner) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.attempt += 1;
    task.status = task.status === 'recovering' ? 'recovering' : 'running';
    task.canCancel = true;
    task.updatedAt = new Date().toISOString();
    task.lastError = null;
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    await this.persist();
    this.emitProgress(task);

    try {
      const result = await this.lockManager.withLocks(task.resourceLocks, () => runner({
        taskId,
        signal: controller.signal,
        setCheckpoint: (checkpoint) => this.updateTask(taskId, { checkpoint }),
        emitProgress: (progress = {}) => this.emitProgress({ ...this.tasks.get(taskId), ...progress }),
      }));
      await this.updateTask(taskId, {
        status: 'completed',
        canCancel: false,
        checkpoint: 'state_persisted',
      });
      return { task: this.tasks.get(taskId), result };
    } catch (error) {
      const canceled = controller.signal.aborted;
      await this.updateTask(taskId, {
        status: canceled ? 'canceled' : 'failed',
        canCancel: false,
        lastError: {
          code: sanitizeText(error?.code) || (canceled ? 'task_canceled' : 'task_failed'),
          message: sanitizeText(error?.message) || (canceled ? 'Task canceled.' : 'Task failed.'),
        },
      });
      throw error;
    } finally {
      this.controllers.delete(taskId);
    }
  }

  async cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }
    if (task.status !== 'running' && task.status !== 'recovering') {
      return task;
    }
    task.status = 'canceling';
    task.updatedAt = new Date().toISOString();
    await this.persist();
    this.emitProgress(task);
    this.controllers.get(taskId)?.abort();
    return task;
  }

  async retryTask(taskId, runner) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (!['failed', 'canceled', 'recovering'].includes(task.status)) {
      return { task, result: null };
    }
    task.status = 'pending';
    await this.persist();
    this.emitProgress(task);
    return this.runTask(taskId, runner);
  }

  async updateTask(taskId, patch = {}) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    await this.persist();
    this.emitProgress(task);
    return task;
  }

  emitProgress(payload) {
    this.emit('download-task:progress', payload);
  }

  async persist() {
    await fs.mkdir(this.tasksDir, { recursive: true });
    await fs.writeFile(this.tasksFilePath, JSON.stringify(this.listTasks(), null, 2), 'utf-8');
  }
}

module.exports = {
  DownloadInstallTaskManager,
};
