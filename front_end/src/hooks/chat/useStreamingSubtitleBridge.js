import { useEffect, useRef } from 'react';

export function useStreamingSubtitleBridge({
  subtitleText,
  appendDelta,
  replaceText,
  clearSubtitle,
  onDelta,
  onDone,
  onError,
  normalizeError,
  onComposerError,
}) {
  const subtitleTextRef = useRef('');

  useEffect(() => {
    subtitleTextRef.current = subtitleText;
  }, [subtitleText]);

  useEffect(() => {
    const detachDelta = onDelta((delta) => appendDelta(delta));
    const detachDone = onDone(() => replaceText(subtitleTextRef.current));
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
    clearSubtitle,
    normalizeError,
    onComposerError,
    onDelta,
    onDone,
    onError,
    replaceText,
  ]);
}
