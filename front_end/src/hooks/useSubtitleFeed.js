import { useCallback, useState } from 'react';

export function useSubtitleFeed() {
  const [subtitleText, setSubtitleText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const beginStream = useCallback(() => {
    setSubtitleText('');
    setIsStreaming(true);
  }, []);

  const appendDelta = useCallback((chunk) => {
    if (!chunk) return;
    setSubtitleText((prev) => prev + chunk);
    setIsStreaming(true);
  }, []);

  const replaceText = useCallback((text) => {
    setSubtitleText(text || '');
    setIsStreaming(false);
  }, []);

  const finishStream = useCallback(() => {
    setIsStreaming(false);
  }, []);

  const clearSubtitle = useCallback(() => {
    setSubtitleText('');
    setIsStreaming(false);
  }, []);

  return {
    subtitleText,
    isStreaming,
    beginStream,
    appendDelta,
    replaceText,
    finishStream,
    clearSubtitle,
  };
}
