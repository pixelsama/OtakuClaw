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

function debugLogger(emitDebugLog, stage, message, details = undefined) {
  if (typeof emitDebugLog !== 'function') {
    return;
  }

  emitDebugLog({
    source: 'acp-websocket-client',
    stage,
    message,
    details,
  });
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

function resolveWebSocketCtor() {
  if (typeof WebSocket === 'function') {
    return WebSocket;
  }

  try {
    // eslint-disable-next-line global-require
    return require('ws');
  } catch {
    return null;
  }
}

function bindSocketEvent(socket, eventName, handler) {
  if (!socket || typeof handler !== 'function') {
    return () => {};
  }

  if (typeof socket.addEventListener === 'function') {
    socket.addEventListener(eventName, handler);
    return () => {
      if (typeof socket.removeEventListener === 'function') {
        socket.removeEventListener(eventName, handler);
      }
    };
  }

  if (typeof socket.on === 'function') {
    socket.on(eventName, handler);
    return () => {
      if (typeof socket.off === 'function') {
        socket.off(eventName, handler);
      } else if (typeof socket.removeListener === 'function') {
        socket.removeListener(eventName, handler);
      }
    };
  }

  return () => {};
}

async function messageToText(value) {
  const source =
    value && typeof value === 'object' && 'data' in value
      ? value.data
      : value;

  if (typeof source === 'string') {
    return source;
  }

  if (Buffer.isBuffer(source)) {
    return source.toString('utf-8');
  }

  if (source instanceof ArrayBuffer) {
    return Buffer.from(source).toString('utf-8');
  }

  if (ArrayBuffer.isView(source)) {
    return Buffer.from(source.buffer, source.byteOffset, source.byteLength).toString('utf-8');
  }

  if (source && typeof source.text === 'function') {
    try {
      const text = await source.text();
      return typeof text === 'string' ? text : '';
    } catch {
      return '';
    }
  }

  return '';
}

function closeSocket(socket) {
  if (!socket || typeof socket.close !== 'function') {
    return;
  }

  try {
    socket.close();
  } catch {
    // Ignore close failures.
  }
}

function sendJson(socket, payload) {
  if (!socket || typeof socket.send !== 'function') {
    return false;
  }

  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

async function runAcpWebSocketStream({
  backend = 'acp',
  settings = {},
  sessionId,
  content,
  options = {},
  signal,
  onEvent,
  emitDebugLog,
} = {}) {
  const normalizedSettings = normalizeAcpBackendSettings(settings);
  const runner = normalizedSettings.runner || {};
  const url = normalizeText(runner.url);
  const timeoutMs = normalizedSettings.timeoutMs;
  const askTimeoutMs = normalizedSettings.askTimeoutMs;
  const permissionMode = normalizedSettings.permissionMode;

  if (!url) {
    throw createAcpError(
      `${backend}_runner_missing_url`,
      `${backend} backend WebSocket URL is required.`,
    );
  }

  const WebSocketCtor = resolveWebSocketCtor();
  if (!WebSocketCtor) {
    throw createAcpError(
      `${backend}_runner_websocket_unavailable`,
      `${backend} backend WebSocket transport is unavailable in this runtime.`,
    );
  }

  await new Promise((resolve, reject) => {
    const turnId = randomUUID();
    const startedAt = Date.now();
    let socket = null;
    let settled = false;
    let terminalSeen = false;
    let timedOut = false;
    let abortedByUser = false;
    let timeoutId = null;
    let openAt = 0;
    let lastError = null;
    let permissionRequests = 0;
    let permissionDeniedCount = 0;
    let askTimerByRequestId = new Map();
    let unsubscribeHandlers = [];

    const finalize = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = null;

      for (const timer of askTimerByRequestId.values()) {
        clearTimeout(timer);
      }
      askTimerByRequestId = new Map();

      for (const dispose of unsubscribeHandlers) {
        try {
          dispose();
        } catch {
          // Ignore detach errors.
        }
      }
      unsubscribeHandlers = [];

      debugLogger(
        emitDebugLog,
        'stream-summary',
        'Completed ACP WebSocket stream session.',
        {
          backend,
          transport: 'websocket',
          url,
          latencyMs: Date.now() - startedAt,
          connectedMs: openAt > 0 ? Date.now() - openAt : 0,
          timedOut,
          permissionRequests,
          permissionDeniedCount,
          terminalSeen,
          abortedByUser,
        },
      );
    };

    const settle = (error = null) => {
      if (settled) {
        return;
      }
      settled = true;
      finalize();

      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

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

    const onPermissionRequest = (rawEvent = {}) => {
      permissionRequests += 1;
      const request = extractPermissionRequest(rawEvent);
      const requestId = normalizeText(request.requestId);
      if (!requestId) {
        return;
      }

      const sendDecision = () => {
        const decisionPayload = createPermissionDecision(permissionMode);
        if (decisionPayload.decision !== 'allow') {
          permissionDeniedCount += 1;
        }

        debugLogger(
          emitDebugLog,
          'permission-decision',
          'Resolved ACP WebSocket permission request with local policy.',
          {
            backend,
            mode: permissionMode,
            requestId,
            permission: request.permission,
            toolName: request.toolName,
            decision: decisionPayload.decision,
            reason: decisionPayload.reason,
          },
        );

        sendJson(socket, {
          protocolVersion: 'acp.v1',
          type: 'permission-response',
          turnId,
          requestId,
          decision: decisionPayload.decision,
          reason: decisionPayload.reason,
        });
      };

      if (permissionMode === 'ask') {
        const timer = setTimeout(() => {
          askTimerByRequestId.delete(requestId);
          sendDecision();
        }, askTimeoutMs);
        askTimerByRequestId.set(requestId, timer);
        return;
      }

      sendDecision();
    };

    const handleIncomingPayload = (payload = {}) => {
      if (!payload || typeof payload !== 'object') {
        return;
      }

      if (isPermissionRequestEvent(payload)) {
        onPermissionRequest(payload);
      }

      const mapped = mapAcpEventToChatEvent(payload, { source: backend });
      if (!mapped) {
        return;
      }

      emitMappedEvent(mapped);
      if (terminalSeen) {
        closeSocket(socket);
      }
    };

    const handleIncomingText = (text = '') => {
      const parsed = parseJson(text);
      if (parsed) {
        handleIncomingPayload(parsed);
        return;
      }

      const plainText = normalizeText(text);
      if (!plainText) {
        return;
      }

      emitMappedEvent({
        type: 'text-delta',
        payload: {
          content: plainText,
          source: backend,
        },
      });
    };

    timeoutId = setTimeout(() => {
      timedOut = true;
      sendJson(socket, {
        protocolVersion: 'acp.v1',
        type: 'abort-turn',
        turnId,
        reason: 'timeout',
      });
      closeSocket(socket);
    }, timeoutMs);

    if (signal?.aborted) {
      abortedByUser = true;
    } else if (signal?.addEventListener) {
      signal.addEventListener('abort', () => {
        if (settled) {
          return;
        }
        abortedByUser = true;
        sendJson(socket, {
          protocolVersion: 'acp.v1',
          type: 'abort-turn',
          turnId,
          reason: 'aborted',
        });
        closeSocket(socket);
      }, { once: true });
    }

    try {
      socket = new WebSocketCtor(url);
    } catch (error) {
      settle(
        createAcpError(
          `${backend}_runner_spawn_failed`,
          error?.message || `Failed to open ACP WebSocket transport for ${backend}.`,
        ),
      );
      return;
    }

    unsubscribeHandlers.push(
      bindSocketEvent(socket, 'open', () => {
        openAt = Date.now();
        debugLogger(emitDebugLog, 'stream-start', 'ACP WebSocket connected for stream.', {
          backend,
          url,
        });
        sendJson(socket, {
          protocolVersion: 'acp.v1',
          type: 'start-turn',
          turnId,
          sessionId,
          backend,
          content,
          options,
        });
      }),
      bindSocketEvent(socket, 'message', (event) => {
        if (settled) {
          return;
        }
        void messageToText(event).then((text) => {
          if (settled) {
            return;
          }
          handleIncomingText(text);
        });
      }),
      bindSocketEvent(socket, 'error', (event) => {
        lastError = event?.error || event || new Error('websocket error');
      }),
      bindSocketEvent(socket, 'close', () => {
        if (settled) {
          return;
        }

        if (terminalSeen) {
          settle();
          return;
        }

        if (timedOut) {
          settle(
            createAcpError(
              'acp_stream_timeout',
              `${backend} ACP stream timed out (${timeoutMs} ms).`,
            ),
          );
          return;
        }

        if (abortedByUser) {
          const abortError = new Error('stream aborted');
          abortError.name = 'AbortError';
          abortError.code = 'aborted';
          settle(abortError);
          return;
        }

        settle(
          createAcpError(
            'acp_stream_closed',
            lastError?.message || `${backend} ACP WebSocket stream closed unexpectedly.`,
          ),
        );
      }),
    );

    if (abortedByUser) {
      sendJson(socket, {
        protocolVersion: 'acp.v1',
        type: 'abort-turn',
        turnId,
        reason: 'aborted',
      });
      closeSocket(socket);
    }
  });
}

async function testAcpWebSocketRunner({
  backend = 'acp',
  settings = {},
  signal,
} = {}) {
  const normalizedSettings = normalizeAcpBackendSettings(settings);
  const runner = normalizedSettings.runner || {};
  const url = normalizeText(runner.url);
  const timeoutMs = Math.min(normalizedSettings.timeoutMs, 15_000);

  if (!url) {
    throw createAcpError(
      `${backend}_runner_missing_url`,
      `${backend} backend WebSocket URL is required.`,
    );
  }

  const WebSocketCtor = resolveWebSocketCtor();
  if (!WebSocketCtor) {
    throw createAcpError(
      `${backend}_runner_websocket_unavailable`,
      `${backend} backend WebSocket transport is unavailable in this runtime.`,
    );
  }

  return new Promise((resolve, reject) => {
    let socket = null;
    let settled = false;
    let timeoutId = null;
    let abortedByUser = false;
    const startedAt = Date.now();

    const settle = (error = null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = null;
      closeSocket(socket);
      if (error) {
        reject(error);
        return;
      }
      resolve({
        ok: true,
        latencyMs: Date.now() - startedAt,
      });
    };

    timeoutId = setTimeout(() => {
      settle(
        createAcpError(
          'acp_test_timeout',
          `${backend} connection test timed out (${timeoutMs} ms).`,
        ),
      );
    }, timeoutMs);

    if (signal?.aborted) {
      abortedByUser = true;
    } else if (signal?.addEventListener) {
      signal.addEventListener('abort', () => {
        if (settled) {
          return;
        }
        abortedByUser = true;
        settle(createAcpError('aborted', 'stream aborted'));
      }, { once: true });
    }

    try {
      socket = new WebSocketCtor(url);
    } catch (error) {
      settle(
        createAcpError(
          `${backend}_runner_spawn_failed`,
          error?.message || `Failed to open ACP WebSocket transport for ${backend}.`,
        ),
      );
      return;
    }

    bindSocketEvent(socket, 'open', () => {
      if (abortedByUser) {
        settle(createAcpError('aborted', 'stream aborted'));
        return;
      }
      settle();
    });

    bindSocketEvent(socket, 'error', (event) => {
      settle(
        createAcpError(
          `${backend}_runner_spawn_failed`,
          event?.error?.message
            || event?.message
            || `Failed to open ACP WebSocket transport for ${backend}.`,
        ),
      );
    });
  });
}

module.exports = {
  runAcpWebSocketStream,
  testAcpWebSocketRunner,
};
