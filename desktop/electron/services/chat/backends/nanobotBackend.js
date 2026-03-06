const path = require('node:path');

const { ChatBackendAdapter } = require('./base');
const { createNanobotBridgeClient } = require('../nanobot/nanobotBridgeClient');

function normalizeString(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim();
}

function normalizeNanobotConfig(settings = {}) {
  const source = settings && typeof settings.nanobot === 'object' ? settings.nanobot : {};
  const fallbackWorkspace = normalizeString(process.env.NANOBOT_WORKSPACE, path.resolve(process.cwd(), 'nanobot-workspace'));

  return {
    enabled: Boolean(source.enabled),
    workspace: normalizeString(source.workspace, fallbackWorkspace) || fallbackWorkspace,
    provider: normalizeString(source.provider, 'openrouter'),
    model: normalizeString(source.model, 'anthropic/claude-opus-4-5'),
    apiBase: normalizeString(source.apiBase, ''),
    apiKey: normalizeString(source.apiKey, ''),
    maxTokens: Number.isFinite(source.maxTokens) ? Math.max(1, Math.floor(source.maxTokens)) : 4096,
    temperature: Number.isFinite(source.temperature) ? Number(source.temperature) : 0.2,
    reasoningEffort: normalizeString(source.reasoningEffort, ''),
  };
}

function createNanobotError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  if (typeof status === 'number') {
    error.status = status;
  }
  return error;
}

function redactNanobotConfig(config = {}) {
  return {
    ...config,
    apiKey: config?.apiKey ? '[redacted]' : '',
  };
}

const TOOL_CALL_PREFIX_REGEX = /^\s*(?:tool\s+call:\s*)?/i;
const TOOL_CALL_NAME_REGEX = /^(read_file|write_file|list_dir|edit_file|exec|spawn|web_search|web_fetch)\s*\(/i;

function sanitizeNanobotDisplayText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const lines = value.split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized) {
      continue;
    }

    const strippedPrefix = normalized.replace(TOOL_CALL_PREFIX_REGEX, '');
    if (TOOL_CALL_NAME_REGEX.test(strippedPrefix)) {
      continue;
    }

    kept.push(line);
  }

  return kept.join('\n').trim();
}

class NanobotBackendAdapter extends ChatBackendAdapter {
  constructor({ bridgeClient, resolveRuntime, emitDebugLog } = {}) {
    super('nanobot');
    this.emitDebugLog = typeof emitDebugLog === 'function' ? emitDebugLog : null;
    this.bridgeClient = bridgeClient || createNanobotBridgeClient({
      resolveLaunchConfig: resolveRuntime,
      emitDebugLog,
    });
  }

  debug(stage, message, details = undefined) {
    if (typeof this.emitDebugLog !== 'function') {
      return;
    }
    this.emitDebugLog({
      source: 'backend',
      stage,
      message,
      details,
    });
  }

  validateSettings(settings) {
    const config = normalizeNanobotConfig(settings);

    if (!config.enabled) {
      throw createNanobotError('nanobot_not_enabled', 'Nanobot 未启用，请先在设置中开启。');
    }

    if (!config.provider || !config.model || !config.apiKey) {
      throw createNanobotError(
        'nanobot_missing_config',
        'Nanobot 配置不完整，请先填写 Provider / Model / API Key。',
      );
    }
  }

  async testConnection({ settings }) {
    const config = normalizeNanobotConfig(settings);
    this.debug('test-request', 'Testing Nanobot connection.', {
      config: redactNanobotConfig(config),
    });
    return this.bridgeClient.testConnection({ config });
  }

  async startStream({ settings, sessionId, content, signal, onEvent }) {
    const config = normalizeNanobotConfig(settings);
    this.debug('start-request', 'Starting Nanobot stream.', {
      sessionId,
      content,
      config: redactNanobotConfig(config),
    });
    return this.bridgeClient.start({
      sessionId,
      content,
      signal,
      config,
      onEvent: (event) => {
        if (!event || typeof event !== 'object') {
          return;
        }

        const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
        this.debug('bridge-event-received', 'Received event from Nanobot bridge.', {
          eventType: event.type,
          payload,
        });
        const isTextDelta = event.type === 'text-delta';
        const sanitizedContent = isTextDelta
          ? sanitizeNanobotDisplayText(payload.content)
          : payload.content;
        if (isTextDelta && !sanitizedContent) {
          this.debug('text-delta-dropped', 'Dropped text-delta containing only tool-call traces.', {
            originalContent: payload.content || '',
          });
          return;
        }

        if (isTextDelta && sanitizedContent !== payload.content) {
          this.debug('text-delta-sanitized', 'Sanitized text-delta before forwarding to app.', {
            originalContent: payload.content || '',
            sanitizedContent,
          });
        }

        const forwardedEvent = {
          ...event,
          payload: {
            ...payload,
            ...(isTextDelta ? { content: sanitizedContent } : {}),
            source: payload.source || 'nanobot',
          },
        };
        this.debug('event-forwarded', 'Forwarding Nanobot event to chat stream.', {
          eventType: forwardedEvent.type,
          payload: forwardedEvent.payload,
        });
        onEvent(forwardedEvent);
      },
    });
  }

  mapError(error) {
    if (error && typeof error === 'object' && typeof error.code === 'string') {
      return {
        code: error.code,
        message: error.message || 'Nanobot 请求失败。',
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
      code: 'nanobot_unreachable',
      message: error?.message || 'Nanobot 服务不可用。',
    };
  }

  async dispose() {
    if (this.bridgeClient && typeof this.bridgeClient.dispose === 'function') {
      await this.bridgeClient.dispose();
    }
  }
}

module.exports = {
  NanobotBackendAdapter,
  normalizeNanobotConfig,
  sanitizeNanobotDisplayText,
};
