import { useEffect, useState } from 'react';
import { desktopBridge } from '../services/desktopBridge.js';
import { parseSseChunk } from '../services/sseClient.js';

const deltaHandlers = new Set();
const segmentHandlers = new Set();
const doneHandlers = new Set();
const errorHandlers = new Set();
const statusHandlers = new Set();

const desktopPendingMap = new Map();
const desktopBufferedEvents = new Map();
const desktopBufferTimers = new Map();
let desktopEventCleanup = null;
let activeDesktopStreamId = null;

let isStreamingState = false;
let abortController = null;

const DESKTOP_EVENT_BUFFER_TTL_MS = 30_000;

const stripTrailingSlash = (value) => (value.endsWith('/') ? value.slice(0, -1) : value);
const ensurePrefixedSlash = (value) => (value.startsWith('/') ? value : `/${value}`);

const apiBase = (() => {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!raw) return '';
  return stripTrailingSlash(raw);
})();

const streamPath = (() => {
  const raw = import.meta.env.VITE_STREAM_PATH?.trim() || 'chat/stream';
  return ensurePrefixedSlash(raw);
})();

const buildStreamUrl = () => `${apiBase}${streamPath}`;

const setStreamingState = (next) => {
  isStreamingState = next;
  statusHandlers.forEach((handler) => {
    try {
      handler(next);
    } catch (error) {
      console.error('Streaming status handler failed:', error);
    }
  });
};

const notifyHandlers = (handlers, payload) => {
  handlers.forEach((handler) => {
    try {
      handler(payload);
    } catch (error) {
      console.error('Streaming handler error:', error);
    }
  });
};

const clearDesktopBufferTimer = (streamId) => {
  const timer = desktopBufferTimers.get(streamId);
  if (timer) {
    clearTimeout(timer);
    desktopBufferTimers.delete(streamId);
  }
};

const bufferDesktopEvent = (streamId, event) => {
  const buffered = desktopBufferedEvents.get(streamId) || [];
  buffered.push(event);
  desktopBufferedEvents.set(streamId, buffered);

  clearDesktopBufferTimer(streamId);
  const timer = setTimeout(() => {
    desktopBufferedEvents.delete(streamId);
    desktopBufferTimers.delete(streamId);
  }, DESKTOP_EVENT_BUFFER_TTL_MS);
  desktopBufferTimers.set(streamId, timer);
};

const consumeBufferedDesktopEvents = (streamId) => {
  clearDesktopBufferTimer(streamId);
  const buffered = desktopBufferedEvents.get(streamId) || [];
  desktopBufferedEvents.delete(streamId);
  return buffered;
};

const resolveDesktopPending = (streamId, pending, endedBy, payload = null) => {
  const isActiveStream = activeDesktopStreamId === streamId;
  if (endedBy === 'done') {
    pending.emitDone(payload);
  }
  pending.resolve({ endedBy });
  desktopPendingMap.delete(streamId);
  if (isActiveStream) {
    activeDesktopStreamId = null;
  }
  if (pending.adopted && isActiveStream) {
    setStreamingState(false);
  }
};

const handleDesktopEvent = (streamId, type, payload, pending) => {
  if (type === 'segment-ready') {
    notifyHandlers(segmentHandlers, payload || {});
    return;
  }

  if (type === 'text-delta') {
    if (payload?.content) {
      notifyHandlers(deltaHandlers, payload.content);
    }
    return;
  }

  if (type === 'error') {
    notifyHandlers(errorHandlers, payload);
    resolveDesktopPending(streamId, pending, 'error');
    return;
  }

  if (type === 'done') {
    resolveDesktopPending(streamId, pending, 'done', payload || null);
  }
};

export function shouldAutoAdoptDesktopStreamEvent({
  streamId,
  type,
  payload,
  hasPending = false,
  activeStreamId = null,
} = {}) {
  if (!streamId || hasPending) {
    return false;
  }

  if (type !== 'segment-ready' && type !== 'text-delta' && type !== 'done' && type !== 'error') {
    return false;
  }

  if (activeStreamId && activeStreamId !== streamId) {
    return false;
  }

  const inputSource = typeof payload?.inputSource === 'string' ? payload.inputSource.trim() : '';
  // Only auto-adopt background voice-asr streams. Text streams must bind explicitly via start().
  if (inputSource !== 'voice-asr') {
    return false;
  }

  return true;
}

const shouldAdoptDesktopEvent = (streamId, type, payload) =>
  shouldAutoAdoptDesktopStreamEvent({
    streamId,
    type,
    payload,
    hasPending: desktopPendingMap.has(streamId),
    activeStreamId: activeDesktopStreamId,
  });

const createAdoptedDesktopPending = (streamId) => ({
  adopted: true,
  emitDone: (payload) => {
    notifyHandlers(doneHandlers, payload);
  },
  resolve: () => {
    // no-op: adopted stream lifecycle is handled in resolveDesktopPending
  },
  streamId,
});

const processSseEvent = (eventType, data, emitDone) => {
  if (!data && eventType !== 'done') {
    return;
  }

  if (eventType === 'segment-ready' || eventType === 'segment.ready') {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') {
        notifyHandlers(segmentHandlers, parsed);
      }
    } catch (error) {
      console.error('Failed to parse segment-ready payload:', error, data);
    }
    return;
  }

  if (eventType === 'text-delta') {
    try {
      const parsed = JSON.parse(data);
      if (parsed?.content) {
        notifyHandlers(deltaHandlers, parsed.content);
      }
    } catch (error) {
      console.error('Failed to parse text-delta payload:', error, data);
    }
    return;
  }

  if (eventType === 'done') {
    try {
      const parsed = data ? JSON.parse(data) : null;
      emitDone(parsed);
    } catch (error) {
      console.error('Failed to parse done payload:', error, data);
      emitDone(null);
    }
    return;
  }

  if (eventType === 'error') {
    notifyHandlers(errorHandlers, data);
  }
};

const ensureDesktopEventListener = () => {
  if (!desktopBridge.isDesktop() || desktopEventCleanup) {
    return;
  }

  desktopEventCleanup = desktopBridge.chat.onEvent((event = {}) => {
    const { streamId, type, payload } = event;
    if (!streamId || !type) {
      return;
    }

    const pending = desktopPendingMap.get(streamId);
    if (!pending) {
      if (shouldAdoptDesktopEvent(streamId, type, payload)) {
        const adoptedPending = createAdoptedDesktopPending(streamId);
        desktopPendingMap.set(streamId, adoptedPending);
        activeDesktopStreamId = streamId;
        setStreamingState(true);
        handleDesktopEvent(streamId, type, payload, adoptedPending);
        return;
      }

      bufferDesktopEvent(streamId, { type, payload });
      return;
    }

    handleDesktopEvent(streamId, type, payload, pending);
  });
};

const startDesktopStreaming = async (sessionId, content, extras, emitDone) => {
  ensureDesktopEventListener();

  if (activeDesktopStreamId) {
    try {
      await desktopBridge.chat.abort({ streamId: activeDesktopStreamId });
    } catch (error) {
      console.warn('Abort previous desktop stream failed:', error);
    }
  }

  const startResult = await desktopBridge.chat.start({
    sessionId,
    content,
    options: extras?.options || {},
  });

  const streamId = startResult?.streamId;
  if (!streamId) {
    throw new Error('desktop_stream_start_failed');
  }

  activeDesktopStreamId = streamId;

  await new Promise((resolve) => {
    const pending = {
      emitDone,
      resolve,
    };
    desktopPendingMap.set(streamId, pending);

    const bufferedEvents = consumeBufferedDesktopEvents(streamId);
    for (const bufferedEvent of bufferedEvents) {
      handleDesktopEvent(streamId, bufferedEvent.type, bufferedEvent.payload, pending);
      if (!desktopPendingMap.has(streamId)) {
        break;
      }
    }
  });
};

const startWebStreaming = async (sessionId, content, extras, emitDone) => {
  if (abortController) {
    abortController.abort();
  }

  abortController = new AbortController();

  const payload = {
    session_id: sessionId,
    content,
    ...extras,
  };

  const response = await fetch(buildStreamUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: abortController.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`流式接口请求失败: ${response.status}`);
  }

  const reader = response.body.getReader();
  const textDecoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += textDecoder.decode(value, { stream: true });
    buffer = parseSseChunk(buffer, (eventType, data) => {
      processSseEvent(eventType, data, emitDone);
    });
  }

  const remaining = textDecoder.decode();
  const finalBuffer = buffer + remaining;
  if (finalBuffer) {
    const tail = parseSseChunk(finalBuffer, (eventType, data) => {
      processSseEvent(eventType, data, emitDone);
    });

    // Treat a trailing unterminated event as complete when upstream closes.
    if (tail.trim()) {
      parseSseChunk(`${tail}\n\n`, (eventType, data) => {
        processSseEvent(eventType, data, emitDone);
      });
    }
  }
};

const startStreaming = async (sessionId, content, extras = {}) => {
  if (!content) {
    return;
  }

  let doneEmitted = false;

  const emitDone = (payloadData) => {
    doneEmitted = true;
    notifyHandlers(doneHandlers, payloadData);
  };

  setStreamingState(true);

  try {
    if (desktopBridge.isDesktop()) {
      await startDesktopStreaming(sessionId, content, extras, emitDone);
    } else {
      await startWebStreaming(sessionId, content, extras, emitDone);
      if (!doneEmitted) {
        emitDone(null);
      }
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error('Streaming request failed:', error);
      notifyHandlers(errorHandlers, error);
    }
  } finally {
    if (abortController?.signal?.aborted && !doneEmitted) {
      emitDone({ aborted: true });
    }

    if (!desktopBridge.isDesktop()) {
      abortController = null;
    }

    setStreamingState(false);
  }
};

const cancelStreaming = async () => {
  if (desktopBridge.isDesktop()) {
    if (activeDesktopStreamId) {
      const streamId = activeDesktopStreamId;
      activeDesktopStreamId = null;
      try {
        await desktopBridge.chat.abort({ streamId });
      } catch (error) {
        console.error('Abort desktop stream failed:', error);
      }
    }
    return;
  }

  if (abortController) {
    abortController.abort();
  }
};

const onDelta = (handler) => {
  if (typeof handler === 'function') {
    deltaHandlers.add(handler);
  }
  return () => deltaHandlers.delete(handler);
};

const onSegmentReady = (handler) => {
  if (typeof handler === 'function') {
    segmentHandlers.add(handler);
  }
  return () => segmentHandlers.delete(handler);
};

const onDone = (handler) => {
  if (typeof handler === 'function') {
    doneHandlers.add(handler);
  }
  return () => doneHandlers.delete(handler);
};

const onError = (handler) => {
  if (typeof handler === 'function') {
    errorHandlers.add(handler);
  }
  return () => errorHandlers.delete(handler);
};

export function useStreamingChat() {
  const [isStreaming, setIsStreaming] = useState(isStreamingState);

  useEffect(() => {
    const handler = (value) => setIsStreaming(value);
    statusHandlers.add(handler);
    return () => {
      statusHandlers.delete(handler);
    };
  }, []);

  return {
    isStreaming,
    startStreaming,
    cancelStreaming,
    onDelta,
    onSegmentReady,
    onDone,
    onError,
  };
}
