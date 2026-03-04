const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createTtsProvider,
  buildSherpaOnnxTtsOptionsFromEnv,
} = require('../services/voice/providerFactory');
const {
  createSherpaOnnxTtsProvider,
  createDefaultTtsConfig,
} = require('../services/voice/providers/tts/sherpaOnnxProvider');

test('buildSherpaOnnxTtsOptionsFromEnv maps env values', () => {
  const options = buildSherpaOnnxTtsOptionsFromEnv({
    VOICE_TTS_SHERPA_MODEL_KIND: 'kokoro',
    VOICE_TTS_SHERPA_MODEL: '/tmp/model.onnx',
    VOICE_TTS_SHERPA_TOKENS: '/tmp/tokens.txt',
    VOICE_TTS_SHERPA_VOICES: '/tmp/voices.bin',
    VOICE_TTS_SHERPA_LEXICON: '/tmp/lexicon.txt',
    VOICE_TTS_SHERPA_DATA_DIR: '/tmp/data',
    VOICE_TTS_SHERPA_NUM_THREADS: '4',
    VOICE_TTS_SHERPA_EXECUTION_PROVIDER: 'coreml',
    VOICE_TTS_SHERPA_DEBUG: '1',
    VOICE_TTS_SHERPA_SID: '1',
    VOICE_TTS_SHERPA_SPEED: '1.25',
    VOICE_TTS_SHERPA_CHUNK_MS: '80',
    VOICE_TTS_SHERPA_OUTPUT_SAMPLE_FORMAT: 'pcm_f32le',
    VOICE_TTS_SHERPA_ENABLE_EXTERNAL_BUFFER: '0',
  });

  assert.equal(options.modelKind, 'kokoro');
  assert.equal(options.modelPath, '/tmp/model.onnx');
  assert.equal(options.tokensPath, '/tmp/tokens.txt');
  assert.equal(options.voicesPath, '/tmp/voices.bin');
  assert.equal(options.lexiconPath, '/tmp/lexicon.txt');
  assert.equal(options.dataDir, '/tmp/data');
  assert.equal(options.numThreads, '4');
  assert.equal(options.executionProvider, 'coreml');
  assert.equal(options.debug, '1');
  assert.equal(options.sid, '1');
  assert.equal(options.speed, '1.25');
  assert.equal(options.chunkMs, '80');
  assert.equal(options.outputSampleFormat, 'pcm_f32le');
  assert.equal(options.enableExternalBuffer, '0');
});

test('createTtsProvider uses env default mock provider', async () => {
  const provider = createTtsProvider({
    env: {
      VOICE_TTS_PROVIDER: 'mock',
    },
  });

  const chunks = [];
  await provider.synthesize({
    text: 'hello',
    onChunk: (chunk) => chunks.push(chunk),
  });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].codec, 'mock/utf8');
});

test('createDefaultTtsConfig validates kokoro required paths', () => {
  assert.throws(
    () =>
      createDefaultTtsConfig({
        modelKind: 'kokoro',
        modelPath: __filename,
        tokensPath: __filename,
      }),
    (error) => {
      assert.equal(error.code, 'voice_tts_model_not_configured');
      return true;
    },
  );
});

test('createSherpaOnnxTtsProvider returns structured error when module missing', async () => {
  const provider = createSherpaOnnxTtsProvider({
    options: {
      ttsConfig: {},
    },
    requireFn: () => {
      throw new Error('missing');
    },
  });

  await assert.rejects(
    () =>
      provider.synthesize({
        text: 'hello',
        onChunk: () => {},
      }),
    (error) => {
      assert.equal(error.code, 'voice_tts_provider_not_installed');
      return true;
    },
  );
});

test('sherpa tts provider emits chunked pcm_s16le audio', async () => {
  const samples = new Float32Array(960);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = i % 2 === 0 ? 0.5 : -0.5;
  }

  let generateCallCount = 0;
  const provider = createSherpaOnnxTtsProvider({
    options: {
      chunkMs: 20,
      outputSampleFormat: 'pcm_s16le',
      ttsConfig: {},
      createTtsFn: () => ({
        sampleRate: 24000,
        async generateAsync(request) {
          generateCallCount += 1;
          assert.equal(typeof request.onProgress, 'function');
          request.onProgress({
            samples: samples.subarray(0, 100),
            progress: 0.1,
          });
          return {
            sampleRate: 24000,
            samples,
          };
        },
      }),
    },
  });

  const chunks = [];
  const result = await provider.synthesize({
    text: 'test',
    onChunk: async (chunk) => {
      chunks.push(chunk);
    },
  });

  assert.equal(generateCallCount, 1);
  assert.equal(result.sampleRate, 24000);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].codec, 'pcm_s16le');
  assert.equal(chunks[0].sampleRate, 24000);
  assert.equal(chunks[0].audioChunk.length, 960);
});

test('sherpa tts provider supports pcm_f32le output', async () => {
  const samples = new Float32Array(240);
  samples.fill(0.25);

  const provider = createSherpaOnnxTtsProvider({
    options: {
      chunkMs: 20,
      outputSampleFormat: 'pcm_f32le',
      ttsConfig: {},
      createTtsFn: () => ({
        generate() {
          return {
            sampleRate: 8000,
            samples,
          };
        },
      }),
    },
  });

  const chunks = [];
  await provider.synthesize({
    text: 'test',
    onChunk: (chunk) => chunks.push(chunk),
  });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].codec, 'pcm_f32le');
  assert.equal(chunks[0].audioChunk.length, 160 * 4);
});

test('sherpa tts provider can be aborted during chunk emit', async () => {
  const controller = new AbortController();
  const provider = createSherpaOnnxTtsProvider({
    options: {
      chunkMs: 20,
      ttsConfig: {},
      createTtsFn: () => ({
        generate() {
          return {
            sampleRate: 16000,
            samples: new Float32Array(640).fill(0.2),
          };
        },
      }),
    },
  });

  await assert.rejects(
    () =>
      provider.synthesize({
        text: 'abort me',
        signal: controller.signal,
        onChunk: () => {
          controller.abort();
        },
      }),
    (error) => {
      assert.equal(error.name, 'AbortError');
      return true;
    },
  );
});
