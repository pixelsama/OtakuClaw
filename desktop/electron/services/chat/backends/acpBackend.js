const { ChatBackendAdapter } = require('./base');
const {
  normalizeAcpBackendSettings,
} = require('../acp/acpEventMapper');
const {
  runAcpStream,
  testAcpRunner,
  createAcpError,
} = require('../acp/acpTransportClient');

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function toBackendCodePrefix(name = '') {
  return normalizeText(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'acp';
}

function createBackendError(prefix, suffix, message, status) {
  return createAcpError(`${prefix}_${suffix}`, message, status);
}

class AcpBackendAdapter extends ChatBackendAdapter {
  constructor({
    name,
    settingsKey,
    displayName,
    defaults,
    emitDebugLog,
    spawnFn,
  } = {}) {
    super(name);
    this.settingsKey = settingsKey;
    this.displayName = displayName || settingsKey || name;
    this.defaults = defaults || {};
    this.emitDebugLog = typeof emitDebugLog === 'function' ? emitDebugLog : null;
    this.spawnFn = typeof spawnFn === 'function' ? spawnFn : undefined;
    this.codePrefix = toBackendCodePrefix(this.name);
  }

  debug(stage, message, details = undefined) {
    if (typeof this.emitDebugLog !== 'function') {
      return;
    }

    this.emitDebugLog({
      source: 'backend',
      backend: this.name,
      stage,
      message,
      details,
    });
  }

  resolveSettings(settings = {}) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const section =
      source[this.settingsKey] && typeof source[this.settingsKey] === 'object'
        ? source[this.settingsKey]
        : {};

    return normalizeAcpBackendSettings(section, this.defaults);
  }

  validateSettings(settings = {}) {
    const resolved = this.resolveSettings(settings);

    if (!resolved.enabled) {
      throw createBackendError(
        this.codePrefix,
        'not_enabled',
        `${this.displayName} backend is disabled.`,
      );
    }

    if (resolved.runner.protocol !== 'acp') {
      throw createBackendError(
        this.codePrefix,
        'runner_protocol_unsupported',
        `${this.displayName} backend supports ACP protocol only.`,
      );
    }

    if (resolved.runner.transport === 'stdio') {
      if (!resolved.runner.command) {
        throw createBackendError(
          this.codePrefix,
          'runner_missing_command',
          `${this.displayName} backend runner command is required for stdio transport.`,
        );
      }
      return resolved;
    }

    if (resolved.runner.transport === 'http') {
      if (!resolved.runner.endpoint) {
        throw createBackendError(
          this.codePrefix,
          'runner_missing_endpoint',
          `${this.displayName} backend HTTP endpoint is required.`,
        );
      }
      return resolved;
    }

    if (resolved.runner.transport === 'websocket') {
      if (!resolved.runner.url) {
        throw createBackendError(
          this.codePrefix,
          'runner_missing_url',
          `${this.displayName} backend WebSocket URL is required.`,
        );
      }
      return resolved;
    }

    throw createBackendError(
      this.codePrefix,
      'runner_transport_unsupported',
      `${this.displayName} backend transport is not supported: ${resolved.runner.transport}`,
    );
  }

  async testConnection({ settings, signal }) {
    const resolved = this.validateSettings(settings);
    this.debug('test-request', 'Testing ACP backend connection.', {
      backend: this.name,
      runner: {
        protocol: resolved.runner.protocol,
        transport: resolved.runner.transport,
        command: resolved.runner.command,
        args: resolved.runner.args,
        endpoint: resolved.runner.endpoint,
        url: resolved.runner.url,
      },
      permissionMode: resolved.permissionMode,
      timeoutMs: resolved.timeoutMs,
    });

    return testAcpRunner({
      backend: this.codePrefix,
      settings: resolved,
      signal,
      spawnFn: this.spawnFn,
    });
  }

  async startStream({ settings, sessionId, content, options = {}, signal, onEvent }) {
    const resolved = this.validateSettings(settings);
    this.debug('start-request', 'Starting ACP backend stream.', {
      backend: this.name,
      sessionId,
      contentLength: content?.length || 0,
      permissionMode: resolved.permissionMode,
      timeoutMs: resolved.timeoutMs,
      runner: {
        protocol: resolved.runner.protocol,
        transport: resolved.runner.transport,
        command: resolved.runner.command,
        args: resolved.runner.args,
        endpoint: resolved.runner.endpoint,
        url: resolved.runner.url,
      },
    });

    return runAcpStream({
      backend: this.name,
      settings: resolved,
      sessionId,
      content,
      options,
      signal,
      onEvent,
      emitDebugLog: (payload = {}) => {
        this.debug(payload.stage || 'stream', payload.message || '', payload.details);
      },
      spawnFn: this.spawnFn,
    });
  }

  mapError(error) {
    if (error && typeof error === 'object' && typeof error.code === 'string') {
      const normalizedCode = normalizeText(error.code, `${this.codePrefix}_error`);
      return {
        code: normalizedCode,
        message: error.message || `${this.displayName} backend request failed.`,
        status: error.status,
      };
    }

    if (error?.name === 'AbortError') {
      return {
        code: 'aborted',
        message: 'stream aborted',
      };
    }

    return {
      code: `${this.codePrefix}_error`,
      message: error?.message || `${this.displayName} backend request failed.`,
    };
  }
}

module.exports = {
  AcpBackendAdapter,
};
