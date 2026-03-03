const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createAsrProvider,
  buildSherpaOnnxOptionsFromEnv,
} = require('../services/voice/providerFactory');
const {
  createSherpaOnnxAsrProvider,
  prepareAudioSamples,
  createDefaultRecognizerConfig,
} = require('../services/voice/providers/asr/sherpaOnnxProvider');

function createPcmBuffer(sampleCount, value = 1024) {
  const buffer = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i += 1) {
    buffer.writeInt16LE(value, i * 2);
  }
  return buffer;
}

test('buildSherpaOnnxOptionsFromEnv maps env values', () => {
  const options = buildSherpaOnnxOptionsFromEnv({
    VOICE_ASR_SHERPA_MODEL: '/tmp/model.onnx',
    VOICE_ASR_SHERPA_TOKENS: '/tmp/tokens.txt',
    VOICE_ASR_SHERPA_ENCODER: '/tmp/encoder.onnx',
    VOICE_ASR_SHERPA_DECODER: '/tmp/decoder.onnx',
    VOICE_ASR_SHERPA_JOINER: '/tmp/joiner.onnx',
    VOICE_ASR_SHERPA_MODEL_KIND: 'zipformer2Ctc',
    VOICE_ASR_SHERPA_SAMPLE_RATE: '16000',
    VOICE_ASR_SHERPA_FEATURE_DIM: '80',
    VOICE_ASR_SHERPA_NUM_THREADS: '4',
    VOICE_ASR_SHERPA_EXECUTION_PROVIDER: 'coreml',
    VOICE_ASR_SHERPA_DEBUG: '1',
    VOICE_ASR_SHERPA_DECODE_CHUNK_MS: '120',
    VOICE_ASR_SHERPA_PREFER_ONLINE: '1',
    VOICE_ASR_SHERPA_MODE: 'online',
  });

  assert.equal(options.modelPath, '/tmp/model.onnx');
  assert.equal(options.tokensPath, '/tmp/tokens.txt');
  assert.equal(options.encoderPath, '/tmp/encoder.onnx');
  assert.equal(options.decoderPath, '/tmp/decoder.onnx');
  assert.equal(options.joinerPath, '/tmp/joiner.onnx');
  assert.equal(options.modelKind, 'zipformer2Ctc');
  assert.equal(options.sampleRate, '16000');
  assert.equal(options.featureDim, '80');
  assert.equal(options.numThreads, '4');
  assert.equal(options.executionProvider, 'coreml');
  assert.equal(options.debug, '1');
  assert.equal(options.decodeChunkMs, '120');
  assert.equal(options.preferOnline, '1');
  assert.equal(options.recognizerMode, 'online');
});

test('createAsrProvider uses env default mock provider', async () => {
  const provider = createAsrProvider({
    env: {
      VOICE_ASR_PROVIDER: 'mock',
    },
  });

  const result = await provider.transcribe({
    audioChunks: [
      {
        pcmChunk: Buffer.from([1, 2]),
      },
    ],
  });
  assert.equal(result.text, 'mock voice input');
});

test('prepareAudioSamples converts pcm_s16le to float32', () => {
  const chunk = Buffer.alloc(4);
  chunk.writeInt16LE(32767, 0);
  chunk.writeInt16LE(-32768, 2);

  const prepared = prepareAudioSamples([
    {
      sampleRate: 16000,
      sampleFormat: 'pcm_s16le',
      pcmChunk: chunk,
    },
  ]);

  assert.equal(prepared.sampleRate, 16000);
  assert.equal(prepared.samples.length, 2);
  assert.ok(prepared.samples[0] > 0.99);
  assert.ok(prepared.samples[1] <= -1);
});

test('createSherpaOnnxAsrProvider returns structured error when module missing', async () => {
  const provider = createSherpaOnnxAsrProvider({
    options: {
      modelPath: __filename,
      tokensPath: __filename,
    },
    requireFn: () => {
      throw new Error('missing');
    },
  });

  await assert.rejects(
    () =>
      provider.transcribe({
        audioChunks: [
          {
            sampleRate: 16000,
            sampleFormat: 'pcm_s16le',
            pcmChunk: Buffer.from([1, 2, 3, 4]),
          },
        ],
      }),
    (error) => {
      assert.equal(error.code, 'voice_asr_provider_not_installed');
      return true;
    },
  );
});

test('createDefaultRecognizerConfig validates required model paths', () => {
  assert.throws(() => createDefaultRecognizerConfig({ tokensPath: __filename }), (error) => {
    assert.equal(error.code, 'voice_asr_model_not_configured');
    return true;
  });
});

test('createDefaultRecognizerConfig chooses zipformerCtc for offline model by default', () => {
  const config = createDefaultRecognizerConfig({
    modelPath: __filename,
    tokensPath: __filename,
  });

  assert.ok(config.modelConfig.zipformerCtc);
});

test('createDefaultRecognizerConfig chooses zipformer2Ctc when online mode is preferred', () => {
  const config = createDefaultRecognizerConfig({
    modelPath: __filename,
    tokensPath: __filename,
    recognizerMode: 'online',
  });

  assert.ok(config.modelConfig.zipformer2Ctc);
});

test('sherpa provider emits incremental partials with dedup and final text', async () => {
  const transcripts = ['h', 'he', 'he', 'hello'];
  let decodeCount = 0;

  const provider = createSherpaOnnxAsrProvider({
    options: {
      decodeChunkMs: 20,
      recognizerConfig: {
        featConfig: {
          sampleRate: 16000,
          featureDim: 80,
        },
        modelConfig: {
          tokens: __filename,
          ctc: {
            model: __filename,
          },
        },
      },
      createRecognizerFn: () => ({
        createStream() {
          return {
            acceptWaveform() {},
            inputFinished() {},
          };
        },
        async decode() {
          decodeCount += 1;
        },
        getResult() {
          const index = Math.min(transcripts.length - 1, Math.max(0, decodeCount - 1));
          return {
            text: transcripts[index],
          };
        },
      }),
    },
  });

  const partials = [];
  const result = await provider.transcribe({
    audioChunks: [
      {
        sampleRate: 16000,
        sampleFormat: 'pcm_s16le',
        pcmChunk: createPcmBuffer(4000),
      },
    ],
    onPartial: (text) => {
      partials.push(text);
    },
  });

  assert.equal(result.text, 'hello');
  assert.deepEqual(partials, ['h', 'he', 'hello']);
});

test('sherpa provider can be aborted while decoding', async () => {
  const controller = new AbortController();
  let decodeCount = 0;

  const provider = createSherpaOnnxAsrProvider({
    options: {
      decodeChunkMs: 20,
      recognizerConfig: {
        featConfig: {
          sampleRate: 16000,
          featureDim: 80,
        },
        modelConfig: {
          tokens: __filename,
          ctc: {
            model: __filename,
          },
        },
      },
      createRecognizerFn: () => ({
        createStream() {
          return {
            acceptWaveform() {},
            inputFinished() {},
          };
        },
        async decode() {
          decodeCount += 1;
        },
        getResult() {
          return {
            text: decodeCount > 0 ? 'partial' : '',
          };
        },
      }),
    },
  });

  await assert.rejects(
    () =>
      provider.transcribe({
        audioChunks: [
          {
            sampleRate: 16000,
            sampleFormat: 'pcm_s16le',
            pcmChunk: createPcmBuffer(4000),
          },
        ],
        signal: controller.signal,
        onPartial: () => {
          controller.abort();
        },
      }),
    (error) => {
      assert.equal(error.name, 'AbortError');
      return true;
    },
  );
});

test('online recognizer mode resets stream after decode', async () => {
  let resetCalls = 0;

  const provider = createSherpaOnnxAsrProvider({
    options: {
      recognizerMode: 'online',
      decodeChunkMs: 20,
      recognizerConfig: {
        featConfig: {
          sampleRate: 16000,
          featureDim: 80,
        },
        modelConfig: {
          tokens: __filename,
          transducer: {
            encoder: __filename,
            decoder: __filename,
            joiner: __filename,
          },
        },
      },
      createRecognizerFn: () => ({
        createStream() {
          return {
            acceptWaveform() {},
            inputFinished() {},
          };
        },
        isReady() {
          return false;
        },
        decode() {},
        getResult() {
          return {
            text: 'ok',
          };
        },
        reset() {
          resetCalls += 1;
        },
      }),
    },
  });

  const result = await provider.transcribe({
    audioChunks: [
      {
        sampleRate: 16000,
        sampleFormat: 'pcm_s16le',
        pcmChunk: createPcmBuffer(320),
      },
    ],
  });

  assert.equal(result.text, 'ok');
  assert.equal(resetCalls, 1);
});
