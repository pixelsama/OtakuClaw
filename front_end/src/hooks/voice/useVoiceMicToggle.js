import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSileroVad } from './useSileroVad.js';
import { waitForSpeechDrain, waitForSpeechQueueSettled } from './pttSpeechDrain.js';
import { useVoiceSession } from './useVoiceSession.js';
import { useVoiceTtsPlayback } from './useVoiceTtsPlayback.js';
import { desktopBridge } from '../../services/desktopBridge.js';

const DEFAULT_FRAME_SAMPLES = 320;
const DEFAULT_AUTO_SUBMIT_DELAY_MS = 1500;
const DEFAULT_INTERRUPT_CONFIRM_MS = 200;
function getDefaultVoiceToggleHotkey() {
  if (typeof navigator === 'object' && /mac/i.test(navigator.platform || '')) {
    return 'F8';
  }

  return 'CommandOrControl+Shift+Space';
}

const RAW_VOICE_TOGGLE_HOTKEY =
  import.meta.env.VITE_VOICE_TOGGLE_ACCELERATOR || getDefaultVoiceToggleHotkey();
const RAW_AUTO_SUBMIT_DELAY_MS = import.meta.env.VITE_VOICE_AUTO_SUBMIT_DELAY_MS;
const RAW_INTERRUPT_CONFIRM_MS = import.meta.env.VITE_VOICE_INTERRUPT_CONFIRM_MS;

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

function normalizeHotkeyLabel(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return getDefaultVoiceToggleHotkey();
  }

  return raw;
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

export async function stopVoiceCaptureAndSubmit({
  reason = 'manual',
  stopVad = async () => ({ ok: true }),
  flushPendingSpeechAndSubmit = async () => ({ ok: true }),
  invalidateEpoch = () => {},
} = {}) {
  try {
    await stopVad();
    return await flushPendingSpeechAndSubmit({ reason });
  } finally {
    invalidateEpoch();
  }
}

export function shouldPreserveVoiceSessionAfterDisable(reason = 'manual') {
  return reason === 'manual';
}

function logVoice(message, details = {}) {
  console.info('[voice-mic]', message, details);
}

export function useVoiceMicToggle({
  desktopMode = false,
  chatSessionId = 'text-composer',
  onSubmitVoiceText,
  onInterruptAssistant,
  toggleHotkey = RAW_VOICE_TOGGLE_HOTKEY,
  autoSubmitDelayMs = RAW_AUTO_SUBMIT_DELAY_MS,
  interruptConfirmMs = RAW_INTERRUPT_CONFIRM_MS,
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
  const isEnabledRef = useRef(false);
  const isSubmittingRef = useRef(false);
  const isTransitioningRef = useRef(false);
  const isInterruptingRef = useRef(false);
  const isVadSpeakingRef = useRef(false);
  const isPlayingTtsRef = useRef(false);
  const autoSubmitTimerRef = useRef(null);
  const interruptTimerRef = useRef(null);
  const interruptTokenRef = useRef(0);
  const stopPlaybackRef = useRef(null);
  const stopVadRef = useRef(null);
  const stopSessionRef = useRef(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  const [capturedFrames, setCapturedFrames] = useState(0);
  const [localError, setLocalError] = useState('');
  const normalizedHotkey = useMemo(() => normalizeHotkeyLabel(toggleHotkey), [toggleHotkey]);
  const silenceSubmitDelayMs = useMemo(
    () => normalizePositiveInteger(autoSubmitDelayMs, DEFAULT_AUTO_SUBMIT_DELAY_MS),
    [autoSubmitDelayMs],
  );
  const interruptDelayMs = useMemo(
    () => normalizePositiveInteger(interruptConfirmMs, DEFAULT_INTERRUPT_CONFIRM_MS),
    [interruptConfirmMs],
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

  const clearAutoSubmitTimer = useCallback(() => {
    if (!autoSubmitTimerRef.current) {
      return;
    }

    clearTimeout(autoSubmitTimerRef.current);
    autoSubmitTimerRef.current = null;
  }, []);

  const clearInterruptTimer = useCallback(() => {
    interruptTokenRef.current += 1;
    if (!interruptTimerRef.current) {
      return;
    }

    clearTimeout(interruptTimerRef.current);
    interruptTimerRef.current = null;
  }, []);

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

  const submitAggregatedTranscription = useCallback(async () => {
    const orderedSegments = segmentTextsRef.current
      .slice()
      .sort((left, right) => left.segmentIndex - right.segmentIndex)
      .filter((item) => Boolean(item?.text));
    const text = orderedSegments.map((item) => item.text).join(' ').trim();

    logVoice('Submitting aggregated voice transcription.', {
      sessionId: chatSessionId,
      segmentCount: orderedSegments.length,
      textLength: text.length,
      textPreview: previewText(text),
      hasSubmitHandler: typeof onSubmitVoiceText === 'function',
    });

    segmentTextsRef.current = [];
    segmentIndexRef.current = 0;

    if (!text || typeof onSubmitVoiceText !== 'function') {
      console.warn('[voice-mic] Aggregated voice submit was skipped.', {
        sessionId: chatSessionId,
        reason: text ? 'submit_handler_missing' : 'empty_text',
        textLength: text.length,
      });
      return { ok: Boolean(text), reason: text ? 'submit_handler_missing' : 'empty_text' };
    }

    await onSubmitVoiceText(text, {
      sessionId: chatSessionId,
      source: 'voice-mic',
    });
    logVoice('Forwarded aggregated voice transcription to chat submitter.', {
      sessionId: chatSessionId,
      textLength: text.length,
      textPreview: previewText(text),
    });
    return { ok: true };
  }, [chatSessionId, onSubmitVoiceText]);

  const flushPendingSpeechAndSubmit = useCallback(
    async ({ reason = 'silence_timeout' } = {}) => {
      clearAutoSubmitTimer();
      if (isSubmittingRef.current) {
        return { ok: false, reason: 'voice_submit_in_progress' };
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      markSpeechActivity();
      logVoice('Flushing pending speech for submit.', {
        reason,
        pendingSpeechTasks: pendingSpeechTasksRef.current,
        bufferedSegmentCount: segmentTextsRef.current.length,
      });

      try {
        const { timedOut } = await waitForSpeechQueue({
          timeoutMs: silenceSubmitDelayMs,
        });

        if (timedOut) {
          console.warn('[voice-mic] Speech queue exceeded soft timeout; waiting for settlement.', {
            reason,
            pendingSpeechTasks: pendingSpeechTasksRef.current,
            bufferedSegmentCount: segmentTextsRef.current.length,
            timeoutMs: silenceSubmitDelayMs,
          });
          await waitForSpeechQueueSettledAfterTimeout();
        }

        const submitResult = await submitAggregatedTranscription();
        if (!submitResult?.ok && submitResult?.reason !== 'empty_text') {
          setLocalError(submitResult.reason || 'voice_submit_failed');
        }
        return submitResult;
      } finally {
        isSubmittingRef.current = false;
        if (mountedRef.current) {
          setIsSubmitting(false);
        }
      }
    },
    [
      clearAutoSubmitTimer,
      markSpeechActivity,
      silenceSubmitDelayMs,
      submitAggregatedTranscription,
      waitForSpeechQueue,
      waitForSpeechQueueSettledAfterTimeout,
    ],
  );

  const scheduleAutoSubmit = useCallback(() => {
    clearAutoSubmitTimer();
    if (isSubmittingRef.current) {
      return;
    }

    const hasBufferedText = segmentTextsRef.current.some((item) => Boolean(item?.text));
    if (!hasBufferedText || !isEnabledRef.current) {
      return;
    }

    autoSubmitTimerRef.current = setTimeout(() => {
      autoSubmitTimerRef.current = null;
      if (!mountedRef.current || !isEnabledRef.current || isSubmittingRef.current) {
        return;
      }

      logVoice('Silence window elapsed; auto-submitting buffered speech.', {
        delayMs: silenceSubmitDelayMs,
        bufferedSegmentCount: segmentTextsRef.current.length,
      });
      void flushPendingSpeechAndSubmit({ reason: 'silence_timeout' });
    }, silenceSubmitDelayMs);
  }, [clearAutoSubmitTimer, flushPendingSpeechAndSubmit, silenceSubmitDelayMs]);

  const handleSpeechStart = useCallback(
    async (epoch) => {
      if (epoch !== runEpochRef.current) {
        return;
      }

      markSpeechActivity();
      clearAutoSubmitTimer();
      clearInterruptTimer();

      if (!isPlayingTtsRef.current) {
        return;
      }

      const interruptToken = interruptTokenRef.current + 1;
      interruptTokenRef.current = interruptToken;
      interruptTimerRef.current = setTimeout(() => {
        interruptTimerRef.current = null;
        if (
          interruptToken !== interruptTokenRef.current
          || epoch !== runEpochRef.current
          || !mountedRef.current
          || !isEnabledRef.current
          || !isVadSpeakingRef.current
          || isInterruptingRef.current
        ) {
          return;
        }

        isInterruptingRef.current = true;
        logVoice('Interrupting assistant playback after confirmed user speech.', {
          epoch,
          delayMs: interruptDelayMs,
        });

        Promise.resolve()
          .then(async () => {
            if (typeof onInterruptAssistant === 'function') {
              await onInterruptAssistant({ reason: 'barge_in' });
            }
            await stopPlayback({
              emitFinalAck: false,
              resetSeq: false,
            });
            await stopTts({ reason: 'barge_in' });
          })
          .catch((error) => {
            console.error('Assistant interruption failed:', error);
          })
          .finally(() => {
            isInterruptingRef.current = false;
          });
      }, interruptDelayMs);
    },
    [
      clearAutoSubmitTimer,
      clearInterruptTimer,
      interruptDelayMs,
      markSpeechActivity,
      onInterruptAssistant,
      stopPlayback,
      stopTts,
    ],
  );

  const handleVADMisfire = useCallback(
    async (epoch) => {
      if (epoch !== runEpochRef.current) {
        return;
      }

      clearInterruptTimer();
      markSpeechActivity();
      logVoice('VAD reported a misfire.', {
        epoch,
      });
    },
    [clearInterruptTimer, markSpeechActivity],
  );

  const handleSpeechEnd = useCallback(
    async (audioFloat32, epoch) => {
      if (epoch !== runEpochRef.current) {
        return;
      }

      clearInterruptTimer();
      pendingSpeechTasksRef.current += 1;
      markSpeechActivity();
      logVoice('Queued speech-end task from VAD.', {
        epoch,
        audioSamples: audioFloat32 instanceof Float32Array ? audioFloat32.length : 0,
        pendingSpeechTasks: pendingSpeechTasksRef.current,
      });

      return enqueueSpeechTask(async () => {
        if (epoch !== runEpochRef.current) {
          logVoice('Skipped speech-end task because epoch is stale.', {
            epoch,
            activeEpoch: runEpochRef.current,
          });
          return;
        }

        const currentSegmentIndex = segmentIndexRef.current;
        segmentIndexRef.current += 1;
        const chunks = splitFloat32ToPcmChunks(audioFloat32, DEFAULT_FRAME_SAMPLES);
        if (!chunks.length) {
          console.warn('[voice-mic] Speech-end task produced no PCM chunks.', {
            epoch,
            segmentIndex: currentSegmentIndex,
            audioSamples: audioFloat32 instanceof Float32Array ? audioFloat32.length : 0,
          });
          return;
        }

        logVoice('Processing speech segment for commit.', {
          epoch,
          segmentIndex: currentSegmentIndex,
          pcmChunkCount: chunks.length,
          audioSamples: audioFloat32 instanceof Float32Array ? audioFloat32.length : 0,
        });

        for (const pcmChunk of chunks) {
          if (epoch !== runEpochRef.current) {
            logVoice('Stopped sending PCM chunks because epoch changed mid-segment.', {
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
            console.warn('[voice-mic] Failed to send PCM chunk to voice session.', {
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
          logVoice('Skipped commit because epoch changed after chunk upload.', {
            epoch,
            activeEpoch: runEpochRef.current,
            segmentIndex: currentSegmentIndex,
          });
          return;
        }

        const finalSeq = sentSeqRef.current;
        if (finalSeq <= lastCommittedSeqRef.current) {
          logVoice('Skipped commit because no new PCM sequence was buffered.', {
            epoch,
            segmentIndex: currentSegmentIndex,
            finalSeq,
            lastCommittedSeq: lastCommittedSeqRef.current,
          });
          return;
        }

        logVoice('Submitting speech segment to ASR commit.', {
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
          console.warn('[voice-mic] ASR commit returned a non-ok result.', {
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
        logVoice('Speech segment commit finished.', {
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
          logVoice('Stored ASR text for aggregated submit.', {
            epoch,
            segmentIndex: currentSegmentIndex,
            bufferedSegmentCount: segmentTextsRef.current.length,
            textLength: finalText.length,
          });
          scheduleAutoSubmit();
        }
      }).finally(() => {
        pendingSpeechTasksRef.current = Math.max(0, pendingSpeechTasksRef.current - 1);
        markSpeechActivity();
        logVoice('Speech-end task settled.', {
          epoch,
          pendingSpeechTasks: pendingSpeechTasksRef.current,
          bufferedSegmentCount: segmentTextsRef.current.length,
        });
      });
    },
    [
      clearInterruptTimer,
      commitInput,
      enqueueSpeechTask,
      markSpeechActivity,
      scheduleAutoSubmit,
      sendAudioChunk,
    ],
  );

  const disableVoice = useCallback(
    async ({ reason = 'manual' } = {}) => {
      if (isTransitioningRef.current) {
        return { ok: false, reason: 'voice_toggle_transitioning' };
      }

      if (!isEnabledRef.current) {
        return { ok: true, reason: 'not_enabled' };
      }

      isTransitioningRef.current = true;
      setIsTransitioning(true);
      clearAutoSubmitTimer();
      clearInterruptTimer();
      logVoice('Disabling voice input.', {
        reason,
        sessionId,
      });
      isEnabledRef.current = false;
      setIsEnabled(false);
      setLocalError('');

      try {
        const preserveVoiceSession = shouldPreserveVoiceSessionAfterDisable(reason);
        const submitResult = await stopVoiceCaptureAndSubmit({
          reason,
          stopVad,
          flushPendingSpeechAndSubmit,
          invalidateEpoch: () => {
            runEpochRef.current += 1;
          },
        });
        if (!submitResult?.ok && submitResult?.reason !== 'empty_text') {
          setLocalError(submitResult.reason || 'voice_submit_failed');
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
        if (mountedRef.current) {
          setCapturedFrames(0);
        }

        if (preserveVoiceSession) {
          logVoice('Preserved voice session for downstream playback.', {
            reason,
            sessionId,
          });
        } else {
          await stopPlayback({
            emitFinalAck: true,
            resetSeq: true,
          });
          await stopTts({ reason });
          await stopSession({ reason });
        }

        logVoice('Voice input disabled and state cleared.', {
          reason,
          preservedVoiceSession: preserveVoiceSession,
        });
        return { ok: true };
      } finally {
        isTransitioningRef.current = false;
        if (mountedRef.current) {
          setIsTransitioning(false);
        }
      }
    },
    [
      clearAutoSubmitTimer,
      clearInterruptTimer,
      flushPendingSpeechAndSubmit,
      sessionId,
      stopPlayback,
      stopSession,
      stopTts,
      stopVad,
    ],
  );

  const enableVoice = useCallback(async () => {
    if (!desktopMode) {
      const errorMessage = 'Voice mode requires desktop runtime.';
      setLocalError(errorMessage);
      return { ok: false, reason: 'desktop_only', message: errorMessage };
    }

    if (isTransitioningRef.current) {
      return { ok: false, reason: 'voice_toggle_transitioning' };
    }

    if (isEnabledRef.current) {
      return { ok: true, reason: 'already_enabled' };
    }

    isTransitioningRef.current = true;
    setIsTransitioning(true);
    clearAutoSubmitTimer();
    clearInterruptTimer();
    setLocalError('');

    try {
      await stopSession({ reason: 'enable_voice' });
      await stopPlayback({
        emitFinalAck: false,
        resetSeq: true,
      });
      await stopTts({ reason: 'enable_voice' });
      logVoice('Enabling voice input and starting session.', {
        sessionId: chatSessionId,
        hotkey: normalizedHotkey,
      });

      const nextEpoch = runEpochRef.current + 1;
      runEpochRef.current = nextEpoch;
      const started = await startSession({
        mode: 'vad',
        sessionId: chatSessionId,
      });
      if (!started?.ok) {
        console.warn('[voice-mic] Failed to start voice session.', {
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

      const vadStarted = await startVad({
        onSpeechStart: async () => handleSpeechStart(nextEpoch),
        onSpeechEnd: async (audioFloat32) => handleSpeechEnd(audioFloat32, nextEpoch),
        onVADMisfire: async () => handleVADMisfire(nextEpoch),
      });

      if (!vadStarted?.ok) {
        await stopSession({ reason: 'vad_start_failed' });
        const errorMessage = vadStarted?.reason || 'silero_vad_start_failed';
        setLocalError(errorMessage);
        return vadStarted;
      }

      isEnabledRef.current = true;
      setIsEnabled(true);
      logVoice('Voice input is now enabled.', {
        sessionId: started.sessionId || chatSessionId,
        hotkey: normalizedHotkey,
      });
      return { ok: true };
    } finally {
      isTransitioningRef.current = false;
      if (mountedRef.current) {
        setIsTransitioning(false);
      }
    }
  }, [
    chatSessionId,
    clearAutoSubmitTimer,
    clearInterruptTimer,
    desktopMode,
    handleSpeechEnd,
    handleSpeechStart,
    handleVADMisfire,
    normalizedHotkey,
    startSession,
    startVad,
    stopPlayback,
    stopSession,
    stopTts,
  ]);

  const toggleVoice = useCallback(async () => {
    if (isTransitioningRef.current) {
      return { ok: false, reason: 'voice_toggle_transitioning' };
    }

    if (isEnabledRef.current) {
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
    isVadSpeakingRef.current = isVadSpeaking;
  }, [isVadSpeaking]);

  useEffect(() => {
    isPlayingTtsRef.current = isPlayingTts;
  }, [isPlayingTts]);

  useEffect(() => onEvent(handleVoiceEvent), [handleVoiceEvent, onEvent]);

  useEffect(() => {
    if (!desktopMode) {
      return () => {};
    }

    return desktopBridge.voice.onToggleRequest((payload = {}) => {
      logVoice('Received global voice toggle request.', {
        hotkey: payload.accelerator || normalizedHotkey,
        source: payload.source || 'unknown',
      });
      void toggleVoice();
    });
  }, [desktopMode, normalizedHotkey, toggleVoice]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearAutoSubmitTimer();
      clearInterruptTimer();
      isEnabledRef.current = false;
      isSubmittingRef.current = false;
      runEpochRef.current += 1;
      void stopPlaybackRef.current?.({
        emitFinalAck: false,
        resetSeq: true,
      });
      void stopVadRef.current?.();
      void stopSessionRef.current?.({ reason: 'toggle_unmount' });
    };
  }, [clearAutoSubmitTimer, clearInterruptTimer]);

  const error = localError || lastError || vadError || playbackError || '';

  return useMemo(
    () => ({
      isEnabled,
      isBusy: isVadLoading || isProcessingSpeech || isSubmitting || isTransitioning,
      isAvailable: desktopMode,
      isPttCapturing: isEnabled,
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
      isEnabled,
      isPlayingTts,
      isProcessingSpeech,
      isSubmitting,
      isTransitioning,
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
