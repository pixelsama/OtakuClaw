const { fork } = require('node:child_process');
const path = require('node:path');

function createAbortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function normalizeProviderName(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase();
}

function isTruthy(value, fallback = false) {
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

  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function toPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return parsed;
}

function createWorkerError(message, code = 'voice_tts_worker_error') {
  const error = new Error(message);
  error.code = code;
  error.stage = 'speaking';
  error.retriable = true;
  return error;
}

function toRequestId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneAudioChunk(value) {
  if (Buffer.isBuffer(value)) {
    return Uint8Array.from(value);
  }

  if (
    value
    && typeof value === 'object'
    && value.type === 'Buffer'
    && Array.isArray(value.data)
  ) {
    return Uint8Array.from(value.data);
  }

  if (value instanceof Uint8Array) {
    return Uint8Array.from(value);
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }

  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }

  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }

  return new Uint8Array(0);
}

function createTtsWorkerClient({ provider = null, env = process.env } = {}) {
  const configuredProvider = normalizeProviderName(provider) || normalizeProviderName(env?.VOICE_TTS_PROVIDER);
  const disableWorker = isTruthy(env?.VOICE_TTS_DISABLE_WORKER, false);
  const workerMaxOldSpaceMb = toPositiveInteger(env?.VOICE_TTS_WORKER_MAX_OLD_SPACE_MB);

  // Keep mock provider in-process for lightweight tests and local fallback.
  if (disableWorker || !configuredProvider || configuredProvider === 'mock') {
    return null;
  }

  let worker = null;
  let disposed = false;
  let requestSeq = 0;
  const pendingRequests = new Map();
  let readyPromise = null;

  const workerFilePath = path.join(__dirname, 'ttsWorkerProcess.js');

  const cleanupPendingRequests = (error) => {
    for (const [, pending] of pendingRequests.entries()) {
      if (pending.signal && pending.onAbort) {
        pending.signal.removeEventListener('abort', pending.onAbort);
      }
      pending.reject(error);
    }
    pendingRequests.clear();
  };

  const ensureWorker = () => {
    if (disposed) {
      throw createWorkerError('TTS worker client has been disposed.', 'voice_tts_worker_disposed');
    }

    if (worker && !worker.killed) {
      return worker;
    }

    const forkOptions = {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    };
    if (workerMaxOldSpaceMb > 0) {
      forkOptions.execArgv = [`--max-old-space-size=${workerMaxOldSpaceMb}`];
    }
    worker = fork(workerFilePath, [], forkOptions);

    worker.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.trim()) {
        console.warn(`[voice-tts-worker] ${text.trim()}`);
      }
    });

    worker.on('message', (message = {}) => {
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'ready') {
        return;
      }

      const requestId = toRequestId(message.requestId);
      if (!requestId) {
        return;
      }

      const pending = pendingRequests.get(requestId);
      if (!pending) {
        return;
      }

      if (message.type === 'warmup-done') {
        pendingRequests.delete(requestId);
        pending.resolve();
        return;
      }

      if (message.type === 'warmup-error') {
        pendingRequests.delete(requestId);
        const errorPayload = message.error && typeof message.error === 'object' ? message.error : {};
        const error = new Error(errorPayload.message || 'TTS worker warmup failed.');
        error.name = errorPayload.name || 'Error';
        if (errorPayload.code) {
          error.code = errorPayload.code;
        }
        if (errorPayload.stage) {
          error.stage = errorPayload.stage;
        }
        error.retriable = Boolean(errorPayload.retriable);
        pending.reject(error);
        return;
      }

      if (message.type === 'tts-chunk') {
        Promise.resolve()
          .then(async () => {
            if (typeof pending.onChunk === 'function') {
              await pending.onChunk({
                audioChunk: cloneAudioChunk(message.audioChunk),
                codec: typeof message.codec === 'string' ? message.codec : '',
                sampleRate: Number.isFinite(message.sampleRate) ? Math.floor(message.sampleRate) : 0,
              });
            }
            worker?.send({
              type: 'chunk-ack',
              requestId,
              seq: Number.isFinite(message.seq) ? Math.floor(message.seq) : 0,
            });
          })
          .catch((error) => {
            worker?.send({
              type: 'abort',
              requestId,
            });
            pendingRequests.delete(requestId);
            if (pending.signal && pending.onAbort) {
              pending.signal.removeEventListener('abort', pending.onAbort);
            }
            pending.reject(error);
          });
        return;
      }

      if (message.type === 'synthesize-done') {
        pendingRequests.delete(requestId);
        if (pending.signal && pending.onAbort) {
          pending.signal.removeEventListener('abort', pending.onAbort);
        }
        pending.resolve({
          sampleRate: Number.isFinite(message.sampleRate) ? Math.floor(message.sampleRate) : 0,
          sampleCount: Number.isFinite(message.sampleCount) ? Math.floor(message.sampleCount) : 0,
        });
        return;
      }

      if (message.type === 'synthesize-error') {
        pendingRequests.delete(requestId);
        if (pending.signal && pending.onAbort) {
          pending.signal.removeEventListener('abort', pending.onAbort);
        }

        const errorPayload = message.error && typeof message.error === 'object' ? message.error : {};
        const error = new Error(errorPayload.message || 'TTS worker synthesize failed.');
        error.name = errorPayload.name || 'Error';
        if (errorPayload.code) {
          error.code = errorPayload.code;
        }
        if (errorPayload.stage) {
          error.stage = errorPayload.stage;
        }
        error.retriable = Boolean(errorPayload.retriable);
        pending.reject(error);
      }
    });

    worker.on('exit', (code, signal) => {
      const reason = `TTS worker exited (code=${code}, signal=${signal || 'none'}).`;
      const error = createWorkerError(reason, 'voice_tts_worker_exited');
      cleanupPendingRequests(error);
      worker = null;
      readyPromise = null;
    });

    worker.on('error', (error) => {
      const wrapped = createWorkerError(
        `TTS worker process failed: ${error?.message || 'unknown error'}`,
        'voice_tts_worker_spawn_failed',
      );
      cleanupPendingRequests(wrapped);
    });

    readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(createWorkerError('TTS worker init timeout.', 'voice_tts_worker_init_timeout'));
      }, 5000);

      const onMessage = (message = {}) => {
        if (message?.type !== 'ready') {
          return;
        }
        clearTimeout(timer);
        worker?.off('message', onMessage);
        resolve();
      };

      worker?.on('message', onMessage);
      worker?.send({
        type: 'init',
        provider: configuredProvider,
        env,
      });
    });

    return worker;
  };

  const ensureReady = async () => {
    ensureWorker();
    if (readyPromise) {
      await readyPromise;
    }
  };

  const sendWarmupRequest = async () => {
    await ensureReady();

    if (!worker || worker.killed) {
      throw createWorkerError('TTS worker is unavailable.', 'voice_tts_worker_unavailable');
    }

    requestSeq += 1;
    const requestId = `tts-warmup-${Date.now().toString(36)}-${requestSeq.toString(36)}`;

    return new Promise((resolve, reject) => {
      pendingRequests.set(requestId, {
        resolve,
        reject,
      });

      worker.send({
        type: 'warmup',
        requestId,
      });
    });
  };

  const sendSynthesizeRequest = async ({ text, signal, onChunk } = {}) => {
    await ensureReady();

    if (!worker || worker.killed) {
      throw createWorkerError('TTS worker is unavailable.', 'voice_tts_worker_unavailable');
    }

    requestSeq += 1;
    const requestId = `tts-${Date.now().toString(36)}-${requestSeq.toString(36)}`;

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        worker?.send({
          type: 'abort',
          requestId,
        });
        pendingRequests.delete(requestId);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        reject(createAbortError());
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      pendingRequests.set(requestId, {
        resolve,
        reject,
        onChunk,
        signal,
        onAbort,
      });

      worker.send({
        type: 'synthesize',
        requestId,
        text,
      });
    });
  };

  const synthesize = async ({ text = '', signal, onChunk } = {}) => {
    const normalizedText = typeof text === 'string' ? text.trim() : '';
    if (!normalizedText) {
      return {
        sampleRate: 0,
        sampleCount: 0,
      };
    }

    let emittedChunkCount = 0;
    let retriesLeft = 1;
    const wrappedOnChunk = async (chunk) => {
      emittedChunkCount += 1;
      if (typeof onChunk === 'function') {
        await onChunk(chunk);
      }
    };

    while (true) {
      try {
        return await sendSynthesizeRequest({
          text: normalizedText,
          signal,
          onChunk: wrappedOnChunk,
        });
      } catch (error) {
        const shouldRetry =
          retriesLeft > 0
          && emittedChunkCount === 0
          && error?.code === 'voice_tts_worker_exited'
          && !disposed
          && !signal?.aborted;

        if (!shouldRetry) {
          throw error;
        }

        retriesLeft -= 1;
      }
    }
  };

  const warmup = async () => {
    let retriesLeft = 1;

    while (true) {
      try {
        await sendWarmupRequest();
        return;
      } catch (error) {
        const shouldRetry =
          retriesLeft > 0
          && error?.code === 'voice_tts_worker_exited'
          && !disposed;

        if (!shouldRetry) {
          throw error;
        }

        retriesLeft -= 1;
      }
    }
  };

  const dispose = async () => {
    if (disposed) {
      return;
    }
    disposed = true;

    const error = createWorkerError('TTS worker client disposed.', 'voice_tts_worker_disposed');
    cleanupPendingRequests(error);

    if (worker && !worker.killed) {
      worker.kill();
    }
    worker = null;
    readyPromise = null;
  };

  return {
    warmup,
    synthesize,
    dispose,
  };
}

module.exports = {
  createTtsWorkerClient,
};
