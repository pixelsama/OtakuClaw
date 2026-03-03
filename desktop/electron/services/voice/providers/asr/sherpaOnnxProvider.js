const fs = require('node:fs');

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_FEATURE_DIM = 80;
const DEFAULT_NUM_THREADS = 2;
const DEFAULT_EXECUTION_PROVIDER = 'cpu';
const DEFAULT_DECODE_CHUNK_MS = 160;
const DEFAULT_OFFLINE_MODEL_KIND = 'zipformerctc';
const DEFAULT_ONLINE_MODEL_KIND = 'zipformer2ctc';

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

function toFiniteInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function toBooleanFlag(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
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

function normalizePath(pathValue) {
  if (typeof pathValue !== 'string') {
    return '';
  }

  return pathValue.trim();
}

function normalizeModelKind(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase();
}

function resolveDefaultMode(options = {}) {
  const forcedMode = typeof options.recognizerMode === 'string' ? options.recognizerMode.trim().toLowerCase() : '';
  if (forcedMode === 'online' || forcedMode === 'offline') {
    return forcedMode;
  }

  if (toBooleanFlag(options.preferOnline, false)) {
    return 'online';
  }

  return 'offline';
}

function ensurePathExists(pathValue, envKey) {
  if (!pathValue) {
    throw createVoiceProviderError(
      'voice_asr_model_not_configured',
      `Missing ${envKey}.`,
      'transcribing',
      false,
    );
  }

  if (!fs.existsSync(pathValue)) {
    throw createVoiceProviderError(
      'voice_asr_model_missing',
      `Configured path does not exist: ${pathValue}`,
      'transcribing',
      false,
    );
  }
}

function extractText(result) {
  if (typeof result === 'string') {
    return result.trim();
  }

  if (result && typeof result === 'object') {
    if (typeof result.text === 'string') {
      return result.text.trim();
    }
    if (typeof result.result === 'string') {
      return result.result.trim();
    }
  }

  return '';
}

function concatFloat32(frames) {
  const totalLength = frames.reduce((sum, frame) => sum + frame.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const frame of frames) {
    merged.set(frame, offset);
    offset += frame.length;
  }
  return merged;
}

function pcmS16LeToFloat32(pcmBuffer) {
  if (!Buffer.isBuffer(pcmBuffer) || pcmBuffer.length < 2) {
    return new Float32Array(0);
  }

  const sampleCount = Math.floor(pcmBuffer.length / 2);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = pcmBuffer.readInt16LE(i * 2);
    out[i] = sample / 32768;
  }
  return out;
}

function splitSamples(samples, chunkSize) {
  if (!(samples instanceof Float32Array) || !samples.length) {
    return [];
  }

  const out = [];
  const safeChunkSize = Math.max(1, Math.floor(chunkSize));
  for (let offset = 0; offset < samples.length; offset += safeChunkSize) {
    out.push(samples.subarray(offset, Math.min(samples.length, offset + safeChunkSize)));
  }
  return out;
}

function prepareAudioSamples(audioChunks = [], expectedSampleRate = DEFAULT_SAMPLE_RATE) {
  if (!Array.isArray(audioChunks) || audioChunks.length === 0) {
    return {
      sampleRate: expectedSampleRate,
      samples: new Float32Array(0),
    };
  }

  const floatFrames = [];
  let sampleRate = expectedSampleRate;

  for (const chunk of audioChunks) {
    if (!chunk || typeof chunk !== 'object') {
      continue;
    }

    if (typeof chunk.sampleRate === 'number' && Number.isFinite(chunk.sampleRate) && chunk.sampleRate > 0) {
      sampleRate = Math.floor(chunk.sampleRate);
    }

    const format = typeof chunk.sampleFormat === 'string' ? chunk.sampleFormat : 'pcm_s16le';
    if (format !== 'pcm_s16le') {
      throw createVoiceProviderError(
        'voice_asr_unsupported_sample_format',
        `Unsupported sample format: ${format}. Only pcm_s16le is supported currently.`,
        'transcribing',
        false,
      );
    }

    const frame = pcmS16LeToFloat32(chunk.pcmChunk);
    if (frame.length > 0) {
      floatFrames.push(frame);
    }
  }

  if (sampleRate !== expectedSampleRate) {
    throw createVoiceProviderError(
      'voice_asr_unsupported_sample_rate',
      `Unsupported sample rate ${sampleRate}. Expected ${expectedSampleRate}.`,
      'transcribing',
      false,
    );
  }

  return {
    sampleRate,
    samples: concatFloat32(floatFrames),
  };
}

function acceptWaveform(stream, sampleRate, samples) {
  if (!stream || typeof stream.acceptWaveform !== 'function') {
    throw createVoiceProviderError(
      'voice_asr_provider_invalid_api',
      'sherpa-onnx stream.acceptWaveform is unavailable.',
      'transcribing',
      false,
    );
  }

  if (stream.acceptWaveform.length >= 2) {
    stream.acceptWaveform(sampleRate, samples);
    return;
  }

  stream.acceptWaveform({
    sampleRate,
    samples,
  });
}

function createDefaultRecognizerConfig(options = {}) {
  const modelPath = normalizePath(options.modelPath);
  const tokensPath = normalizePath(options.tokensPath);
  const encoderPath = normalizePath(options.encoderPath);
  const decoderPath = normalizePath(options.decoderPath);
  const joinerPath = normalizePath(options.joinerPath);
  const mode = resolveDefaultMode(options);
  const modelKind = normalizeModelKind(options.modelKind) || (
    mode === 'online' ? DEFAULT_ONLINE_MODEL_KIND : DEFAULT_OFFLINE_MODEL_KIND
  );

  ensurePathExists(tokensPath, 'VOICE_ASR_SHERPA_TOKENS');

  const hasTransducer = Boolean(encoderPath && decoderPath && joinerPath);
  if (hasTransducer) {
    ensurePathExists(encoderPath, 'VOICE_ASR_SHERPA_ENCODER');
    ensurePathExists(decoderPath, 'VOICE_ASR_SHERPA_DECODER');
    ensurePathExists(joinerPath, 'VOICE_ASR_SHERPA_JOINER');
  } else {
    ensurePathExists(modelPath, 'VOICE_ASR_SHERPA_MODEL');
  }

  const sampleRate = toFiniteInteger(options.sampleRate, DEFAULT_SAMPLE_RATE);
  const featureDim = toFiniteInteger(options.featureDim, DEFAULT_FEATURE_DIM);
  const numThreads = Math.max(1, toFiniteInteger(options.numThreads, DEFAULT_NUM_THREADS));
  const executionProvider = normalizePath(options.executionProvider) || DEFAULT_EXECUTION_PROVIDER;
  const debug = toBooleanFlag(options.debug, false) ? 1 : 0;

  const modelConfig = {
    tokens: tokensPath,
    numThreads,
    provider: executionProvider,
    debug,
  };

  if (hasTransducer) {
    modelConfig.transducer = {
      encoder: encoderPath,
      decoder: decoderPath,
      joiner: joinerPath,
    };
  } else {
    const modelKindKeyMap = {
      zipformerctc: 'zipformerCtc',
      zipformer2ctc: 'zipformer2Ctc',
      wenetctc: 'wenetCtc',
      omnilingual: 'omnilingual',
      medasr: 'medasr',
      dolphin: 'dolphin',
      nemoctc: 'nemoCtc',
      tonectc: 'toneCtc',
      tdnn: 'tdnn',
      sensevoice: 'senseVoice',
    };
    const modelKey = modelKindKeyMap[modelKind];
    if (!modelKey) {
      throw createVoiceProviderError(
        'voice_asr_model_kind_unsupported',
        `Unsupported VOICE_ASR_SHERPA_MODEL_KIND: ${modelKind}`,
        'transcribing',
        false,
      );
    }

    modelConfig[modelKey] = { model: modelPath };
  }

  return {
    featConfig: {
      sampleRate,
      featureDim,
    },
    modelConfig,
  };
}

async function decodeOnce(recognizer, stream) {
  if (typeof recognizer.decode === 'function') {
    await recognizer.decode(stream);
    return;
  }

  if (typeof recognizer.decodeStream === 'function') {
    await recognizer.decodeStream(stream);
    return;
  }

  throw createVoiceProviderError(
    'voice_asr_provider_invalid_api',
    'sherpa-onnx recognizer decode API is unavailable.',
    'transcribing',
    false,
  );
}

async function decodeUntilBlocked(recognizer, stream) {
  if (typeof recognizer.isReady === 'function') {
    let iteration = 0;
    while (recognizer.isReady(stream)) {
      iteration += 1;
      await decodeOnce(recognizer, stream);
      if (iteration > 8192) {
        throw createVoiceProviderError(
          'voice_asr_decode_loop_overflow',
          'Recognizer decode loop overflow.',
          'transcribing',
          true,
        );
      }
    }
    return;
  }

  await decodeOnce(recognizer, stream);
}

function getRecognizerResult(recognizer, stream) {
  if (typeof recognizer.getResult !== 'function') {
    return '';
  }

  return extractText(recognizer.getResult(stream));
}

function resolveRecognizerMode({ options = {}, config = {} } = {}) {
  const defaultMode = resolveDefaultMode(options);

  if (config?.modelConfig?.transducer) {
    return 'online';
  }

  return defaultMode;
}

function createSherpaOnnxAsrProvider({ options = {}, requireFn = require } = {}) {
  let sherpaModule = null;
  let recognizer = null;
  let recognizerConfig = null;
  let recognizerMode = null;

  const getSherpaModule = () => {
    if (sherpaModule) {
      return sherpaModule;
    }

    try {
      sherpaModule = requireFn('sherpa-onnx-node');
      return sherpaModule;
    } catch (error) {
      throw createVoiceProviderError(
        'voice_asr_provider_not_installed',
        `Failed to load sherpa-onnx-node: ${error?.message || 'module not found'}`,
        'transcribing',
        false,
      );
    }
  };

  const getRecognizerConfig = () => {
    if (options.recognizerConfig && typeof options.recognizerConfig === 'object') {
      return options.recognizerConfig;
    }

    if (!recognizerConfig) {
      recognizerConfig = createDefaultRecognizerConfig(options);
    }

    return recognizerConfig;
  };

  const getRecognizer = () => {
    if (recognizer) {
      return recognizer;
    }

    const config = getRecognizerConfig();
    const mode = resolveRecognizerMode({
      options,
      config,
    });

    if (typeof options.createRecognizerFn === 'function') {
      const created = options.createRecognizerFn({
        config,
        mode,
      });
      recognizer = created;
      recognizerMode = mode;
      return recognizer;
    }

    const sherpa = getSherpaModule();
    const ctor = mode === 'online' ? sherpa.OnlineRecognizer : sherpa.OfflineRecognizer;
    if (typeof ctor !== 'function') {
      throw createVoiceProviderError(
        'voice_asr_provider_invalid_api',
        `sherpa-onnx-node ${mode} recognizer constructor is unavailable.`,
        'transcribing',
        false,
      );
    }

    recognizer = new ctor(config);
    recognizerMode = mode;
    return recognizer;
  };

  const emitPartialIfChanged = async (nextText, state, onPartial) => {
    const normalized = typeof nextText === 'string' ? nextText.trim() : '';
    if (!normalized) {
      return;
    }

    if (normalized === state.lastPartialText) {
      return;
    }

    state.lastPartialText = normalized;
    if (typeof onPartial === 'function') {
      await onPartial(normalized);
    }
  };

  return {
    async transcribe({ audioChunks = [], signal, onPartial } = {}) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const config = getRecognizerConfig();
      const sampleRate = config?.featConfig?.sampleRate || DEFAULT_SAMPLE_RATE;
      const prepared = prepareAudioSamples(audioChunks, sampleRate);

      if (!prepared.samples.length) {
        return { text: '' };
      }

      const decodeChunkMs = Math.max(20, toFiniteInteger(options.decodeChunkMs, DEFAULT_DECODE_CHUNK_MS));
      const decodeChunkSamples = Math.max(1, Math.floor((prepared.sampleRate * decodeChunkMs) / 1000));

      const recognizerInstance = getRecognizer();
      if (!recognizerInstance || typeof recognizerInstance.createStream !== 'function') {
        throw createVoiceProviderError(
          'voice_asr_provider_invalid_api',
          'sherpa-onnx recognizer.createStream is unavailable.',
          'transcribing',
          false,
        );
      }

      const stream = recognizerInstance.createStream();
      const frames = splitSamples(prepared.samples, decodeChunkSamples);
      const state = {
        lastPartialText: '',
      };

      for (const frame of frames) {
        if (signal?.aborted) {
          throw createAbortError();
        }

        acceptWaveform(stream, prepared.sampleRate, frame);
        await decodeUntilBlocked(recognizerInstance, stream);

        const partialText = getRecognizerResult(recognizerInstance, stream);
        await emitPartialIfChanged(partialText, state, onPartial);
      }

      if (typeof stream.inputFinished === 'function') {
        stream.inputFinished();
      }

      if (signal?.aborted) {
        throw createAbortError();
      }

      await decodeUntilBlocked(recognizerInstance, stream);
      const finalText = getRecognizerResult(recognizerInstance, stream);
      await emitPartialIfChanged(finalText, state, onPartial);

      if (recognizerMode === 'online' && typeof recognizerInstance.reset === 'function') {
        recognizerInstance.reset(stream);
      }

      return { text: finalText };
    },
  };
}

module.exports = {
  createSherpaOnnxAsrProvider,
  prepareAudioSamples,
  createDefaultRecognizerConfig,
  splitSamples,
  createVoiceProviderError,
};
