import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { desktopBridge } from '../../services/desktopBridge.js';

const STATUS_IDLE = 'idle';

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `voice-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeVoiceError(error) {
  if (typeof error === 'string' && error) {
    return error;
  }

  if (typeof error?.message === 'string' && error.message) {
    return error.message;
  }

  return 'Voice request failed.';
}

export function useVoiceSession({ desktopMode = desktopBridge.isDesktop() } = {}) {
  const sessionIdRef = useRef('');
  const [sessionId, setSessionId] = useState('');
  const [status, setStatus] = useState(STATUS_IDLE);
  const [lastPartialText, setLastPartialText] = useState('');
  const [lastFinalText, setLastFinalText] = useState('');
  const [lastError, setLastError] = useState('');
  const [flowControl, setFlowControl] = useState({ action: 'resume', bufferedMs: 0 });

  const setSessionIdWithRef = useCallback((nextSessionId) => {
    sessionIdRef.current = nextSessionId || '';
    setSessionId(nextSessionId || '');
  }, []);

  const active = Boolean(sessionIdRef.current && status !== STATUS_IDLE);

  useEffect(() => {
    if (!desktopMode) {
      return () => {};
    }

    const disposeEvent = desktopBridge.voice.onEvent((event = {}) => {
      const currentSessionId = sessionIdRef.current;
      if (currentSessionId && event.sessionId && event.sessionId !== currentSessionId) {
        return;
      }

      if (event.type === 'state' && event.status) {
        setStatus(event.status);
      }

      if (event.type === 'asr-partial' && typeof event.text === 'string') {
        setLastPartialText(event.text);
      }

      if (event.type === 'asr-final' && typeof event.text === 'string') {
        setLastFinalText(event.text);
      }

      if (event.type === 'error') {
        setLastError(normalizeVoiceError(event));
      }

      if (event.type === 'done' && event.stage === 'session') {
        setStatus(STATUS_IDLE);
        setSessionIdWithRef('');
      }
    });

    const disposeFlow = desktopBridge.voice.onFlowControl((event = {}) => {
      const currentSessionId = sessionIdRef.current;
      if (currentSessionId && event.sessionId && event.sessionId !== currentSessionId) {
        return;
      }

      setFlowControl({
        action: event.action === 'pause' ? 'pause' : 'resume',
        bufferedMs: typeof event.bufferedMs === 'number' ? event.bufferedMs : 0,
      });
    });

    return () => {
      disposeEvent();
      disposeFlow();
    };
  }, [desktopMode, setSessionIdWithRef]);

  const startSession = useCallback(
    async ({ mode = 'vad' } = {}) => {
      if (!desktopMode) {
        setLastError('Voice mode requires desktop runtime.');
        return { ok: false, reason: 'desktop_only' };
      }

      const nextSessionId = createSessionId();
      setLastError('');
      setLastPartialText('');
      setLastFinalText('');

      const result = await desktopBridge.voice.start({
        sessionId: nextSessionId,
        mode,
      });

      if (!result?.ok) {
        setLastError(result?.reason || 'voice_session_start_failed');
        return result;
      }

      setSessionIdWithRef(nextSessionId);
      setStatus(result.status || 'listening');
      return result;
    },
    [desktopMode, setSessionIdWithRef],
  );

  const sendAudioChunk = useCallback(
    async ({
      seq,
      chunkId,
      pcmChunk,
      sampleRate = 16000,
      channels = 1,
      sampleFormat = 'pcm_s16le',
      isSpeech = false,
    } = {}) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
        return { ok: false, reason: 'session_not_started' };
      }

      return desktopBridge.voice.sendAudioChunk({
        sessionId: activeSessionId,
        seq,
        chunkId,
        pcmChunk,
        sampleRate,
        channels,
        sampleFormat,
        isSpeech,
      });
    },
    [],
  );

  const commitInput = useCallback(
    async ({ finalSeq } = {}) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
        return { ok: false, reason: 'session_not_started' };
      }

      return desktopBridge.voice.commit({
        sessionId: activeSessionId,
        finalSeq,
      });
    },
    [],
  );

  const stopSession = useCallback(
    async ({ reason = 'manual' } = {}) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
        return { ok: true, reason: 'not_started' };
      }

      const result = await desktopBridge.voice.stop({
        sessionId: activeSessionId,
        reason,
      });
      setSessionIdWithRef('');
      setStatus(STATUS_IDLE);
      return result;
    },
    [setSessionIdWithRef],
  );

  const stopTts = useCallback(
    async ({ reason = 'manual' } = {}) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
        return { ok: true, reason: 'not_started' };
      }

      return desktopBridge.voice.stopTts({
        sessionId: activeSessionId,
        reason,
      });
    },
    [],
  );

  const sendPlaybackAck = useCallback(
    async ({ ackSeq, bufferedMs } = {}) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
        return { ok: false, reason: 'session_not_started' };
      }

      return desktopBridge.voice.sendPlaybackAck({
        sessionId: activeSessionId,
        ackSeq,
        bufferedMs,
      });
    },
    [],
  );

  return useMemo(
    () => ({
      sessionId,
      status,
      active,
      lastPartialText,
      lastFinalText,
      lastError,
      flowControl,
      startSession,
      sendAudioChunk,
      commitInput,
      stopSession,
      stopTts,
      sendPlaybackAck,
    }),
    [
      sessionId,
      status,
      active,
      lastPartialText,
      lastFinalText,
      lastError,
      flowControl,
      startSession,
      sendAudioChunk,
      commitInput,
      stopSession,
      stopTts,
      sendPlaybackAck,
    ],
  );
}
