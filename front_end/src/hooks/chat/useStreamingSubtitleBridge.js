import { useEffect, useRef } from 'react';

const SEGMENT_READY_FALLBACK_DELAY_MS = 350;
const TTS_STARTED_BUFFER_TTL_MS = 10000;
const DEFAULT_TTS_FINISH_HOLD_MS = 280;
const DEFAULT_TTS_FAILED_HOLD_MS = 1200;

function parseDelayFromEnv(key, fallback) {
  const raw = import.meta?.env?.[key];
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(parsed, 20000);
}

const TTS_FINISH_HOLD_MS = parseDelayFromEnv(
  'VITE_SUBTITLE_TTS_FINISH_HOLD_MS',
  DEFAULT_TTS_FINISH_HOLD_MS,
);
const TTS_FAILED_HOLD_MS = parseDelayFromEnv(
  'VITE_SUBTITLE_TTS_FAILED_HOLD_MS',
  DEFAULT_TTS_FAILED_HOLD_MS,
);

function normalizeSegmentId(segment = {}) {
  if (typeof segment.segmentId === 'string' && segment.segmentId.trim()) {
    return segment.segmentId.trim();
  }

  const turnId = typeof segment.turnId === 'string' ? segment.turnId.trim() : '';
  const index = Number.isFinite(segment.index) ? Math.max(0, Math.floor(segment.index)) : -1;
  if (turnId && index >= 0) {
    return `${turnId}:${index}`;
  }

  return '';
}

export function useStreamingSubtitleBridge({
  appendDelta,
  setSegmentText,
  finishStream,
  clearSubtitle,
  onDelta,
  onSegmentReady,
  onDone,
  onError,
  onVoiceEvent,
  normalizeError,
  onComposerError,
}) {
  const segmentModeRef = useRef(false);

  useEffect(() => {
    const pendingSegments = new Map();
    const startedBeforeReady = new Map();
    let clearTimer = null;

    const clearPendingTimer = (entry) => {
      if (entry?.fallbackTimer) {
        clearTimeout(entry.fallbackTimer);
      }
    };

    const clearSubtitleClearTimer = () => {
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
    };

    const scheduleSubtitleClear = (delayMs) => {
      clearSubtitleClearTimer();
      if (delayMs <= 0) {
        segmentModeRef.current = false;
        clearSubtitle();
        return;
      }

      clearTimer = setTimeout(() => {
        clearTimer = null;
        segmentModeRef.current = false;
        clearSubtitle();
      }, delayMs);
    };

    const clearAllPending = () => {
      for (const entry of pendingSegments.values()) {
        clearPendingTimer(entry);
      }
      pendingSegments.clear();
      startedBeforeReady.clear();
      clearSubtitleClearTimer();
    };

    const applySegmentText = (text) => {
      const safeText = typeof text === 'string' ? text.trim() : '';
      if (!safeText) {
        return;
      }

      clearSubtitleClearTimer();
      segmentModeRef.current = true;
      setSegmentText(safeText);
    };

    const pruneStartedBeforeReady = () => {
      const now = Date.now();
      for (const [segmentId, buffered] of startedBeforeReady.entries()) {
        if (now - buffered.at > TTS_STARTED_BUFFER_TTL_MS) {
          startedBeforeReady.delete(segmentId);
        }
      }
    };

    const detachSegment = onSegmentReady((segment = {}) => {
      const text = typeof segment.text === 'string' ? segment.text.trim() : '';
      if (!text) {
        return;
      }

      const segmentId = normalizeSegmentId(segment);
      if (!segmentId) {
        applySegmentText(text);
        return;
      }

      pruneStartedBeforeReady();
      const bufferedStarted = startedBeforeReady.get(segmentId);
      if (bufferedStarted) {
        startedBeforeReady.delete(segmentId);
        applySegmentText(bufferedStarted.text || text);
        pendingSegments.set(segmentId, {
          text,
          ttsStarted: true,
          fallbackShown: false,
          fallbackTimer: null,
        });
        return;
      }

      const previous = pendingSegments.get(segmentId);
      clearPendingTimer(previous);
      const entry = {
        text,
        ttsStarted: false,
        fallbackShown: false,
        fallbackTimer: null,
      };
      entry.fallbackTimer = setTimeout(() => {
        const current = pendingSegments.get(segmentId);
        if (!current || current.ttsStarted || current.fallbackShown) {
          return;
        }

        current.fallbackShown = true;
        current.fallbackTimer = null;
        pendingSegments.set(segmentId, current);
        applySegmentText(current.text);
      }, SEGMENT_READY_FALLBACK_DELAY_MS);
      pendingSegments.set(segmentId, entry);
    });

    const detachDelta = onDelta((delta) => {
      if (segmentModeRef.current) {
        return;
      }
      appendDelta(delta);
    });

    const detachDone = onDone(() => {
      let lastFallbackText = '';
      for (const [segmentId, entry] of pendingSegments.entries()) {
        clearPendingTimer(entry);
        if (entry.ttsStarted) {
          continue;
        }

        if (entry.text) {
          lastFallbackText = entry.text;
        }
        pendingSegments.delete(segmentId);
      }

      if (lastFallbackText) {
        applySegmentText(lastFallbackText);
      }

      segmentModeRef.current = false;
      finishStream();
    });

    const detachVoice = onVoiceEvent?.((event = {}) => {
      if (!event || typeof event !== 'object') {
        return;
      }

      if (
        event.type !== 'segment-tts-started'
        && event.type !== 'segment-tts-finished'
        && event.type !== 'segment-tts-failed'
      ) {
        return;
      }

      const segmentId = normalizeSegmentId(event);
      if (!segmentId) {
        return;
      }

      pruneStartedBeforeReady();
      const entry = pendingSegments.get(segmentId);

      if (event.type === 'segment-tts-started') {
        if (!entry) {
          startedBeforeReady.set(segmentId, {
            text: typeof event.text === 'string' ? event.text.trim() : '',
            at: Date.now(),
          });
          return;
        }

        clearPendingTimer(entry);
        entry.ttsStarted = true;
        entry.fallbackTimer = null;
        pendingSegments.set(segmentId, entry);
        applySegmentText(
          typeof event.text === 'string' && event.text.trim() ? event.text : entry.text,
        );
        return;
      }

      if (entry) {
        clearPendingTimer(entry);
        pendingSegments.delete(segmentId);
      }

      if (event.type === 'segment-tts-finished') {
        if (entry) {
          scheduleSubtitleClear(TTS_FINISH_HOLD_MS);
        }
        return;
      }

      if (event.type === 'segment-tts-failed') {
        const fallbackText =
          typeof event.text === 'string' && event.text.trim()
            ? event.text
            : entry?.text || '';
        if (fallbackText) {
          applySegmentText(fallbackText);
        }
        if (entry) {
          scheduleSubtitleClear(TTS_FAILED_HOLD_MS);
        }
      }
    });

    const detachError = onError((error) => {
      console.error('字幕流式输出发生错误:', error);
      clearAllPending();
      segmentModeRef.current = false;
      clearSubtitle();
      onComposerError?.(normalizeError(error));
    });

    return () => {
      clearAllPending();
      segmentModeRef.current = false;
      detachSegment?.();
      detachDelta?.();
      detachDone?.();
      detachVoice?.();
      detachError?.();
    };
  }, [
    appendDelta,
    setSegmentText,
    finishStream,
    clearSubtitle,
    normalizeError,
    onComposerError,
    onDelta,
    onSegmentReady,
    onDone,
    onError,
    onVoiceEvent,
  ]);
}
