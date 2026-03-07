const playbackSubscribers = new Set();

function normalizeSegmentText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function normalizeSegmentMeta(payload = {}) {
  const turnId = typeof payload.turnId === 'string' ? payload.turnId.trim() : '';
  const segmentId =
    typeof payload.segmentId === 'string' && payload.segmentId.trim()
      ? payload.segmentId.trim()
      : turnId && Number.isFinite(payload.index)
        ? `${turnId}:${Math.max(0, Math.floor(payload.index))}`
        : '';

  return {
    sessionId: typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '',
    turnId,
    segmentId,
    index: Number.isFinite(payload.index) ? Math.max(0, Math.floor(payload.index)) : 0,
    text: normalizeSegmentText(payload.text),
  };
}

function emitPlaybackEvent(event = {}) {
  for (const subscriber of playbackSubscribers) {
    try {
      subscriber(event);
    } catch (error) {
      console.error('TTS playback lifecycle subscriber failed:', error);
    }
  }
}

export function subscribeTtsPlaybackLifecycle(handler) {
  if (typeof handler !== 'function') {
    return () => {};
  }

  playbackSubscribers.add(handler);
  return () => {
    playbackSubscribers.delete(handler);
  };
}

export function createTtsPlaybackLifecycleTracker({
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  emitEvent = emitPlaybackEvent,
} = {}) {
  const segmentMap = new Map();

  const updateSegmentMeta = (entry, payload = {}) => {
    const nextMeta = normalizeSegmentMeta(payload);
    if (!nextMeta.segmentId) {
      return entry;
    }

    if (!entry) {
      return {
        ...nextMeta,
        pendingChunks: 0,
        playbackStarted: false,
        lifecycleSettled: false,
        failed: false,
        startTimer: null,
      };
    }

    return {
      ...entry,
      sessionId: nextMeta.sessionId || entry.sessionId,
      turnId: nextMeta.turnId || entry.turnId,
      segmentId: nextMeta.segmentId || entry.segmentId,
      index: Number.isFinite(nextMeta.index) ? nextMeta.index : entry.index,
      text: nextMeta.text || entry.text,
    };
  };

  const clearSegmentStartTimer = (entry) => {
    if (!entry?.startTimer) {
      return;
    }
    clearTimer(entry.startTimer);
    entry.startTimer = null;
  };

  const maybeFinalizeSegment = (segmentId) => {
    const entry = segmentMap.get(segmentId);
    if (!entry || !entry.lifecycleSettled || entry.pendingChunks > 0) {
      return;
    }

    clearSegmentStartTimer(entry);
    emitEvent({
      type: entry.failed ? 'segment-playback-failed' : 'segment-playback-finished',
      sessionId: entry.sessionId,
      turnId: entry.turnId,
      segmentId: entry.segmentId,
      index: entry.index,
      text: entry.text,
    });
    segmentMap.delete(segmentId);
  };

  const ensureSegment = (payload = {}) => {
    const nextMeta = normalizeSegmentMeta(payload);
    if (!nextMeta.segmentId) {
      return null;
    }

    const entry = updateSegmentMeta(segmentMap.get(nextMeta.segmentId), nextMeta);
    segmentMap.set(nextMeta.segmentId, entry);
    return entry;
  };

  const scheduleChunkPlayback = ({
    sessionId,
    turnId,
    segmentId,
    index,
    text,
    startAt,
    currentTime,
  } = {}) => {
    const entry = ensureSegment({
      sessionId,
      turnId,
      segmentId,
      index,
      text,
    });
    if (!entry) {
      return () => {};
    }

    entry.pendingChunks += 1;

    if (!entry.playbackStarted && !entry.startTimer) {
      const startDelayMs = Math.max(0, Math.round((startAt - currentTime) * 1000));
      entry.startTimer = setTimer(() => {
        const current = segmentMap.get(entry.segmentId);
        if (!current || current.playbackStarted) {
          return;
        }

        current.startTimer = null;
        current.playbackStarted = true;
        emitEvent({
          type: 'segment-playback-started',
          sessionId: current.sessionId,
          turnId: current.turnId,
          segmentId: current.segmentId,
          index: current.index,
          text: current.text,
        });
      }, startDelayMs);
    }

    return () => {
      const current = segmentMap.get(entry.segmentId);
      if (!current) {
        return;
      }

      current.pendingChunks = Math.max(0, current.pendingChunks - 1);
      maybeFinalizeSegment(entry.segmentId);
    };
  };

  const markSegmentStarted = (payload = {}) => {
    ensureSegment(payload);
  };

  const markSegmentFinished = (payload = {}) => {
    const entry = ensureSegment(payload);
    if (!entry) {
      return;
    }

    entry.lifecycleSettled = true;
    entry.failed = false;
    maybeFinalizeSegment(entry.segmentId);
  };

  const markSegmentFailed = (payload = {}) => {
    const entry = ensureSegment(payload);
    if (!entry) {
      return;
    }

    entry.lifecycleSettled = true;
    entry.failed = true;
    maybeFinalizeSegment(entry.segmentId);
  };

  const reset = ({ reason = '' } = {}) => {
    for (const entry of segmentMap.values()) {
      clearSegmentStartTimer(entry);
    }
    segmentMap.clear();
    emitEvent({
      type: 'segment-playback-reset',
      reason: typeof reason === 'string' ? reason : '',
    });
  };

  return {
    scheduleChunkPlayback,
    markSegmentStarted,
    markSegmentFinished,
    markSegmentFailed,
    reset,
    _segmentMap: segmentMap,
  };
}
