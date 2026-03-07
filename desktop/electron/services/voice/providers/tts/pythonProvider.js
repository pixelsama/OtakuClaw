const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_CHUNK_MS = 120;
const DEFAULT_ENGINE = 'qwen3-mlx';
const DEFAULT_SPEAKER = 'vivian';
const DEFAULT_LANGUAGE = 'Chinese';
const DEFAULT_TTS_MODE = 'custom_voice';
const DEFAULT_DEVICE = 'auto';
const DEFAULT_EDGE_VOICE = 'zh-CN-XiaoxiaoNeural';
const DEFAULT_EDGE_RATE = '+0%';
const DEFAULT_EDGE_PITCH = '+0Hz';
const DEFAULT_EDGE_VOLUME = '+0%';
const DEFAULT_STREAMING_INTERVAL = 0.4;
const DEFAULT_TEMPERATURE = 0.9;
const READY_TIMEOUT_MS = 30_000;
const JSON_PREFIX = '__TTS_JSON__';

function createAbortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function createVoiceProviderError(code, message, stage = 'speaking', retriable = false) {
  const error = new Error(message);
  error.code = code;
  error.stage = stage;
  error.retriable = retriable;
  return error;
}

function normalizePath(pathValue) {
  if (typeof pathValue !== 'string') {
    return '';
  }

  return pathValue.trim();
}

function normalizeTextValue(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function toPositiveNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function toBoolean(value, fallback) {
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

function ensurePathExists(
  pathValue,
  envKey,
  notConfiguredCode,
  missingCode,
  existsSync = fs.existsSync,
) {
  if (!pathValue) {
    throw createVoiceProviderError(
      notConfiguredCode,
      `Missing ${envKey}.`,
      'speaking',
      false,
    );
  }

  if (!existsSync(pathValue)) {
    throw createVoiceProviderError(
      missingCode,
      `Configured path does not exist: ${pathValue}`,
      'speaking',
      false,
    );
  }
}

function parseJsonPayload(stdoutText) {
  const raw = typeof stdoutText === 'string' ? stdoutText : '';
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with best-effort extraction for noisy stdout.
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // Keep scanning.
    }
  }

  for (let start = trimmed.lastIndexOf('{'); start >= 0; start = trimmed.lastIndexOf('{', start - 1)) {
    const candidate = trimmed.slice(start).trim();
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep scanning.
    }
  }

  throw new Error('No JSON payload found in Python stdout.');
}

function parseWorkerLine(line) {
  const text = typeof line === 'string' ? line : '';
  const index = text.indexOf(JSON_PREFIX);
  if (index < 0) {
    return null;
  }

  const payloadText = text.slice(index + JSON_PREFIX.length).trim();
  if (!payloadText) {
    return null;
  }

  try {
    return JSON.parse(payloadText);
  } catch {
    return null;
  }
}

function resolveResidentScriptPath(configuredPath = '') {
  const explicit = normalizePath(configuredPath);
  if (explicit) {
    return explicit;
  }

  return path.join(__dirname, '..', 'python', 'tts_resident_worker.py');
}

async function runPythonBridge({
  pythonExecutable,
  bridgeScriptPath,
  args = [],
  signal,
  spawnFn = spawn,
}) {
  return new Promise((resolve, reject) => {
    const child = spawnFn(pythonExecutable, [bridgeScriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdoutText = '';
    let stderrText = '';

    child.stdout.on('data', (chunk) => {
      stdoutText += chunk.toString('utf-8');
    });

    child.stderr.on('data', (chunk) => {
      stderrText += chunk.toString('utf-8');
    });

    const onAbort = () => {
      child.kill('SIGTERM');
      reject(createAbortError());
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.on('error', (error) => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      reject(
        createVoiceProviderError(
          'voice_tts_python_spawn_failed',
          `Failed to start Python process: ${error?.message || 'unknown error'}`,
          'speaking',
          true,
        ),
      );
    });

    child.on('close', (code) => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }

      if (code !== 0) {
        reject(
          createVoiceProviderError(
            'voice_tts_python_failed',
            stderrText.trim() || `Python TTS bridge exited with code ${code}.`,
            'speaking',
            true,
          ),
        );
        return;
      }

      try {
        const payload = parseJsonPayload(stdoutText);
        resolve(payload);
      } catch (error) {
        reject(
          createVoiceProviderError(
            'voice_tts_python_invalid_response',
            `Invalid Python TTS response: ${error?.message || 'unknown error'}`,
            'speaking',
            true,
          ),
        );
      }
    });
  });
}

function splitPcmS16le(buffer, sampleRate, chunkMs) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return [];
  }

  const safeSampleRate = Math.max(1, toPositiveInteger(sampleRate, DEFAULT_SAMPLE_RATE));
  const safeChunkMs = Math.max(20, toPositiveInteger(chunkMs, DEFAULT_CHUNK_MS));
  const samplesPerChunk = Math.max(1, Math.floor((safeSampleRate * safeChunkMs) / 1000));
  const bytesPerChunk = samplesPerChunk * 2;

  const out = [];
  for (let offset = 0; offset < buffer.length; offset += bytesPerChunk) {
    out.push(buffer.subarray(offset, Math.min(buffer.length, offset + bytesPerChunk)));
  }
  return out;
}

function serializeWorkerError(payload = {}) {
  const message = normalizeTextValue(payload.message, 'Python TTS worker failed.');
  return createVoiceProviderError(
    normalizeTextValue(payload.code, 'voice_tts_python_worker_failed'),
    message,
    'speaking',
    true,
  );
}

function createResidentPythonTtsRunner(
  {
    pythonExecutable,
    workerScriptPath,
    workerScriptSource,
    modelDir,
    tokenizerDir,
    engine,
    ttsMode,
    speaker,
    language,
    device,
    stream,
    streamingInterval,
    temperature,
    timeoutMs,
  },
  {
    spawnFn = spawn,
  } = {},
) {
  let child = null;
  let stdoutBuffer = '';
  let readyPromise = null;
  let readyResolve = null;
  let readyReject = null;
  let readyTimer = null;
  let disposed = false;
  let requestSeq = 0;
  const pendingMap = new Map();

  const cleanupReadyState = () => {
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    readyResolve = null;
    readyReject = null;
  };

  const removePending = (requestId, pending = null) => {
    const resolvedPending = pending || pendingMap.get(requestId);
    if (!resolvedPending) {
      return null;
    }

    pendingMap.delete(requestId);
    if (resolvedPending.signal && resolvedPending.onAbort) {
      resolvedPending.signal.removeEventListener('abort', resolvedPending.onAbort);
    }
    return resolvedPending;
  };

  const rejectPending = (requestId, error) => {
    const pending = removePending(requestId);
    if (!pending) {
      return;
    }
    pending.settled = true;
    pending.reject(error);
  };

  const rejectAllPending = (error) => {
    for (const requestId of [...pendingMap.keys()]) {
      rejectPending(requestId, error);
    }
  };

  const writeCommand = (payload) =>
    new Promise((resolve, reject) => {
      if (!child || child.killed || !child.stdin) {
        reject(
          createVoiceProviderError(
            'voice_tts_python_worker_not_ready',
            'Python TTS worker is not ready.',
            'speaking',
            true,
          ),
        );
        return;
      }

      const line = `${JSON.stringify(payload)}\n`;
      child.stdin.write(line, 'utf-8', (error) => {
        if (error) {
          reject(
            createVoiceProviderError(
              'voice_tts_python_worker_write_failed',
              error?.message || 'Failed to write to Python TTS worker.',
              'speaking',
              true,
            ),
          );
          return;
        }
        resolve();
      });
    });

  const handleWorkerPayload = (payload = {}) => {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    if (payload.type === 'ready') {
      if (readyResolve) {
        const resolve = readyResolve;
        cleanupReadyState();
        resolve();
      }
      return;
    }

    const requestId = normalizeTextValue(payload.requestId);
    if (!requestId) {
      return;
    }

    const pending = pendingMap.get(requestId);
    if (!pending || pending.settled) {
      return;
    }

    if (payload.type === 'chunk') {
      const pcmBase64 = normalizeTextValue(payload.pcmS16LeBase64);
      const audioChunk = pcmBase64 ? Buffer.from(pcmBase64, 'base64') : Buffer.alloc(0);
      const sampleRate = Math.max(1, toPositiveInteger(payload.sampleRate, DEFAULT_SAMPLE_RATE));
      const chunkSampleCount = Math.floor(audioChunk.length / 2);

      pending.sampleRate = sampleRate;
      pending.sampleCount += chunkSampleCount;
      pending.chunkChain = pending.chunkChain
        .then(async () => {
          if (!audioChunk.length || typeof pending.onChunk !== 'function') {
            return;
          }
          await pending.onChunk({
            audioChunk,
            codec: 'pcm_s16le',
            sampleRate,
          });
        })
        .catch((error) => {
          pending.chunkError = error;
          pending.settled = true;
          pendingMap.delete(requestId);
          if (pending.signal && pending.onAbort) {
            pending.signal.removeEventListener('abort', pending.onAbort);
          }
          void writeCommand({
            type: 'abort',
            requestId,
          }).catch(() => {});
          pending.reject(error);
        });
      return;
    }

    if (payload.type === 'result') {
      pending.chunkChain
        .then(() => {
          const resolvedPending = removePending(requestId, pending);
          if (!resolvedPending || resolvedPending.settled) {
            return;
          }
          resolvedPending.settled = true;
          if (resolvedPending.chunkError) {
            resolvedPending.reject(resolvedPending.chunkError);
            return;
          }
          resolvedPending.resolve({
            sampleRate: Math.max(1, toPositiveInteger(payload.sampleRate, resolvedPending.sampleRate)),
            sampleCount: Math.max(
              resolvedPending.sampleCount,
              toPositiveInteger(payload.sampleCount, resolvedPending.sampleCount),
            ),
          });
        })
        .catch((error) => {
          rejectPending(requestId, error);
        });
      return;
    }

    if (payload.type === 'error') {
      pending.chunkChain
        .then(() => {
          rejectPending(requestId, pending.chunkError || serializeWorkerError(payload));
        })
        .catch((error) => {
          rejectPending(requestId, error);
        });
    }
  };

  const handleStdoutChunk = (chunk) => {
    stdoutBuffer += chunk.toString('utf-8');
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const payload = parseWorkerLine(line);
      if (payload) {
        handleWorkerPayload(payload);
      }
    }
  };

  const startProcess = () => {
    if (child && !child.killed) {
      return;
    }

    const scriptArgs = workerScriptPath
      ? [
          workerScriptPath,
          '--engine',
          engine,
          '--model-dir',
          modelDir,
          '--tts-mode',
          ttsMode,
          '--speaker',
          speaker,
          '--language',
          language,
          '--device',
          device,
          '--stream',
          stream ? '1' : '0',
          '--streaming-interval',
          String(streamingInterval),
          '--temperature',
          String(temperature),
        ]
      : [
          '-u',
          '-c',
          workerScriptSource,
          '--engine',
          engine,
          '--model-dir',
          modelDir,
          '--tts-mode',
          ttsMode,
          '--speaker',
          speaker,
          '--language',
          language,
          '--device',
          device,
          '--stream',
          stream ? '1' : '0',
          '--streaming-interval',
          String(streamingInterval),
          '--temperature',
          String(temperature),
        ];

    if (tokenizerDir) {
      scriptArgs.push('--tokenizer-dir', tokenizerDir);
    }

    child = spawnFn(pythonExecutable, scriptArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    child.stdout?.on('data', handleStdoutChunk);
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      if (text.trim()) {
        console.warn(`[voice-tts-python] ${text.trim()}`);
      }
    });

    child.on('error', (error) => {
      const wrapped = createVoiceProviderError(
        'voice_tts_python_worker_spawn_failed',
        error?.message || 'Failed to start Python TTS worker.',
        'speaking',
        true,
      );
      if (readyReject) {
        const reject = readyReject;
        cleanupReadyState();
        reject(wrapped);
      }
      rejectAllPending(wrapped);
      child = null;
      readyPromise = null;
    });

    child.on('exit', (code, signal) => {
      const wrapped = createVoiceProviderError(
        'voice_tts_python_worker_exited',
        `Python TTS worker exited (code=${code}, signal=${signal || 'none'}).`,
        'speaking',
        true,
      );
      if (readyReject) {
        const reject = readyReject;
        cleanupReadyState();
        reject(wrapped);
      }
      if (!disposed) {
        rejectAllPending(wrapped);
      } else {
        rejectAllPending(createAbortError());
      }
      child = null;
      readyPromise = null;
      stdoutBuffer = '';
    });
  };

  const ensureReady = async () => {
    if (disposed) {
      throw createVoiceProviderError(
        'voice_tts_python_worker_disposed',
        'Python TTS worker has been disposed.',
        'speaking',
        false,
      );
    }

    if (readyPromise) {
      await readyPromise;
      return;
    }

    startProcess();
    readyPromise = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
      readyTimer = setTimeout(() => {
        cleanupReadyState();
        reject(
          createVoiceProviderError(
            'voice_tts_python_worker_init_timeout',
            'Python TTS worker init timeout.',
            'speaking',
            true,
          ),
        );
      }, READY_TIMEOUT_MS);
      readyTimer.unref?.();
    });

    await readyPromise;
  };

  return {
    async warmup() {
      await ensureReady();
    },
    async synthesize({ text = '', instruct = '', signal, onChunk } = {}) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const normalizedText = normalizeTextValue(text);
      if (!normalizedText) {
        return {
          sampleRate: DEFAULT_SAMPLE_RATE,
          sampleCount: 0,
        };
      }

      await ensureReady();

      const requestId = `tts-${Date.now()}-${++requestSeq}`;
      return new Promise((resolve, reject) => {
        const pending = {
          resolve,
          reject,
          onChunk,
          signal,
          onAbort: null,
          sampleRate: DEFAULT_SAMPLE_RATE,
          sampleCount: 0,
          chunkChain: Promise.resolve(),
          chunkError: null,
          settled: false,
        };

        pending.onAbort = () => {
          removePending(requestId, pending);
          pending.settled = true;
          void writeCommand({
            type: 'abort',
            requestId,
          }).catch(() => {});
          reject(createAbortError());
        };

        if (signal) {
          if (signal.aborted) {
            pending.onAbort();
            return;
          }
          signal.addEventListener('abort', pending.onAbort, { once: true });
        }

        pendingMap.set(requestId, pending);
        void writeCommand({
          type: 'synthesize',
          requestId,
          text: normalizedText,
          instruct: normalizeTextValue(instruct),
        }).catch((error) => {
          rejectPending(requestId, error);
        });
      });
    },

    async dispose() {
      disposed = true;
      const activeChild = child;
      child = null;
      readyPromise = null;
      cleanupReadyState();
      rejectAllPending(createAbortError());
      if (!activeChild || activeChild.killed) {
        return;
      }

      try {
        if (activeChild.stdin && !activeChild.stdin.destroyed) {
          activeChild.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`, 'utf-8');
        }
      } catch {
        // noop
      }

      activeChild.kill('SIGTERM');
    },
  };
}

function createPythonTtsProvider(
  {
    options = {},
    spawnFn = spawn,
    existsSync = fs.existsSync,
  } = {},
) {
  let residentRunner = null;

  const ensureBasePaths = ({
    pythonExecutable,
    bridgeScriptPath,
    modelDir,
    tokenizerDir,
    engine,
    requireBridgeScript,
  }) => {
    ensurePathExists(
      pythonExecutable,
      'VOICE_PYTHON_EXECUTABLE',
      'voice_tts_python_not_configured',
      'voice_tts_python_missing',
      existsSync,
    );
    if (requireBridgeScript) {
      ensurePathExists(
        bridgeScriptPath,
        'VOICE_PYTHON_BRIDGE_SCRIPT',
        'voice_tts_python_bridge_not_configured',
        'voice_tts_python_bridge_missing',
        existsSync,
      );
    }
    if (engine !== 'edge') {
      ensurePathExists(
        modelDir,
        'VOICE_TTS_PYTHON_MODEL_DIR',
        'voice_tts_model_not_configured',
        'voice_tts_model_missing',
        existsSync,
      );
      if (tokenizerDir) {
        ensurePathExists(
          tokenizerDir,
          'VOICE_TTS_PYTHON_TOKENIZER_DIR',
          'voice_tts_tokenizer_not_configured',
          'voice_tts_tokenizer_missing',
          existsSync,
        );
      }
    }
  };

  const getResidentRunner = ({
    pythonExecutable,
    modelDir,
    tokenizerDir,
    engine,
    ttsMode,
    speaker,
    language,
    device,
    stream,
    streamingInterval,
    temperature,
    timeoutMs,
  }) => {
    if (residentRunner) {
      return residentRunner;
    }

    const configuredWorkerScriptPath = normalizePath(options.workerScriptPath);
    let workerScriptPath = '';
    let workerScriptSource = '';

    if (configuredWorkerScriptPath) {
      ensurePathExists(
        configuredWorkerScriptPath,
        'VOICE_TTS_PYTHON_WORKER_SCRIPT',
        'voice_tts_python_worker_script_not_configured',
        'voice_tts_python_worker_script_missing',
        existsSync,
      );
      workerScriptPath = configuredWorkerScriptPath;
    } else {
      const bundledScriptPath = resolveResidentScriptPath();
      if (!existsSync(bundledScriptPath)) {
        throw createVoiceProviderError(
          'voice_tts_python_worker_script_missing',
          `Bundled TTS worker script not found: ${bundledScriptPath}`,
          'speaking',
          false,
        );
      }
      workerScriptSource = fs.readFileSync(bundledScriptPath, 'utf-8');
    }

    residentRunner = createResidentPythonTtsRunner(
      {
        pythonExecutable,
        workerScriptPath,
        workerScriptSource,
        modelDir,
        tokenizerDir,
        engine,
        ttsMode,
        speaker,
        language,
        device,
        stream,
        streamingInterval,
        temperature,
        timeoutMs,
      },
      {
        spawnFn,
      },
    );

    return residentRunner;
  };

  const synthesizeWithBridge = async ({
    text,
    signal,
    onChunk,
    pythonExecutable,
    bridgeScriptPath,
    engine,
    modelDir,
    tokenizerDir,
    ttsMode,
    speaker,
    language,
    instruct,
    edgeVoice,
    edgeRate,
    edgePitch,
    edgeVolume,
    device,
    chunkMs,
    timeoutMs,
  }) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    timeoutId.unref?.();

    const onAbort = () => {
      controller.abort();
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    let payload;
    try {
      const args = [
        '--task',
        'tts',
        '--tts-engine',
        engine,
        '--text',
        text,
        '--tts-mode',
        ttsMode,
        '--speaker',
        speaker,
        '--language',
        language,
        '--device',
        device,
      ];
      if (modelDir) {
        args.push('--model-dir', modelDir);
      }
      if (tokenizerDir) {
        args.push('--tokenizer-dir', tokenizerDir);
      }
      if (instruct) {
        args.push('--instruct', instruct);
      }
      if (engine === 'edge') {
        args.push(
          '--edge-voice',
          edgeVoice,
          '--edge-rate',
          edgeRate,
          '--edge-pitch',
          edgePitch,
          '--edge-volume',
          edgeVolume,
        );
      }

      payload = await runPythonBridge({
        pythonExecutable,
        bridgeScriptPath,
        args,
        signal: controller.signal,
        spawnFn,
      });
    } finally {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }

    const sampleRate = Math.max(1, toPositiveInteger(payload?.sampleRate, DEFAULT_SAMPLE_RATE));
    const pcmBase64 = typeof payload?.pcmS16LeBase64 === 'string' ? payload.pcmS16LeBase64.trim() : '';
    const pcmBuffer = pcmBase64 ? Buffer.from(pcmBase64, 'base64') : Buffer.alloc(0);

    if (typeof onChunk === 'function' && pcmBuffer.length > 0) {
      const chunks = splitPcmS16le(pcmBuffer, sampleRate, chunkMs);
      for (const chunk of chunks) {
        if (signal?.aborted) {
          throw createAbortError();
        }

        await onChunk({
          audioChunk: chunk,
          codec: 'pcm_s16le',
          sampleRate,
        });
      }
    }

    return {
      sampleRate,
      sampleCount: Math.floor(pcmBuffer.length / 2),
    };
  };

  return {
    async warmup() {
      const pythonExecutable = normalizePath(options.pythonExecutable);
      const bridgeScriptPath = normalizePath(options.bridgeScriptPath);
      const engine = normalizePath(options.engine) || DEFAULT_ENGINE;
      const modelDir = normalizePath(options.modelDir);
      const tokenizerDir = normalizePath(options.tokenizerDir);
      const ttsMode = normalizePath(options.ttsMode) || DEFAULT_TTS_MODE;
      const speaker = normalizePath(options.speaker) || DEFAULT_SPEAKER;
      const language = normalizePath(options.language) || DEFAULT_LANGUAGE;
      const device = normalizePath(options.device) || DEFAULT_DEVICE;
      const timeoutMs = Math.max(1_000, toPositiveInteger(options.timeoutMs, 180_000));
      const stream = toBoolean(options.stream, engine === 'qwen3-mlx');
      const streamingInterval = Math.max(
        0.1,
        toPositiveNumber(options.streamingInterval, DEFAULT_STREAMING_INTERVAL),
      );
      const temperature = Math.max(0, toPositiveNumber(options.temperature, DEFAULT_TEMPERATURE));
      const useResidentWorker = engine === 'qwen3-mlx' && !toBoolean(options.disableResidentWorker, false);

      ensureBasePaths({
        pythonExecutable,
        bridgeScriptPath,
        modelDir,
        tokenizerDir,
        engine,
        requireBridgeScript: !useResidentWorker,
      });

      if (!useResidentWorker) {
        return;
      }

      const runner = getResidentRunner({
        pythonExecutable,
        modelDir,
        tokenizerDir,
        engine,
        ttsMode,
        speaker,
        language,
        device,
        stream,
        streamingInterval,
        temperature,
        timeoutMs,
      });
      if (typeof runner.warmup === 'function') {
        await runner.warmup();
      }
    },
    async synthesize({ text = '', signal, onChunk } = {}) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const normalizedText = normalizeTextValue(text);
      if (!normalizedText) {
        return {
          sampleRate: DEFAULT_SAMPLE_RATE,
          sampleCount: 0,
        };
      }

      const pythonExecutable = normalizePath(options.pythonExecutable);
      const bridgeScriptPath = normalizePath(options.bridgeScriptPath);
      const engine = normalizePath(options.engine) || DEFAULT_ENGINE;
      const modelDir = normalizePath(options.modelDir);
      const tokenizerDir = normalizePath(options.tokenizerDir);
      const ttsMode = normalizePath(options.ttsMode) || DEFAULT_TTS_MODE;
      const speaker = normalizePath(options.speaker) || DEFAULT_SPEAKER;
      const language = normalizePath(options.language) || DEFAULT_LANGUAGE;
      const instruct = normalizePath(options.instruct);
      const edgeVoice = normalizePath(options.edgeVoice) || DEFAULT_EDGE_VOICE;
      const edgeRate = normalizePath(options.edgeRate) || DEFAULT_EDGE_RATE;
      const edgePitch = normalizePath(options.edgePitch) || DEFAULT_EDGE_PITCH;
      const edgeVolume = normalizePath(options.edgeVolume) || DEFAULT_EDGE_VOLUME;
      const device = normalizePath(options.device) || DEFAULT_DEVICE;
      const chunkMs = Math.max(20, toPositiveInteger(options.chunkMs, DEFAULT_CHUNK_MS));
      const timeoutMs = Math.max(1_000, toPositiveInteger(options.timeoutMs, 180_000));
      const stream = toBoolean(options.stream, engine === 'qwen3-mlx');
      const streamingInterval = Math.max(
        0.1,
        toPositiveNumber(options.streamingInterval, DEFAULT_STREAMING_INTERVAL),
      );
      const temperature = Math.max(0, toPositiveNumber(options.temperature, DEFAULT_TEMPERATURE));
      const useResidentWorker = engine === 'qwen3-mlx' && !toBoolean(options.disableResidentWorker, false);

      ensureBasePaths({
        pythonExecutable,
        bridgeScriptPath,
        modelDir,
        tokenizerDir,
        engine,
        requireBridgeScript: !useResidentWorker,
      });

      if (useResidentWorker) {
        const runner = getResidentRunner({
          pythonExecutable,
          modelDir,
          tokenizerDir,
          engine,
          ttsMode,
          speaker,
          language,
          device,
          stream,
          streamingInterval,
          temperature,
          timeoutMs,
        });

        return runner.synthesize({
          text: normalizedText,
          instruct,
          signal,
          onChunk,
        });
      }

      return synthesizeWithBridge({
        text: normalizedText,
        signal,
        onChunk,
        pythonExecutable,
        bridgeScriptPath,
        engine,
        modelDir,
        tokenizerDir,
        ttsMode,
        speaker,
        language,
        instruct,
        edgeVoice,
        edgeRate,
        edgePitch,
        edgeVolume,
        device,
        chunkMs,
        timeoutMs,
      });
    },

    async dispose() {
      if (!residentRunner || typeof residentRunner.dispose !== 'function') {
        return;
      }

      await residentRunner.dispose();
      residentRunner = null;
    },
  };
}

module.exports = {
  createPythonTtsProvider,
  createVoiceProviderError,
};
