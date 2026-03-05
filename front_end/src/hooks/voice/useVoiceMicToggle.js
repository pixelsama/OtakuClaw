import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSileroVad } from './useSileroVad.js';
import { useVoiceSession } from './useVoiceSession.js';
import { useVoiceTtsPlayback } from './useVoiceTtsPlayback.js';

const DEFAULT_FRAME_SAMPLES = 320;

function clampToInt16(sample) {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function splitFloat32ToPcmChunks(audioFloat32, frameSamples = DEFAULT_FRAME_SAMPLES) {
  if (!(audioFloat32 instanceof Float32Array) || audioFloat32.length === 0) {
    return [];
  }

  const int16 = new Int16Array(audioFloat32.length);
  for (let i = 0; i < audioFloat32.length; i += 1) {
    int16[i] = clampToInt16(audioFloat32[i]);
  }

  const chunks = [];
  for (let offset = 0; offset < int16.length; offset += frameSamples) {
    const segment = int16.slice(offset, Math.min(offset + frameSamples, int16.length));
    if (!segment.length) {
      continue;
    }

    const pcmChunk = new Uint8Array(segment.length * 2);
    const view = new DataView(pcmChunk.buffer);
    for (let i = 0; i < segment.length; i += 1) {
      view.setInt16(i * 2, segment[i], true);
    }
    chunks.push(pcmChunk);
  }

  return chunks;
}

export function useVoiceMicToggle({
  desktopMode = false,
  chatSessionId = 'text-composer',
} = {}) {
  const seqRef = useRef(0);
  const chunkIdRef = useRef(0);
  const speechQueueRef = useRef(Promise.resolve());
  const runEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const stopPlaybackRef = useRef(null);
  const stopVadRef = useRef(null);
  const stopSessionRef = useRef(null);
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  const [capturedFrames, setCapturedFrames] = useState(0);
  const [localError, setLocalError] = useState('');

  const {
    sessionId,
    status,
    active,
    lastError,
    startSession,
    sendAudioChunk,
    commitInput,
    stopSession,
    stopTts,
    sendPlaybackAck,
    onEvent,
  } = useVoiceSession({ desktopMode });

  const {
    handleVoiceEvent,
    stopPlayback,
    isPlaying: isPlayingTts,
    playbackError,
  } = useVoiceTtsPlayback({
    desktopMode,
    sessionId,
    sendPlaybackAck,
  });

  const {
    isLoading: isVadLoading,
    isListening: isVadListening,
    isSpeaking: isVadSpeaking,
    vadError,
    start: startVad,
    stop: stopVad,
  } = useSileroVad();

  const enqueueSpeechTask = useCallback((task) => {
    speechQueueRef.current = speechQueueRef.current
      .then(async () => {
        if (!mountedRef.current) {
          return;
        }

        setIsProcessingSpeech(true);
        try {
          await task();
        } finally {
          if (mountedRef.current) {
            setIsProcessingSpeech(false);
          }
        }
      })
      .catch((error) => {
        console.error('Voice speech pipeline failed:', error);
        if (mountedRef.current) {
          setIsProcessingSpeech(false);
        }
      });

    return speechQueueRef.current;
  }, []);

  const handleSpeechEnd = useCallback(
    async (audioFloat32, epoch) =>
      enqueueSpeechTask(async () => {
        if (epoch !== runEpochRef.current) {
          return;
        }

        const chunks = splitFloat32ToPcmChunks(audioFloat32, DEFAULT_FRAME_SAMPLES);
        if (!chunks.length) {
          return;
        }

        for (const pcmChunk of chunks) {
          if (epoch !== runEpochRef.current) {
            return;
          }

          seqRef.current += 1;
          chunkIdRef.current += 1;
          if (mountedRef.current) {
            setCapturedFrames((value) => value + 1);
          }

          const sent = await sendAudioChunk({
            seq: seqRef.current,
            chunkId: chunkIdRef.current,
            pcmChunk,
            sampleRate: 16000,
            channels: 1,
            sampleFormat: 'pcm_s16le',
            isSpeech: true,
          });

          if (!sent?.ok) {
            return;
          }
        }

        if (epoch !== runEpochRef.current) {
          return;
        }

        await commitInput({
          finalSeq: seqRef.current,
        });
      }),
    [commitInput, enqueueSpeechTask, sendAudioChunk],
  );

  const disableVoice = useCallback(
    async ({ reason = 'manual' } = {}) => {
      runEpochRef.current += 1;
      setLocalError('');
      await stopPlayback({
        emitFinalAck: true,
        resetSeq: true,
      });
      await stopVad();
      await stopSession({ reason });
      seqRef.current = 0;
      chunkIdRef.current = 0;
      if (mountedRef.current) {
        setCapturedFrames(0);
      }
      return { ok: true };
    },
    [stopPlayback, stopSession, stopVad],
  );

  const enableVoice = useCallback(async () => {
    if (!desktopMode) {
      const errorMessage = 'Voice mode requires desktop runtime.';
      setLocalError(errorMessage);
      return { ok: false, reason: 'desktop_only', message: errorMessage };
    }

    setLocalError('');
    await stopPlayback({
      emitFinalAck: false,
      resetSeq: true,
    });

    const started = await startSession({
      mode: 'vad',
      sessionId: chatSessionId,
    });
    if (!started?.ok) {
      const errorMessage = started?.reason || 'voice_session_start_failed';
      setLocalError(errorMessage);
      return started;
    }

    seqRef.current = 0;
    chunkIdRef.current = 0;
    setCapturedFrames(0);
    const nextEpoch = runEpochRef.current + 1;
    runEpochRef.current = nextEpoch;

    const vadStarted = await startVad({
      onSpeechEnd: async (audioFloat32) => handleSpeechEnd(audioFloat32, nextEpoch),
    });

    if (!vadStarted?.ok) {
      runEpochRef.current += 1;
      await stopSession({ reason: 'vad_start_failed' });
      const errorMessage = vadStarted?.reason || 'silero_vad_start_failed';
      setLocalError(errorMessage);
      return vadStarted;
    }

    return { ok: true };
  }, [chatSessionId, desktopMode, handleSpeechEnd, startSession, startVad, stopPlayback, stopSession]);

  const toggleVoice = useCallback(async () => {
    if (active || isVadListening || isVadSpeaking || isVadLoading) {
      return disableVoice({ reason: 'manual' });
    }
    return enableVoice();
  }, [active, disableVoice, enableVoice, isVadListening, isVadLoading, isVadSpeaking]);

  const stopTtsPlayback = useCallback(async () => {
    await stopPlayback({
      emitFinalAck: true,
      resetSeq: false,
    });
    await stopTts({ reason: 'manual' });
  }, [stopPlayback, stopTts]);

  useEffect(() => {
    stopPlaybackRef.current = stopPlayback;
    stopVadRef.current = stopVad;
    stopSessionRef.current = stopSession;
  }, [stopPlayback, stopSession, stopVad]);

  useEffect(() => onEvent(handleVoiceEvent), [handleVoiceEvent, onEvent]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runEpochRef.current += 1;
      void stopPlaybackRef.current?.({
        emitFinalAck: false,
        resetSeq: true,
      });
      void stopVadRef.current?.();
      void stopSessionRef.current?.({ reason: 'toggle_unmount' });
    };
  }, []);

  const error = localError || lastError || vadError || playbackError || '';

  return useMemo(
    () => ({
      isEnabled: active && isVadListening,
      isBusy: isVadLoading || isProcessingSpeech,
      isAvailable: desktopMode,
      isVadSpeaking,
      isPlayingTts,
      sessionId,
      status,
      capturedFrames,
      error,
      enableVoice,
      disableVoice,
      toggleVoice,
      stopTtsPlayback,
    }),
    [
      active,
      capturedFrames,
      desktopMode,
      disableVoice,
      enableVoice,
      error,
      isPlayingTts,
      isProcessingSpeech,
      isVadListening,
      isVadLoading,
      isVadSpeaking,
      sessionId,
      status,
      stopTtsPlayback,
      toggleVoice,
    ],
  );
}

