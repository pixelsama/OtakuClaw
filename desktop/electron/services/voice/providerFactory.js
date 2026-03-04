const { createSherpaOnnxAsrProvider } = require('./providers/asr/sherpaOnnxProvider');
const { createSherpaOnnxTtsProvider } = require('./providers/tts/sherpaOnnxProvider');

function createAbortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function createMockAsrProvider() {
  return {
    async transcribe({ audioChunks = [], signal, onPartial }) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const hasAudio = Array.isArray(audioChunks) && audioChunks.length > 0;
      const text = hasAudio ? 'mock voice input' : '';

      if (typeof onPartial === 'function' && text) {
        onPartial('mock...');
      }

      return { text };
    },
  };
}

function createMockTtsProvider() {
  return {
    async synthesize({ text = '', signal, onChunk }) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      if (typeof onChunk !== 'function' || !text.trim()) {
        return;
      }

      // Placeholder chunk for wiring and flow-control testing.
      const audioChunk = Buffer.from(text, 'utf-8');
      await onChunk({
        audioChunk,
        codec: 'mock/utf8',
        sampleRate: 16000,
      });
    },
  };
}

function normalizeProviderName(providerName) {
  if (typeof providerName !== 'string') {
    return '';
  }

  return providerName.trim().toLowerCase();
}

function buildSherpaOnnxOptionsFromEnv(env = process.env) {
  return {
    modelPath: env.VOICE_ASR_SHERPA_MODEL,
    tokensPath: env.VOICE_ASR_SHERPA_TOKENS,
    encoderPath: env.VOICE_ASR_SHERPA_ENCODER,
    decoderPath: env.VOICE_ASR_SHERPA_DECODER,
    joinerPath: env.VOICE_ASR_SHERPA_JOINER,
    modelKind: env.VOICE_ASR_SHERPA_MODEL_KIND,
    sampleRate: env.VOICE_ASR_SHERPA_SAMPLE_RATE,
    featureDim: env.VOICE_ASR_SHERPA_FEATURE_DIM,
    numThreads: env.VOICE_ASR_SHERPA_NUM_THREADS,
    executionProvider: env.VOICE_ASR_SHERPA_EXECUTION_PROVIDER || env.VOICE_ASR_SHERPA_PROVIDER,
    debug: env.VOICE_ASR_SHERPA_DEBUG,
    decodeChunkMs: env.VOICE_ASR_SHERPA_DECODE_CHUNK_MS,
    preferOnline: env.VOICE_ASR_SHERPA_PREFER_ONLINE,
    recognizerMode: env.VOICE_ASR_SHERPA_MODE,
  };
}

function buildSherpaOnnxTtsOptionsFromEnv(env = process.env) {
  return {
    modelKind: env.VOICE_TTS_SHERPA_MODEL_KIND,
    modelPath: env.VOICE_TTS_SHERPA_MODEL,
    tokensPath: env.VOICE_TTS_SHERPA_TOKENS,
    voicesPath: env.VOICE_TTS_SHERPA_VOICES,
    lexiconPath: env.VOICE_TTS_SHERPA_LEXICON,
    dataDir: env.VOICE_TTS_SHERPA_DATA_DIR,
    acousticModelPath: env.VOICE_TTS_SHERPA_ACOUSTIC_MODEL,
    vocoderPath: env.VOICE_TTS_SHERPA_VOCODER,
    lmFlowPath: env.VOICE_TTS_SHERPA_LM_FLOW,
    lmMainPath: env.VOICE_TTS_SHERPA_LM_MAIN,
    encoderPath: env.VOICE_TTS_SHERPA_ENCODER,
    decoderPath: env.VOICE_TTS_SHERPA_DECODER,
    textConditionerPath: env.VOICE_TTS_SHERPA_TEXT_CONDITIONER,
    vocabJsonPath: env.VOICE_TTS_SHERPA_VOCAB_JSON,
    tokenScoresJsonPath: env.VOICE_TTS_SHERPA_TOKEN_SCORES_JSON,
    lang: env.VOICE_TTS_SHERPA_LANG,
    numThreads: env.VOICE_TTS_SHERPA_NUM_THREADS,
    executionProvider: env.VOICE_TTS_SHERPA_EXECUTION_PROVIDER || env.VOICE_TTS_SHERPA_PROVIDER,
    debug: env.VOICE_TTS_SHERPA_DEBUG,
    maxNumSentences: env.VOICE_TTS_SHERPA_MAX_NUM_SENTENCES,
    silenceScale: env.VOICE_TTS_SHERPA_SILENCE_SCALE,
    sid: env.VOICE_TTS_SHERPA_SID,
    speed: env.VOICE_TTS_SHERPA_SPEED,
    chunkMs: env.VOICE_TTS_SHERPA_CHUNK_MS,
    outputSampleFormat: env.VOICE_TTS_SHERPA_OUTPUT_SAMPLE_FORMAT,
    enableExternalBuffer: env.VOICE_TTS_SHERPA_ENABLE_EXTERNAL_BUFFER,
    lengthScale: env.VOICE_TTS_SHERPA_LENGTH_SCALE,
    noiseScale: env.VOICE_TTS_SHERPA_NOISE_SCALE,
    noiseScaleW: env.VOICE_TTS_SHERPA_NOISE_SCALE_W,
    voiceEmbeddingCacheCapacity: env.VOICE_TTS_SHERPA_VOICE_EMBEDDING_CACHE_CAPACITY,
  };
}

function createAsrProvider({ provider = null, env = process.env } = {}) {
  const providerName = normalizeProviderName(provider) || normalizeProviderName(env.VOICE_ASR_PROVIDER) || 'mock';

  if (providerName === 'mock') {
    return createMockAsrProvider();
  }

  if (providerName === 'sherpa-onnx') {
    return createSherpaOnnxAsrProvider({
      options: buildSherpaOnnxOptionsFromEnv(env),
    });
  }

  throw new Error(`Unsupported ASR provider: ${providerName}`);
}

function createTtsProvider({ provider = null, env = process.env } = {}) {
  const providerName = normalizeProviderName(provider) || normalizeProviderName(env.VOICE_TTS_PROVIDER) || 'mock';

  if (providerName === 'mock') {
    return createMockTtsProvider();
  }

  if (providerName === 'sherpa-onnx') {
    return createSherpaOnnxTtsProvider({
      options: buildSherpaOnnxTtsOptionsFromEnv(env),
    });
  }

  throw new Error(`Unsupported TTS provider: ${providerName}`);
}

module.exports = {
  createAsrProvider,
  createTtsProvider,
  createAbortError,
  buildSherpaOnnxOptionsFromEnv,
  buildSherpaOnnxTtsOptionsFromEnv,
};
