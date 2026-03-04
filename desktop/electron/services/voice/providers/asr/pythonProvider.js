const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_LANGUAGE = 'auto';
const DEFAULT_DEVICE = 'auto';

function createAbortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function createVoiceProviderError(code, message, stage = 'transcribing', retriable = false) {
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

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function normalizeAudioChunks(audioChunks = []) {
  if (!Array.isArray(audioChunks) || !audioChunks.length) {
    return {
      sampleRate: DEFAULT_SAMPLE_RATE,
      pcmBuffer: Buffer.alloc(0),
    };
  }

  const parts = [];
  let sampleRate = DEFAULT_SAMPLE_RATE;

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

    const pcmChunk = Buffer.isBuffer(chunk.pcmChunk)
      ? chunk.pcmChunk
      : chunk.pcmChunk instanceof Uint8Array
        ? Buffer.from(chunk.pcmChunk)
        : null;

    if (pcmChunk && pcmChunk.length > 0) {
      parts.push(pcmChunk);
    }
  }

  if (sampleRate !== DEFAULT_SAMPLE_RATE) {
    throw createVoiceProviderError(
      'voice_asr_unsupported_sample_rate',
      `Unsupported sample rate ${sampleRate}. Expected ${DEFAULT_SAMPLE_RATE}.`,
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
          'voice_asr_python_spawn_failed',
          `Failed to start Python process: ${error?.message || 'unknown error'}`,
          'transcribing',
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
            'voice_asr_python_failed',
            stderrText.trim() || `Python ASR bridge exited with code ${code}.`,
            'transcribing',
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
            'voice_asr_python_invalid_response',
            `Invalid Python ASR response: ${error?.message || 'unknown error'}`,
            'transcribing',
            true,
          ),
        );
      }
    });
  });
}

function createPythonAsrProvider({ options = {} } = {}) {
  return {
    async transcribe({ audioChunks = [], signal, onPartial } = {}) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const {
        sampleRate,
        pcmBuffer,
      } = normalizeAudioChunks(audioChunks);

      if (!pcmBuffer.length) {
        return { text: '' };
      }

      const pythonExecutable = normalizePath(options.pythonExecutable);
      const bridgeScriptPath = normalizePath(options.bridgeScriptPath);
      const modelDir = normalizePath(options.modelDir);
      const language = normalizePath(options.language) || DEFAULT_LANGUAGE;
      const device = normalizePath(options.device) || DEFAULT_DEVICE;
      const timeoutMs = Math.max(1_000, toPositiveInteger(options.timeoutMs, 120_000));

      ensurePathExists(
        pythonExecutable,
        'VOICE_PYTHON_EXECUTABLE',
        'voice_asr_python_not_configured',
        'voice_asr_python_missing',
      );
      ensurePathExists(
        bridgeScriptPath,
        'VOICE_PYTHON_BRIDGE_SCRIPT',
        'voice_asr_python_bridge_not_configured',
        'voice_asr_python_bridge_missing',
      );
      ensurePathExists(
        modelDir,
        'VOICE_ASR_PYTHON_MODEL_DIR',
        'voice_asr_model_not_configured',
        'voice_asr_model_missing',
      );

      const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'openclaw-asr-'));
      const wavPath = path.join(tempDir, 'input.wav');
      try {
        const wavHeader = createWavHeader({
          sampleRate,
          channels: 1,
          bitsPerSample: 16,
          dataLength: pcmBuffer.length,
        });
        await fsp.writeFile(wavPath, Buffer.concat([wavHeader, pcmBuffer]));

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
          payload = await runPythonBridge({
            pythonExecutable,
            bridgeScriptPath,
            args: [
              '--task',
              'asr',
              '--model-dir',
              modelDir,
              '--audio-path',
              wavPath,
              '--language',
              language,
              '--device',
              device,
            ],
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
          if (signal) {
            signal.removeEventListener('abort', onAbort);
          }
        }

        const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
        if (text && typeof onPartial === 'function') {
          await onPartial(text);
        }

        return { text };
      } finally {
        await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

module.exports = {
  createPythonAsrProvider,
  createVoiceProviderError,
};
