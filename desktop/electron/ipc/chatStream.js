const { randomUUID } = require('node:crypto');
const { createChatBackendManager } = require('../services/chat/backendManager');
const { createChatSegmentEmitter } = require('../services/chat/segmenter');

function registerChatStreamIpc({
  ipcMain,
  emitEvent,
  getSettings,
  startStream,
  backendManager = createChatBackendManager(),
}) {
  const streamMap = new Map();

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
    sendEvent(streamId, 'done', payload);
  };

  const failStream = (streamId, errorPayload) => {
    const state = streamMap.get(streamId);
    if (!state || state.settled) {
      return;
    }

    state.settled = true;
    sendEvent(streamId, 'error', errorPayload);
  };

  const runStream = async (streamId, request, state) => {
    let source = 'openclaw';
    const buildTurnPayload = (payload = {}) => ({
      sessionId: request.sessionId,
      turnId: streamId,
      ...payload,
    });
    const segmentEmitter = createChatSegmentEmitter({
      streamId,
      sessionId: request.sessionId,
      emitReady: (payload) => {
        sendEvent(streamId, 'segment-ready', payload);
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
        onEvent: (event) => {
          if (state.settled) {
            return;
          }

          if (event.type === 'done') {
            segmentEmitter.flushRemaining({ source });
            completeStream(
              streamId,
              buildTurnPayload(event.payload || { source }),
            );
            return;
          }

          if (event.type === 'error') {
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

          if (event.type === 'text-delta') {
            const payload = event.payload || {};
            sendEvent(streamId, 'text-delta', payload);
            if (typeof payload.content === 'string' && payload.content) {
              segmentEmitter.ingestDelta(payload.content, {
                source: payload.source || source,
              });
            }
          }
        },
      });

      segmentEmitter.flushRemaining({ source });
      completeStream(
        streamId,
        buildTurnPayload({ source }),
      );
    } catch (error) {
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

    return {
      ok: true,
      streamId,
    };
  };

  ipcMain.handle('chat:stream:start', async (_event, request = {}) => {
    const result = startChatStream(request);
    if (!result.ok) {
      throw new Error('content is required');
    }

    return { streamId: result.streamId };
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
    streamMap.clear();
  };

  dispose.start = async (request = {}) => startChatStream(request);

  return dispose;
}

module.exports = {
  registerChatStreamIpc,
};
