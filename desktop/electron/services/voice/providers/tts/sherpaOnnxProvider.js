const fs = require('node:fs');

const DEFAULT_MODEL_KIND = 'kokoro';
const DEFAULT_NUM_THREADS = 2;
const DEFAULT_EXECUTION_PROVIDER = 'cpu';
const DEFAULT_CHUNK_MS = 120;
const DEFAULT_SPEED = 1;
const DEFAULT_SID = 0;
const DEFAULT_OUTPUT_SAMPLE_FORMAT = 'pcm_s16le';
const DEFAULT_FALLBACK_SAMPLE_RATE = 24000;

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

function normalizeModelKind(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase();
}

function toFiniteInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function toFiniteNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
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

function ensurePathExists(pathValue, envKey) {
  if (!pathValue) {
    throw createVoiceProviderError(
      'voice_tts_model_not_configured',
      `Missing ${envKey}.`,
      'speaking',
      false,
    );
  }

  if (!fs.existsSync(pathValue)) {
    throw createVoiceProviderError(
      'voice_tts_model_missing',
      `Configured path does not exist: ${pathValue}`,
      'speaking',
      false,
    );
  }
}

function toOptionalNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toOptionalInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function assignOptional(target, key, value) {
  if (value === undefined || value === null || value === '') {
    return;
  }

  target[key] = value;
}

function buildModelConfig(modelKind, options = {}) {
  const modelPath = normalizePath(options.modelPath);
  const tokensPath = normalizePath(options.tokensPath);
  const voicesPath = normalizePath(options.voicesPath);
  const lexiconPath = normalizePath(options.lexiconPath);
  const dataDir = normalizePath(options.dataDir);
  const acousticModelPath = normalizePath(options.acousticModelPath);
  const vocoderPath = normalizePath(options.vocoderPath);
  const lmFlowPath = normalizePath(options.lmFlowPath);
  const lmMainPath = normalizePath(options.lmMainPath);
  const encoderPath = normalizePath(options.encoderPath);
  const decoderPath = normalizePath(options.decoderPath);
  const textConditionerPath = normalizePath(options.textConditionerPath);
  const vocabJsonPath = normalizePath(options.vocabJsonPath);
  const tokenScoresJsonPath = normalizePath(options.tokenScoresJsonPath);
  const lang = normalizePath(options.lang);

  if (modelKind === 'vits') {
    ensurePathExists(modelPath, 'VOICE_TTS_SHERPA_MODEL');
    ensurePathExists(tokensPath, 'VOICE_TTS_SHERPA_TOKENS');
    if (lexiconPath) {
      ensurePathExists(lexiconPath, 'VOICE_TTS_SHERPA_LEXICON');
    }
    if (dataDir) {
      ensurePathExists(dataDir, 'VOICE_TTS_SHERPA_DATA_DIR');
    }

    const config = {
      model: modelPath,
      tokens: tokensPath,
    };
    assignOptional(config, 'lexicon', lexiconPath);
    assignOptional(config, 'dataDir', dataDir);
    assignOptional(config, 'noiseScale', toOptionalNumber(options.noiseScale));
    assignOptional(config, 'noiseScaleW', toOptionalNumber(options.noiseScaleW));
    assignOptional(config, 'lengthScale', toOptionalNumber(options.lengthScale));
    return { vits: config };
  }

  if (modelKind === 'matcha') {
    ensurePathExists(acousticModelPath, 'VOICE_TTS_SHERPA_ACOUSTIC_MODEL');
    ensurePathExists(vocoderPath, 'VOICE_TTS_SHERPA_VOCODER');
    ensurePathExists(tokensPath, 'VOICE_TTS_SHERPA_TOKENS');
    if (lexiconPath) {
      ensurePathExists(lexiconPath, 'VOICE_TTS_SHERPA_LEXICON');
    }
    if (dataDir) {
      ensurePathExists(dataDir, 'VOICE_TTS_SHERPA_DATA_DIR');
    }

    const config = {
      acousticModel: acousticModelPath,
      vocoder: vocoderPath,
      tokens: tokensPath,
    };
    assignOptional(config, 'lexicon', lexiconPath);
    assignOptional(config, 'dataDir', dataDir);
    assignOptional(config, 'noiseScale', toOptionalNumber(options.noiseScale));
    assignOptional(config, 'lengthScale', toOptionalNumber(options.lengthScale));
    return { matcha: config };
  }

  if (modelKind === 'kokoro') {
    ensurePathExists(modelPath, 'VOICE_TTS_SHERPA_MODEL');
    ensurePathExists(voicesPath, 'VOICE_TTS_SHERPA_VOICES');
    ensurePathExists(tokensPath, 'VOICE_TTS_SHERPA_TOKENS');
    if (lexiconPath) {
      ensurePathExists(lexiconPath, 'VOICE_TTS_SHERPA_LEXICON');
    }
    if (dataDir) {
      ensurePathExists(dataDir, 'VOICE_TTS_SHERPA_DATA_DIR');
    }

    const config = {
      model: modelPath,
      voices: voicesPath,
      tokens: tokensPath,
    };
    assignOptional(config, 'lexicon', lexiconPath);
    assignOptional(config, 'dataDir', dataDir);
    assignOptional(config, 'lengthScale', toOptionalNumber(options.lengthScale));
    assignOptional(config, 'lang', lang);
    return { kokoro: config };
  }

  if (modelKind === 'kitten') {
    ensurePathExists(modelPath, 'VOICE_TTS_SHERPA_MODEL');
    ensurePathExists(voicesPath, 'VOICE_TTS_SHERPA_VOICES');
    ensurePathExists(tokensPath, 'VOICE_TTS_SHERPA_TOKENS');
    if (dataDir) {
      ensurePathExists(dataDir, 'VOICE_TTS_SHERPA_DATA_DIR');
    }

    const config = {
      model: modelPath,
      voices: voicesPath,
      tokens: tokensPath,
    };
    assignOptional(config, 'dataDir', dataDir);
    assignOptional(config, 'lengthScale', toOptionalNumber(options.lengthScale));
    return { kitten: config };
  }

  if (modelKind === 'pocket') {
    ensurePathExists(lmFlowPath, 'VOICE_TTS_SHERPA_LM_FLOW');
    ensurePathExists(lmMainPath, 'VOICE_TTS_SHERPA_LM_MAIN');
    ensurePathExists(encoderPath, 'VOICE_TTS_SHERPA_ENCODER');
    ensurePathExists(decoderPath, 'VOICE_TTS_SHERPA_DECODER');
    ensurePathExists(textConditionerPath, 'VOICE_TTS_SHERPA_TEXT_CONDITIONER');
    ensurePathExists(vocabJsonPath, 'VOICE_TTS_SHERPA_VOCAB_JSON');
    ensurePathExists(tokenScoresJsonPath, 'VOICE_TTS_SHERPA_TOKEN_SCORES_JSON');

    const config = {
      lmFlow: lmFlowPath,
      lmMain: lmMainPath,
      encoder: encoderPath,
      decoder: decoderPath,
      textConditioner: textConditionerPath,
      vocabJson: vocabJsonPath,
      tokenScoresJson: tokenScoresJsonPath,
    };
    assignOptional(config, 'voiceEmbeddingCacheCapacity', toOptionalInteger(options.voiceEmbeddingCacheCapacity));
    return { pocket: config };
  }

  throw createVoiceProviderError(
    'voice_tts_model_kind_unsupported',
    `Unsupported VOICE_TTS_SHERPA_MODEL_KIND: ${modelKind}`,
    'speaking',
    false,
  );
}

function createDefaultTtsConfig(options = {}) {
  const modelKind = normalizeModelKind(options.modelKind) || DEFAULT_MODEL_KIND;
  const numThreads = Math.max(1, toFiniteInteger(options.numThreads, DEFAULT_NUM_THREADS));
  const executionProvider = normalizePath(options.executionProvider) || DEFAULT_EXECUTION_PROVIDER;
  const debug = toBooleanFlag(options.debug, false) ? 1 : 0;

  const config = {
    model: buildModelConfig(modelKind, options),
    numThreads,
    provider: executionProvider,
    debug,
  };

  assignOptional(config, 'maxNumSentences', toOptionalInteger(options.maxNumSentences));
  assignOptional(config, 'silenceScale', toOptionalNumber(options.silenceScale));

  return config;
}

function normalizeSamples(samples) {
  if (samples instanceof Float32Array) {
    return samples;
  }

  if (Array.isArray(samples)) {
    return Float32Array.from(samples);
  }

  return new Float32Array(0);
}

function float32ToS16leBuffer(samples) {
  const buffer = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i])) : 0;
    const int16 = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
    buffer.writeInt16LE(int16, i * 2);
  }
  return buffer;
}

function float32ToF32leBuffer(samples) {
  const byteLength = samples.length * Float32Array.BYTES_PER_ELEMENT;
  const source = Buffer.from(samples.buffer, samples.byteOffset, byteLength);
  return Buffer.from(source);
}

function buildChunkBuffer(samples, outputSampleFormat) {
  if (outputSampleFormat === 'pcm_s16le') {
    return {
      codec: 'pcm_s16le',
      audioChunk: float32ToS16leBuffer(samples),
    };
  }

  if (outputSampleFormat === 'pcm_f32le') {
    return {
      codec: 'pcm_f32le',
      audioChunk: float32ToF32leBuffer(samples),
    };
  }

  throw createVoiceProviderError(
    'voice_tts_unsupported_sample_format',
    `Unsupported output sample format: ${outputSampleFormat}`,
    'speaking',
    false,
  );
}

function splitSamples(samples, sampleRate, chunkMs) {
  if (!(samples instanceof Float32Array) || samples.length === 0) {
    return [];
  }

  const samplesPerChunk = Math.max(1, Math.floor((sampleRate * chunkMs) / 1000));
  const out = [];
  for (let offset = 0; offset < samples.length; offset += samplesPerChunk) {
    out.push(samples.subarray(offset, Math.min(samples.length, offset + samplesPerChunk)));
  }
  return out;
}

function createSherpaOnnxTtsProvider({ options = {}, requireFn = require } = {}) {
  let sherpaModule = null;
  let ttsConfig = null;
  let ttsEngine = null;

  const getSherpaModule = () => {
    if (sherpaModule) {
      return sherpaModule;
    }

    try {
      sherpaModule = requireFn('sherpa-onnx-node');
      return sherpaModule;
    } catch (error) {
      throw createVoiceProviderError(
        'voice_tts_provider_not_installed',
        `Failed to load sherpa-onnx-node: ${error?.message || 'module not found'}`,
        'speaking',
        false,
      );
    }
  };

  const getTtsConfig = () => {
    if (options.ttsConfig && typeof options.ttsConfig === 'object') {
      return options.ttsConfig;
    }

    if (!ttsConfig) {
      ttsConfig = createDefaultTtsConfig(options);
    }

    return ttsConfig;
  };

  const getTtsEngine = () => {
    if (ttsEngine) {
      return ttsEngine;
    }

    const config = getTtsConfig();

    if (typeof options.createTtsFn === 'function') {
      ttsEngine = options.createTtsFn({ config });
      return ttsEngine;
    }

    const sherpa = getSherpaModule();
    const ctor = sherpa.OfflineTts;
    if (typeof ctor !== 'function') {
      throw createVoiceProviderError(
        'voice_tts_provider_invalid_api',
        'sherpa-onnx-node OfflineTts constructor is unavailable.',
        'speaking',
        false,
      );
    }

    ttsEngine = new ctor(config);
    return ttsEngine;
  };

  return {
    async synthesize({ text = '', signal, onChunk } = {}) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const normalizedText = typeof text === 'string' ? text.trim() : '';
      if (!normalizedText) {
        return {
          sampleRate: DEFAULT_FALLBACK_SAMPLE_RATE,
          sampleCount: 0,
        };
      }

      const tts = getTtsEngine();
      if (!tts || (typeof tts.generate !== 'function' && typeof tts.generateAsync !== 'function')) {
        throw createVoiceProviderError(
          'voice_tts_provider_invalid_api',
          'sherpa-onnx OfflineTts generate API is unavailable.',
          'speaking',
          false,
        );
      }

      const generationConfig = options.generationConfig && typeof options.generationConfig === 'object'
        ? options.generationConfig
        : undefined;
      const request = {
        text: normalizedText,
        sid: Math.max(0, toFiniteInteger(options.sid, DEFAULT_SID)),
        speed: Math.max(0.1, toFiniteNumber(options.speed, DEFAULT_SPEED)),
      };

      if (generationConfig) {
        request.generationConfig = generationConfig;
      }

      if (options.enableExternalBuffer !== undefined) {
        request.enableExternalBuffer = toBooleanFlag(options.enableExternalBuffer, true);
      }

      let generated;
      if (typeof tts.generateAsync === 'function') {
        generated = await tts.generateAsync({
          ...request,
          onProgress: () => {
            if (signal?.aborted) {
              return 0;
            }
            return 1;
          },
        });
      } else {
        generated = tts.generate(request);
      }

      if (signal?.aborted) {
        throw createAbortError();
      }

      const samples = normalizeSamples(generated?.samples);
      const sampleRate = Math.max(
        1,
        toFiniteInteger(generated?.sampleRate, toFiniteInteger(tts.sampleRate, DEFAULT_FALLBACK_SAMPLE_RATE)),
      );
      const chunkMs = Math.max(20, toFiniteInteger(options.chunkMs, DEFAULT_CHUNK_MS));
      const outputSampleFormat = normalizePath(options.outputSampleFormat) || DEFAULT_OUTPUT_SAMPLE_FORMAT;

      if (typeof onChunk === 'function' && samples.length > 0) {
        const frames = splitSamples(samples, sampleRate, chunkMs);
        for (const frame of frames) {
          if (signal?.aborted) {
            throw createAbortError();
          }

          const { audioChunk, codec } = buildChunkBuffer(frame, outputSampleFormat);
          await onChunk({
            audioChunk,
            codec,
            sampleRate,
          });
        }
      }

      return {
        sampleRate,
        sampleCount: samples.length,
      };
    },
  };
}

module.exports = {
  createSherpaOnnxTtsProvider,
  createDefaultTtsConfig,
  splitSamples,
  buildChunkBuffer,
  createVoiceProviderError,
};
