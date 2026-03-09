const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  createTtsProvider,
  buildDashScopeTtsOptionsFromEnv,
  buildSherpaOnnxTtsOptionsFromEnv,
  buildPythonTtsOptionsFromEnv,
} = require('../services/voice/providerFactory');
const { createPythonTtsProvider } = require('../services/voice/providers/tts/pythonProvider');
const { createDashScopeTtsProvider } = require('../services/voice/providers/tts/dashscopeProvider');
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
    VOICE_TTS_SHERPA_TEXT_SEGMENT_MAX_CHARS: '180',
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
  assert.equal(options.textSegmentMaxChars, '180');
  assert.equal(options.enableExternalBuffer, '0');
});

test('buildPythonTtsOptionsFromEnv maps env values', () => {
  const options = buildPythonTtsOptionsFromEnv({
    VOICE_TTS_PYTHON_EXECUTABLE: '/tmp/python',
    VOICE_TTS_PYTHON_BRIDGE_SCRIPT: '/tmp/bridge.py',
    VOICE_TTS_PYTHON_WORKER_SCRIPT: '/tmp/tts_worker.py',
    VOICE_TTS_PYTHON_ENGINE: 'qwen3-mlx',
    VOICE_TTS_PYTHON_MODEL_DIR: '/tmp/tts',
    VOICE_TTS_PYTHON_TOKENIZER_DIR: '/tmp/tokenizer',
    VOICE_TTS_PYTHON_MODE: 'custom_voice',
    VOICE_TTS_PYTHON_SPEAKER: 'vivian',
    VOICE_TTS_PYTHON_LANGUAGE: 'Chinese',
    VOICE_TTS_PYTHON_EDGE_VOICE: 'zh-CN-XiaoxiaoNeural',
    VOICE_TTS_PYTHON_EDGE_RATE: '+0%',
    VOICE_TTS_PYTHON_EDGE_PITCH: '+0Hz',
    VOICE_TTS_PYTHON_EDGE_VOLUME: '+0%',
    VOICE_TTS_PYTHON_DEVICE: 'cpu',
    VOICE_TTS_PYTHON_STREAM: '1',
    VOICE_TTS_PYTHON_STREAMING_INTERVAL: '0.4',
    VOICE_TTS_PYTHON_TEMPERATURE: '0.9',
    VOICE_TTS_PYTHON_DISABLE_RESIDENT_WORKER: '0',
    VOICE_TTS_PYTHON_CHUNK_MS: '80',
    VOICE_TTS_PYTHON_TIMEOUT_MS: '120000',
  });

  assert.equal(options.pythonExecutable, '/tmp/python');
  assert.equal(options.bridgeScriptPath, '/tmp/bridge.py');
  assert.equal(options.workerScriptPath, '/tmp/tts_worker.py');
  assert.equal(options.engine, 'qwen3-mlx');
  assert.equal(options.modelDir, '/tmp/tts');
  assert.equal(options.tokenizerDir, '/tmp/tokenizer');
  assert.equal(options.ttsMode, 'custom_voice');
  assert.equal(options.speaker, 'vivian');
  assert.equal(options.language, 'Chinese');
  assert.equal(options.edgeVoice, 'zh-CN-XiaoxiaoNeural');
  assert.equal(options.edgeRate, '+0%');
  assert.equal(options.edgePitch, '+0Hz');
  assert.equal(options.edgeVolume, '+0%');
  assert.equal(options.device, 'cpu');
  assert.equal(options.stream, '1');
  assert.equal(options.streamingInterval, '0.4');
  assert.equal(options.temperature, '0.9');
  assert.equal(options.disableResidentWorker, '0');
  assert.equal(options.chunkMs, '80');
  assert.equal(options.timeoutMs, '120000');
});

test('buildDashScopeTtsOptionsFromEnv maps env values', () => {
  const options = buildDashScopeTtsOptionsFromEnv({
    VOICE_DASHSCOPE_API_KEY: 'dashscope-key',
    VOICE_DASHSCOPE_WORKSPACE: 'workspace-01',
    VOICE_DASHSCOPE_BASE_URL: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
    VOICE_TTS_DASHSCOPE_MODEL: 'qwen-tts-realtime-latest',
    VOICE_TTS_DASHSCOPE_VOICE: 'Cherry',
    VOICE_TTS_DASHSCOPE_LANGUAGE: 'Chinese',
    VOICE_TTS_DASHSCOPE_RESPONSE_FORMAT: 'pcm',
    VOICE_TTS_DASHSCOPE_SAMPLE_RATE: '24000',
    VOICE_TTS_DASHSCOPE_SPEECH_RATE: '1.1',
    VOICE_TTS_DASHSCOPE_INSTRUCTIONS: 'Warm and calm',
    VOICE_TTS_DASHSCOPE_OPTIMIZE_INSTRUCTIONS: '1',
    VOICE_DASHSCOPE_TIMEOUT_MS: '80000',
  });

  assert.equal(options.apiKey, 'dashscope-key');
  assert.equal(options.workspace, 'workspace-01');
  assert.equal(options.baseUrl, 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime');
  assert.equal(options.model, 'qwen-tts-realtime-latest');
  assert.equal(options.voice, 'Cherry');
  assert.equal(options.language, 'Chinese');
  assert.equal(options.responseFormat, 'pcm');
  assert.equal(options.sampleRate, '24000');
  assert.equal(options.speechRate, '1.1');
  assert.equal(options.instructions, 'Warm and calm');
  assert.equal(options.optimizeInstructions, '1');
  assert.equal(options.timeoutMs, '80000');
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

test('createTtsProvider accepts python provider selection', () => {
  const provider = createTtsProvider({
    env: {
      VOICE_TTS_PROVIDER: 'python',
    },
  });

  assert.equal(typeof provider.synthesize, 'function');
});

test('createTtsProvider accepts dashscope provider selection', () => {
  const provider = createTtsProvider({
    env: {
      VOICE_TTS_PROVIDER: 'dashscope',
    },
  });

  assert.equal(typeof provider.synthesize, 'function');
});

test('python tts provider streams qwen3 mlx chunks through resident worker', async () => {
  const commands = [];
  let spawnCount = 0;

  const createFakeChild = () => {
    const listeners = new Map();
    const stdoutListeners = [];
    const stderrListeners = [];
    const child = {
      stdout: {
        on(event, handler) {
          if (event === 'data') {
            stdoutListeners.push(handler);
          }
        },
      },
      stderr: {
        on(event, handler) {
          if (event === 'data') {
            stderrListeners.push(handler);
          }
        },
      },
      stdin: {
        destroyed: false,
        write(chunk, _encoding, callback) {
          const payload = JSON.parse(String(chunk).trim());
          commands.push(payload);

          if (payload.type === 'synthesize') {
            const sampleRate = 24000;
            const chunkA = Buffer.from([0, 1, 2, 3]);
            const chunkB = Buffer.from([4, 5, 6, 7]);
            setImmediate(() => {
              for (const handler of stdoutListeners) {
                handler(
                  Buffer.from(
                    `__TTS_JSON__${JSON.stringify({
                      type: 'chunk',
                      requestId: payload.requestId,
                      sampleRate,
                      pcmS16LeBase64: chunkA.toString('base64'),
                    })}\n`,
                    'utf-8',
                  ),
                );
              }
              for (const handler of stdoutListeners) {
                handler(
                  Buffer.from(
                    `__TTS_JSON__${JSON.stringify({
                      type: 'chunk',
                      requestId: payload.requestId,
                      sampleRate,
                      pcmS16LeBase64: chunkB.toString('base64'),
                    })}\n`,
                    'utf-8',
                  ),
                );
              }
              for (const handler of stdoutListeners) {
                handler(
                  Buffer.from(
                    `__TTS_JSON__${JSON.stringify({
                      type: 'result',
                      requestId: payload.requestId,
                      sampleRate,
                      sampleCount: 4,
                    })}\n`,
                    'utf-8',
                  ),
                );
              }
            });
          }

          if (payload.type === 'shutdown') {
            setImmediate(() => {
              const exitHandlers = listeners.get('exit') || [];
              for (const handler of exitHandlers) {
                handler(0, null);
              }
            });
          }

          callback?.();
          return true;
        },
      },
      killed: false,
      on(event, handler) {
        const handlers = listeners.get(event) || [];
        handlers.push(handler);
        listeners.set(event, handlers);
      },
      kill() {
        child.killed = true;
      },
    };

    setImmediate(() => {
      for (const handler of stdoutListeners) {
        handler(
          Buffer.from(
            `__TTS_JSON__${JSON.stringify({
              type: 'ready',
              deviceUsed: 'mlx',
            })}\n`,
            'utf-8',
          ),
        );
      }
    });

    return child;
  };

  const provider = createPythonTtsProvider({
    options: {
      pythonExecutable: '/tmp/python',
      bridgeScriptPath: '/tmp/bridge.py',
      workerScriptPath: '/tmp/tts_worker.py',
      modelDir: '/tmp/model',
      engine: 'qwen3-mlx',
      speaker: 'vivian',
      language: 'Chinese',
      stream: '1',
      streamingInterval: '0.4',
      temperature: '0.9',
    },
    existsSync: () => true,
    spawnFn: () => {
      spawnCount += 1;
      return createFakeChild();
    },
  });

  const chunks = [];
  const result = await provider.synthesize({
    text: 'hello',
    onChunk: async (chunk) => {
      chunks.push(chunk);
    },
  });

  assert.equal(spawnCount, 1);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].codec, 'pcm_s16le');
  assert.equal(chunks[0].sampleRate, 24000);
  assert.deepEqual([...chunks[0].audioChunk], [0, 1, 2, 3]);
  assert.deepEqual([...chunks[1].audioChunk], [4, 5, 6, 7]);
  assert.equal(result.sampleRate, 24000);
  assert.equal(result.sampleCount, 4);

  await provider.synthesize({
    text: 'hello again',
    onChunk: async () => {},
  });
  assert.equal(spawnCount, 1);

  await provider.dispose();
  assert.ok(commands.some((item) => item.type === 'shutdown'));
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

test('sherpa tts provider splits long text into bounded segments', async () => {
  const textCalls = [];
  const provider = createSherpaOnnxTtsProvider({
    options: {
      chunkMs: 20,
      textSegmentMaxChars: 40,
      ttsConfig: {},
      createTtsFn: () => ({
        generate(request) {
          textCalls.push(request.text);
          return {
            sampleRate: 16000,
            samples: new Float32Array(160).fill(0.1),
          };
        },
      }),
    },
  });

  const result = await provider.synthesize({
    text:
      '这是第一句这是第一句这是第一句这是第一句这是第一句。'
      + '这是第二句这是第二句这是第二句这是第二句这是第二句。'
      + '这是第三句这是第三句这是第三句这是第三句这是第三句。',
    onChunk: () => {},
  });

  assert.ok(textCalls.length >= 2);
  assert.ok(textCalls.every((part) => typeof part === 'string' && part.length <= 40));
  assert.equal(result.sampleCount, textCalls.length * 160);
});

test('dashscope tts provider streams pcm chunks', async () => {
  class FakeWebSocket extends EventEmitter {
    constructor(url, options = {}) {
      super();
      this.url = url;
      this.options = options;
      this.sent = [];

      setImmediate(() => {
        this.emit('open');
      });
    }

    send(payload) {
      this.sent.push(JSON.parse(payload));
      const last = this.sent[this.sent.length - 1];
      if (last.type === 'session.update') {
        setImmediate(() => {
          this.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })), false);
        });
      }
      if (last.type === 'session.finish') {
        setImmediate(() => {
          this.emit(
            'message',
            Buffer.from(JSON.stringify({
              type: 'response.audio.delta',
              delta: Buffer.from([1, 2, 3, 4]).toString('base64'),
            })),
            false,
          );
          this.emit('message', Buffer.from(JSON.stringify({ type: 'session.finished' })), false);
          this.emit('close');
        });
      }
    }

    close() {}
    terminate() {}
  }

  const provider = createDashScopeTtsProvider({
    options: {
      apiKey: 'dashscope-key',
      model: 'qwen-tts-realtime-latest',
      voice: 'Cherry',
      sampleRate: 24000,
    },
    WebSocketImpl: FakeWebSocket,
  });

  const chunks = [];
  const result = await provider.synthesize({
    text: '你好',
    onChunk: async (chunk) => {
      chunks.push(chunk);
    },
  });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].codec, 'pcm_s16le');
  assert.equal(chunks[0].sampleRate, 24000);
  assert.equal(Buffer.from(chunks[0].audioChunk).length, 4);
  assert.equal(result.sampleRate, 24000);
  assert.equal(result.sampleCount, 2);
});
