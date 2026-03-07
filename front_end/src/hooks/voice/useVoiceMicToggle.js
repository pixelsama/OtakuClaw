import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { desktopBridge } from '../../services/desktopBridge.js';
import { useSileroVad } from './useSileroVad.js';
import { waitForSpeechDrain, waitForSpeechQueueSettled } from './pttSpeechDrain.js';
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

function previewText(value, limit = 80) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim();
  if (!normalized) {
    return '';
  }

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit)}...`;
}

function logPtt(message, details = {}) {
  console.info('[voice-ptt]', message, details);
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
  const pendingSpeechTasksRef = useRef(0);
  const lastSpeechActivityAtRef = useRef(0);
  const runEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const isArmedRef = useRef(false);
  const isPttCapturingRef = useRef(false);
  const isFlushingRef = useRef(false);
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

  const markSpeechActivity = useCallback(() => {
    lastSpeechActivityAtRef.current = Date.now();
  }, []);

  const handleSpeechEnd = useCallback(
    async (audioFloat32, epoch) => {
      pendingSpeechTasksRef.current += 1;
      markSpeechActivity();
      logPtt('Queued speech-end task from VAD.', {
        epoch,
        audioSamples: audioFloat32 instanceof Float32Array ? audioFloat32.length : 0,
        pendingSpeechTasks: pendingSpeechTasksRef.current,
      });

      return enqueueSpeechTask(async () => {
        if (epoch !== runEpochRef.current) {
          logPtt('Skipped speech-end task because epoch is stale.', {
            epoch,
            activeEpoch: runEpochRef.current,
          });
          return;
        }

        const currentSegmentIndex = segmentIndexRef.current;
        segmentIndexRef.current += 1;
        const chunks = splitFloat32ToPcmChunks(audioFloat32, DEFAULT_FRAME_SAMPLES);
        if (!chunks.length) {
          console.warn('[voice-ptt] Speech-end task produced no PCM chunks.', {
            epoch,
            segmentIndex: currentSegmentIndex,
            audioSamples: audioFloat32 instanceof Float32Array ? audioFloat32.length : 0,
          });
          return;
        }

        logPtt('Processing speech segment for commit.', {
          epoch,
          segmentIndex: currentSegmentIndex,
          pcmChunkCount: chunks.length,
          audioSamples: audioFloat32 instanceof Float32Array ? audioFloat32.length : 0,
        });

        for (const pcmChunk of chunks) {
          if (epoch !== runEpochRef.current) {
            logPtt('Stopped sending PCM chunks because epoch changed mid-segment.', {
              epoch,
              activeEpoch: runEpochRef.current,
              segmentIndex: currentSegmentIndex,
            });
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
            console.warn('[voice-ptt] Failed to send PCM chunk to voice session.', {
              epoch,
              segmentIndex: currentSegmentIndex,
              seq: nextSeq,
              chunkId: chunkIdRef.current,
              reason: sent?.reason || 'unknown_reason',
            });
            setLocalError(sent?.reason || 'voice_send_audio_chunk_failed');
            return;
          }

          sentSeqRef.current = nextSeq;
        }

        if (epoch !== runEpochRef.current) {
          logPtt('Skipped commit because epoch changed after chunk upload.', {
            epoch,
            activeEpoch: runEpochRef.current,
            segmentIndex: currentSegmentIndex,
          });
          return;
        }

        const finalSeq = sentSeqRef.current;
        if (finalSeq <= lastCommittedSeqRef.current) {
          logPtt('Skipped commit because no new PCM sequence was buffered.', {
            epoch,
            segmentIndex: currentSegmentIndex,
            finalSeq,
            lastCommittedSeq: lastCommittedSeqRef.current,
          });
          return;
        }

        logPtt('Submitting speech segment to ASR commit.', {
          epoch,
          segmentIndex: currentSegmentIndex,
          finalSeq,
          lastCommittedSeq: lastCommittedSeqRef.current,
          sentSeq: sentSeqRef.current,
        });
        const committed = await commitInput({
          finalSeq,
          autoStartChat: false,
        });

        if (!committed?.ok) {
          console.warn('[voice-ptt] ASR commit returned a non-ok result.', {
            epoch,
            segmentIndex: currentSegmentIndex,
            finalSeq,
            reason: committed?.reason || 'unknown_reason',
          });
          if (committed?.reason !== 'empty_audio') {
            setLocalError(committed?.reason || 'voice_commit_failed');
          }
          return;
        }

        lastCommittedSeqRef.current = finalSeq;
        const finalText = typeof committed.text === 'string' ? committed.text.trim() : '';
        logPtt('Speech segment commit finished.', {
          epoch,
          segmentIndex: currentSegmentIndex,
          finalSeq,
          textLength: finalText.length,
          textPreview: previewText(finalText),
        });
        if (finalText) {
          segmentTextsRef.current.push({
            segmentIndex: currentSegmentIndex,
            text: finalText,
          });
          logPtt('Stored ASR text for aggregated PTT submit.', {
            epoch,
            segmentIndex: currentSegmentIndex,
            bufferedSegmentCount: segmentTextsRef.current.length,
            textLength: finalText.length,
          });
        }
      }).finally(() => {
        pendingSpeechTasksRef.current = Math.max(0, pendingSpeechTasksRef.current - 1);
        markSpeechActivity();
        logPtt('Speech-end task settled.', {
          epoch,
          pendingSpeechTasks: pendingSpeechTasksRef.current,
          bufferedSegmentCount: segmentTextsRef.current.length,
        });
      });
    },
    [commitInput, enqueueSpeechTask, markSpeechActivity, sendAudioChunk],
  );

  const waitForSpeechQueue = useCallback(
    async ({ timeoutMs }) => {
      return waitForSpeechDrain({
        timeoutMs,
        getPendingCount: () => pendingSpeechTasksRef.current,
        getLastActivityAt: () => lastSpeechActivityAtRef.current,
        getQueue: () => speechQueueRef.current,
        onWaitStart: markSpeechActivity,
      });
    },
    [markSpeechActivity],
  );

  const waitForSpeechQueueSettledAfterTimeout = useCallback(async () => {
    return waitForSpeechQueueSettled({
      getPendingCount: () => pendingSpeechTasksRef.current,
      getQueue: () => speechQueueRef.current,
    });
  }, []);

  const submitPttTranscription = useCallback(async () => {
    const orderedSegments = segmentTextsRef.current
      .slice()
      .sort((left, right) => left.segmentIndex - right.segmentIndex)
      .filter((item) => Boolean(item?.text));
    const text = orderedSegments.map((item) => item.text).join(' ').trim();

    logPtt('Submitting aggregated PTT transcription.', {
      sessionId: chatSessionId,
      segmentCount: orderedSegments.length,
      textLength: text.length,
      textPreview: previewText(text),
      hasSubmitHandler: typeof onSubmitVoiceText === 'function',
    });

    segmentTextsRef.current = [];
    segmentIndexRef.current = 0;

    if (!text || typeof onSubmitVoiceText !== 'function') {
      console.warn('[voice-ptt] Aggregated PTT submit was skipped.', {
        sessionId: chatSessionId,
        reason: text ? 'submit_handler_missing' : 'empty_text',
        textLength: text.length,
      });
      return { ok: Boolean(text), reason: text ? 'submit_handler_missing' : 'empty_text' };
    }

    await onSubmitVoiceText(text, {
      sessionId: chatSessionId,
      source: 'voice-ptt',
    });
    logPtt('Forwarded aggregated PTT transcription to chat submitter.', {
      sessionId: chatSessionId,
      textLength: text.length,
      textPreview: previewText(text),
    });
    return { ok: true };
  }, [chatSessionId, onSubmitVoiceText]);

  const startPttCapture = useCallback(async () => {
    if (isPttCapturingRef.current || isFlushingRef.current) {
      console.warn('[voice-ptt] Ignored PTT start because capture is not ready.', {
        isPttCapturing: isPttCapturingRef.current,
        isFlushing: isFlushingRef.current,
      });
      return { ok: false, reason: 'ptt_not_ready' };
    }

    if (!isArmedRef.current) {
      const armed = await enableVoice();
      if (!armed?.ok) {
        return armed;
      }
    }

    if (status === 'transcribing') {
      console.warn('[voice-ptt] Ignored PTT start because ASR is still transcribing.', {
        status,
      });
      return { ok: false, reason: 'voice_transcribing_in_progress' };
    }

    const nextEpoch = runEpochRef.current + 1;
    runEpochRef.current = nextEpoch;
    setLocalError('');
    logPtt('Starting PTT capture.', {
      epoch: nextEpoch,
      sessionId,
      status,
      hotkey: normalizedHotkey,
    });

    const started = await startVad({
      onSpeechEnd: async (audioFloat32) => handleSpeechEnd(audioFloat32, nextEpoch),
    });

    if (!started?.ok) {
      console.warn('[voice-ptt] Failed to start VAD for PTT capture.', {
        epoch: nextEpoch,
        reason: started?.reason || 'unknown_reason',
      });
      setLocalError(started?.reason || 'silero_vad_start_failed');
      return started;
    }

    isPttCapturingRef.current = true;
    setIsPttCapturing(true);
    logPtt('PTT capture started.', {
      epoch: nextEpoch,
      sessionId,
    });
    return { ok: true };
  }, [enableVoice, handleSpeechEnd, normalizedHotkey, sessionId, startVad, status]);

  const stopPttCaptureAndSubmit = useCallback(async () => {
    if (!isPttCapturingRef.current || isFlushingRef.current) {
      console.warn('[voice-ptt] Ignored PTT stop because capture is not active.', {
        isPttCapturing: isPttCapturingRef.current,
        isFlushing: isFlushingRef.current,
      });
      return { ok: false, reason: 'ptt_not_capturing' };
    }

    isFlushingRef.current = true;
    setIsFlushing(true);
    isPttCapturingRef.current = false;
    setIsPttCapturing(false);
    logPtt('Stopping PTT capture and flushing pending speech.', {
      epoch: runEpochRef.current,
      pendingSpeechTasks: pendingSpeechTasksRef.current,
      capturedFrames,
      bufferedSegmentCount: segmentTextsRef.current.length,
    });

    try {
      const stopResult = await stopVad();
      logPtt('VAD stop completed for PTT flush.', {
        epoch: runEpochRef.current,
        ok: stopResult?.ok !== false,
        reason: stopResult?.reason || '',
      });

      const { timedOut } = await waitForSpeechQueue({
        timeoutMs: flushTimeoutMs,
      });
      logPtt('Speech queue wait finished.', {
        epoch: runEpochRef.current,
        timedOut,
        pendingSpeechTasks: pendingSpeechTasksRef.current,
        bufferedSegmentCount: segmentTextsRef.current.length,
      });
      if (timedOut) {
        console.warn('[voice-ptt] Speech queue exceeded soft flush timeout; waiting for in-flight speech to finish.', {
          epoch: runEpochRef.current,
          pendingSpeechTasks: pendingSpeechTasksRef.current,
          bufferedSegmentCount: segmentTextsRef.current.length,
          flushTimeoutMs,
        });
        await waitForSpeechQueueSettledAfterTimeout();
        logPtt('Speech queue settled after soft timeout.', {
          epoch: runEpochRef.current,
          pendingSpeechTasks: pendingSpeechTasksRef.current,
          bufferedSegmentCount: segmentTextsRef.current.length,
        });
      }

      const submitResult = await submitPttTranscription();
      logPtt('PTT submit finished.', {
        epoch: runEpochRef.current,
        ok: submitResult?.ok !== false,
        reason: submitResult?.reason || '',
      });
      if (!submitResult?.ok && submitResult?.reason !== 'empty_text') {
        setLocalError(submitResult.reason || 'voice_ptt_submit_failed');
      }

      return { ok: true };
    } finally {
      isFlushingRef.current = false;
      setIsFlushing(false);
    }
  }, [
    capturedFrames,
    flushTimeoutMs,
    stopVad,
    submitPttTranscription,
    waitForSpeechQueue,
    waitForSpeechQueueSettledAfterTimeout,
  ]);

  const disableVoice = useCallback(
    async ({ reason = 'manual' } = {}) => {
      logPtt('Disabling voice toggle.', {
        reason,
        sessionId,
      });
      runEpochRef.current += 1;
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
      speechQueueRef.current = Promise.resolve();
      pendingSpeechTasksRef.current = 0;
      lastSpeechActivityAtRef.current = 0;
      segmentIndexRef.current = 0;
      segmentTextsRef.current = [];
      if (mountedRef.current) {
        setCapturedFrames(0);
      }
      logPtt('Voice toggle disabled and state cleared.', {
        reason,
      });
      return { ok: true };
    },
    [sessionId, stopPlayback, stopSession, stopVad],
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
    logPtt('Enabling voice toggle and starting session.', {
      sessionId: chatSessionId,
      hotkey: normalizedHotkey,
    });

    const started = await startSession({
      mode: 'vad',
      sessionId: chatSessionId,
    });
    if (!started?.ok) {
      console.warn('[voice-ptt] Failed to enable voice toggle session.', {
        sessionId: chatSessionId,
        reason: started?.reason || 'unknown_reason',
      });
      const errorMessage = started?.reason || 'voice_session_start_failed';
      setLocalError(errorMessage);
      return started;
    }

    seqRef.current = 0;
    sentSeqRef.current = 0;
    chunkIdRef.current = 0;
    lastCommittedSeqRef.current = 0;
    speechQueueRef.current = Promise.resolve();
    pendingSpeechTasksRef.current = 0;
    lastSpeechActivityAtRef.current = 0;
    segmentIndexRef.current = 0;
    segmentTextsRef.current = [];
    setCapturedFrames(0);
    isArmedRef.current = true;
    setIsArmed(true);
    logPtt('Voice toggle armed for push-to-talk.', {
      sessionId: started.sessionId || chatSessionId,
      hotkey: normalizedHotkey,
    });

    return { ok: true };
  }, [chatSessionId, desktopMode, normalizedHotkey, startSession, stopPlayback]);

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
    if (!desktopMode) {
      return () => {};
    }

    return desktopBridge.voice.onPttCommand((event = {}) => {
      if (event.hotkey && event.hotkey !== normalizedHotkey) {
        return;
      }

      if (event.action === 'start') {
        logPtt('Received global PTT start command.', {
          hotkey: normalizedHotkey,
        });
        void startPttCapture();
        return;
      }

      if (event.action === 'stop') {
        logPtt('Received global PTT stop command.', {
          hotkey: normalizedHotkey,
        });
        void stopPttCaptureAndSubmit();
      }
    });
  }, [desktopMode, normalizedHotkey, startPttCapture, stopPttCaptureAndSubmit]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
