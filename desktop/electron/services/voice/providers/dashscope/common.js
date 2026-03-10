const crypto = require('node:crypto');
const wsModule = require('ws');

const DEFAULT_DASHSCOPE_REALTIME_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
const DEFAULT_DASHSCOPE_INFERENCE_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
const DEFAULT_DASHSCOPE_TIMEOUT_MS = 120000;

function createAbortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function createVoiceProviderError(code, message, stage = 'unknown', retriable = false) {
  const error = new Error(message);
  error.code = code;
  error.stage = stage;
  error.retriable = retriable;
  return error;
}

function sanitizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function toFiniteNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function toBooleanFlag(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return fallback;
}

function createEventId(prefix = 'dashscope') {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveDashScopeWsUrl({
  baseUrl,
  model,
  fallbackUrl,
  fallbackPath,
} = {}) {
  const resolvedFallbackUrl = sanitizeText(baseUrl, fallbackUrl);
  let parsedUrl;

  try {
    parsedUrl = new URL(resolvedFallbackUrl);
  } catch (error) {
    throw createVoiceProviderError(
      'voice_dashscope_invalid_url',
      `Invalid DashScope websocket URL: ${resolvedFallbackUrl}`,
      'connecting',
      false,
    );
  }

  const normalizedPath = sanitizeText(parsedUrl.pathname || '/');
  if (
    !normalizedPath
    || normalizedPath === '/'
    || normalizedPath === '/api-ws/v1/realtime'
    || normalizedPath === '/api-ws/v1/inference'
  ) {
    parsedUrl.pathname = fallbackPath;
  }

  const normalizedModel = sanitizeText(model);
  if (normalizedModel && !parsedUrl.searchParams.has('model')) {
    parsedUrl.searchParams.set('model', normalizedModel);
  }

  return parsedUrl.toString();
}

function resolveRealtimeUrl({ baseUrl, model } = {}) {
  return resolveDashScopeWsUrl({
    baseUrl,
    model,
    fallbackUrl: DEFAULT_DASHSCOPE_REALTIME_URL,
    fallbackPath: '/api-ws/v1/realtime',
  });
}

function resolveInferenceUrl({ baseUrl, model } = {}) {
  return resolveDashScopeWsUrl({
    baseUrl,
    model,
    fallbackUrl: DEFAULT_DASHSCOPE_INFERENCE_URL,
    fallbackPath: '/api-ws/v1/inference',
  });
}

function buildDashScopeHeaders({ apiKey, workspace } = {}) {
  const normalizedApiKey = sanitizeText(apiKey);
  const normalizedWorkspace = sanitizeText(workspace);

  if (!normalizedApiKey) {
    return null;
  }

  const headers = {
    Authorization: `Bearer ${normalizedApiKey}`,
  };

  if (normalizedWorkspace) {
    headers['X-DashScope-WorkSpace'] = normalizedWorkspace;
  }

  return headers;
}

function parseMessageData(raw, isBinary = false) {
  if (isBinary) {
    return null;
  }

  const text = Buffer.isBuffer(raw) ? raw.toString('utf-8') : String(raw || '');
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function decodeBase64Payload(value) {
  const text = sanitizeText(value);
  if (!text) {
    return Buffer.alloc(0);
  }

  try {
    return Buffer.from(text, 'base64');
  } catch {
    return Buffer.alloc(0);
  }
}

function getWebSocketImpl(WebSocketImpl = null) {
  return WebSocketImpl || wsModule.WebSocket || wsModule;
}

function safeCloseWebSocket(socket, { terminate = false } = {}) {
  if (!socket) {
    return;
  }

  try {
    if (terminate && typeof socket.terminate === 'function') {
      socket.terminate();
      return;
    }

    if (typeof socket.close === 'function') {
      socket.close();
    }
  } catch {
    // noop
  }
}

function extractDashScopeError(message, {
  fallbackCode = 'voice_dashscope_failed',
  fallbackMessage = 'DashScope request failed.',
  stage = 'unknown',
  retriable = true,
} = {}) {
  const source =
    message?.error && typeof message.error === 'object'
      ? message.error
      : (message || {});

  return createVoiceProviderError(
    sanitizeText(source.code, fallbackCode),
    sanitizeText(source.message, fallbackMessage),
    stage,
    retriable,
  );
}

module.exports = {
  DEFAULT_DASHSCOPE_INFERENCE_URL,
  DEFAULT_DASHSCOPE_REALTIME_URL,
  DEFAULT_DASHSCOPE_TIMEOUT_MS,
  buildDashScopeHeaders,
  createAbortError,
  createEventId,
  createVoiceProviderError,
  decodeBase64Payload,
  extractDashScopeError,
  getWebSocketImpl,
  parseMessageData,
  resolveInferenceUrl,
  resolveRealtimeUrl,
  safeCloseWebSocket,
  sanitizeText,
  toBooleanFlag,
  toFiniteNumber,
  toPositiveInteger,
};
