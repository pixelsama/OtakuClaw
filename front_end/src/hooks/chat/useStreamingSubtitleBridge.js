import { useEffect, useRef } from 'react';

export function useStreamingSubtitleBridge({
  appendDelta,
  setSegmentText,
  finishStream,
  clearSubtitle,
  onDelta,
  onSegmentReady,
  onDone,
  onError,
  normalizeError,
  onComposerError,
}) {
  const segmentModeRef = useRef(false);

  useEffect(() => {
    const detachSegment = onSegmentReady((segment = {}) => {
      const text = typeof segment.text === 'string' ? segment.text.trim() : '';
      if (!text) {
        return;
      }

      segmentModeRef.current = true;
      setSegmentText(text);
    });

    const detachDelta = onDelta((delta) => {
      if (segmentModeRef.current) {
        return;
      }
      appendDelta(delta);
    });

    const detachDone = onDone(() => {
      segmentModeRef.current = false;
      finishStream();
    });
    const detachError = onError((error) => {
      console.error('字幕流式输出发生错误:', error);
      segmentModeRef.current = false;
      clearSubtitle();
      onComposerError?.(normalizeError(error));
    });

    return () => {
      segmentModeRef.current = false;
      detachSegment?.();
      detachDelta?.();
      detachDone?.();
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
  ]);
}
