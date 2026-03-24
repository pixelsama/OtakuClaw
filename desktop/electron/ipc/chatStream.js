const { randomUUID } = require('node:crypto');
const { createChatBackendManager } = require('../services/chat/backendManager');
const { createChatSegmentEmitter } = require('../services/chat/segmenter');

function registerChatStreamIpc({
  ipcMain,
  emitEvent,
  emitDebugLog,
  getSettings,
  startStream,
  backendManager = createChatBackendManager(),
}) {
  const streamMap = new Map();
  const permissionPendingMap = new Map();
  const permissionRequestIdsByStreamId = new Map();
  const debug = (payload = {}) => {
    if (typeof emitDebugLog !== 'function') {
      return;
    }
    emitDebugLog({
      source: 'chat-stream',
      ...payload,
    });
  };
  const normalizeInputSource = (value) => {
    if (typeof value !== 'string') {
      return 'text-composer';
    }
    const normalized = value.trim();
    return normalized || 'text-composer';
  };

  const normalizePermissionDecision = (value, fallback = 'deny') => {
    if (typeof value !== 'string') {
      return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'allow' || normalized === 'deny') {
      return normalized;
    }
    return fallback;
  };

  const normalizePermissionText = (value, fallback = '') =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback;

  const settlePermissionRequest = (permissionRequestId, decision, reason) => {
    const pending = permissionPendingMap.get(permissionRequestId);
    if (!pending) {
      return false;
    }

    permissionPendingMap.delete(permissionRequestId);
    const streamRequestIds = permissionRequestIdsByStreamId.get(pending.streamId);
    if (streamRequestIds) {
      streamRequestIds.delete(permissionRequestId);
      if (streamRequestIds.size === 0) {
        permissionRequestIdsByStreamId.delete(pending.streamId);
      }
    }

    if (pending.timerId) {
      clearTimeout(pending.timerId);
    }

    pending.resolve({
      decision: normalizePermissionDecision(decision, 'deny'),
      reason: normalizePermissionText(reason, decision === 'allow' ? 'user_allow' : 'user_deny'),
    });
    return true;
  };

  const clearPermissionRequestsForStream = (streamId, reason = 'stream_settled') => {
    if (!streamId || typeof streamId !== 'string') {
      return;
    }

    const permissionRequestIds = permissionRequestIdsByStreamId.get(streamId);
    if (!permissionRequestIds || permissionRequestIds.size === 0) {
      permissionRequestIdsByStreamId.delete(streamId);
      return;
    }

    for (const permissionRequestId of [...permissionRequestIds]) {
      settlePermissionRequest(permissionRequestId, 'deny', reason);
    }
    permissionRequestIdsByStreamId.delete(streamId);
  };

  const sendEvent = (streamId, type, payload = {}) => {
    emitEvent({
      streamId,
      type,
      payload,
    });
  };

  const completeStream = (streamId, payload = {}) => {
    const state = streamMap.get(streamId);
    if (!state || state.settled) {
      return;
    }

    state.settled = true;
    clearPermissionRequestsForStream(streamId, 'stream_done');
    sendEvent(streamId, 'done', payload);
  };

  const failStream = (streamId, errorPayload) => {
    const state = streamMap.get(streamId);
    if (!state || state.settled) {
      return;
    }

    state.settled = true;
    clearPermissionRequestsForStream(streamId, 'stream_error');
    sendEvent(streamId, 'error', errorPayload);
  };

  const createPermissionRequestResolver = ({
    streamId,
    sessionId,
    inputSource,
    backend,
  }) =>
    async (permissionPayload = {}) => {
      const source =
        permissionPayload && typeof permissionPayload === 'object'
          ? permissionPayload
          : {};
      const request =
        source.request && typeof source.request === 'object'
          ? source.request
          : source;

      const requestId = normalizePermissionText(request.requestId);
      const permissionRequestId = randomUUID();
      const askTimeoutMs = Number.isFinite(source.askTimeoutMs) && source.askTimeoutMs > 0
        ? Math.min(Math.floor(source.askTimeoutMs), 60_000)
        : 8_000;

      const streamRequestIds = permissionRequestIdsByStreamId.get(streamId) || new Set();
      streamRequestIds.add(permissionRequestId);
      permissionRequestIdsByStreamId.set(streamId, streamRequestIds);

      const result = await new Promise((resolve) => {
        const timerId = setTimeout(() => {
          settlePermissionRequest(permissionRequestId, 'deny', 'user_timeout');
        }, askTimeoutMs);

        permissionPendingMap.set(permissionRequestId, {
          streamId,
          requestId,
          resolve,
          timerId,
        });

        sendEvent(streamId, 'permission-request', {
          sessionId,
          turnId: streamId,
          inputSource,
          backend: normalizePermissionText(source.backend, backend),
          transport: normalizePermissionText(source.transport),
          permissionRequestId,
          requestId,
          permission: normalizePermissionText(request.permission),
          toolName: normalizePermissionText(request.toolName),
          reason: normalizePermissionText(request.reason),
          askTimeoutMs,
        });
      });

      return {
        decision: normalizePermissionDecision(result?.decision, 'deny'),
        reason: normalizePermissionText(result?.reason, 'user_deny'),
      };
    };

  const runStream = async (streamId, request, state) => {
    let source = 'nanobot';
    const inputSource = normalizeInputSource(request?.options?.source);
    const buildTurnPayload = (payload = {}) => ({
      sessionId: request.sessionId,
      turnId: streamId,
      inputSource,
      ...payload,
    });
    const segmentEmitter = createChatSegmentEmitter({
      streamId,
      sessionId: request.sessionId,
      emitReady: (payload) => {
        sendEvent(
          streamId,
          'segment-ready',
          buildTurnPayload(payload),
        );
      },
    });

    try {
      const settings = getSettings();
      const backend = backendManager.resolveBackendName({
        settings,
        requestBackend: request.backend,
      });
      state.backend = backend;
      source = state.backend || source;
      if (backend === 'nanobot') {
        debug({
          stage: 'stream-start',
          message: 'Chat stream started with Nanobot backend.',
          details: {
            streamId,
            sessionId: request.sessionId,
            inputSource,
            content: request.content,
          },
        });
      }

      const streamRunner =
        typeof startStream === 'function'
          ? startStream
          : (payload) =>
              backendManager.startStream({
                ...payload,
                backend,
              });

      await streamRunner({
        backend,
        settings,
        sessionId: request.sessionId,
        content: request.content,
        options: request.options || {},
        signal: state.controller.signal,
        resolvePermissionRequest: createPermissionRequestResolver({
          streamId,
          sessionId: request.sessionId,
          inputSource,
          backend,
        }),
        onEvent: (event) => {
          if (state.settled) {
            return;
          }
          if (backend === 'nanobot') {
            debug({
              stage: 'backend-event',
              message: 'Chat stream received backend event.',
              details: {
                streamId,
                eventType: event?.type || '',
                payload: event?.payload || null,
              },
            });
          }

          if (event.type === 'done') {
            segmentEmitter.flushRemaining({ source });
            if (backend === 'nanobot') {
              debug({
                stage: 'stream-done',
                message: 'Chat stream completed with done event.',
                details: {
                  streamId,
                  payload: event.payload || {},
                },
              });
            }
            completeStream(
              streamId,
              buildTurnPayload(event.payload || { source }),
            );
            return;
          }

          if (event.type === 'error') {
            if (backend === 'nanobot') {
              debug({
                stage: 'stream-error',
                message: 'Chat stream received error event.',
                details: {
                  streamId,
                  payload: event.payload || null,
                },
              });
            }
            failStream(
              streamId,
              buildTurnPayload(
                event.payload ||
                  backendManager.mapError(new Error('upstream error'), {
                    backend: state.backend,
                  }),
              ),
            );
            return;
          }

          if (event.type === 'agent-state') {
            const payload = event.payload || {};
            if (backend === 'nanobot') {
              debug({
                stage: 'agent-state-forward',
                message: 'Forwarding structured agent state to renderer.',
                details: {
                  streamId,
                  payload,
                },
              });
            }
            sendEvent(
              streamId,
              'agent-state',
              buildTurnPayload(payload),
            );
            return;
          }

          if (event.type === 'text-delta') {
            const payload = event.payload || {};
            if (backend === 'nanobot') {
              debug({
                stage: 'text-delta-forward',
                message: 'Forwarding text-delta to renderer.',
                details: {
                  streamId,
                  payload,
                },
              });
            }
            sendEvent(
              streamId,
              'text-delta',
              buildTurnPayload(payload),
            );
            if (typeof payload.content === 'string' && payload.content) {
              segmentEmitter.ingestDelta(payload.content, {
                source: payload.source || source,
                inputSource,
              });
              if (backend === 'nanobot') {
                debug({
                  stage: 'segment-ingest',
                  message: 'Segmenter ingested Nanobot text-delta.',
                  details: {
                    streamId,
                    content: payload.content,
                  },
                });
              }
            }
            return;
          }

          const passthroughType = typeof event.type === 'string' ? event.type.trim() : '';
          if (passthroughType) {
            sendEvent(
              streamId,
              passthroughType,
              buildTurnPayload(event.payload && typeof event.payload === 'object' ? event.payload : {}),
            );
          }
        },
      });

      segmentEmitter.flushRemaining({ source, inputSource });
      if (backend === 'nanobot') {
        debug({
          stage: 'stream-finalize',
          message: 'Chat stream finalized after backend returned.',
          details: {
            streamId,
            source,
            inputSource,
          },
        });
      }
      completeStream(
        streamId,
        buildTurnPayload({ source }),
      );
    } catch (error) {
      if (state.backend === 'nanobot') {
        debug({
          stage: 'stream-catch',
          message: 'Chat stream caught terminal error.',
          details: {
            streamId,
            code: error?.code || '',
            name: error?.name || '',
            message: error?.message || '',
          },
        });
      }
      if (state.aborted || error?.name === 'AbortError') {
        completeStream(
          streamId,
          buildTurnPayload({ source, aborted: true }),
        );
      } else {
        failStream(
          streamId,
          buildTurnPayload(
            backendManager.mapError(error, {
              backend: state.backend,
            }),
          ),
        );
      }
    } finally {
      clearPermissionRequestsForStream(streamId, 'stream_disposed');
      streamMap.delete(streamId);
    }
  };

  const startChatStream = (request = {}) => {
    const content = typeof request.content === 'string' ? request.content.trim() : '';
    const sessionId = typeof request.sessionId === 'string' ? request.sessionId : 'default';

    if (!content) {
      return {
        ok: false,
        reason: 'content_required',
      };
    }

    const streamId = randomUUID();
    const state = {
      controller: new AbortController(),
      aborted: false,
      settled: false,
    };
    streamMap.set(streamId, state);

    void runStream(
      streamId,
      {
        sessionId,
        content,
        backend: typeof request.backend === 'string' ? request.backend : '',
        options: request.options || {},
      },
      state,
    );

    const fallbackBackend = typeof request.backend === 'string' && request.backend.trim()
      ? request.backend.trim()
      : '';
    const settingsBackend =
      (() => {
        try {
          return backendManager.resolveBackendName({
            settings: getSettings(),
            requestBackend: fallbackBackend,
          });
        } catch {
          return '';
        }
      })();

    return {
      ok: true,
      streamId,
      backend: fallbackBackend || settingsBackend || 'nanobot',
    };
  };

  ipcMain.handle('chat:stream:start', async (_event, request = {}) => {
    const result = startChatStream(request);
    if (!result.ok) {
      throw new Error('content is required');
    }

    return {
      streamId: result.streamId,
      backend: result.backend || '',
    };
  });

  ipcMain.handle('chat:stream:abort', async (_event, request = {}) => {
    const streamId = request?.streamId;
    if (typeof streamId !== 'string' || !streamId) {
      return { ok: false, reason: 'invalid_stream_id' };
    }

    const state = streamMap.get(streamId);
    if (!state) {
      return { ok: true, reason: 'not_found' };
    }

    state.aborted = true;
    state.controller.abort();
    return { ok: true };
  });

  const dispose = () => {
    for (const [, state] of streamMap.entries()) {
      state.aborted = true;
      state.controller.abort();
    }
    for (const permissionRequestId of [...permissionPendingMap.keys()]) {
      settlePermissionRequest(permissionRequestId, 'deny', 'stream_disposed');
    }
    permissionPendingMap.clear();
    permissionRequestIdsByStreamId.clear();
    streamMap.clear();
  };

  dispose.start = async (request = {}) => startChatStream(request);
  dispose.abort = async ({ streamId } = {}) => {
    if (typeof streamId !== 'string' || !streamId) {
      return { ok: false, reason: 'invalid_stream_id' };
    }

    const state = streamMap.get(streamId);
    if (!state) {
      return { ok: true, reason: 'not_found' };
    }

    state.aborted = true;
    state.controller.abort();
    return { ok: true };
  };
  dispose.resolvePermissionRequest = async ({
    permissionRequestId,
    decision,
    reason,
  } = {}) => {
    const normalizedPermissionRequestId = normalizePermissionText(permissionRequestId);
    if (!normalizedPermissionRequestId) {
      return { ok: false, reason: 'permission_request_id_required' };
    }

    const accepted = settlePermissionRequest(
      normalizedPermissionRequestId,
      normalizePermissionDecision(decision, 'deny'),
      normalizePermissionText(reason, normalizePermissionDecision(decision, 'deny') === 'allow' ? 'user_allow' : 'user_deny'),
    );
    if (!accepted) {
      return { ok: false, reason: 'permission_request_not_found' };
    }

    return { ok: true };
  };

  return dispose;
}

module.exports = {
  registerChatStreamIpc,
};
