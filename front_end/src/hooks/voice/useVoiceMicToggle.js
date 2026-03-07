import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSileroVad } from './useSileroVad.js';
import { useVoiceSession } from './useVoiceSession.js';
import { useVoiceTtsPlayback } from './useVoiceTtsPlayback.js';

const DEFAULT_FRAME_SAMPLES = 320;
const DEFAULT_PTT_FLUSH_TIMEOUT_MS = 1500;
const RAW_PTT_HOTKEY = import.meta.env.VITE_VOICE_PTT_KEY || import.meta.env.VITE_PTT_HOTKEY || 'F8';
const RAW_PTT_FLUSH_TIMEOUT_MS = import.meta.env.VITE_VOICE_PTT_FLUSH_TIMEOUT_MS;

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

function normalizePttHotkey(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return 'F8';
  }

  if (raw === ' ') {
    return 'SPACE';
  }

  return raw.toUpperCase();
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function eventMatchesPttHotkey(event, hotkey) {
  if (!hotkey) {
    return false;
  }

  const eventCode = typeof event?.code === 'string' ? event.code.trim().toUpperCase() : '';
  const eventKey = typeof event?.key === 'string' ? event.key.trim().toUpperCase() : '';

  if (hotkey === 'SPACE') {
    return eventCode === 'SPACE' || eventKey === 'SPACE' || event?.key === ' ';
  }

  return eventCode === hotkey || eventKey === hotkey;
}

function isFunctionHotkey(hotkey) {
  return /^F[1-9]$/.test(hotkey) || /^F1[0-2]$/.test(hotkey);
}

function isEditableTarget(target) {
  if (!target || typeof target !== 'object') {
    return false;
  }

  const tagName = typeof target.tagName === 'string' ? target.tagName.toLowerCase() : '';
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }

  if (target.isContentEditable) {
    return true;
  }

  return false;
}

export function useVoiceMicToggle({
  desktopMode = false,
  chatSessionId = 'text-composer',
  onSubmitVoiceText,
  pttHotkey = RAW_PTT_HOTKEY,
  pttFlushTimeoutMs = RAW_PTT_FLUSH_TIMEOUT_MS,
} = {}) {
  const seqRef = useRef(0);
  const sentSeqRef = useRef(0);
  const chunkIdRef = useRef(0);
  const lastCommittedSeqRef = useRef(0);
  const segmentIndexRef = useRef(0);
  const segmentTextsRef = useRef([]);
  const speechQueueRef = useRef(Promise.resolve());
  const runEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const isArmedRef = useRef(false);
  const isPttCapturingRef = useRef(false);
  const isFlushingRef = useRef(false);
  const hotkeyPressedRef = useRef(false);
  const stopPlaybackRef = useRef(null);
  const stopVadRef = useRef(null);
  const stopSessionRef = useRef(null);
  const [isArmed, setIsArmed] = useState(false);
  const [isPttCapturing, setIsPttCapturing] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  const [capturedFrames, setCapturedFrames] = useState(0);
  const [localError, setLocalError] = useState('');
  const normalizedHotkey = useMemo(() => normalizePttHotkey(pttHotkey), [pttHotkey]);
  const flushTimeoutMs = useMemo(
    () => normalizePositiveInteger(pttFlushTimeoutMs, DEFAULT_PTT_FLUSH_TIMEOUT_MS),
    [pttFlushTimeoutMs],
  );

  const {
    sessionId,
    status,
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

        const currentSegmentIndex = segmentIndexRef.current;
        segmentIndexRef.current += 1;
        const chunks = splitFloat32ToPcmChunks(audioFloat32, DEFAULT_FRAME_SAMPLES);
        if (!chunks.length) {
          return;
        }

        for (const pcmChunk of chunks) {
          if (epoch !== runEpochRef.current) {
            return;
          }

          seqRef.current += 1;
          const nextSeq = seqRef.current;
          chunkIdRef.current += 1;
          if (mountedRef.current) {
            setCapturedFrames((value) => value + 1);
          }

          const sent = await sendAudioChunk({
            seq: nextSeq,
            chunkId: chunkIdRef.current,
            pcmChunk,
            sampleRate: 16000,
            channels: 1,
            sampleFormat: 'pcm_s16le',
            isSpeech: true,
          });

          if (!sent?.ok) {
            setLocalError(sent?.reason || 'voice_send_audio_chunk_failed');
            return;
          }

          sentSeqRef.current = nextSeq;
        }

        if (epoch !== runEpochRef.current) {
          return;
        }

        const finalSeq = sentSeqRef.current;
        if (finalSeq <= lastCommittedSeqRef.current) {
          return;
        }

        const committed = await commitInput({
          finalSeq,
          autoStartChat: false,
        });

        if (!committed?.ok) {
          if (committed?.reason !== 'empty_audio') {
            setLocalError(committed?.reason || 'voice_commit_failed');
          }
          return;
        }

        lastCommittedSeqRef.current = finalSeq;
        const finalText = typeof committed.text === 'string' ? committed.text.trim() : '';
        if (finalText) {
          segmentTextsRef.current.push({
            segmentIndex: currentSegmentIndex,
            text: finalText,
          });
        }
      }),
    [commitInput, enqueueSpeechTask, sendAudioChunk],
  );

  const waitForSpeechQueue = useCallback(
    async ({ timeoutMs }) => {
      let timeoutId = null;
      let timeoutTriggered = false;

      const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          timeoutTriggered = true;
          resolve();
        }, timeoutMs);
      });

      await Promise.race([speechQueueRef.current, timeoutPromise]);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      return {
        timedOut: timeoutTriggered,
      };
    },
    [],
  );

  const submitPttTranscription = useCallback(async () => {
    const text = segmentTextsRef.current
      .slice()
      .sort((left, right) => left.segmentIndex - right.segmentIndex)
      .map((item) => item.text)
      .filter(Boolean)
      .join(' ')
      .trim();

    segmentTextsRef.current = [];
    segmentIndexRef.current = 0;

    if (!text || typeof onSubmitVoiceText !== 'function') {
      return { ok: Boolean(text), reason: text ? 'submit_handler_missing' : 'empty_text' };
    }

    await onSubmitVoiceText(text, {
      sessionId: chatSessionId,
      source: 'voice-ptt',
    });
    return { ok: true };
  }, [chatSessionId, onSubmitVoiceText]);

  const startPttCapture = useCallback(async () => {
    if (!isArmedRef.current || isPttCapturingRef.current || isFlushingRef.current) {
      return { ok: false, reason: 'ptt_not_ready' };
    }

    if (status === 'transcribing') {
      return { ok: false, reason: 'voice_transcribing_in_progress' };
    }

    const nextEpoch = runEpochRef.current + 1;
    runEpochRef.current = nextEpoch;
    setLocalError('');

    const started = await startVad({
      onSpeechEnd: async (audioFloat32) => handleSpeechEnd(audioFloat32, nextEpoch),
    });

    if (!started?.ok) {
      setLocalError(started?.reason || 'silero_vad_start_failed');
      return started;
    }

    isPttCapturingRef.current = true;
    setIsPttCapturing(true);
    return { ok: true };
  }, [handleSpeechEnd, startVad, status]);

  const stopPttCaptureAndSubmit = useCallback(async () => {
    if (!isPttCapturingRef.current || isFlushingRef.current) {
      return { ok: false, reason: 'ptt_not_capturing' };
    }

    isFlushingRef.current = true;
    setIsFlushing(true);
    isPttCapturingRef.current = false;
    setIsPttCapturing(false);

    try {
      await stopVad();

      const { timedOut } = await waitForSpeechQueue({
        timeoutMs: flushTimeoutMs,
      });
      if (timedOut) {
        runEpochRef.current += 1;
        setLocalError('voice_ptt_flush_timeout_partial_submit');
      }

      const submitResult = await submitPttTranscription();
      if (!submitResult?.ok && submitResult?.reason !== 'empty_text') {
        setLocalError(submitResult.reason || 'voice_ptt_submit_failed');
      }

      return { ok: true };
    } finally {
      isFlushingRef.current = false;
      setIsFlushing(false);
    }
  }, [flushTimeoutMs, stopVad, submitPttTranscription, waitForSpeechQueue]);

  const disableVoice = useCallback(
    async ({ reason = 'manual' } = {}) => {
      runEpochRef.current += 1;
      hotkeyPressedRef.current = false;
      isPttCapturingRef.current = false;
      isFlushingRef.current = false;
      isArmedRef.current = false;
      setIsPttCapturing(false);
      setIsFlushing(false);
      setIsArmed(false);
      setLocalError('');
      await stopPlayback({
        emitFinalAck: true,
        resetSeq: true,
      });
      await stopVad();
      await stopSession({ reason });
      seqRef.current = 0;
      sentSeqRef.current = 0;
      chunkIdRef.current = 0;
      lastCommittedSeqRef.current = 0;
      segmentIndexRef.current = 0;
      segmentTextsRef.current = [];
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
    sentSeqRef.current = 0;
    chunkIdRef.current = 0;
    lastCommittedSeqRef.current = 0;
    segmentIndexRef.current = 0;
    segmentTextsRef.current = [];
    setCapturedFrames(0);
    isArmedRef.current = true;
    setIsArmed(true);

    return { ok: true };
  }, [chatSessionId, desktopMode, startSession, stopPlayback]);

  const toggleVoice = useCallback(async () => {
    if (isArmedRef.current) {
      return disableVoice({ reason: 'manual' });
    }
    return enableVoice();
  }, [disableVoice, enableVoice]);

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

  useEffect(() => {
    isArmedRef.current = isArmed;
  }, [isArmed]);

  useEffect(() => {
    isPttCapturingRef.current = isPttCapturing;
  }, [isPttCapturing]);

  useEffect(() => onEvent(handleVoiceEvent), [handleVoiceEvent, onEvent]);

  useEffect(() => {
    if (!desktopMode || !isArmed || !normalizedHotkey) {
      return () => {};
    }

    const shouldSkipEditable = !isFunctionHotkey(normalizedHotkey);

    const onKeyDown = (event) => {
      if (!eventMatchesPttHotkey(event, normalizedHotkey)) {
        return;
      }

      if (event.repeat || hotkeyPressedRef.current) {
        return;
      }

      if (shouldSkipEditable && isEditableTarget(event.target)) {
        return;
      }

      hotkeyPressedRef.current = true;
      event.preventDefault();
      void startPttCapture();
    };

    const onKeyUp = (event) => {
      if (!eventMatchesPttHotkey(event, normalizedHotkey)) {
        return;
      }

      if (!hotkeyPressedRef.current) {
        return;
      }

      hotkeyPressedRef.current = false;
      event.preventDefault();
      void stopPttCaptureAndSubmit();
    };

    const onBlur = () => {
      if (!hotkeyPressedRef.current) {
        return;
      }
      hotkeyPressedRef.current = false;
      void stopPttCaptureAndSubmit();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [desktopMode, isArmed, normalizedHotkey, startPttCapture, stopPttCaptureAndSubmit]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      hotkeyPressedRef.current = false;
      isArmedRef.current = false;
      isPttCapturingRef.current = false;
      isFlushingRef.current = false;
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
      isEnabled: isArmed,
      isBusy: isVadLoading || isProcessingSpeech || isFlushing,
      isAvailable: desktopMode,
      isPttCapturing,
      isVadSpeaking,
      isPlayingTts,
      pttHotkey: normalizedHotkey,
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
      capturedFrames,
      desktopMode,
      disableVoice,
      enableVoice,
      error,
      isArmed,
      isFlushing,
      isPlayingTts,
      isPttCapturing,
      isProcessingSpeech,
      isVadLoading,
      isVadSpeaking,
      normalizedHotkey,
      sessionId,
      status,
      stopTtsPlayback,
      toggleVoice,
    ],
  );
}
