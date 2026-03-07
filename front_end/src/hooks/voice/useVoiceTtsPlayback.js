import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createTtsPlaybackLifecycleTracker } from './ttsPlaybackLifecycle.js';

const ACK_INTERVAL_MS = 200;
const MIN_SCHEDULE_LEAD_SECONDS = 0.02;

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }

  return new Uint8Array(0);
}

function pcmS16leToFloat32(inputBytes) {
  if (!(inputBytes instanceof Uint8Array) || inputBytes.byteLength < 2) {
    return new Float32Array(0);
  }

  const sampleCount = Math.floor(inputBytes.byteLength / 2);
  const out = new Float32Array(sampleCount);
  const view = new DataView(inputBytes.buffer, inputBytes.byteOffset, inputBytes.byteLength);
  for (let i = 0; i < sampleCount; i += 1) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

function pcmF32leToFloat32(inputBytes) {
  if (!(inputBytes instanceof Uint8Array) || inputBytes.byteLength < 4) {
    return new Float32Array(0);
  }

  const sampleCount = Math.floor(inputBytes.byteLength / 4);
  const out = new Float32Array(sampleCount);
  const view = new DataView(inputBytes.buffer, inputBytes.byteOffset, inputBytes.byteLength);
  for (let i = 0; i < sampleCount; i += 1) {
    out[i] = view.getFloat32(i * 4, true);
  }
  return out;
}

function decodeChunkSamples({ audioChunk, codec }) {
  const bytes = toUint8Array(audioChunk);
  if (!bytes.length) {
    return new Float32Array(0);
  }

  if (codec === 'pcm_s16le') {
    return pcmS16leToFloat32(bytes);
  }

  if (codec === 'pcm_f32le') {
    return pcmF32leToFloat32(bytes);
  }

  throw new Error(`unsupported_tts_codec:${codec || 'unknown'}`);
}

function clampSampleRate(value, fallback = 24000) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

export function useVoiceTtsPlayback({
  desktopMode = false,
  sessionId = '',
  sendPlaybackAck,
} = {}) {
  const audioContextRef = useRef(null);
  const gainNodeRef = useRef(null);
  const activeSourcesRef = useRef(new Set());
  const nextStartTimeRef = useRef(0);
  const lastAckSeqRef = useRef(0);
  const ackTimerRef = useRef(null);
  const ackInFlightRef = useRef(false);
  const playbackSessionIdRef = useRef('');
  const playbackLifecycleRef = useRef(createTtsPlaybackLifecycleTracker());

  const [isPlaying, setIsPlaying] = useState(false);
  const [bufferedMs, setBufferedMs] = useState(0);
  const [lastCodec, setLastCodec] = useState('');
  const [playbackError, setPlaybackError] = useState('');

  const getBufferedMs = useCallback(() => {
    const context = audioContextRef.current;
    if (!context) {
      return 0;
    }

    return Math.max(0, (nextStartTimeRef.current - context.currentTime) * 1000);
  }, []);

  const emitAck = useCallback(async () => {
    const targetSessionId = sessionId || playbackSessionIdRef.current;
    if (!desktopMode || !targetSessionId || typeof sendPlaybackAck !== 'function') {
      return;
    }

    if (lastAckSeqRef.current <= 0 || ackInFlightRef.current) {
      return;
    }

    const nextBufferedMs = Math.floor(getBufferedMs());
    setBufferedMs(nextBufferedMs);

    ackInFlightRef.current = true;
    try {
      await sendPlaybackAck({
        sessionId: targetSessionId,
        ackSeq: lastAckSeqRef.current,
        bufferedMs: nextBufferedMs,
      });
    } finally {
      ackInFlightRef.current = false;
    }
  }, [desktopMode, getBufferedMs, sendPlaybackAck, sessionId]);

  const stopAckTimer = useCallback(() => {
    if (ackTimerRef.current) {
      clearInterval(ackTimerRef.current);
      ackTimerRef.current = null;
    }
  }, []);

  const startAckTimer = useCallback(() => {
    if (ackTimerRef.current) {
      return;
    }

    ackTimerRef.current = setInterval(() => {
      void emitAck();
    }, ACK_INTERVAL_MS);
  }, [emitAck]);

  const ensureAudioContextReady = useCallback(async () => {
    if (!desktopMode) {
      return null;
    }

    if (!audioContextRef.current) {
      const context = new AudioContext();
      const gainNode = context.createGain();
      gainNode.gain.value = 1;
      gainNode.connect(context.destination);
      audioContextRef.current = context;
      gainNodeRef.current = gainNode;
      nextStartTimeRef.current = context.currentTime;
    }

    const context = audioContextRef.current;
    if (context.state === 'suspended') {
      await context.resume();
    }

    return context;
  }, [desktopMode]);

  const stopPlayback = useCallback(
    async ({ emitFinalAck = true, resetSeq = false } = {}) => {
      playbackLifecycleRef.current.reset({ reason: 'playback_stopped' });
      for (const source of activeSourcesRef.current) {
        try {
          source.stop();
        } catch {
          // noop
        }
      }
      activeSourcesRef.current.clear();

      const context = audioContextRef.current;
      if (context) {
        nextStartTimeRef.current = context.currentTime;
      } else {
        nextStartTimeRef.current = 0;
      }

      setIsPlaying(false);
      setBufferedMs(0);
      stopAckTimer();

      if (emitFinalAck) {
        await emitAck();
      }

      if (resetSeq) {
        lastAckSeqRef.current = 0;
        playbackSessionIdRef.current = '';
      }
    },
    [emitAck, stopAckTimer],
  );

  const scheduleChunk = useCallback(
    async ({ audioChunk, codec, sampleRate, seq, sessionId: chunkSessionId, turnId, segmentId, index, text }) => {
      const context = await ensureAudioContextReady();
      if (!context) {
        return;
      }

      if (typeof chunkSessionId === 'string' && chunkSessionId.trim()) {
        playbackSessionIdRef.current = chunkSessionId.trim();
      }

      const safeCodec = typeof codec === 'string' ? codec : '';
      const samples = decodeChunkSamples({
        audioChunk,
        codec: safeCodec,
      });
      if (!samples.length) {
        return;
      }

      const safeSampleRate = clampSampleRate(sampleRate, context.sampleRate || 24000);
      const audioBuffer = context.createBuffer(1, samples.length, safeSampleRate);
      audioBuffer.copyToChannel(samples, 0);

      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNodeRef.current || context.destination);

      const startAt = Math.max(
        context.currentTime + MIN_SCHEDULE_LEAD_SECONDS,
        nextStartTimeRef.current,
      );
      const durationSeconds = samples.length / safeSampleRate;
      nextStartTimeRef.current = startAt + durationSeconds;
      const handleChunkEnded = playbackLifecycleRef.current.scheduleChunkPlayback({
        sessionId: chunkSessionId,
        turnId,
        segmentId,
        index,
        text,
        startAt,
        currentTime: context.currentTime,
      });

      source.onended = () => {
        activeSourcesRef.current.delete(source);
        handleChunkEnded();
        if (activeSourcesRef.current.size === 0 && getBufferedMs() <= 1) {
          setIsPlaying(false);
          setBufferedMs(0);
          stopAckTimer();
          void emitAck();
        }
      };
      activeSourcesRef.current.add(source);
      source.start(startAt);

      lastAckSeqRef.current = Math.max(
        lastAckSeqRef.current,
        typeof seq === 'number' && Number.isFinite(seq) ? Math.floor(seq) : 0,
      );
      setLastCodec(safeCodec);
      setIsPlaying(true);
      startAckTimer();
      await emitAck();
    },
    [emitAck, ensureAudioContextReady, getBufferedMs, startAckTimer, stopAckTimer],
  );

  const handleVoiceEvent = useCallback(
    (event = {}) => {
      if (!event || typeof event !== 'object') {
        return;
      }

      if (event.type === 'tts-chunk') {
        setPlaybackError('');
        if (typeof event.sessionId === 'string' && event.sessionId.trim()) {
          playbackSessionIdRef.current = event.sessionId.trim();
        }
        void scheduleChunk(event).catch((error) => {
          const message = error?.message || 'tts_playback_failed';
          setPlaybackError(message);
          console.error('TTS playback failed:', error);
        });
        return;
      }

      if (event.type === 'segment-tts-started') {
        playbackLifecycleRef.current.markSegmentStarted(event);
        return;
      }

      if (event.type === 'segment-tts-finished') {
        playbackLifecycleRef.current.markSegmentFinished(event);
        return;
      }

      if (event.type === 'segment-tts-failed') {
        playbackLifecycleRef.current.markSegmentFailed(event);
      }

      const isSpeakingStage = event.stage === 'speaking';
      if (event.type === 'error' && isSpeakingStage) {
        setPlaybackError(event.message || 'tts_playback_failed');
        void stopPlayback({
          emitFinalAck: false,
          resetSeq: false,
        });
        return;
      }

      if (event.type === 'done' && event.stage === 'session') {
        void stopPlayback({
          emitFinalAck: true,
          resetSeq: false,
        });
        return;
      }

      if (event.type === 'done' && isSpeakingStage && event.aborted) {
        void stopPlayback({
          emitFinalAck: true,
          resetSeq: false,
        });
      }
    },
    [scheduleChunk, stopPlayback],
  );

  useEffect(() => {
    const activeSources = activeSourcesRef.current;
    const playbackLifecycle = playbackLifecycleRef.current;

    return () => {
      playbackLifecycle.reset({ reason: 'playback_unmount' });
      stopAckTimer();
      for (const source of activeSources) {
        try {
          source.stop();
        } catch {
          // noop
        }
      }
      activeSources.clear();
      nextStartTimeRef.current = 0;
      lastAckSeqRef.current = 0;
      playbackSessionIdRef.current = '';

      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      gainNodeRef.current = null;
    };
  }, [stopAckTimer]);

  return useMemo(
    () => ({
      handleVoiceEvent,
      stopPlayback,
      isPlaying,
      bufferedMs,
      lastCodec,
      playbackError,
    }),
    [bufferedMs, handleVoiceEvent, isPlaying, lastCodec, playbackError, stopPlayback],
  );
}
