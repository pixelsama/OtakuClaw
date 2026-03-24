const { NanobotBackendAdapter } = require('./backends/nanobotBackend');
const { ClaudeCodeBackendAdapter } = require('./backends/claudeCodeBackend');
const { CodexBackendAdapter } = require('./backends/codexBackend');

function normalizeBackendName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function coerceBackendName(value) {
  const normalized = normalizeBackendName(value);
  // Legacy compatibility: OpenClaw has been removed from user-visible backend choices.
  if (normalized === 'openclaw') {
    return 'nanobot';
  }
  if (normalized === 'claude code' || normalized === 'claudecode' || normalized === 'claude_code') {
    return 'claude-code';
  }
  return normalized;
}

function resolveProfileBackend(profile = {}) {
  if (!profile || typeof profile !== 'object') {
    return '';
  }

  return coerceBackendName(
    profile.backend
      || profile.chatBackend
      || profile.engine
      || profile.provider,
  );
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
      : [
        new NanobotBackendAdapter(),
        new ClaudeCodeBackendAdapter(),
        new CodexBackendAdapter(),
      ];
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

  resolveBackendName({
    settings = {},
    requestBackend,
    requestProfile,
    requestProfileId = '',
    agentProfile,
  } = {}) {
    const fromExplicitProfile =
      resolveProfileBackend(requestProfile)
      || resolveProfileBackend(agentProfile);
    if (fromExplicitProfile) {
      return this.requireBackend(fromExplicitProfile);
    }

    const settingsProfiles =
      settings && typeof settings.agentProfiles === 'object' && !Array.isArray(settings.agentProfiles)
        ? settings.agentProfiles
        : {};
    const settingsProfile =
      (requestProfileId && settingsProfiles[requestProfileId]) || {};
    const fromSettingsProfile = resolveProfileBackend(settingsProfile);
    if (fromSettingsProfile) {
      return this.requireBackend(fromSettingsProfile);
    }

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

  async startStream({
    backend,
    settings,
    sessionId,
    content,
    options = {},
    signal,
    onEvent,
    resolvePermissionRequest,
  }) {
    const adapter = this.getBackend(backend);
    adapter.validateSettings(settings);

    return adapter.startStream({
      settings,
      sessionId,
      content,
      options,
      signal,
      onEvent,
      resolvePermissionRequest,
    });
  }

  async testConnection({ backend, settings, signal }) {
    const adapter = this.getBackend(backend);
    adapter.validateSettings(settings);
    return adapter.testConnection({ settings, signal });
  }

  async runDirect({ backend, settings, sessionId, content, options = {}, signal }) {
    const adapter = this.getBackend(backend);
    adapter.validateSettings(settings);

    const directInvoker =
      typeof adapter.runDirect === 'function'
        ? adapter.runDirect
        : adapter.invokeDirect;

    if (typeof directInvoker !== 'function') {
      throw new Error('runDirect is not implemented');
    }

    return directInvoker.call(adapter, {
      settings,
      sessionId,
      content,
      options,
      signal,
    });
  }

  async invokeDirect(payload) {
    return this.runDirect(payload);
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
