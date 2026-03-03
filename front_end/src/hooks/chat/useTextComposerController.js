import { useCallback, useEffect, useMemo, useState } from 'react';

export function useTextComposerController({
  beginStream,
  startStreaming,
  cancelStreaming,
  isStreaming,
}) {
  const [composerExternalError, setComposerExternalError] = useState('');

  const sendUserText = useCallback(
    async (content, options = {}) => {
      if (!content) {
        return;
      }

      beginStream();
      await startStreaming(options.sessionId || 'default', content, options.payload);
    },
    [beginStream, startStreaming],
  );

  const stopStreaming = useCallback(() => {
    void cancelStreaming();
  }, [cancelStreaming]);

  useEffect(
    () => () => {
      void cancelStreaming();
    },
    [cancelStreaming],
  );

  const submitTextComposer = useCallback(
    async (content) => {
      setComposerExternalError('');
      await sendUserText(content, { sessionId: 'text-composer' });
    },
    [sendUserText],
  );

  const dismissComposerExternalError = useCallback(() => {
    setComposerExternalError('');
  }, []);

  const textComposerProps = useMemo(
    () => ({
      isStreaming,
      onSubmit: submitTextComposer,
      onStop: stopStreaming,
      externalError: composerExternalError,
      onDismissExternalError: dismissComposerExternalError,
    }),
    [
      composerExternalError,
      dismissComposerExternalError,
      isStreaming,
      stopStreaming,
      submitTextComposer,
    ],
  );

  return {
    setComposerExternalError,
    textComposerProps,
  };
}
