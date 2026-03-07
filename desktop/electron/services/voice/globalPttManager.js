const { fork } = require('node:child_process');
const path = require('node:path');

function normalizePttHotkey(value) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (normalized === ' ' || normalized === 'SPACE') {
    return 'SPACE';
  }
  if (/^F([1-9]|1[0-2])$/.test(normalized)) {
    return normalized;
  }
  return 'F8';
}

class GlobalPttManager {
  constructor({
    emitCommand,
    emitStatus,
    logger = console,
    forkImpl = fork,
    workerFilePath = path.join(__dirname, 'globalPttHookProcess.js'),
  } = {}) {
    this.emitCommand = typeof emitCommand === 'function' ? emitCommand : () => {};
    this.emitStatus = typeof emitStatus === 'function' ? emitStatus : () => {};
    this.logger = logger;
    this.forkImpl = forkImpl;
    this.workerFilePath = workerFilePath;
    this.hotkey = 'F8';
    this.started = false;
    this.lastError = '';
    this.worker = null;
    this.workerReady = false;
    this.shouldRun = false;
  }

  updateSettings(settings = {}) {
    this.hotkey = normalizePttHotkey(settings?.voice?.pttHotkey);
    if (this.worker && this.worker.connected) {
      this.worker.send({ type: 'configure', hotkey: this.hotkey });
    }
    this.emitCurrentStatus();
  }

  emitCurrentStatus(extra = {}) {
    this.emitStatus(this.getStatus(extra));
  }

  getStatus(extra = {}) {
    return {
      available: Boolean(this.started && this.workerReady),
      hotkey: this.hotkey,
      error: this.lastError,
      ...extra,
    };
  }

  ensureWorker() {
    if (this.worker && this.worker.connected) {
      return this.worker;
    }

    this.workerReady = false;
    const worker = this.forkImpl(this.workerFilePath, [], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    this.worker = worker;

    worker.stderr?.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        this.logger.warn(`[global-ptt-worker] ${text}`);
      }
    });

    worker.on('message', (message = {}) => {
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'ready') {
        this.workerReady = true;
        this.lastError = '';
        worker.send({ type: 'configure', hotkey: this.hotkey });
        if (this.shouldRun) {
          worker.send({ type: 'start' });
        }
        return;
      }

      if (message.type === 'status') {
        this.started = message.available === true;
        this.lastError = typeof message.error === 'string' ? message.error : '';
        this.emitCurrentStatus({
          available: this.started,
          error: this.lastError,
        });
        return;
      }

      if (message.type === 'command' && (message.action === 'start' || message.action === 'stop')) {
        this.emitCommand({
          action: message.action,
          hotkey: this.hotkey,
        });
      }
    });

    worker.on('exit', (code, signal) => {
      if (this.worker === worker) {
        this.worker = null;
      }
      this.workerReady = false;
      this.started = false;
      this.lastError = `ptt_worker_exited:${code ?? 'null'}:${signal || 'none'}`;
      this.emitCurrentStatus({
        available: false,
        error: this.lastError,
      });
    });

    worker.on('error', (error) => {
      this.workerReady = false;
      this.started = false;
      this.lastError = error?.message || 'ptt_worker_spawn_failed';
      this.emitCurrentStatus({
        available: false,
        error: this.lastError,
      });
    });

    worker.send({ type: 'init', hotkey: this.hotkey });
    return worker;
  }

  start() {
    this.shouldRun = true;
    this.ensureWorker();
    this.emitCurrentStatus();
  }

  stop() {
    this.shouldRun = false;
    if (this.worker && this.worker.connected) {
      this.worker.send({ type: 'stop' });
      this.worker.disconnect();
    }
    this.worker = null;
    this.workerReady = false;
    this.started = false;
    this.lastError = '';
    this.emitCurrentStatus({ available: false });
  }
}

module.exports = {
  GlobalPttManager,
  normalizePttHotkey,
};