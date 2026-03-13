const { NanobotBackendAdapter } = require('./backends/nanobotBackend');

function normalizeBackendName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function coerceBackendName(value) {
  const normalized = normalizeBackendName(value);
  // OpenClaw is temporarily disabled in current public builds.
  if (normalized === 'openclaw') {
    return 'nanobot';
  }
  return normalized;
}

function createUnsupportedBackendError(backend) {
  const error = new Error(`Unsupported chat backend: ${backend || 'unknown'}`);
  error.code = 'chat_backend_unsupported';
  return error;
}

class ChatBackendManager {
  constructor({ backends } = {}) {
    this.backends = new Map();

    const backendList = Array.isArray(backends) && backends.length > 0
      ? backends
      : [new NanobotBackendAdapter()];
    for (const backend of backendList) {
      this.register(backend);
    }
  }

  register(backend) {
    const name = normalizeBackendName(backend?.name);
    if (!name) {
      throw new Error('backend name is required');
    }

    this.backends.set(name, backend);
  }

  resolveBackendName({ settings = {}, requestBackend } = {}) {
    const fromRequest = coerceBackendName(requestBackend);
    if (fromRequest) {
      return this.requireBackend(fromRequest);
    }

    const fromSettings = coerceBackendName(settings.chatBackend);
    if (fromSettings) {
      return this.requireBackend(fromSettings);
    }

    return this.requireBackend('nanobot');
  }

  requireBackend(name) {
    if (!this.backends.has(name)) {
      throw createUnsupportedBackendError(name);
    }

    return name;
  }

  getBackend(name) {
    const normalized = this.requireBackend(normalizeBackendName(name));
    return this.backends.get(normalized);
  }

  async startStream({ backend, settings, sessionId, content, options = {}, signal, onEvent }) {
    const adapter = this.getBackend(backend);
    adapter.validateSettings(settings);

    return adapter.startStream({
      settings,
      sessionId,
      content,
      options,
      signal,
      onEvent,
    });
  }

  async testConnection({ backend, settings, signal }) {
    const adapter = this.getBackend(backend);
    adapter.validateSettings(settings);
    return adapter.testConnection({ settings, signal });
  }

  mapError(error, { backend } = {}) {
    if (error && typeof error === 'object' && typeof error.code === 'string') {
      return {
        code: error.code,
        message: error.message || '聊天后端请求失败。',
        status: error.status,
      };
    }

    const name = coerceBackendName(backend);
    const adapter = (name && this.backends.get(name)) || this.backends.get('nanobot');

    if (adapter && typeof adapter.mapError === 'function') {
      return adapter.mapError(error);
    }

    if (error?.name === 'AbortError') {
      return {
        code: 'aborted',
        message: 'stream aborted',
      };
    }

    return {
      code: 'chat_backend_error',
      message: error?.message || '聊天后端请求失败。',
    };
  }

  async dispose() {
    const disposeTasks = [];

    for (const backend of this.backends.values()) {
      if (typeof backend?.dispose === 'function') {
        disposeTasks.push(Promise.resolve(backend.dispose()));
      }
    }

    await Promise.allSettled(disposeTasks);
  }
}

function createChatBackendManager(options) {
  return new ChatBackendManager(options);
}

module.exports = {
  ChatBackendManager,
  createChatBackendManager,
};
