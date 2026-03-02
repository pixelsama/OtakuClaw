const { randomUUID } = require('node:crypto');
const { startOpenClawStream, toClientError } = require('../services/openclawClient');

function registerChatStreamIpc({ ipcMain, emitEvent, getSettings, startStream = startOpenClawStream }) {
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
    try {
      await startStream({
        settings: getSettings(),
        sessionId: request.sessionId,
        content: request.content,
        options: request.options || {},
        signal: state.controller.signal,
        onEvent: (event) => {
          if (state.settled) {
            return;
          }

          if (event.type === 'done') {
            completeStream(streamId, event.payload || { source: 'openclaw' });
            return;
          }

          if (event.type === 'error') {
            failStream(streamId, event.payload || toClientError(new Error('upstream error')));
            return;
          }

          if (event.type === 'text-delta') {
            sendEvent(streamId, 'text-delta', event.payload || {});
          }
        },
      });

      completeStream(streamId, { source: 'openclaw' });
    } catch (error) {
      if (state.aborted || error?.name === 'AbortError') {
        completeStream(streamId, { source: 'openclaw', aborted: true });
      } else {
        failStream(streamId, toClientError(error));
      }
    } finally {
      streamMap.delete(streamId);
    }
  };

  ipcMain.handle('chat:stream:start', async (_event, request = {}) => {
    const content = typeof request.content === 'string' ? request.content.trim() : '';
    const sessionId = typeof request.sessionId === 'string' ? request.sessionId : 'default';

    if (!content) {
      throw new Error('content is required');
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
        options: request.options || {},
      },
      state,
    );

    return { streamId };
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

  return () => {
    for (const [, state] of streamMap.entries()) {
      state.aborted = true;
      state.controller.abort();
    }
    streamMap.clear();
  };
}

module.exports = {
  registerChatStreamIpc,
};
