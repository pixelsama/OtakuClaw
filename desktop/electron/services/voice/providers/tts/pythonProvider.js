const fs = require('node:fs');
const { spawn } = require('node:child_process');

const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_CHUNK_MS = 120;
const DEFAULT_SPEAKER = 'Vivian';
const DEFAULT_LANGUAGE = 'Chinese';
const DEFAULT_TTS_MODE = 'custom_voice';
const DEFAULT_DEVICE = 'auto';

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

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function ensurePathExists(pathValue, envKey, notConfiguredCode, missingCode) {
  if (!pathValue) {
    throw createVoiceProviderError(
      notConfiguredCode,
      `Missing ${envKey}.`,
      'speaking',
      false,
    );
  }

  if (!fs.existsSync(pathValue)) {
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

async function runPythonBridge({
  pythonExecutable,
  bridgeScriptPath,
  args = [],
  signal,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable, [bridgeScriptPath, ...args], {
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

function createPythonTtsProvider({ options = {} } = {}) {
  return {
    async synthesize({ text = '', signal, onChunk } = {}) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const normalizedText = typeof text === 'string' ? text.trim() : '';
      if (!normalizedText) {
        return {
          sampleRate: DEFAULT_SAMPLE_RATE,
          sampleCount: 0,
        };
      }

      const pythonExecutable = normalizePath(options.pythonExecutable);
      const bridgeScriptPath = normalizePath(options.bridgeScriptPath);
      const modelDir = normalizePath(options.modelDir);
      const tokenizerDir = normalizePath(options.tokenizerDir);
      const ttsMode = normalizePath(options.ttsMode) || DEFAULT_TTS_MODE;
      const speaker = normalizePath(options.speaker) || DEFAULT_SPEAKER;
      const language = normalizePath(options.language) || DEFAULT_LANGUAGE;
      const instruct = normalizePath(options.instruct);
      const device = normalizePath(options.device) || DEFAULT_DEVICE;
      const chunkMs = Math.max(20, toPositiveInteger(options.chunkMs, DEFAULT_CHUNK_MS));
      const timeoutMs = Math.max(1_000, toPositiveInteger(options.timeoutMs, 180_000));

      ensurePathExists(
        pythonExecutable,
        'VOICE_PYTHON_EXECUTABLE',
        'voice_tts_python_not_configured',
        'voice_tts_python_missing',
      );
      ensurePathExists(
        bridgeScriptPath,
        'VOICE_PYTHON_BRIDGE_SCRIPT',
        'voice_tts_python_bridge_not_configured',
        'voice_tts_python_bridge_missing',
      );
      ensurePathExists(
        modelDir,
        'VOICE_TTS_PYTHON_MODEL_DIR',
        'voice_tts_model_not_configured',
        'voice_tts_model_missing',
      );
      if (tokenizerDir) {
        ensurePathExists(
          tokenizerDir,
          'VOICE_TTS_PYTHON_TOKENIZER_DIR',
          'voice_tts_tokenizer_not_configured',
          'voice_tts_tokenizer_missing',
        );
      }

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
          '--model-dir',
          modelDir,
          '--text',
          normalizedText,
          '--tts-mode',
          ttsMode,
          '--speaker',
          speaker,
          '--language',
          language,
          '--device',
          device,
        ];
        if (tokenizerDir) {
          args.push('--tokenizer-dir', tokenizerDir);
        }
        if (instruct) {
          args.push('--instruct', instruct);
        }

        payload = await runPythonBridge({
          pythonExecutable,
          bridgeScriptPath,
          args,
          signal: controller.signal,
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
    },
  };
}

module.exports = {
  createPythonTtsProvider,
  createVoiceProviderError,
};
