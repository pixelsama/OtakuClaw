const { randomUUID } = require('node:crypto');

const {
  mapAcpEventToChatEvent,
  normalizeAcpBackendSettings,
  isPermissionRequestEvent,
  extractPermissionRequest,
} = require('./acpEventMapper');
const { createAcpError } = require('./acpStdioClient');

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function normalizeHeaders(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value)
    .map(([key, item]) => [normalizeText(key), normalizeText(item)])
    .filter(([key]) => Boolean(key));
  return Object.fromEntries(entries);
}

function parseJson(text = '') {
  const raw = normalizeText(text);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function debugLogger(emitDebugLog, stage, message, details = undefined) {
  if (typeof emitDebugLog !== 'function') {
    return;
  }

  emitDebugLog({
    source: 'acp-http-client',
    stage,
    message,
    details,
  });
}

function createPermissionDecision(mode) {
  if (mode === 'allow') {
    return {
      decision: 'allow',
      reason: 'policy_allow',
    };
  }

  return {
    decision: 'deny',
    reason: mode === 'ask' ? 'policy_ask_timeout' : 'policy_deny',
  };
}

function normalizePermissionDecisionResult(value, fallbackReason = 'policy_ask_timeout') {
  if (value && typeof value === 'object') {
    const normalizedDecision = normalizeText(value.decision).toLowerCase();
    if (normalizedDecision === 'allow' || normalizedDecision === 'deny') {
      return {
        decision: normalizedDecision,
        reason: normalizeText(value.reason, normalizedDecision === 'allow' ? 'user_allow' : 'user_deny'),
      };
    }
  }

  const normalizedText = normalizeText(value).toLowerCase();
  if (normalizedText === 'allow' || normalizedText === 'deny') {
    return {
      decision: normalizedText,
      reason: normalizedText === 'allow' ? 'user_allow' : 'user_deny',
    };
  }

  return {
    decision: 'deny',
    reason: fallbackReason,
  };
}

async function resolveAskDecision({
  request = {},
  backend = 'acp',
  transport = 'http',
  sessionId = '',
  turnId = '',
  askTimeoutMs = 8_000,
  resolvePermissionRequest,
} = {}) {
  if (typeof resolvePermissionRequest !== 'function') {
    await new Promise((resolve) => setTimeout(resolve, askTimeoutMs));
    return {
      decision: 'deny',
      reason: 'policy_ask_timeout',
    };
  }

  let timeoutId = null;
  try {
    const resolverResult = await Promise.race([
      Promise.resolve(
        resolvePermissionRequest({
          backend,
          transport,
          sessionId,
          turnId,
          askTimeoutMs,
          request: {
            requestId: normalizeText(request.requestId),
            permission: normalizeText(request.permission),
            toolName: normalizeText(request.toolName),
            reason: normalizeText(request.reason),
          },
        }),
      ),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          resolve({
            decision: 'deny',
            reason: 'policy_ask_timeout',
          });
        }, askTimeoutMs);
      }),
    ]);

    return normalizePermissionDecisionResult(resolverResult, 'policy_ask_timeout');
  } catch {
    return {
      decision: 'deny',
      reason: 'policy_ask_failed',
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function sendPermissionDecision({
  endpoint,
  headers,
  turnId,
  requestId,
  decision,
  reason,
  emitDebugLog,
}) {
  if (!endpoint || !requestId) {
    return;
  }

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        protocolVersion: 'acp.v1',
        type: 'permission-response',
        turnId,
        requestId,
        decision,
        reason,
      }),
    });
  } catch (error) {
    debugLogger(
      emitDebugLog,
      'permission-response-failed',
      'Failed to send HTTP ACP permission response.',
      {
        endpoint,
        requestId,
        decision,
        error: error?.message || String(error),
      },
    );
  }
}

async function consumeTextLinesFromStream(body, onLine) {
  if (!body || typeof body.getReader !== 'function') {
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      onLine(line);
    }
  }

  buffer += decoder.decode();
  if (buffer) {
    onLine(buffer);
  }
}

async function runAcpHttpStream({
  backend = 'acp',
  settings = {},
  sessionId,
  content,
  options = {},
  signal,
  onEvent,
  emitDebugLog,
  resolvePermissionRequest,
} = {}) {
  const normalizedSettings = normalizeAcpBackendSettings(settings);
  const runner = normalizedSettings.runner || {};
  const endpoint = normalizeText(runner.endpoint);
  const permissionEndpoint = normalizeText(runner.permissionEndpoint, endpoint);
  const timeoutMs = normalizedSettings.timeoutMs;
  const askTimeoutMs = normalizedSettings.askTimeoutMs;
  const permissionMode = normalizedSettings.permissionMode;
  const headers = normalizeHeaders(runner.headers);

  if (!endpoint) {
    throw createAcpError(
      `${backend}_runner_missing_endpoint`,
      `${backend} backend HTTP endpoint is required.`,
    );
  }

  const turnId = randomUUID();
  const startedAt = Date.now();
  let timeoutId = null;
  let timedOut = false;
  let terminalSeen = false;
  let abortedByUser = false;
  let permissionRequests = 0;
  let permissionDeniedCount = 0;
  const controller = new AbortController();

  if (signal?.aborted) {
    abortedByUser = true;
    controller.abort();
  } else if (signal?.addEventListener) {
    signal.addEventListener('abort', () => {
      abortedByUser = true;
      controller.abort();
    }, { once: true });
  }

  timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const emitMappedEvent = (event = {}) => {
    if (typeof onEvent !== 'function' || !event || typeof event !== 'object') {
      return;
    }
    if (terminalSeen && event.type !== 'done' && event.type !== 'error') {
      return;
    }
    onEvent(event);
    if (event.type === 'done' || event.type === 'error') {
      terminalSeen = true;
    }
  };

  const handlePermissionRequest = (rawEvent = {}) => {
    permissionRequests += 1;
    const request = extractPermissionRequest(rawEvent);
    const requestId = normalizeText(request.requestId);
    if (!requestId) {
      return;
    }

    const resolveDecision = async () => {
      const decisionPayload =
        permissionMode === 'ask'
          ? await resolveAskDecision({
              request,
              backend,
              transport: 'http',
              sessionId,
              turnId,
              askTimeoutMs,
              resolvePermissionRequest,
            })
          : createPermissionDecision(permissionMode);
      if (decisionPayload.decision !== 'allow') {
        permissionDeniedCount += 1;
      }
      debugLogger(
        emitDebugLog,
        'permission-decision',
        'Resolved ACP HTTP permission request with local policy.',
        {
          backend,
          mode: permissionMode,
          requestId,
          decision: decisionPayload.decision,
          reason: decisionPayload.reason,
          toolName: request.toolName,
          permission: request.permission,
        },
      );

      await sendPermissionDecision({
        endpoint: permissionEndpoint,
        headers,
        turnId,
        requestId,
        decision: decisionPayload.decision,
        reason: decisionPayload.reason,
        emitDebugLog,
      });
    };

    void resolveDecision();
  };

  const handleAcpPayload = (rawPayload = {}) => {
    if (!rawPayload || typeof rawPayload !== 'object') {
      return;
    }

    if (isPermissionRequestEvent(rawPayload)) {
      handlePermissionRequest(rawPayload);
    }

    const mapped = mapAcpEventToChatEvent(rawPayload, { source: backend });
    if (!mapped) {
      return;
    }

    emitMappedEvent(mapped);
  };

  const handleTextLine = (line = '') => {
    const parsed = parseJson(line);
    if (parsed) {
      handleAcpPayload(parsed);
      return;
    }

    const text = normalizeText(line);
    if (!text) {
      return;
    }

    emitMappedEvent({
      type: 'text-delta',
      payload: {
        content: text,
        source: backend,
      },
    });
  };

  const finalize = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = null;

    debugLogger(
      emitDebugLog,
      'stream-summary',
      'Completed ACP HTTP stream session.',
      {
        backend,
        transport: 'http',
        endpoint,
        latencyMs: Date.now() - startedAt,
        timedOut,
        permissionRequests,
        permissionDeniedCount,
        terminalSeen,
      },
    );
  };

  try {
    debugLogger(emitDebugLog, 'stream-start', 'Starting ACP HTTP stream.', {
      backend,
      endpoint,
      timeoutMs,
      permissionMode,
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/x-ndjson, text/event-stream, application/json, text/plain',
        ...headers,
      },
      body: JSON.stringify({
        protocolVersion: 'acp.v1',
        type: 'start-turn',
        turnId,
        sessionId,
        backend,
        content,
        options,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw createAcpError(
        `${backend}_http_status_${response.status}`,
        `${backend} HTTP stream request failed (${response.status}).`,
        response.status,
      );
    }

    const contentType = normalizeText(response.headers.get('content-type')).toLowerCase();
    const isSse = contentType.includes('text/event-stream');
    const isJson = contentType.includes('application/json') && !contentType.includes('ndjson');

    if (isJson) {
      const text = await response.text();
      const parsed = parseJson(text);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          handleAcpPayload(item);
        }
      } else if (parsed && Array.isArray(parsed.events)) {
        for (const item of parsed.events) {
          handleAcpPayload(item);
        }
      } else if (parsed && typeof parsed === 'object') {
        handleAcpPayload(parsed);
      } else {
        handleTextLine(text);
      }
    } else if (isSse) {
      let dataLines = [];
      const flushSseData = () => {
        if (!dataLines.length) {
          return;
        }
        const payloadText = dataLines.join('\n').trim();
        dataLines = [];
        if (!payloadText) {
          return;
        }
        if (payloadText === '[DONE]') {
          emitMappedEvent({
            type: 'done',
            payload: {
              source: backend,
              finishReason: 'completed',
            },
          });
          return;
        }

        handleTextLine(payloadText);
      };

      await consumeTextLinesFromStream(response.body, (line) => {
        const raw = line.replace(/\r/g, '');
        if (!raw) {
          flushSseData();
          return;
        }
        if (!raw.startsWith('data:')) {
          return;
        }
        dataLines.push(raw.slice('data:'.length).trimStart());
      });
      flushSseData();
    } else {
      await consumeTextLinesFromStream(response.body, (line) => {
        handleTextLine(line);
      });
    }

    if (!terminalSeen) {
      throw createAcpError(
        'acp_stream_closed',
        `${backend} ACP HTTP stream closed unexpectedly.`,
      );
    }
  } catch (error) {
    if (timedOut) {
      throw createAcpError(
        'acp_stream_timeout',
        `${backend} ACP stream timed out (${timeoutMs} ms).`,
      );
    }

    const isAbortError = error?.name === 'AbortError';
    if (abortedByUser && isAbortError) {
      const abortError = new Error('stream aborted');
      abortError.name = 'AbortError';
      abortError.code = 'aborted';
      throw abortError;
    }

    throw error;
  } finally {
    finalize();
  }
}

async function testAcpHttpRunner({
  backend = 'acp',
  settings = {},
  signal,
} = {}) {
  const normalizedSettings = normalizeAcpBackendSettings(settings);
  const runner = normalizedSettings.runner || {};
  const endpoint = normalizeText(runner.endpoint);
  const headers = normalizeHeaders(runner.headers);
  const timeoutMs = Math.min(normalizedSettings.timeoutMs, 15_000);

  if (!endpoint) {
    throw createAcpError(
      `${backend}_runner_missing_endpoint`,
      `${backend} backend HTTP endpoint is required.`,
    );
  }

  const controller = new AbortController();
  let timeoutId = null;
  let abortedByUser = false;
  const startedAt = Date.now();

  if (signal?.aborted) {
    abortedByUser = true;
    controller.abort();
  } else if (signal?.addEventListener) {
    signal.addEventListener('abort', () => {
      abortedByUser = true;
      controller.abort();
    }, { once: true });
  }

  timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        protocolVersion: 'acp.v1',
        type: 'health-check',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw createAcpError(
        `${backend}_http_status_${response.status}`,
        `${backend} HTTP connection test failed (${response.status}).`,
        response.status,
      );
    }

    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (abortedByUser) {
        throw createAcpError('aborted', 'stream aborted');
      }
      throw createAcpError(
        'acp_test_timeout',
        `${backend} connection test timed out (${timeoutMs} ms).`,
      );
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = null;
  }
}

module.exports = {
  runAcpHttpStream,
  testAcpHttpRunner,
};
