const { createAsrService } = require('../services/voice/asrService');
const { createTtsService } = require('../services/voice/ttsService');

const SESSION_STATUS_IDLE = 'idle';
const SESSION_STATUS_LISTENING = 'listening';
const SESSION_STATUS_TRANSCRIBING = 'transcribing';
const SESSION_STATUS_SPEAKING = 'speaking';
const SESSION_STATUS_ERROR = 'error';
const SESSION_MODE_INTERNAL_PLAYBACK = 'internal-playback';
const TTS_PAUSE_HIGH_WATERMARK_MS = 2000;
const TTS_RESUME_LOW_WATERMARK_MS = 800;
const DEFAULT_TTS_BACKPRESSURE_TIMEOUT_MS = 5000;
const TTS_ACK_WATCHDOG_INTERVAL_MS = 200;
const SEGMENT_TRACE_LIMIT = 20;

function logVoiceSession(message, details = {}) {
  console.info('[voice-session]', message, details);
}

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

function normalizeTurnId(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function normalizeSegmentText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function normalizeSegmentId(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function buildTurnKey(sessionId, turnId) {
  return `${sessionId}::${turnId}`;
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

function toBufferChunk(value) {
  const chunk = cloneBinaryChunk(value);
  if (!chunk.length) {
    return Buffer.alloc(0);
  }

  return Buffer.from(chunk);
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
  resolveVoiceEnv,
  ttsBackpressureTimeoutMs = DEFAULT_TTS_BACKPRESSURE_TIMEOUT_MS,
}) {
  const sessionMap = new Map();
  const segmentTracesBySession = new Map();
  let cachedAsrService = null;
  let cachedTtsService = null;
  let cachedEnvFingerprint = '';
  let cachedAsrWarm = false;
  let cachedTtsWarm = false;
  let cachedAsrWarmupPromise = null;
  let cachedTtsWarmupPromise = null;
  const segmentDebugEnabled = isTruthyEnv(process.env.VOICE_SEGMENT_DEBUG, false);

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

  const normalizeTraceLimit = (value) => {
    const parsed = normalizePositiveInteger(value, SEGMENT_TRACE_LIMIT);
    return Math.min(parsed, 200);
  };

  const getSessionTraceList = (sessionId) => {
    const key = normalizeSessionId(sessionId);
    if (!key) {
      return [];
    }

    const existing = segmentTracesBySession.get(key);
    if (existing) {
      return existing;
    }

    const created = [];
    segmentTracesBySession.set(key, created);
    return created;
  };

  const upsertSegmentTrace = (segment = {}, patch = {}) => {
    const sessionId = normalizeSessionId(segment.sessionId || patch.sessionId);
    const segmentId = normalizeSegmentId(segment.segmentId || patch.segmentId);
    if (!sessionId || !segmentId) {
      return null;
    }

    const traces = getSessionTraceList(sessionId);
    const index = traces.findIndex((item) => item.segmentId === segmentId);
    const now = Date.now();
    const base = index >= 0
      ? traces[index]
      : {
          sessionId,
          turnId: normalizeTurnId(segment.turnId),
          segmentId,
          index: normalizeSeq(segment.index),
          text: normalizeSegmentText(segment.text),
          source: typeof segment.source === 'string' ? segment.source : '',
          lang: typeof segment.lang === 'string' ? segment.lang : '',
          readyAt: 0,
          startedAt: 0,
          finishedAt: 0,
          failedAt: 0,
          status: 'ready',
          code: '',
          message: '',
          retriable: false,
          aborted: false,
          reason: '',
          updatedAt: 0,
        };

    const next = {
      ...base,
      ...(segment.turnId ? { turnId: normalizeTurnId(segment.turnId) } : {}),
      ...(typeof segment.index === 'number' ? { index: normalizeSeq(segment.index) } : {}),
      ...(segment.text ? { text: normalizeSegmentText(segment.text) } : {}),
      ...(segment.source ? { source: String(segment.source) } : {}),
      ...(segment.lang ? { lang: String(segment.lang) } : {}),
      ...patch,
      updatedAt: now,
    };

    if (index >= 0) {
      traces[index] = next;
    } else {
      traces.push(next);
      if (traces.length > SEGMENT_TRACE_LIMIT) {
        traces.splice(0, traces.length - SEGMENT_TRACE_LIMIT);
      }
    }

    return next;
  };

  const createTimingPayload = (trace) => {
    if (!trace) {
      return {};
    }

    const queueDelayMs =
      trace.readyAt > 0 && trace.startedAt > 0
        ? Math.max(0, trace.startedAt - trace.readyAt)
        : undefined;
    const ttsDurationMs =
      trace.startedAt > 0 && trace.finishedAt > 0
        ? Math.max(0, trace.finishedAt - trace.startedAt)
        : undefined;
    return {
      readyAt: trace.readyAt || undefined,
      startedAt: trace.startedAt || undefined,
      finishedAt: trace.finishedAt || undefined,
      failedAt: trace.failedAt || undefined,
      queueDelayMs,
      ttsDurationMs,
    };
  };

  const debugSegmentTrace = (label, trace) => {
    if (!segmentDebugEnabled || !trace) {
      return;
    }

    const timing = createTimingPayload(trace);
    console.info(
      `[voice-segment] ${label} session=${trace.sessionId} turn=${trace.turnId} segment=${trace.segmentId} status=${trace.status} queue=${timing.queueDelayMs ?? 'n/a'}ms tts=${timing.ttsDurationMs ?? 'n/a'}ms`,
    );
  };

  const listSegmentTraceItems = ({ sessionId = '', limit = SEGMENT_TRACE_LIMIT } = {}) => {
    const safeLimit = normalizeTraceLimit(limit);
    const normalizedSessionId = normalizeSessionId(sessionId);

    if (normalizedSessionId) {
      const items = (segmentTracesBySession.get(normalizedSessionId) || []).slice(-safeLimit);
      return items;
    }

    const merged = [];
    for (const traces of segmentTracesBySession.values()) {
      merged.push(...traces);
    }
    merged.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
    return merged.slice(-safeLimit);
  };

  const resolveRuntime = () => {
    const env =
      typeof resolveVoiceEnv === 'function'
        ? resolveVoiceEnv()
        : process.env;

    const fingerprint = buildVoiceEnvFingerprint(env);
    if (!cachedAsrService || !cachedTtsService || cachedEnvFingerprint !== fingerprint) {
      if (cachedAsrService && typeof cachedAsrService.dispose === 'function') {
        Promise.resolve(cachedAsrService.dispose()).catch(() => {});
      }
      if (cachedTtsService && typeof cachedTtsService.dispose === 'function') {
        Promise.resolve(cachedTtsService.dispose()).catch(() => {});
      }
      cachedAsrService = createAsrServiceImpl({ env });
      cachedTtsService = createTtsServiceImpl({ env });
      cachedEnvFingerprint = fingerprint;
    }

    return {
      env,
      asrService: cachedAsrService,
      ttsService: cachedTtsService,
    };
  };

  const disposeCachedRuntime = async () => {
    const pending = [];
    if (cachedAsrService && typeof cachedAsrService.dispose === 'function') {
      pending.push(Promise.resolve(cachedAsrService.dispose()).catch(() => {}));
    }
    if (cachedTtsService && typeof cachedTtsService.dispose === 'function') {
      pending.push(Promise.resolve(cachedTtsService.dispose()).catch(() => {}));
    }

    cachedAsrService = null;
    cachedTtsService = null;
    cachedEnvFingerprint = '';
    cachedAsrWarm = false;
    cachedTtsWarm = false;
    cachedAsrWarmupPromise = null;
    cachedTtsWarmupPromise = null;

    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
  };

  const ensureServiceWarm = async (serviceKey, runtime) => {
    const isAsr = serviceKey === 'asr';
    const service = isAsr ? runtime?.asrService : runtime?.ttsService;
    const alreadyWarm = isAsr ? cachedAsrWarm : cachedTtsWarm;
    if (alreadyWarm) {
      return {
        alreadyWarm: true,
        warmed: false,
      };
    }

    if (!service || typeof service.warmup !== 'function') {
      if (isAsr) {
        cachedAsrWarm = true;
      } else {
        cachedTtsWarm = true;
      }
      return {
        alreadyWarm: true,
        warmed: false,
      };
    }

    const inFlightPromise = isAsr ? cachedAsrWarmupPromise : cachedTtsWarmupPromise;
    if (inFlightPromise) {
      await inFlightPromise;
      return {
        alreadyWarm: false,
        warmed: true,
      };
    }

    const warmupPromise = Promise.resolve(service.warmup())
      .then(() => {
        if (isAsr) {
          cachedAsrWarm = true;
        } else {
          cachedTtsWarm = true;
        }
      })
      .finally(() => {
        if (isAsr) {
          cachedAsrWarmupPromise = null;
        } else {
          cachedTtsWarmupPromise = null;
        }
      });

    if (isAsr) {
      cachedAsrWarmupPromise = warmupPromise;
    } else {
      cachedTtsWarmupPromise = warmupPromise;
    }

    await warmupPromise;
    return {
      alreadyWarm: false,
      warmed: true,
    };
  };

  const warmupRuntime = async ({
    reload = false,
    warmAsr = true,
    warmTts = true,
  } = {}) => {
    if (reload) {
      await disposeCachedRuntime();
    }

    const runtime = resolveRuntime();
    const warmupTasks = [];
    const warmResults = {
      asr: {
        alreadyWarm: cachedAsrWarm,
        warmed: false,
      },
      tts: {
        alreadyWarm: cachedTtsWarm,
        warmed: false,
      },
    };

    if (warmAsr) {
      warmupTasks.push(
        ensureServiceWarm('asr', runtime).then((result) => {
          warmResults.asr = result;
        }),
      );
    }

    if (warmTts) {
      warmupTasks.push(
        ensureServiceWarm('tts', runtime).then((result) => {
          warmResults.tts = result;
        }),
      );
    }

    if (warmupTasks.length > 0) {
      await Promise.all(warmupTasks);
    }

    return {
      ...runtime,
      warmResults,
    };
  };

  const buildSessionState = (sessionId, mode, { ownedByUi = true } = {}) => ({
    sessionId,
    mode: mode || 'vad',
    ownedByUi,
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
    segmentTurns: new Map(),
    segmentTurnOrder: [],
    segmentPlaybackActive: false,
    activeSegment: null,
  });

  const shouldEmitUiLifecycle = (sessionState) => Boolean(sessionState?.ownedByUi);

  const createSessionState = (sessionId, mode, options = {}) => {
    const sessionState = buildSessionState(sessionId, mode, options);
    sessionMap.set(sessionId, sessionState);
    if (shouldEmitUiLifecycle(sessionState)) {
      sendState(sessionId, sessionState.status);
    }
    return sessionState;
  };

  const getOrCreateSessionState = (sessionId, { mode = 'vad', ownedByUi = true } = {}) => {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return null;
    }

    const existing = sessionMap.get(normalizedSessionId);
    if (existing) {
      if (ownedByUi && !existing.ownedByUi) {
        existing.ownedByUi = true;
        existing.mode = mode || existing.mode;
        sendState(normalizedSessionId, existing.status);
      }
      return existing;
    }

    return createSessionState(normalizedSessionId, mode, { ownedByUi });
  };

  const maybeDisposeInternalSession = (sessionState) => {
    if (!sessionState || sessionState.ownedByUi) {
      return;
    }

    if (sessionState.asrController || sessionState.ttsController) {
      return;
    }

    if (sessionState.audioChunks.length > 0) {
      return;
    }

    if (sessionState.segmentPlaybackActive || sessionState.segmentTurnOrder.length > 0 || sessionState.activeSegment) {
      return;
    }

    sessionMap.delete(sessionState.sessionId);
  };

  const setSessionStatus = (sessionState, nextStatus) => {
    if (!sessionState || sessionState.status === nextStatus) {
      return;
    }

    sessionState.status = nextStatus;
    if (shouldEmitUiLifecycle(sessionState)) {
      sendState(sessionState.sessionId, nextStatus);
    }
  };

  const normalizeSegmentPayload = (payload = {}) => {
    const sessionId = normalizeSessionId(payload.sessionId);
    const turnId = normalizeTurnId(payload.turnId);
    const text = normalizeSegmentText(payload.text);
    const index = normalizeSeq(payload.index);
    const segmentId = normalizeSegmentId(payload.segmentId) || `${turnId}:${index}`;

    return {
      sessionId,
      turnId,
      segmentId,
      index,
      text,
      final: Boolean(payload.final),
      source: typeof payload.source === 'string' ? payload.source : undefined,
      lang: typeof payload.lang === 'string' ? payload.lang : undefined,
      createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : undefined,
      readyAt:
        typeof payload.readyAt === 'number'
          ? payload.readyAt
          : typeof payload.createdAt === 'number'
            ? payload.createdAt
            : Date.now(),
    };
  };

  const emitSegmentLifecycleEvent = (type, segment, extra = {}) => {
    if (!segment) {
      return;
    }

    const now = Date.now();
    const tracePatch = {};
    if (type === 'segment-tts-started') {
      tracePatch.status = 'started';
      tracePatch.startedAt = now;
    } else if (type === 'segment-tts-finished') {
      tracePatch.status = 'finished';
      tracePatch.finishedAt = now;
      tracePatch.code = '';
      tracePatch.message = '';
      tracePatch.retriable = false;
      tracePatch.aborted = false;
      tracePatch.reason = '';
    } else if (type === 'segment-tts-failed') {
      tracePatch.status = 'failed';
      tracePatch.failedAt = now;
      tracePatch.code = typeof extra.code === 'string' ? extra.code : '';
      tracePatch.message = typeof extra.message === 'string' ? extra.message : '';
      tracePatch.retriable = Boolean(extra.retriable);
      tracePatch.aborted = Boolean(extra.aborted);
      tracePatch.reason = typeof extra.reason === 'string' ? extra.reason : '';
    }

    const trace = upsertSegmentTrace(segment, tracePatch);
    const timing = createTimingPayload(trace);
    debugSegmentTrace(type, trace);

    sendEvent({
      type,
      sessionId: segment.sessionId,
      turnId: segment.turnId,
      segmentId: segment.segmentId,
      index: segment.index,
      text: segment.text,
      ...timing,
      ...extra,
    });
  };

  const createTurnState = ({ sessionId, turnId }) => ({
    sessionId,
    turnId,
    key: buildTurnKey(sessionId, turnId),
    segments: [],
    segmentIds: new Set(),
    cursor: 0,
    done: false,
    aborted: false,
    abortReason: '',
    draining: false,
  });

  const getOrCreateTurnState = (sessionState, sessionId, turnId) => {
    const key = buildTurnKey(sessionId, turnId);
    const existing = sessionState.segmentTurns.get(key);
    if (existing) {
      return existing;
    }

    const turnState = createTurnState({ sessionId, turnId });
    sessionState.segmentTurns.set(key, turnState);
    sessionState.segmentTurnOrder.push(key);
    return turnState;
  };

  const emitSegmentAbortForRemaining = (
    turnState,
    reason = 'aborted',
    message = 'Operation aborted.',
    skipSegmentId = '',
  ) => {
    if (!turnState) {
      return;
    }

    const startIndex = Math.max(0, turnState.cursor);
    for (let i = startIndex; i < turnState.segments.length; i += 1) {
      if (skipSegmentId && turnState.segments[i]?.segmentId === skipSegmentId) {
        continue;
      }
      emitSegmentLifecycleEvent('segment-tts-failed', turnState.segments[i], {
        code: 'aborted',
        message,
        retriable: true,
        aborted: true,
        reason,
      });
    }
    turnState.cursor = turnState.segments.length;
  };

  const deleteTurnState = (sessionState, turnState) => {
    if (!sessionState || !turnState) {
      return;
    }

    sessionState.segmentTurns.delete(turnState.key);
    const index = sessionState.segmentTurnOrder.indexOf(turnState.key);
    if (index >= 0) {
      sessionState.segmentTurnOrder.splice(index, 1);
    }
  };

  const getNextTurnState = (sessionState) => {
    for (const key of sessionState.segmentTurnOrder) {
      const turnState = sessionState.segmentTurns.get(key);
      if (!turnState) {
        continue;
      }
      return turnState;
    }

    return null;
  };

  const hasPendingSegmentPlayback = (sessionState) => {
    if (!sessionState) {
      return false;
    }

    if (sessionState.ttsController) {
      return true;
    }

    return sessionState.segmentTurnOrder.length > 0;
  };

  const updateStatusFromSegmentQueue = (sessionState) => {
    if (!sessionState) {
      return;
    }

    if (sessionState.status === SESSION_STATUS_IDLE || sessionState.status === SESSION_STATUS_TRANSCRIBING) {
      return;
    }

    if (hasPendingSegmentPlayback(sessionState)) {
      setSessionStatus(sessionState, SESSION_STATUS_SPEAKING);
      return;
    }

    if (sessionState.status === SESSION_STATUS_SPEAKING) {
      setSessionStatus(sessionState, SESSION_STATUS_LISTENING);
    }
  };

  const markTurnAborted = (sessionState, turnState, reason, message) => {
    if (!sessionState || !turnState) {
      return;
    }

    turnState.aborted = true;
    turnState.done = true;
    turnState.abortReason = reason || turnState.abortReason || 'aborted';
    const activeSegmentId =
      sessionState.activeSegment?.turnId === turnState.turnId
        ? sessionState.activeSegment.segmentId
        : '';
    emitSegmentAbortForRemaining(turnState, reason, message, activeSegmentId);
    if (sessionState.activeSegment?.turnId === turnState.turnId) {
      sessionState.ttsAbortReason = reason || 'turn_abort';
      sessionState.ttsStopNotified = true;
      setTtsFlowPaused(sessionState, false);
      sessionState.ttsController?.abort();
      clearTtsAckWatchdog(sessionState);
    }
  };

  const abortAllTurnsForSession = (sessionState, reason, message) => {
    if (!sessionState) {
      return;
    }

    const turns = sessionState.segmentTurnOrder
      .map((key) => sessionState.segmentTurns.get(key))
      .filter(Boolean);

    for (const turnState of turns) {
      markTurnAborted(sessionState, turnState, reason, message);
    }
  };

  const markTurnDone = ({ sessionId, turnId, aborted = false, reason = '' }) => {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const normalizedTurnId = normalizeTurnId(turnId);
    if (!normalizedSessionId || !normalizedTurnId) {
      return {
        ok: false,
        reason: 'invalid_turn_ref',
      };
    }

    const sessionState = sessionMap.get(normalizedSessionId);
    if (!sessionState) {
      return {
        ok: false,
        reason: 'session_not_found',
      };
    }

    const turnState = getOrCreateTurnState(sessionState, normalizedSessionId, normalizedTurnId);
    turnState.done = true;
    if (aborted) {
      markTurnAborted(
        sessionState,
        turnState,
        reason || 'turn_abort',
        'Segment playback aborted before completion.',
      );
    }

    void drainSegmentPlaybackQueue(sessionState);
    maybeDisposeInternalSession(sessionState);
    return { ok: true };
  };

  const enqueueSegmentReady = (payload = {}) => {
    const segment = normalizeSegmentPayload(payload);
    if (!segment.sessionId || !segment.turnId || !segment.text) {
      return {
        ok: false,
        reason: 'invalid_segment',
      };
    }

    const sessionState = getOrCreateSessionState(segment.sessionId, {
      mode: SESSION_MODE_INTERNAL_PLAYBACK,
      ownedByUi: false,
    });
    if (!sessionState) {
      return {
        ok: false,
        reason: 'session_not_found',
      };
    }

    const turnState = getOrCreateTurnState(sessionState, segment.sessionId, segment.turnId);
    if (turnState.segmentIds.has(segment.segmentId)) {
      return {
        ok: true,
        accepted: false,
        reason: 'duplicate_segment',
      };
    }

    turnState.segmentIds.add(segment.segmentId);
    turnState.segments.push(segment);
    const trace = upsertSegmentTrace(segment, {
      status: 'ready',
      readyAt: typeof segment.readyAt === 'number' ? segment.readyAt : Date.now(),
    });
    debugSegmentTrace('segment-ready', trace);
    void drainSegmentPlaybackQueue(sessionState);

    return {
      ok: true,
      accepted: true,
      segmentId: segment.segmentId,
    };
  };

  async function synthesizeSegmentFromQueue({ sessionState, segment }) {
    const runtime = resolveRuntime();
    const ttsService = runtime.ttsService;
    const timeoutMs = normalizePositiveInteger(
      sessionState.ttsBackpressureTimeoutMs,
      DEFAULT_TTS_BACKPRESSURE_TIMEOUT_MS,
    );
    sessionState.ttsBackpressureTimeoutMs = timeoutMs;

    resetTtsRuntimeState(sessionState);
    sessionState.ttsController = new AbortController();
    sessionState.activeSegment = segment;
    let seq = 0;

    emitSegmentLifecycleEvent('segment-tts-started', segment);

    try {
      await ttsService.synthesize({
        text: segment.text,
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
            sessionId: segment.sessionId,
            turnId: segment.turnId,
            segmentId: segment.segmentId,
            index: segment.index,
            seq,
            chunkId: seq,
            audioChunk,
            codec,
            sampleRate,
          });
        },
      });

      clearTtsAckWatchdog(sessionState);
      emitSegmentLifecycleEvent('segment-tts-finished', segment);
      return { ok: true };
    } catch (error) {
      clearTtsAckWatchdog(sessionState);

      const abortReason = sessionState.ttsAbortReason;
      const isAbort = error?.name === 'AbortError';
      const isExpectedAbort =
        isAbort
        && (
          abortReason === 'manual_stop'
          || abortReason === 'session_stop'
          || abortReason === 'turn_abort'
          || abortReason === 'turn_error'
        );

      if (isExpectedAbort) {
        emitSegmentLifecycleEvent('segment-tts-failed', segment, {
          code: 'aborted',
          message: 'Operation aborted.',
          retriable: true,
          aborted: true,
          reason: abortReason,
        });
        return {
          ok: false,
          aborted: true,
        };
      }

      const payload =
        abortReason === 'backpressure_timeout' || error?.code === 'voice_tts_backpressure_timeout'
          ? {
              code: 'voice_tts_backpressure_timeout',
              message: `No playback ACK received for ${timeoutMs}ms.`,
              retriable: true,
            }
          : toVoiceError(error, 'voice_tts_failed', 'speaking');

      emitSegmentLifecycleEvent('segment-tts-failed', segment, {
        code: payload.code,
        message: payload.message,
        retriable: payload.retriable,
        aborted: false,
      });
      return {
        ok: false,
        aborted: false,
      };
    } finally {
      sessionState.activeSegment = null;
      resetTtsRuntimeState(sessionState);
    }
  }

  async function drainSegmentPlaybackQueue(sessionState) {
    if (!sessionState || sessionState.segmentPlaybackActive) {
      return;
    }

    sessionState.segmentPlaybackActive = true;

    try {
      while (true) {
        if (sessionState.status === SESSION_STATUS_TRANSCRIBING || sessionState.status === SESSION_STATUS_IDLE) {
          break;
        }

        const turnState = getNextTurnState(sessionState);
        if (!turnState) {
          break;
        }

        if (turnState.aborted) {
          deleteTurnState(sessionState, turnState);
          continue;
        }

        if (turnState.cursor >= turnState.segments.length) {
          if (!turnState.done) {
            break;
          }
          deleteTurnState(sessionState, turnState);
          continue;
        }

        const segment = turnState.segments[turnState.cursor];
        updateStatusFromSegmentQueue(sessionState);
        await synthesizeSegmentFromQueue({ sessionState, segment });
        turnState.cursor += 1;

        if (turnState.aborted) {
          deleteTurnState(sessionState, turnState);
          continue;
        }

        if (turnState.done && turnState.cursor >= turnState.segments.length) {
          deleteTurnState(sessionState, turnState);
        }
      }
    } finally {
      sessionState.segmentPlaybackActive = false;
      updateStatusFromSegmentQueue(sessionState);
      maybeDisposeInternalSession(sessionState);
    }
  }

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
      if (!existing.ownedByUi) {
        existing.ownedByUi = true;
        existing.mode = request.mode || existing.mode;
        sendState(sessionId, existing.status);
      }
      return {
        ok: true,
        sessionId,
        status: existing.status,
      };
    }

    const sessionState = createSessionState(sessionId, request.mode, { ownedByUi: true });

    // Pre-warm ASR worker/model in background to reduce first-turn latency.
    const runtime = resolveRuntime();
    if (runtime?.asrService) {
      Promise.resolve(ensureServiceWarm('asr', runtime)).catch((error) => {
        console.warn('ASR warmup failed:', error);
      });
    }

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
      console.warn('[voice-session] Rejected audio chunk for missing session.', {
        sessionId,
        seq: normalizeSeq(request.seq),
      });
      return {
        ok: false,
        reason: 'session_not_found',
      };
    }

    const seq = normalizeSeq(request.seq);
    if (seq <= sessionState.lastSeq) {
      console.warn('[voice-session] Rejected stale audio chunk sequence.', {
        sessionId,
        seq,
        lastSeq: sessionState.lastSeq,
      });
      return {
        ok: false,
        reason: 'stale_seq',
      };
    }

    sessionState.lastSeq = seq;

    const chunkValue = request.pcmChunk;
    const chunkBuffer = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue || []);
    if (!chunkBuffer.length) {
      console.warn('[voice-session] Rejected empty audio chunk buffer.', {
        sessionId,
        seq,
      });
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
    const chunkCount = sessionState.audioChunks.length;
    if (chunkCount === 1 || chunkCount % 20 === 0) {
      logVoiceSession('Buffered audio chunk for pending ASR commit.', {
        sessionId,
        seq,
        chunkCount,
        chunkBytes: chunkBuffer.length,
        isSpeech: Boolean(request.isSpeech),
      });
    }

    return {
      ok: true,
      accepted: true,
      seq,
    };
  });

  ipcMain.handle('voice:input:commit', async (_event, request = {}) => {
    const sessionId = normalizeSessionId(request.sessionId);
    const autoStartChat = request.autoStartChat !== false;
    const sessionState = sessionMap.get(sessionId);
    if (!sessionState) {
      console.warn('[voice-session] Rejected commit for missing session.', {
        sessionId,
        autoStartChat,
      });
      return {
        ok: false,
        reason: 'session_not_found',
      };
    }

    if (sessionState.status === SESSION_STATUS_TRANSCRIBING) {
      console.warn('[voice-session] Rejected commit because transcription is already in progress.', {
        sessionId,
        autoStartChat,
      });
      return {
        ok: false,
        reason: 'transcribing_in_progress',
      };
    }

    const committedChunks = sessionState.audioChunks;
    logVoiceSession('Received voice commit request.', {
      sessionId,
      autoStartChat,
      bufferedChunkCount: committedChunks.length,
      status: sessionState.status,
    });
    if (!committedChunks.length) {
      console.warn('[voice-session] Commit had no buffered audio chunks.', {
        sessionId,
        autoStartChat,
      });
      return {
        ok: false,
        reason: 'empty_audio',
      };
    }
    sessionState.audioChunks = [];

    sessionState.status = SESSION_STATUS_TRANSCRIBING;
    if (shouldEmitUiLifecycle(sessionState)) {
      sendState(sessionId, sessionState.status);
    }
    sessionState.asrController = new AbortController();

    try {
      const runtime = resolveRuntime();
      let partialSeq = 0;
      logVoiceSession('Starting ASR transcription for committed audio.', {
        sessionId,
        autoStartChat,
        chunkCount: committedChunks.length,
      });
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
      logVoiceSession('ASR transcription completed.', {
        sessionId,
        autoStartChat,
        chunkCount: committedChunks.length,
        partialCount: partialSeq,
        textLength: finalText.length,
      });
      if (finalText) {
        sendEvent({
          type: 'asr-final',
          sessionId,
          seq: partialSeq + 1,
          text: finalText,
        });
      }

      if (typeof onAsrFinal === 'function' && finalText && autoStartChat) {
        logVoiceSession('Forwarding ASR final text to chat runtime.', {
          sessionId,
          textLength: finalText.length,
        });
        await onAsrFinal({
          sessionId,
          text: finalText,
        });
      }

      sendDone(sessionId, 'transcribing');
      if (sessionState.status !== SESSION_STATUS_SPEAKING) {
        sessionState.status = SESSION_STATUS_LISTENING;
        if (shouldEmitUiLifecycle(sessionState)) {
          sendState(sessionId, sessionState.status);
        }
      }
      void drainSegmentPlaybackQueue(sessionState);

      return {
        ok: true,
        text: finalText,
      };
    } catch (error) {
      console.error('[voice-session] ASR transcription failed.', {
        sessionId,
        autoStartChat,
        chunkCount: committedChunks.length,
        message: error?.message || '',
      });
      sessionState.audioChunks = committedChunks.concat(sessionState.audioChunks);
      const payload = toVoiceError(error, 'voice_asr_failed', 'transcribing');
      sendError(sessionId, payload);
      sessionState.status = SESSION_STATUS_ERROR;
      if (shouldEmitUiLifecycle(sessionState)) {
        sendState(sessionId, sessionState.status);
      }
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
    abortAllTurnsForSession(
      sessionState,
      'session_stop',
      'Segment playback aborted because session stopped.',
    );
    sessionState.ttsAbortReason = 'session_stop';
    sessionState.ttsStopNotified = true;
    setTtsFlowPaused(sessionState, false);
    sessionState.ttsController?.abort();
    clearTtsAckWatchdog(sessionState);
    sessionState.audioChunks = [];
    sessionState.status = SESSION_STATUS_IDLE;
    if (shouldEmitUiLifecycle(sessionState)) {
      sendState(sessionId, sessionState.status);
      sendDone(sessionId, 'session', { aborted: true });
    }
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

    abortAllTurnsForSession(
      sessionState,
      'manual_stop',
      'Segment playback aborted by manual stop.',
    );
    sessionState.ttsAbortReason = 'manual_stop';
    sessionState.ttsStopNotified = true;
    setTtsFlowPaused(sessionState, false);
    sessionState.ttsController?.abort();
    clearTtsAckWatchdog(sessionState);
    sessionState.status = SESSION_STATUS_LISTENING;
    if (shouldEmitUiLifecycle(sessionState)) {
      sendState(sessionId, sessionState.status);
      sendDone(sessionId, 'speaking', { aborted: true });
    }
    maybeDisposeInternalSession(sessionState);

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

    const response = {
      ok: true,
      sessionId,
      ackSeq: sessionState.lastAckSeq,
      bufferedMs: sessionState.bufferedMs,
    };
    maybeDisposeInternalSession(sessionState);
    return response;
  });

  ipcMain.handle('voice:warmup', async (_event, request = {}) => {
    try {
      const result = await warmupRuntime({
        reload: Boolean(request.reload),
        warmAsr: request.warmAsr !== false,
        warmTts: Boolean(request.warmTts),
      });
      return {
        ok: true,
        warmAsr: request.warmAsr !== false,
        warmTts: Boolean(request.warmTts),
        alreadyWarmAsr: Boolean(result?.warmResults?.asr?.alreadyWarm),
        alreadyWarmTts: Boolean(result?.warmResults?.tts?.alreadyWarm),
        warmedAsr: Boolean(result?.warmResults?.asr?.warmed),
        warmedTts: Boolean(result?.warmResults?.tts?.warmed),
      };
    } catch (error) {
      return {
        ok: false,
        error: toVoiceError(error, 'voice_runtime_warmup_failed', 'warming'),
      };
    }
  });

  ipcMain.handle('voice:diagnostics:asr', async (_event, request = {}) => {
    const pcmChunk = toBufferChunk(request.pcmChunk);
    if (!pcmChunk.length) {
      return {
        ok: false,
        error: {
          code: 'voice_asr_test_empty_audio',
          message: 'ASR test requires non-empty audio input.',
          stage: 'transcribing',
          retriable: false,
        },
      };
    }

    const sampleRate = normalizeSeq(request.sampleRate) || 16000;
    const channels = normalizeSeq(request.channels) || 1;
    const sampleFormat =
      typeof request.sampleFormat === 'string' && request.sampleFormat.trim()
        ? request.sampleFormat.trim()
        : 'pcm_s16le';
    const timeoutMs = normalizePositiveInteger(request.timeoutMs, 120000);

    const runtime = resolveRuntime();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    timeoutId.unref?.();

    let partialCount = 0;
    const startedAt = Date.now();
    try {
      const result = await runtime.asrService.transcribe({
        audioChunks: [
          {
            seq: 1,
            chunkId: 1,
            sampleRate,
            channels,
            sampleFormat,
            isSpeech: true,
            pcmChunk,
          },
        ],
        signal: controller.signal,
        onPartial: () => {
          partialCount += 1;
        },
      });

      const text = typeof result?.text === 'string' ? result.text.trim() : '';
      return {
        ok: true,
        text,
        latencyMs: Math.max(0, Date.now() - startedAt),
        partialCount,
        sampleRate,
        sampleFormat,
        audioBytes: pcmChunk.length,
      };
    } catch (error) {
      return {
        ok: false,
        error: toVoiceError(error, 'voice_asr_test_failed', 'transcribing'),
        latencyMs: Math.max(0, Date.now() - startedAt),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  });

  ipcMain.handle('voice:diagnostics:tts', async (_event, request = {}) => {
    const text = normalizeSegmentText(request.text);
    if (!text) {
      return {
        ok: false,
        error: {
          code: 'voice_tts_test_text_required',
          message: 'TTS test text is required.',
          stage: 'speaking',
          retriable: false,
        },
      };
    }

    const timeoutMs = normalizePositiveInteger(request.timeoutMs, 180000);
    const runtime = resolveRuntime();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    timeoutId.unref?.();

    let firstChunkAt = 0;
    let chunkCount = 0;
    let totalBytes = 0;
    let observedSampleRate = 0;
    let observedCodec = '';
    const includeAudio = Boolean(request.includeAudio);
    const collectedAudioChunks = [];

    const startedAt = Date.now();
    try {
      const providerName =
        typeof runtime.env?.VOICE_TTS_PROVIDER === 'string'
          ? runtime.env.VOICE_TTS_PROVIDER.trim().toLowerCase()
          : '';
      if (!providerName || providerName === 'mock') {
        return {
          ok: false,
          error: {
            code: 'voice_tts_provider_not_configured',
            message: '当前未配置可用的 TTS 模型。请先安装并选择一个真实 TTS 模型后再测试。',
            stage: 'speaking',
            retriable: false,
          },
          latencyMs: Math.max(0, Date.now() - startedAt),
        };
      }

      const result = await runtime.ttsService.synthesize({
        text,
        signal: controller.signal,
        onChunk: async ({ audioChunk, sampleRate, codec }) => {
          const chunk = cloneBinaryChunk(audioChunk);
          if (!chunk.length) {
            return;
          }

          const chunkCodec = typeof codec === 'string' ? codec.trim().toLowerCase() : '';
          chunkCount += 1;
          totalBytes += chunk.byteLength;
          if (!observedCodec && chunkCodec) {
            observedCodec = chunkCodec;
          }
          if (includeAudio && chunkCodec === 'pcm_s16le') {
            collectedAudioChunks.push(Buffer.from(chunk));
          }
          if (!firstChunkAt) {
            firstChunkAt = Date.now();
          }

          if (!observedSampleRate && Number.isFinite(sampleRate) && sampleRate > 0) {
            observedSampleRate = Math.floor(sampleRate);
          }
        },
      });

      const resultSampleRate = Number.isFinite(result?.sampleRate) ? Math.floor(result.sampleRate) : 0;
      const resultSampleCount = Number.isFinite(result?.sampleCount) ? Math.floor(result.sampleCount) : 0;
      const outputDurationMs =
        resultSampleRate > 0 && resultSampleCount > 0
          ? Math.max(0, Math.round((resultSampleCount / resultSampleRate) * 1000))
          : 0;
      const pcmS16LeBase64 =
        includeAudio && observedCodec === 'pcm_s16le' && collectedAudioChunks.length > 0
          ? Buffer.concat(collectedAudioChunks).toString('base64')
          : '';
      return {
        ok: true,
        latencyMs: Math.max(0, Date.now() - startedAt),
        firstChunkLatencyMs: firstChunkAt ? Math.max(0, firstChunkAt - startedAt) : null,
        chunkCount,
        totalBytes,
        sampleRate: observedSampleRate || resultSampleRate || undefined,
        sampleCount: resultSampleCount || undefined,
        outputDurationMs: outputDurationMs || undefined,
        textLength: text.length,
        codec: observedCodec || undefined,
        pcmS16LeBase64: pcmS16LeBase64 || undefined,
      };
    } catch (error) {
      return {
        ok: false,
        error: toVoiceError(error, 'voice_tts_test_failed', 'speaking'),
        latencyMs: Math.max(0, Date.now() - startedAt),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  });

  ipcMain.handle('voice:segment:trace:list', async (_event, request = {}) => ({
    ok: true,
    items: listSegmentTraceItems({
      sessionId: request?.sessionId,
      limit: request?.limit,
    }),
  }));

  const dispose = () => {
    for (const [, sessionState] of sessionMap.entries()) {
      sessionState.asrController?.abort();
      abortAllTurnsForSession(
        sessionState,
        'session_stop',
        'Segment playback aborted because session stopped.',
      );
      sessionState.ttsAbortReason = 'session_stop';
      sessionState.ttsStopNotified = true;
      setTtsFlowPaused(sessionState, false);
      sessionState.ttsController?.abort();
      clearTtsAckWatchdog(sessionState);
    }
    sessionMap.clear();
    void disposeCachedRuntime();

    ipcMain.removeHandler('voice:session:start');
    ipcMain.removeHandler('voice:audio:chunk');
    ipcMain.removeHandler('voice:input:commit');
    ipcMain.removeHandler('voice:session:stop');
    ipcMain.removeHandler('voice:tts:stop');
    ipcMain.removeHandler('voice:playback:ack');
    ipcMain.removeHandler('voice:warmup');
    ipcMain.removeHandler('voice:diagnostics:asr');
    ipcMain.removeHandler('voice:diagnostics:tts');
    ipcMain.removeHandler('voice:segment:trace:list');
  };

  dispose.enqueueSegmentReady = (payload = {}) => enqueueSegmentReady(payload);
  dispose.markTurnDone = (payload = {}) => markTurnDone(payload);
  dispose.disposeCachedRuntime = disposeCachedRuntime;
  dispose.warmupRuntime = warmupRuntime;

  return dispose;
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
