const { createAsrService } = require('../services/voice/asrService');
const { createTtsService } = require('../services/voice/ttsService');

const SESSION_STATUS_IDLE = 'idle';
const SESSION_STATUS_LISTENING = 'listening';
const SESSION_STATUS_TRANSCRIBING = 'transcribing';
const SESSION_STATUS_SPEAKING = 'speaking';
const SESSION_STATUS_ERROR = 'error';
const TTS_PAUSE_HIGH_WATERMARK_MS = 2000;
const TTS_RESUME_LOW_WATERMARK_MS = 800;
const DEFAULT_TTS_BACKPRESSURE_TIMEOUT_MS = 5000;
const TTS_ACK_WATCHDOG_INTERVAL_MS = 200;

function createAbortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function toVoiceError(error, fallbackCode = 'voice_unknown_error', fallbackStage = 'unknown') {
  if (error?.name === 'AbortError') {
    return {
      code: 'aborted',
      message: 'Operation aborted.',
      stage: fallbackStage,
      retriable: true,
    };
  }

  if (error && typeof error === 'object' && typeof error.code === 'string') {
    return {
      code: error.code,
      message: error.message || 'Voice request failed.',
      stage: error.stage || fallbackStage,
      retriable: Boolean(error.retriable),
    };
  }

  return {
    code: fallbackCode,
    message: error?.message || 'Voice request failed.',
    stage: fallbackStage,
    retriable: false,
  };
}

function normalizeSessionId(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function normalizeSeq(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function cloneBinaryChunk(value) {
  if (Buffer.isBuffer(value)) {
    return Uint8Array.from(value);
  }

  if (value instanceof Uint8Array) {
    return Uint8Array.from(value);
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }

  if (ArrayBuffer.isView(value)) {
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return Uint8Array.from(view);
  }

  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }

  return new Uint8Array(0);
}

function toSafeVoiceEvent(event) {
  if (!event || typeof event !== 'object') {
    return event;
  }

  if (event.type === 'tts-chunk' && Object.prototype.hasOwnProperty.call(event, 'audioChunk')) {
    return {
      ...event,
      audioChunk: cloneBinaryChunk(event.audioChunk),
    };
  }

  return event;
}

function isTruthyEnv(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return fallback;
}

function buildVoiceEnvFingerprint(env = {}) {
  const entries = Object.keys(env)
    .filter((key) => key.startsWith('VOICE_'))
    .sort()
    .map((key) => `${key}=${env[key] ?? ''}`);
  return entries.join('\n');
}

function createTtsBackpressureTimeoutError(timeoutMs) {
  const error = new Error(`No playback ACK received for ${timeoutMs}ms.`);
  error.code = 'voice_tts_backpressure_timeout';
  error.stage = 'speaking';
  error.retriable = true;
  return error;
}

function clearTtsAckWatchdog(sessionState) {
  if (sessionState?.ttsAckWatchdog) {
    clearInterval(sessionState.ttsAckWatchdog);
    sessionState.ttsAckWatchdog = null;
  }
}

function resolveTtsResumeWaiters(sessionState) {
  if (!sessionState?.ttsResumeWaiters) {
    return;
  }

  for (const resolve of sessionState.ttsResumeWaiters) {
    try {
      resolve();
    } catch {
      // noop
    }
  }

  sessionState.ttsResumeWaiters.clear();
}

function setTtsFlowPaused(sessionState, paused) {
  if (!sessionState) {
    return false;
  }

  if (sessionState.ttsFlowPaused === paused) {
    return false;
  }

  sessionState.ttsFlowPaused = paused;
  if (!paused) {
    resolveTtsResumeWaiters(sessionState);
  }

  return true;
}

async function waitForTtsResume({ sessionState, signal, timeoutMs }) {
  if (!sessionState?.ttsFlowPaused) {
    return;
  }

  await new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      sessionState.ttsResumeWaiters.delete(onResume);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const onResume = () => {
      cleanup();
      resolve();
    };

    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(createTtsBackpressureTimeoutError(timeoutMs));
    }, timeoutMs);

    sessionState.ttsResumeWaiters.add(onResume);

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
      }
    }
  });
}

function startTtsAckWatchdog(sessionState, timeoutMs) {
  clearTtsAckWatchdog(sessionState);
  sessionState.ttsAckWatchdog = setInterval(() => {
    if (!sessionState?.ttsStartedAt || !sessionState?.ttsController) {
      return;
    }

    const now = Date.now();
    const lastAckAt = sessionState.ttsLastAckAt || sessionState.ttsStartedAt;
    if (now - lastAckAt <= timeoutMs) {
      return;
    }

    sessionState.ttsAbortReason = 'backpressure_timeout';
    sessionState.ttsStopNotified = false;
    setTtsFlowPaused(sessionState, false);
    sessionState.ttsController.abort();
  }, TTS_ACK_WATCHDOG_INTERVAL_MS);
  sessionState.ttsAckWatchdog.unref?.();
}

function resetTtsRuntimeState(sessionState) {
  clearTtsAckWatchdog(sessionState);
  setTtsFlowPaused(sessionState, false);
  resolveTtsResumeWaiters(sessionState);
  sessionState.ttsController = null;
  sessionState.ttsStartedAt = 0;
  sessionState.ttsLastAckAt = 0;
  sessionState.ttsLastChunkSeq = 0;
  sessionState.ttsStopNotified = false;
  sessionState.ttsAbortReason = '';
}

function registerVoiceSessionIpc({
  ipcMain,
  emitEvent,
  emitFlowControl,
  createAsrServiceImpl = createAsrService,
  createTtsServiceImpl = createTtsService,
  onAsrFinal,
  autoTtsOnAsrFinal = false,
  resolveVoiceEnv,
  ttsBackpressureTimeoutMs = DEFAULT_TTS_BACKPRESSURE_TIMEOUT_MS,
}) {
  const sessionMap = new Map();
  let cachedAsrService = null;
  let cachedTtsService = null;
  let cachedEnvFingerprint = '';

  const sendEvent = (event) => {
    try {
      emitEvent(toSafeVoiceEvent(event));
    } catch (error) {
      console.error('Failed to emit voice event:', error);
    }
  };

  const sendFlowControl = (event) => {
    if (typeof emitFlowControl !== 'function') {
      return;
    }

    try {
      emitFlowControl(event);
    } catch (error) {
      console.error('Failed to emit voice flow-control event:', error);
    }
  };

  const sendState = (sessionId, status) => {
    sendEvent({
      type: 'state',
      sessionId,
      status,
    });
  };

  const sendError = (sessionId, errorPayload) => {
    sendEvent({
      type: 'error',
      sessionId,
      ...errorPayload,
    });
  };

  const sendDone = (sessionId, stage, extra = {}) => {
    sendEvent({
      type: 'done',
      sessionId,
      stage,
      ...extra,
    });
  };

  const safeTtsBackpressureTimeoutMs = normalizePositiveInteger(
    ttsBackpressureTimeoutMs,
    DEFAULT_TTS_BACKPRESSURE_TIMEOUT_MS,
  );

  const resolveRuntime = () => {
    const env =
      typeof resolveVoiceEnv === 'function'
        ? resolveVoiceEnv()
        : process.env;

    const fingerprint = buildVoiceEnvFingerprint(env);
    if (!cachedAsrService || !cachedTtsService || cachedEnvFingerprint !== fingerprint) {
      cachedAsrService = createAsrServiceImpl({ env });
      cachedTtsService = createTtsServiceImpl({ env });
      cachedEnvFingerprint = fingerprint;
    }

    return {
      env,
      asrService: cachedAsrService,
      ttsService: cachedTtsService,
      autoTtsOnAsrFinal: isTruthyEnv(env?.VOICE_TTS_AUTO_ON_ASR_FINAL, autoTtsOnAsrFinal),
    };
  };

  const buildSessionState = (sessionId, mode) => ({
    sessionId,
    mode: mode || 'vad',
    status: SESSION_STATUS_LISTENING,
    lastSeq: 0,
    lastAckSeq: 0,
    bufferedMs: 0,
    audioChunks: [],
    asrController: null,
    ttsController: null,
    ttsResumeWaiters: new Set(),
    ttsFlowPaused: false,
    ttsStartedAt: 0,
    ttsLastAckAt: 0,
    ttsLastChunkSeq: 0,
    ttsAckWatchdog: null,
    ttsBackpressureTimeoutMs: safeTtsBackpressureTimeoutMs,
    ttsAbortReason: '',
    ttsStopNotified: false,
  });

  ipcMain.handle('voice:session:start', async (_event, request = {}) => {
    const sessionId = normalizeSessionId(request.sessionId);
    if (!sessionId) {
      return {
        ok: false,
        reason: 'invalid_session_id',
      };
    }

    const existing = sessionMap.get(sessionId);
    if (existing) {
      return {
        ok: true,
        sessionId,
        status: existing.status,
      };
    }

    const sessionState = buildSessionState(sessionId, request.mode);
    sessionMap.set(sessionId, sessionState);
    sendState(sessionId, sessionState.status);

    return {
      ok: true,
      sessionId,
      status: sessionState.status,
    };
  });

  ipcMain.handle('voice:audio:chunk', async (_event, request = {}) => {
    const sessionId = normalizeSessionId(request.sessionId);
    const sessionState = sessionMap.get(sessionId);
    if (!sessionState) {
      return {
        ok: false,
        reason: 'session_not_found',
      };
    }

    const seq = normalizeSeq(request.seq);
    if (seq <= sessionState.lastSeq) {
      return {
        ok: false,
        reason: 'stale_seq',
      };
    }

    sessionState.lastSeq = seq;

    const chunkValue = request.pcmChunk;
    const chunkBuffer = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue || []);
    if (!chunkBuffer.length) {
      return {
        ok: false,
        reason: 'empty_chunk',
      };
    }

    sessionState.audioChunks.push({
      seq,
      chunkId: normalizeSeq(request.chunkId),
      sampleRate: normalizeSeq(request.sampleRate) || 16000,
      channels: normalizeSeq(request.channels) || 1,
      sampleFormat: typeof request.sampleFormat === 'string' ? request.sampleFormat : 'pcm_s16le',
      isSpeech: Boolean(request.isSpeech),
      pcmChunk: chunkBuffer,
    });

    return {
      ok: true,
      accepted: true,
      seq,
    };
  });

  ipcMain.handle('voice:input:commit', async (_event, request = {}) => {
    const sessionId = normalizeSessionId(request.sessionId);
    const sessionState = sessionMap.get(sessionId);
    if (!sessionState) {
      return {
        ok: false,
        reason: 'session_not_found',
      };
    }

    if (sessionState.status === SESSION_STATUS_TRANSCRIBING) {
      return {
        ok: false,
        reason: 'transcribing_in_progress',
      };
    }

    const committedChunks = sessionState.audioChunks;
    if (!committedChunks.length) {
      return {
        ok: false,
        reason: 'empty_audio',
      };
    }
    sessionState.audioChunks = [];

    sessionState.status = SESSION_STATUS_TRANSCRIBING;
    sendState(sessionId, sessionState.status);
    sessionState.asrController = new AbortController();

    try {
      const runtime = resolveRuntime();
      let partialSeq = 0;
      const result = await runtime.asrService.transcribe({
        audioChunks: committedChunks,
        signal: sessionState.asrController.signal,
        onPartial: (text) => {
          partialSeq += 1;
          sendEvent({
            type: 'asr-partial',
            sessionId,
            seq: partialSeq,
            text,
          });
        },
      });

      const finalText = typeof result?.text === 'string' ? result.text.trim() : '';
      if (finalText) {
        sendEvent({
          type: 'asr-final',
          sessionId,
          seq: partialSeq + 1,
          text: finalText,
        });
      }

      if (typeof onAsrFinal === 'function' && finalText) {
        await onAsrFinal({
          sessionId,
          text: finalText,
        });
      }

      if (runtime.autoTtsOnAsrFinal && finalText) {
        await synthesizeTts({
          sessionId,
          text: finalText,
          ttsService: runtime.ttsService,
          sendEvent,
          sendDone,
          sendError,
          sessionState,
          ttsBackpressureTimeoutMs: safeTtsBackpressureTimeoutMs,
        });
      }

      sendDone(sessionId, 'transcribing');
      if (sessionState.status !== SESSION_STATUS_SPEAKING) {
        sessionState.status = SESSION_STATUS_LISTENING;
        sendState(sessionId, sessionState.status);
      }

      return {
        ok: true,
        text: finalText,
      };
    } catch (error) {
      sessionState.audioChunks = committedChunks.concat(sessionState.audioChunks);
      const payload = toVoiceError(error, 'voice_asr_failed', 'transcribing');
      sendError(sessionId, payload);
      sessionState.status = SESSION_STATUS_ERROR;
      sendState(sessionId, sessionState.status);
      return {
        ok: false,
        reason: 'asr_failed',
        error: payload,
      };
    }
  });

  ipcMain.handle('voice:session:stop', async (_event, request = {}) => {
    const sessionId = normalizeSessionId(request.sessionId);
    const sessionState = sessionMap.get(sessionId);
    if (!sessionState) {
      return {
        ok: true,
        reason: 'not_found',
      };
    }

    sessionState.asrController?.abort();
    sessionState.ttsAbortReason = 'session_stop';
    sessionState.ttsStopNotified = true;
    setTtsFlowPaused(sessionState, false);
    sessionState.ttsController?.abort();
    clearTtsAckWatchdog(sessionState);
    sessionState.audioChunks = [];
    sessionState.status = SESSION_STATUS_IDLE;
    sendState(sessionId, sessionState.status);
    sendDone(sessionId, 'session', { aborted: true });
    sessionMap.delete(sessionId);

    return { ok: true };
  });

  ipcMain.handle('voice:tts:stop', async (_event, request = {}) => {
    const sessionId = normalizeSessionId(request.sessionId);
    const sessionState = sessionMap.get(sessionId);
    if (!sessionState) {
      return {
        ok: true,
        reason: 'not_found',
      };
    }

    sessionState.ttsAbortReason = 'manual_stop';
    sessionState.ttsStopNotified = true;
    setTtsFlowPaused(sessionState, false);
    sessionState.ttsController?.abort();
    clearTtsAckWatchdog(sessionState);
    sessionState.status = SESSION_STATUS_LISTENING;
    sendState(sessionId, sessionState.status);
    sendDone(sessionId, 'speaking', { aborted: true });

    return { ok: true };
  });

  ipcMain.handle('voice:playback:ack', async (_event, request = {}) => {
    const sessionId = normalizeSessionId(request.sessionId);
    const sessionState = sessionMap.get(sessionId);
    if (!sessionState) {
      return {
        ok: true,
        reason: 'not_found',
      };
    }

    const ackSeq = normalizeSeq(request.ackSeq);
    const bufferedMs = normalizeSeq(request.bufferedMs);
    sessionState.lastAckSeq = Math.max(sessionState.lastAckSeq, ackSeq);
    sessionState.bufferedMs = bufferedMs;
    sessionState.ttsLastAckAt = Date.now();

    const shouldPause = bufferedMs > TTS_PAUSE_HIGH_WATERMARK_MS;
    const shouldResume = bufferedMs < TTS_RESUME_LOW_WATERMARK_MS;
    if (shouldPause) {
      setTtsFlowPaused(sessionState, true);
    } else if (shouldResume) {
      setTtsFlowPaused(sessionState, false);
    }

    if (shouldPause) {
      sendFlowControl({
        type: 'tts-flow-control',
        sessionId,
        action: 'pause',
        bufferedMs,
      });
    } else if (shouldResume) {
      sendFlowControl({
        type: 'tts-flow-control',
        sessionId,
        action: 'resume',
        bufferedMs,
      });
    }

    return {
      ok: true,
      sessionId,
      ackSeq: sessionState.lastAckSeq,
      bufferedMs: sessionState.bufferedMs,
    };
  });

  return () => {
    for (const [, sessionState] of sessionMap.entries()) {
      sessionState.asrController?.abort();
      sessionState.ttsAbortReason = 'session_stop';
      sessionState.ttsStopNotified = true;
      setTtsFlowPaused(sessionState, false);
      sessionState.ttsController?.abort();
      clearTtsAckWatchdog(sessionState);
    }
    sessionMap.clear();

    ipcMain.removeHandler('voice:session:start');
    ipcMain.removeHandler('voice:audio:chunk');
    ipcMain.removeHandler('voice:input:commit');
    ipcMain.removeHandler('voice:session:stop');
    ipcMain.removeHandler('voice:tts:stop');
    ipcMain.removeHandler('voice:playback:ack');
  };
}

async function synthesizeTts({
  sessionId,
  text,
  ttsService,
  sendEvent,
  sendDone,
  sendError,
  sessionState,
  ttsBackpressureTimeoutMs = DEFAULT_TTS_BACKPRESSURE_TIMEOUT_MS,
}) {
  resetTtsRuntimeState(sessionState);
  sessionState.status = SESSION_STATUS_SPEAKING;
  sendEvent({
    type: 'state',
    sessionId,
    status: sessionState.status,
  });

  const timeoutMs = normalizePositiveInteger(
    ttsBackpressureTimeoutMs || sessionState.ttsBackpressureTimeoutMs,
    DEFAULT_TTS_BACKPRESSURE_TIMEOUT_MS,
  );
  sessionState.ttsBackpressureTimeoutMs = timeoutMs;
  sessionState.ttsController = new AbortController();
  let seq = 0;
  try {
    await ttsService.synthesize({
      text,
      signal: sessionState.ttsController.signal,
      onChunk: async ({ audioChunk, codec, sampleRate }) => {
        await waitForTtsResume({
          sessionState,
          signal: sessionState.ttsController.signal,
          timeoutMs,
        });

        if (sessionState.ttsAbortReason === 'backpressure_timeout') {
          throw createTtsBackpressureTimeoutError(timeoutMs);
        }

        seq += 1;
        sessionState.ttsLastChunkSeq = seq;
        if (seq === 1) {
          sessionState.ttsStartedAt = Date.now();
          sessionState.ttsLastAckAt = 0;
          startTtsAckWatchdog(sessionState, timeoutMs);
        }

        sendEvent({
          type: 'tts-chunk',
          sessionId,
          seq,
          chunkId: seq,
          audioChunk,
          codec,
          sampleRate,
        });
      },
    });

    clearTtsAckWatchdog(sessionState);
    sendDone(sessionId, 'speaking');
    sessionState.status = SESSION_STATUS_LISTENING;
    sendEvent({
      type: 'state',
      sessionId,
      status: sessionState.status,
    });
  } catch (error) {
    clearTtsAckWatchdog(sessionState);

    const abortReason = sessionState.ttsAbortReason;
    const isAbort = error?.name === 'AbortError';
    const isManualAbort =
      isAbort && (abortReason === 'manual_stop' || abortReason === 'session_stop');

    if (isManualAbort) {
      if (!sessionState.ttsStopNotified && abortReason === 'manual_stop') {
        sendDone(sessionId, 'speaking', { aborted: true });
      }
      if (abortReason === 'manual_stop' && sessionState.status !== SESSION_STATUS_IDLE) {
        sessionState.status = SESSION_STATUS_LISTENING;
        sendEvent({
          type: 'state',
          sessionId,
          status: sessionState.status,
        });
      }
      resetTtsRuntimeState(sessionState);
      return;
    }

    const payload =
      abortReason === 'backpressure_timeout' || error?.code === 'voice_tts_backpressure_timeout'
        ? {
            code: 'voice_tts_backpressure_timeout',
            message: `No playback ACK received for ${timeoutMs}ms.`,
            stage: 'speaking',
            retriable: true,
          }
        : toVoiceError(error, 'voice_tts_failed', 'speaking');

    sendError(sessionId, payload);
    sessionState.status = SESSION_STATUS_ERROR;
    sendEvent({
      type: 'state',
      sessionId,
      status: sessionState.status,
    });
  } finally {
    resetTtsRuntimeState(sessionState);
  }
}

module.exports = {
  registerVoiceSessionIpc,
  synthesizeTts,
  toVoiceError,
};
