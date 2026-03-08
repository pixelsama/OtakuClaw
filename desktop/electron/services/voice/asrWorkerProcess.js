const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { resolveExternalScriptPath } = require('../externalScriptPath');

const JSON_PREFIX = '__ASR_JSON__';
const READY_TIMEOUT_MS = 90_000;

function createAbortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function toRequestId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePath(pathValue) {
  if (typeof pathValue !== 'string') {
    return '';
  }
  return pathValue.trim();
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function createVoiceProviderError(code, message, stage = 'transcribing', retriable = false) {
  const error = new Error(message);
  error.code = code;
  error.stage = stage;
  error.retriable = retriable;
  return error;
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    code: error?.code || '',
    message: error?.message || 'ASR worker error.',
    stage: error?.stage || 'transcribing',
    retriable: Boolean(error?.retriable),
  };
}

function clonePcmChunk(value) {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }

  if (
    value
    && typeof value === 'object'
    && value.type === 'Buffer'
    && Array.isArray(value.data)
  ) {
    return Buffer.from(value.data);
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(value));
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }

  if (Array.isArray(value)) {
    return Buffer.from(value);
  }

  return Buffer.alloc(0);
}

function normalizeAudioChunks(audioChunks = []) {
  if (!Array.isArray(audioChunks) || !audioChunks.length) {
    return {
      sampleRate: 16000,
      pcmBuffer: Buffer.alloc(0),
    };
  }

  const parts = [];
  let sampleRate = 16000;

  for (const chunk of audioChunks) {
    if (!chunk || typeof chunk !== 'object') {
      continue;
    }

    if (Number.isFinite(chunk.sampleRate) && chunk.sampleRate > 0) {
      sampleRate = Math.floor(chunk.sampleRate);
    }

    const sampleFormat = typeof chunk.sampleFormat === 'string' ? chunk.sampleFormat : 'pcm_s16le';
    if (sampleFormat !== 'pcm_s16le') {
      throw createVoiceProviderError(
        'voice_asr_unsupported_sample_format',
        `Unsupported sample format: ${sampleFormat}`,
        'transcribing',
        false,
      );
    }

    const pcmChunk = clonePcmChunk(chunk.pcmChunk);
    if (pcmChunk.length > 0) {
      parts.push(pcmChunk);
    }
  }

  if (sampleRate !== 16000) {
    throw createVoiceProviderError(
      'voice_asr_unsupported_sample_rate',
      `Unsupported sample rate ${sampleRate}. Expected 16000.`,
      'transcribing',
      false,
    );
  }

  return {
    sampleRate,
    pcmBuffer: Buffer.concat(parts),
  };
}

function createWavHeader({
  sampleRate,
  channels,
  bitsPerSample,
  dataLength,
}) {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

function sendMessage(payload) {
  if (!process.send) {
    return;
  }

  try {
    process.send(payload);
  } catch {
    // noop
  }
}

function resolveResidentScriptPath(configuredPath = '') {
  const explicit = normalizePath(configuredPath);
  if (explicit) {
    return resolveExternalScriptPath(explicit);
  }

  return resolveExternalScriptPath(path.join(__dirname, 'providers', 'python', 'asr_resident_worker.py'));
}

function ensurePathExists(pathValue, envKey, notConfiguredCode, missingCode) {
  if (!pathValue) {
    throw createVoiceProviderError(
      notConfiguredCode,
      `Missing ${envKey}.`,
      'transcribing',
      false,
    );
  }

  if (!fs.existsSync(pathValue)) {
    throw createVoiceProviderError(
      missingCode,
      `Configured path does not exist: ${pathValue}`,
      'transcribing',
      false,
    );
  }
}

function createResidentPythonAsrRunner({
  pythonExecutable,
  workerScriptPath,
  workerScriptSource,
  modelDir,
  language,
  device,
  timeoutMs,
}) {
  let child = null;
  let stdoutBuffer = '';
  let readyPromise = null;
  let readyResolve = null;
  let readyReject = null;
  let readyTimer = null;
  let disposeRequested = false;
  let resolvedDevice = '';
  const pendingMap = new Map();

  const rejectPending = (error) => {
    for (const [, pending] of pendingMap.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    pendingMap.clear();
  };

  const cleanupReadyState = () => {
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    readyResolve = null;
    readyReject = null;
  };

  const parseWorkerLine = (line) => {
    const index = line.indexOf(JSON_PREFIX);
    if (index < 0) {
      return null;
    }

    const raw = line.slice(index + JSON_PREFIX.length).trim();
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const handleWorkerPayload = (payload = {}) => {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    if (payload.type === 'ready') {
      resolvedDevice = typeof payload.deviceUsed === 'string' ? payload.deviceUsed : '';
      if (readyResolve) {
        const resolve = readyResolve;
        cleanupReadyState();
        resolve();
      }
      return;
    }

    if (payload.type === 'shutdown-ack') {
      return;
    }

    const requestId = toRequestId(payload.requestId);
    if (!requestId) {
      return;
    }

    const pending = pendingMap.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeoutId);
    pendingMap.delete(requestId);

    if (payload.type === 'result') {
      pending.resolve({
        text: typeof payload.text === 'string' ? payload.text : '',
        deviceUsed: typeof payload.deviceUsed === 'string' ? payload.deviceUsed : resolvedDevice,
      });
      return;
    }

    if (payload.type === 'error') {
      pending.reject(
        createVoiceProviderError(
          'voice_asr_python_worker_failed',
          typeof payload.message === 'string' ? payload.message : 'Python ASR worker failed.',
          'transcribing',
          true,
        ),
      );
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
          '--model-dir',
          modelDir,
          '--language',
          language,
          '--device',
          device,
        ]
      : [
          '-u',
          '-c',
          workerScriptSource,
          '--model-dir',
          modelDir,
          '--language',
          language,
          '--device',
          device,
        ];

    child = spawn(pythonExecutable, scriptArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    child.stdout.on('data', handleStdoutChunk);

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      if (text.trim()) {
        console.warn(`[voice-asr-worker] ${text.trim()}`);
      }
    });

    child.on('exit', (code, signal) => {
      const workerExitedError = createVoiceProviderError(
        'voice_asr_python_worker_exited',
        `Python ASR worker exited (code=${code}, signal=${signal || 'none'}).`,
        'transcribing',
        true,
      );

      if (readyReject) {
        const reject = readyReject;
        cleanupReadyState();
        reject(workerExitedError);
      }
      if (!disposeRequested) {
        rejectPending(workerExitedError);
      } else {
        rejectPending(createAbortError());
      }
      child = null;
      readyPromise = null;
      stdoutBuffer = '';
    });
  };

  const ensureReady = async () => {
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
            'voice_asr_python_worker_init_timeout',
            'Python ASR worker init timeout.',
            'transcribing',
            true,
          ),
        );
      }, READY_TIMEOUT_MS);
      readyTimer.unref?.();
    });

    await readyPromise;
  };

  const writeCommand = (payload) =>
    new Promise((resolve, reject) => {
      if (!child || child.killed || !child.stdin) {
        reject(
          createVoiceProviderError(
            'voice_asr_python_worker_unavailable',
            'Python ASR worker is unavailable.',
            'transcribing',
            true,
          ),
        );
        return;
      }

      const serialized = `${JSON.stringify(payload)}\n`;
      child.stdin.write(serialized, (error) => {
        if (error) {
          reject(
            createVoiceProviderError(
              'voice_asr_python_worker_write_failed',
              `Failed to write request to Python ASR worker: ${error?.message || 'unknown error'}`,
              'transcribing',
              true,
            ),
          );
          return;
        }
        resolve();
      });
    });

  return {
    async warmup() {
      await ensureReady();
      return {
        deviceUsed: resolvedDevice,
      };
    },
    async transcribe({ requestId, audioPath, languageOverride }) {
      await ensureReady();

      return new Promise(async (resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pendingMap.delete(requestId);
          reject(
            createVoiceProviderError(
              'voice_asr_python_timeout',
              `Python ASR request timed out after ${timeoutMs}ms.`,
              'transcribing',
              true,
            ),
          );
        }, timeoutMs);
        timeoutId.unref?.();

        pendingMap.set(requestId, {
          resolve,
          reject,
          timeoutId,
        });

        try {
          await writeCommand({
            type: 'transcribe',
            requestId,
            audioPath,
            language: languageOverride || language,
          });
        } catch (error) {
          clearTimeout(timeoutId);
          pendingMap.delete(requestId);
          reject(error);
        }
      });
    },
    async abortRequest(requestId) {
      const pending = pendingMap.get(requestId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeoutId);
      pendingMap.delete(requestId);
      pending.reject(createAbortError());
      await this.restart();
    },
    async restart() {
      rejectPending(createAbortError());
      readyPromise = null;
      cleanupReadyState();
      resolvedDevice = '';
      stdoutBuffer = '';
      if (child && !child.killed) {
        child.kill('SIGTERM');
      }
    },
    async dispose() {
      disposeRequested = true;
      rejectPending(createAbortError());
      readyPromise = null;
      cleanupReadyState();
      if (child && !child.killed) {
        try {
          await writeCommand({ type: 'shutdown' });
        } catch {
          // noop
        }
        child.kill('SIGTERM');
      }
      child = null;
      stdoutBuffer = '';
    },
  };
}

let providerName = null;
let runtimeEnv = process.env;
let asrRunner = null;
const requestAbortControllers = new Map();

function toEnvProviderName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function buildAsrRunnerOptions() {
  const pythonExecutable = normalizePath(runtimeEnv.VOICE_ASR_PYTHON_EXECUTABLE);
  const modelDir =
    normalizePath(runtimeEnv.VOICE_ASR_PYTHON_MODEL_DIR) || normalizePath(runtimeEnv.VOICE_ASR_PYTHON_MODEL);
  const language = normalizePath(runtimeEnv.VOICE_ASR_PYTHON_LANGUAGE) || 'auto';
  const device = normalizePath(runtimeEnv.VOICE_ASR_PYTHON_DEVICE) || 'auto';
  const timeoutMs = Math.max(1000, toPositiveInteger(runtimeEnv.VOICE_ASR_PYTHON_TIMEOUT_MS, 120000));
  const workerScriptPath = normalizePath(runtimeEnv.VOICE_ASR_PYTHON_WORKER_SCRIPT);
  let resolvedWorkerScriptPath = '';
  let workerScriptSource = '';

  ensurePathExists(
    pythonExecutable,
    'VOICE_ASR_PYTHON_EXECUTABLE',
    'voice_asr_python_not_configured',
    'voice_asr_python_missing',
  );
  ensurePathExists(
    modelDir,
    'VOICE_ASR_PYTHON_MODEL_DIR',
    'voice_asr_model_not_configured',
    'voice_asr_model_missing',
  );
  if (workerScriptPath) {
    ensurePathExists(
      workerScriptPath,
      'VOICE_ASR_PYTHON_WORKER_SCRIPT',
      'voice_asr_python_worker_script_not_configured',
      'voice_asr_python_worker_script_missing',
    );
    resolvedWorkerScriptPath = workerScriptPath;
  } else {
    const bundledScriptPath = resolveResidentScriptPath();
    if (!fs.existsSync(bundledScriptPath)) {
      throw createVoiceProviderError(
        'voice_asr_python_worker_script_missing',
        `Bundled ASR worker script not found: ${bundledScriptPath}`,
        'transcribing',
        false,
      );
    }
    workerScriptSource = fs.readFileSync(bundledScriptPath, 'utf-8');
  }

  return {
    pythonExecutable,
    workerScriptPath: resolvedWorkerScriptPath,
    workerScriptSource,
    modelDir,
    language,
    device,
    timeoutMs,
  };
}

function getAsrRunner() {
  if (asrRunner) {
    return asrRunner;
  }

  if (providerName !== 'python') {
    throw createVoiceProviderError(
      'voice_asr_provider_unsupported_for_worker',
      `Unsupported ASR worker provider: ${providerName || 'unknown'}.`,
      'transcribing',
      false,
    );
  }

  asrRunner = createResidentPythonAsrRunner(buildAsrRunnerOptions());
  return asrRunner;
}

async function handleTranscribe(message = {}) {
  const requestId = toRequestId(message.requestId);
  if (!requestId) {
    return;
  }

  const controller = new AbortController();
  requestAbortControllers.set(requestId, controller);

  let tempDir = '';
  try {
    const { sampleRate, pcmBuffer } = normalizeAudioChunks(message.audioChunks);
    if (!pcmBuffer.length) {
      sendMessage({
        type: 'transcribe-done',
        requestId,
        text: '',
      });
      return;
    }

    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'openclaw-asr-worker-'));
    const wavPath = path.join(tempDir, 'input.wav');
    const wavHeader = createWavHeader({
      sampleRate,
      channels: 1,
      bitsPerSample: 16,
      dataLength: pcmBuffer.length,
    });
    await fsp.writeFile(wavPath, Buffer.concat([wavHeader, pcmBuffer]));

    if (controller.signal.aborted) {
      throw createAbortError();
    }

    const runner = getAsrRunner();
    const payload = await runner.transcribe({
      requestId,
      audioPath: wavPath,
      languageOverride: typeof message.language === 'string' ? message.language : '',
    });

    if (controller.signal.aborted) {
      throw createAbortError();
    }

    sendMessage({
      type: 'transcribe-done',
      requestId,
      text: typeof payload?.text === 'string' ? payload.text.trim() : '',
      deviceUsed: typeof payload?.deviceUsed === 'string' ? payload.deviceUsed : '',
    });
  } catch (error) {
    sendMessage({
      type: 'transcribe-error',
      requestId,
      error: serializeError(error),
    });
  } finally {
    requestAbortControllers.delete(requestId);
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function abortRequest(requestId) {
  const controller = requestAbortControllers.get(requestId);
  if (controller) {
    controller.abort();
    requestAbortControllers.delete(requestId);
  }

  if (asrRunner) {
    try {
      await asrRunner.abortRequest(requestId);
    } catch {
      // noop
    }
  }
}

async function handleWarmup(message = {}) {
  const requestId = toRequestId(message.requestId);
  if (!requestId) {
    return;
  }

  try {
    const runner = getAsrRunner();
    const payload = await runner.warmup();
    sendMessage({
      type: 'warmup-done',
      requestId,
      deviceUsed: typeof payload?.deviceUsed === 'string' ? payload.deviceUsed : '',
    });
  } catch (error) {
    sendMessage({
      type: 'warmup-error',
      requestId,
      error: serializeError(error),
    });
  }
}

process.on('message', (message = {}) => {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'init') {
    runtimeEnv = message.env && typeof message.env === 'object' ? message.env : process.env;
    providerName = toEnvProviderName(message.provider) || toEnvProviderName(runtimeEnv.VOICE_ASR_PROVIDER) || 'mock';
    asrRunner = null;
    sendMessage({ type: 'ready' });
    return;
  }

  if (message.type === 'transcribe') {
    void handleTranscribe(message);
    return;
  }

  if (message.type === 'warmup') {
    void handleWarmup(message);
    return;
  }

  if (message.type === 'abort') {
    const requestId = toRequestId(message.requestId);
    if (requestId) {
      void abortRequest(requestId);
    }
  }
});

process.on('disconnect', () => {
  if (asrRunner && typeof asrRunner.dispose === 'function') {
    void asrRunner.dispose().catch(() => {});
  }
  process.exit(0);
});
