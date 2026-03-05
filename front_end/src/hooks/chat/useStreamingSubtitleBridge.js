import { useEffect } from 'react';

export function useStreamingSubtitleBridge({
  appendDelta,
  finishStream,
  clearSubtitle,
  onDelta,
  onDone,
  onError,
  normalizeError,
  onComposerError,
}) {
  useEffect(() => {
    const detachDelta = onDelta((delta) => appendDelta(delta));
    const detachDone = onDone(() => finishStream());
    const detachError = onError((error) => {
      console.error('字幕流式输出发生错误:', error);
      clearSubtitle();
      onComposerError?.(normalizeError(error));
    });

    return () => {
      detachDelta?.();
      detachDone?.();
      detachError?.();
    };
  }, [
    appendDelta,
    finishStream,
    clearSubtitle,
    normalizeError,
    onComposerError,
    onDelta,
    onDone,
    onError,
  ]);
}
