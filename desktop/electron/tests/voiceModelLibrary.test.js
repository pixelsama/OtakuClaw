const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { VoiceModelLibrary } = require('../services/voice/voiceModelLibrary');

async function createLibraryForTest() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-model-library-test-'));
  const app = {
    getPath() {
      return tmpDir;
    },
  };

  const downloadFileImpl = async ({ url, destinationPath, onProgress }) => {
    const payload = Buffer.from(`download:${url}`, 'utf-8');
    onProgress?.({
      downloadedBytes: Math.floor(payload.length / 2),
      totalBytes: payload.length,
    });
    onProgress?.({
      downloadedBytes: payload.length,
      totalBytes: payload.length,
    });
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, payload);
  };

  const library = new VoiceModelLibrary(app, { downloadFileImpl });
  await library.init();

  return {
    library,
    tmpDir,
  };
}

test('downloadBundle persists bundle and resolves runtime env', async () => {
  const { library } = await createLibraryForTest();

  const progressEvents = [];
  const result = await library.downloadBundle(
    {
      bundleName: 'test-voice',
      asr: {
        modelUrl: 'https://example.com/asr/model.onnx',
        tokensUrl: 'https://example.com/asr/tokens.txt',
        modelKind: 'zipformerctc',
        executionProvider: 'coreml',
      },
      tts: {
        modelUrl: 'https://example.com/tts/model.onnx',
        voicesUrl: 'https://example.com/tts/voices.bin',
        tokensUrl: 'https://example.com/tts/tokens.txt',
        modelKind: 'kokoro',
        executionProvider: 'cpu',
      },
    },
    {
      onProgress: (event) => {
        progressEvents.push(event);
      },
    },
  );

  assert.ok(result.bundle.id);
  assert.equal(result.selectedBundleId, result.bundle.id);
  assert.equal(result.bundles.length, 1);
  assert.ok(progressEvents.length > 0);
  assert.equal(progressEvents.at(-1).phase, 'completed');

  const runtimeEnv = library.getRuntimeEnv({});
  assert.equal(runtimeEnv.VOICE_ASR_PROVIDER, 'sherpa-onnx');
  assert.equal(runtimeEnv.VOICE_TTS_PROVIDER, 'sherpa-onnx');
  assert.equal(runtimeEnv.VOICE_TTS_AUTO_ON_ASR_FINAL, undefined);
  assert.ok(await fs.stat(runtimeEnv.VOICE_ASR_SHERPA_MODEL));
  assert.ok(await fs.stat(runtimeEnv.VOICE_TTS_SHERPA_MODEL));
});

test('selectBundle supports clearing selection', async () => {
  const { library } = await createLibraryForTest();
  const downloaded = await library.downloadBundle({
    bundleName: 'asr-only',
    asr: {
      modelUrl: 'https://example.com/asr/model.onnx',
      tokensUrl: 'https://example.com/asr/tokens.txt',
    },
  });

  assert.equal(library.listBundles().selectedBundleId, downloaded.bundle.id);
  await library.selectBundle('');
  assert.equal(library.listBundles().selectedBundleId, '');
});

test('downloadBundle validates required URL groups', async () => {
  const { library } = await createLibraryForTest();

  await assert.rejects(
    () =>
      library.downloadBundle({
        bundleName: 'invalid',
        asr: {
          modelUrl: 'https://example.com/asr/model.onnx',
          tokensUrl: '',
        },
      }),
    (error) => {
      assert.equal(error.code, 'voice_model_download_invalid_input');
      return true;
    },
  );
});

test('listCatalog returns built-in model items', async () => {
  const { library } = await createLibraryForTest();

  const catalog = library.listCatalog();
  assert.ok(Array.isArray(catalog));
  assert.ok(catalog.length >= 1);
  assert.ok(catalog.some((item) => item.id === 'builtin-zh-int8-zipformer-kokoro-v1'));
  assert.ok(catalog.some((item) => item.id === 'builtin-python-funasr-qwen3tts-v1'));
});

test('getRuntimeEnv infers kokoro data dir and lexicon for legacy bundles', async () => {
  const { library, tmpDir } = await createLibraryForTest();

  const modelDir = path.join(tmpDir, 'kokoro');
  await fs.mkdir(path.join(modelDir, 'espeak-ng-data'), { recursive: true });
  await fs.writeFile(path.join(modelDir, 'model.onnx'), '');
  await fs.writeFile(path.join(modelDir, 'voices.bin'), '');
  await fs.writeFile(path.join(modelDir, 'tokens.txt'), '');
  await fs.writeFile(path.join(modelDir, 'lexicon-zh.txt'), '');

  library.state = {
    selectedBundleId: 'legacy-kokoro',
    bundles: [
      {
        id: 'legacy-kokoro',
        name: 'legacy',
        asr: null,
        tts: {
          modelPath: path.join(modelDir, 'model.onnx'),
          voicesPath: path.join(modelDir, 'voices.bin'),
          tokensPath: path.join(modelDir, 'tokens.txt'),
          modelKind: 'kokoro',
          executionProvider: 'coreml',
        },
      },
    ],
  };

  const runtimeEnv = library.getRuntimeEnv({});
  assert.equal(runtimeEnv.VOICE_TTS_PROVIDER, 'sherpa-onnx');
  assert.equal(runtimeEnv.VOICE_TTS_SHERPA_EXECUTION_PROVIDER, 'cpu');
  assert.equal(runtimeEnv.VOICE_TTS_SHERPA_DATA_DIR, path.join(modelDir, 'espeak-ng-data'));
  assert.equal(runtimeEnv.VOICE_TTS_SHERPA_LEXICON, path.join(modelDir, 'lexicon-zh.txt'));
  assert.equal(runtimeEnv.VOICE_TTS_SHERPA_LANG, 'zh');
  assert.equal(runtimeEnv.VOICE_TTS_SHERPA_SID, '46');
  assert.equal(runtimeEnv.VOICE_TTS_SHERPA_ENABLE_EXTERNAL_BUFFER, '0');
});

test('downloadBundle preserves optional tts sid/speed into runtime env', async () => {
  const { library } = await createLibraryForTest();

  await library.downloadBundle({
    bundleName: 'tts-sid-speed',
    tts: {
      modelUrl: 'https://example.com/tts/model.onnx',
      voicesUrl: 'https://example.com/tts/voices.bin',
      tokensUrl: 'https://example.com/tts/tokens.txt',
      modelKind: 'kokoro',
      executionProvider: 'cpu',
      sid: '47',
      speed: '0.95',
    },
  });

  const runtimeEnv = library.getRuntimeEnv({});
  assert.equal(runtimeEnv.VOICE_TTS_SHERPA_SID, '47');
  assert.equal(runtimeEnv.VOICE_TTS_SHERPA_SPEED, '0.95');
});

test('installCatalogBundle rejects unknown catalog id', async () => {
  const { library } = await createLibraryForTest();

  await assert.rejects(
    () => library.installCatalogBundle({ catalogId: 'missing-catalog' }),
    (error) => {
      assert.equal(error.code, 'voice_model_catalog_not_found');
      return true;
    },
  );
});

test('getRuntimeEnv maps python runtime bundle into python provider env', async () => {
  const { library, tmpDir } = await createLibraryForTest();

  const pythonExecutablePath = path.join(tmpDir, 'runtime', 'python3');
  const bridgeScriptPath = path.join(tmpDir, 'runtime', 'voice_bridge.py');
  const asrModelDir = path.join(tmpDir, 'models', 'asr');
  const ttsModelDir = path.join(tmpDir, 'models', 'tts');
  const ttsTokenizerDir = path.join(tmpDir, 'models', 'tts-tokenizer');
  await fs.mkdir(path.dirname(pythonExecutablePath), { recursive: true });
  await fs.mkdir(asrModelDir, { recursive: true });
  await fs.mkdir(ttsModelDir, { recursive: true });
  await fs.mkdir(ttsTokenizerDir, { recursive: true });
  await fs.writeFile(pythonExecutablePath, '');
  await fs.writeFile(bridgeScriptPath, '');

  library.state = {
    selectedBundleId: 'python-runtime',
    bundles: [
      {
        id: 'python-runtime',
        name: 'python',
        asr: null,
        tts: null,
        runtime: {
          kind: 'python',
          pythonExecutablePath,
          bridgeScriptPath,
          asrModelDir,
          ttsModelDir,
          ttsTokenizerDir,
          asrLanguage: '中文',
          ttsLanguage: 'Chinese',
          ttsMode: 'custom_voice',
          ttsSpeaker: 'Vivian',
          device: 'cpu',
        },
      },
    ],
  };

  const runtimeEnv = library.getRuntimeEnv({});
  assert.equal(runtimeEnv.VOICE_ASR_PROVIDER, 'python');
  assert.equal(runtimeEnv.VOICE_TTS_PROVIDER, 'python');
  assert.equal(runtimeEnv.VOICE_PYTHON_EXECUTABLE, pythonExecutablePath);
  assert.equal(runtimeEnv.VOICE_PYTHON_BRIDGE_SCRIPT, bridgeScriptPath);
  assert.equal(runtimeEnv.VOICE_ASR_PYTHON_MODEL_DIR, asrModelDir);
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_MODEL_DIR, ttsModelDir);
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_TOKENIZER_DIR, ttsTokenizerDir);
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_MODE, 'custom_voice');
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_SPEAKER, 'Vivian');
  assert.equal(runtimeEnv.VOICE_TTS_AUTO_ON_ASR_FINAL, undefined);
});
