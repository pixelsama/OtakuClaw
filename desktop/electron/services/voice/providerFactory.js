const { createSherpaOnnxAsrProvider } = require('./providers/asr/sherpaOnnxProvider');

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
      onChunk({
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

function createTtsProvider({ provider = 'mock' } = {}) {
  if (provider === 'mock') {
    return createMockTtsProvider();
  }

  throw new Error(`Unsupported TTS provider: ${provider}`);
}

module.exports = {
  createAsrProvider,
  createTtsProvider,
  createAbortError,
  buildSherpaOnnxOptionsFromEnv,
};
