const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { VoiceModelLibrary } = require('../services/voice/voiceModelLibrary');

async function createLibraryForTest({ pythonRuntimeManager = null, pythonEnvManager = null } = {}) {
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

  const library = new VoiceModelLibrary(app, {
    downloadFileImpl,
    pythonRuntimeManager,
    pythonEnvManager,
  });
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
  assert.equal(result.selectedAsrBundleId, result.bundle.id);
  assert.equal(result.selectedTtsBundleId, result.bundle.id);
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
    bundleName: 'asr-tts',
    asr: {
      modelUrl: 'https://example.com/asr/model.onnx',
      tokensUrl: 'https://example.com/asr/tokens.txt',
    },
    tts: {
      modelUrl: 'https://example.com/tts/model.onnx',
      voicesUrl: 'https://example.com/tts/voices.bin',
      tokensUrl: 'https://example.com/tts/tokens.txt',
    },
  });

  assert.equal(library.listBundles().selectedAsrBundleId, downloaded.bundle.id);
  assert.equal(library.listBundles().selectedTtsBundleId, downloaded.bundle.id);
  await library.selectBundles({ asrBundleId: '', ttsBundleId: '' });
  assert.equal(library.listBundles().selectedAsrBundleId, '');
  assert.equal(library.listBundles().selectedTtsBundleId, '');
});

test('removeBundle deletes bundle files and clears active selection', async () => {
  const { library } = await createLibraryForTest();
  const downloaded = await library.downloadBundle({
    bundleName: 'remove-me',
    asr: {
      modelUrl: 'https://example.com/asr/model.onnx',
      tokensUrl: 'https://example.com/asr/tokens.txt',
    },
    tts: {
      modelUrl: 'https://example.com/tts/model.onnx',
      voicesUrl: 'https://example.com/tts/voices.bin',
      tokensUrl: 'https://example.com/tts/tokens.txt',
    },
  });

  const bundleId = downloaded.bundle.id;
  const asrModelPath = downloaded.bundle.asr.modelPath;
  await fs.stat(asrModelPath);

  const result = await library.removeBundle({ bundleId });
  assert.equal(result.removedBundleId, bundleId);
  assert.equal(result.selectedAsrBundleId, '');
  assert.equal(result.selectedTtsBundleId, '');
  assert.equal(result.bundles.length, 0);

  await assert.rejects(() => fs.stat(asrModelPath), (error) => error?.code === 'ENOENT');
});

test('removeBundle validates bundle id and existing bundle', async () => {
  const { library } = await createLibraryForTest();

  await assert.rejects(
    () => library.removeBundle({ bundleId: '' }),
    (error) => {
      assert.equal(error.code, 'voice_model_delete_invalid_input');
      return true;
    },
  );

  await assert.rejects(
    () => library.removeBundle({ bundleId: 'missing-bundle' }),
    (error) => {
      assert.equal(error.code, 'voice_model_bundle_not_found');
      return true;
    },
  );
});

test('removeBundle recycles unreferenced python env', async () => {
  const removedEnvIds = [];
  const { library } = await createLibraryForTest({
    pythonRuntimeManager: {
      async init() {},
    },
    pythonEnvManager: {
      async init() {},
      getEnvById() {
        return null;
      },
      async removeEnv(envId) {
        removedEnvIds.push(envId);
        return true;
      },
    },
  });

  library.state = {
    selectedAsrBundleId: 'python-runtime-asr',
    selectedTtsBundleId: '',
    bundles: [
      {
        id: 'python-runtime-asr',
        name: 'python-runtime-asr',
        runtime: {
          kind: 'python',
          pythonEnvId: 'asr-qwen-env',
          asrModelDir: '/tmp/fake-asr-model',
        },
      },
    ],
  };

  const result = await library.removeBundle({ bundleId: 'python-runtime-asr' });

  assert.deepEqual(removedEnvIds, ['asr-qwen-env']);
  assert.deepEqual(result.recycledPythonEnvIds, ['asr-qwen-env']);
});

test('removeBundle keeps python env when still referenced by another bundle', async () => {
  const removedEnvIds = [];
  const { library } = await createLibraryForTest({
    pythonRuntimeManager: {
      async init() {},
    },
    pythonEnvManager: {
      async init() {},
      getEnvById() {
        return null;
      },
      async removeEnv(envId) {
        removedEnvIds.push(envId);
        return true;
      },
    },
  });

  library.state = {
    selectedAsrBundleId: 'python-runtime-asr',
    selectedTtsBundleId: 'python-runtime-tts',
    bundles: [
      {
        id: 'python-runtime-asr',
        name: 'python-runtime-asr',
        runtime: {
          kind: 'python',
          pythonEnvId: 'shared-qwen-env',
          asrModelDir: '/tmp/fake-asr-model',
        },
      },
      {
        id: 'python-runtime-tts',
        name: 'python-runtime-tts',
        runtime: {
          kind: 'python',
          pythonEnvId: 'shared-qwen-env',
          ttsEngine: 'qwen3-mlx',
          ttsModelDir: '/tmp/fake-tts-model',
        },
      },
    ],
  };

  const result = await library.removeBundle({ bundleId: 'python-runtime-asr' });

  assert.deepEqual(removedEnvIds, []);
  assert.deepEqual(result.recycledPythonEnvIds, []);
});

test('selectBundles allows ASR and TTS from different bundles', async () => {
  const { library } = await createLibraryForTest();
  const asrOnly = await library.downloadBundle({
    bundleName: 'asr-only',
    asr: {
      modelUrl: 'https://example.com/asr/model.onnx',
      tokensUrl: 'https://example.com/asr/tokens.txt',
    },
  });
  const ttsOnly = await library.downloadBundle({
    bundleName: 'tts-only',
    tts: {
      modelUrl: 'https://example.com/tts/model.onnx',
      voicesUrl: 'https://example.com/tts/voices.bin',
      tokensUrl: 'https://example.com/tts/tokens.txt',
    },
  });

  await library.selectBundles({
    asrBundleId: asrOnly.bundle.id,
    ttsBundleId: ttsOnly.bundle.id,
  });

  const listed = library.listBundles();
  assert.equal(listed.selectedAsrBundleId, asrOnly.bundle.id);
  assert.equal(listed.selectedTtsBundleId, ttsOnly.bundle.id);
});

test('selectBundles ignores undefined fields and preserves the other capability selection', async () => {
  const { library } = await createLibraryForTest();
  const asrOnly = await library.downloadBundle({
    bundleName: 'asr-only-preserve',
    asr: {
      modelUrl: 'https://example.com/asr/model.onnx',
      tokensUrl: 'https://example.com/asr/tokens.txt',
    },
  });
  const ttsOnly = await library.downloadBundle({
    bundleName: 'tts-only-preserve',
    tts: {
      modelUrl: 'https://example.com/tts/model.onnx',
      voicesUrl: 'https://example.com/tts/voices.bin',
      tokensUrl: 'https://example.com/tts/tokens.txt',
    },
  });

  await library.selectBundles({
    asrBundleId: asrOnly.bundle.id,
    ttsBundleId: ttsOnly.bundle.id,
  });
  await library.selectBundles({
    asrBundleId: asrOnly.bundle.id,
    ttsBundleId: undefined,
  });

  let listed = library.listBundles();
  assert.equal(listed.selectedAsrBundleId, asrOnly.bundle.id);
  assert.equal(listed.selectedTtsBundleId, ttsOnly.bundle.id);

  await library.selectBundles({
    asrBundleId: undefined,
    ttsBundleId: ttsOnly.bundle.id,
  });

  listed = library.listBundles();
  assert.equal(listed.selectedAsrBundleId, asrOnly.bundle.id);
  assert.equal(listed.selectedTtsBundleId, ttsOnly.bundle.id);
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
  assert.ok(catalog.length >= 4);
  assert.ok(catalog.some((item) => item.id === 'builtin-asr-zh-int8-zipformer-v1'));
  assert.ok(catalog.some((item) => item.id === 'builtin-asr-qwen3-0.6b-4bit-v1'));
  assert.ok(catalog.some((item) => item.id === 'builtin-tts-qwen3-0.6b-8bit-v1'));
  assert.ok(catalog.some((item) => item.id === 'builtin-tts-edge-v1'));
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
    selectedAsrBundleId: '',
    selectedTtsBundleId: 'legacy-kokoro',
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

test('installCatalogBundle stores python env id for built-in edge tts', async () => {
  const ensuredEnv = {
    envId: 'tts-edge-py312-abcd1234',
    envPythonExecutable: '/tmp/python-envs/tts-edge/bin/python3',
  };
  const { library } = await createLibraryForTest({
    pythonRuntimeManager: {
      init: async () => {},
    },
    pythonEnvManager: {
      init: async () => {},
      async ensureEnv() {
        return ensuredEnv;
      },
      getEnvById(envId) {
        return envId === ensuredEnv.envId ? ensuredEnv : null;
      },
    },
  });

  const result = await library.installCatalogBundle({
    catalogId: 'builtin-tts-edge-v1',
  });

  assert.equal(result.bundle.runtime.pythonEnvId, ensuredEnv.envId);
  assert.equal(result.bundle.runtime.pythonEnvProfile, 'tts-edge');
  assert.equal(result.bundle.runtime.pythonVersion, '3.12.12');
  assert.equal(library.getRuntimeEnv({}).VOICE_TTS_PYTHON_EXECUTABLE, ensuredEnv.envPythonExecutable);
});

test('installCatalogBundle does not treat nested ensureEnv completed as terminal completion', async () => {
  const ensuredEnv = {
    envId: 'tts-edge-py312-abcd1234',
    envPythonExecutable: '/tmp/python-envs/tts-edge/bin/python3',
  };
  const { library } = await createLibraryForTest({
    pythonRuntimeManager: {
      init: async () => {},
    },
    pythonEnvManager: {
      init: async () => {},
      async ensureEnv({ onProgress }) {
        onProgress?.({
          phase: 'running',
          currentFile: 'python-runtime.tar.gz',
          overallProgress: 0.5,
          fileDownloadedBytes: 100,
          fileTotalBytes: 200,
          downloadSpeedBytesPerSec: 50,
          estimatedRemainingSeconds: 2,
        });
        onProgress?.({
          phase: 'completed',
          currentFile: '',
          overallProgress: 1,
        });
        return ensuredEnv;
      },
      getEnvById(envId) {
        return envId === ensuredEnv.envId ? ensuredEnv : null;
      },
    },
  });

  const progressEvents = [];
  const result = await library.installCatalogBundle(
    {
      catalogId: 'builtin-tts-edge-v1',
      installAsr: false,
      installTts: true,
    },
    {
      onProgress: (event) => {
        progressEvents.push(event);
      },
    },
  );

  assert.ok(result.bundle?.id);
  assert.ok(progressEvents.length > 0);
  assert.equal(progressEvents.at(-1).phase, 'completed');
  const nestedCompletedEvent = progressEvents.find((event, index) => event.phase === 'completed' && index < progressEvents.length - 1);
  assert.equal(nestedCompletedEvent, undefined);
  const runtimeEvent = progressEvents.find((event) => event.currentFile === 'python-runtime.tar.gz');
  assert.ok(runtimeEvent);
  assert.equal(runtimeEvent.fileDownloadedBytes, 100);
  assert.equal(runtimeEvent.fileTotalBytes, 200);
  assert.equal(runtimeEvent.downloadSpeedBytesPerSec, 50);
  assert.equal(runtimeEvent.estimatedRemainingSeconds, 2);
});

test('installCatalogBundle emits structured error in failed progress event', async () => {
  const failure = new Error('ensure env failed');
  failure.code = 'python_env_failed';
  const { library } = await createLibraryForTest({
    pythonRuntimeManager: {
      init: async () => {},
    },
    pythonEnvManager: {
      init: async () => {},
      async ensureEnv() {
        throw failure;
      },
      getEnvById() {
        return null;
      },
    },
  });

  const progressEvents = [];
  await assert.rejects(
    () => library.installCatalogBundle(
      {
        catalogId: 'builtin-tts-edge-v1',
        installAsr: false,
        installTts: true,
      },
      {
        onProgress: (event) => {
          progressEvents.push(event);
        },
      },
    ),
    (error) => error?.code === 'python_env_failed',
  );

  assert.ok(progressEvents.length > 0);
  const failedEvent = progressEvents.at(-1);
  assert.equal(failedEvent.phase, 'failed');
  assert.equal(failedEvent.error?.code, 'python_env_failed');
  assert.equal(failedEvent.error?.message, 'ensure env failed');
});

test('getRuntimeEnv falls back to legacy python executable path', async () => {
  const { library, tmpDir } = await createLibraryForTest({
    pythonRuntimeManager: {
      init: async () => {},
    },
    pythonEnvManager: {
      init: async () => {},
      getEnvById() {
        return null;
      },
    },
  });

  const pythonExecutablePath = path.join(tmpDir, 'runtime', 'python', 'bin', 'python3');
  const bridgeScriptPath = path.join(tmpDir, 'runtime', 'voice_bridge.py');
  const ttsModelDir = path.join(tmpDir, 'models', 'tts');
  await fs.mkdir(path.dirname(pythonExecutablePath), { recursive: true });
  await fs.mkdir(ttsModelDir, { recursive: true });
  await fs.writeFile(pythonExecutablePath, '');
  await fs.writeFile(bridgeScriptPath, '');

  library.state = {
    selectedAsrBundleId: '',
    selectedTtsBundleId: 'legacy-python-runtime',
    bundles: [
      {
        id: 'legacy-python-runtime',
        name: 'legacy-python-runtime',
        runtime: {
          kind: 'python',
          pythonExecutablePath,
          bridgeScriptPath,
          ttsEngine: 'qwen3-mlx',
          ttsModelDir,
        },
      },
    ],
  };

  const runtimeEnv = library.getRuntimeEnv({});
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_EXECUTABLE, pythonExecutablePath);
  assert.equal(runtimeEnv.VOICE_TTS_PROVIDER, 'python');
});

test('getRuntimeEnv maps python runtime bundle into python provider env', async () => {
  const envRecord = {
    envId: 'tts-qwen3-mlx-py312-test',
    envPythonExecutable: '/tmp/shared/python-env/bin/python3',
  };
  const { library, tmpDir } = await createLibraryForTest({
    pythonRuntimeManager: {
      init: async () => {},
    },
    pythonEnvManager: {
      init: async () => {},
      getEnvById(envId) {
        return envId === envRecord.envId ? envRecord : null;
      },
    },
  });

  const bridgeScriptPath = path.join(tmpDir, 'runtime', 'voice_bridge.py');
  const asrModelDir = path.join(tmpDir, 'models', 'asr');
  const ttsModelDir = path.join(tmpDir, 'models', 'tts');
  const ttsTokenizerDir = path.join(tmpDir, 'models', 'tts-tokenizer');
  await fs.mkdir(path.dirname(bridgeScriptPath), { recursive: true });
  await fs.mkdir(asrModelDir, { recursive: true });
  await fs.mkdir(ttsModelDir, { recursive: true });
  await fs.mkdir(ttsTokenizerDir, { recursive: true });
  await fs.writeFile(bridgeScriptPath, '');

  library.state = {
    selectedAsrBundleId: 'python-runtime',
    selectedTtsBundleId: 'python-runtime',
    bundles: [
      {
        id: 'python-runtime',
        name: 'python',
        asr: null,
        tts: null,
        runtime: {
          kind: 'python',
          pythonEnvId: envRecord.envId,
          bridgeScriptPath,
          asrModelDir,
          ttsModelDir,
          ttsTokenizerDir,
          asrLanguage: '中文',
          ttsLanguage: 'Chinese',
          ttsEngine: 'qwen3-mlx',
          ttsMode: 'custom_voice',
          ttsSpeaker: 'vivian',
          device: 'cpu',
        },
      },
    ],
  };

  const runtimeEnv = library.getRuntimeEnv({});
  assert.equal(runtimeEnv.VOICE_ASR_PROVIDER, 'python');
  assert.equal(runtimeEnv.VOICE_TTS_PROVIDER, 'python');
  assert.equal(runtimeEnv.VOICE_ASR_PYTHON_EXECUTABLE, envRecord.envPythonExecutable);
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_EXECUTABLE, envRecord.envPythonExecutable);
  assert.equal(runtimeEnv.VOICE_ASR_PYTHON_BRIDGE_SCRIPT, bridgeScriptPath);
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_BRIDGE_SCRIPT, bridgeScriptPath);
  assert.equal(runtimeEnv.VOICE_ASR_PYTHON_MODEL_DIR, asrModelDir);
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_ENGINE, 'qwen3-mlx');
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_MODEL_DIR, ttsModelDir);
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_TOKENIZER_DIR, ttsTokenizerDir);
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_MODE, 'custom_voice');
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_SPEAKER, 'vivian');
  assert.equal(runtimeEnv.VOICE_TTS_AUTO_ON_ASR_FINAL, undefined);
});

test('getRuntimeEnv supports edge tts python runtime without local model dir', async () => {
  const envRecord = {
    envId: 'tts-edge-py312-test',
    envPythonExecutable: '/tmp/shared/edge-env/bin/python3',
  };
  const { library, tmpDir } = await createLibraryForTest({
    pythonRuntimeManager: {
      init: async () => {},
    },
    pythonEnvManager: {
      init: async () => {},
      getEnvById(envId) {
        return envId === envRecord.envId ? envRecord : null;
      },
    },
  });

  const bridgeScriptPath = path.join(tmpDir, 'runtime', 'voice_bridge.py');
  await fs.mkdir(path.dirname(bridgeScriptPath), { recursive: true });
  await fs.writeFile(bridgeScriptPath, '');

  library.state = {
    selectedAsrBundleId: '',
    selectedTtsBundleId: 'edge-runtime',
    bundles: [
      {
        id: 'edge-runtime',
        name: 'edge',
        asr: null,
        tts: null,
        runtime: {
          kind: 'python',
          pythonEnvId: envRecord.envId,
          bridgeScriptPath,
          ttsEngine: 'edge',
          ttsLanguage: 'Chinese',
          ttsVoice: 'zh-CN-XiaoxiaoNeural',
          ttsRate: '+0%',
          ttsPitch: '+0Hz',
          ttsVolume: '+0%',
          device: 'auto',
        },
      },
    ],
  };

  const runtimeEnv = library.getRuntimeEnv({});
  assert.equal(runtimeEnv.VOICE_TTS_PROVIDER, 'python');
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_ENGINE, 'edge');
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_EDGE_VOICE, 'zh-CN-XiaoxiaoNeural');
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_EDGE_RATE, '+0%');
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_EDGE_PITCH, '+0Hz');
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_EDGE_VOLUME, '+0%');
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_EXECUTABLE, envRecord.envPythonExecutable);
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_BRIDGE_SCRIPT, bridgeScriptPath);
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_MODEL_DIR, undefined);
});

test('getRuntimeEnv keeps separate python executables for asr and tts bundles', async () => {
  const asrEnvRecord = {
    envId: 'asr-qwen3-mlx-py312-separate',
    envPythonExecutable: '/tmp/shared/asr-env/bin/python3',
  };
  const ttsEnvRecord = {
    envId: 'tts-edge-py312-separate',
    envPythonExecutable: '/tmp/shared/tts-env/bin/python3',
  };
  const { library, tmpDir } = await createLibraryForTest({
    pythonRuntimeManager: {
      init: async () => {},
    },
    pythonEnvManager: {
      init: async () => {},
      getEnvById(envId) {
        if (envId === asrEnvRecord.envId) {
          return asrEnvRecord;
        }
        if (envId === ttsEnvRecord.envId) {
          return ttsEnvRecord;
        }
        return null;
      },
    },
  });

  const asrBridgeScriptPath = path.join(tmpDir, 'runtime', 'asr_voice_bridge.py');
  const ttsBridgeScriptPath = path.join(tmpDir, 'runtime', 'tts_voice_bridge.py');
  const asrModelDir = path.join(tmpDir, 'models', 'asr');
  await fs.mkdir(path.dirname(asrBridgeScriptPath), { recursive: true });
  await fs.mkdir(asrModelDir, { recursive: true });
  await fs.writeFile(asrBridgeScriptPath, '');
  await fs.writeFile(ttsBridgeScriptPath, '');

  library.state = {
    selectedAsrBundleId: 'python-asr-runtime',
    selectedTtsBundleId: 'python-tts-runtime',
    bundles: [
      {
        id: 'python-asr-runtime',
        name: 'python asr',
        asr: null,
        tts: null,
        runtime: {
          kind: 'python',
          pythonEnvId: asrEnvRecord.envId,
          bridgeScriptPath: asrBridgeScriptPath,
          asrModelDir,
          asrLanguage: 'Chinese',
          device: 'cpu',
        },
      },
      {
        id: 'python-tts-runtime',
        name: 'python tts',
        asr: null,
        tts: null,
        runtime: {
          kind: 'python',
          pythonEnvId: ttsEnvRecord.envId,
          bridgeScriptPath: ttsBridgeScriptPath,
          ttsEngine: 'edge',
          ttsLanguage: 'Chinese',
          ttsVoice: 'zh-CN-XiaoxiaoNeural',
          device: 'auto',
        },
      },
    ],
  };

  const runtimeEnv = library.getRuntimeEnv({});
  assert.equal(runtimeEnv.VOICE_ASR_PROVIDER, 'python');
  assert.equal(runtimeEnv.VOICE_TTS_PROVIDER, 'python');
  assert.equal(runtimeEnv.VOICE_ASR_PYTHON_EXECUTABLE, asrEnvRecord.envPythonExecutable);
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_EXECUTABLE, ttsEnvRecord.envPythonExecutable);
  assert.equal(runtimeEnv.VOICE_ASR_PYTHON_BRIDGE_SCRIPT, asrBridgeScriptPath);
  assert.equal(runtimeEnv.VOICE_TTS_PYTHON_BRIDGE_SCRIPT, ttsBridgeScriptPath);
});

test('init migrates legacy sherpa+kohoro combined bundle and drops deprecated built-in tts', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-model-library-migrate-test-'));
  const app = {
    getPath() {
      return tmpDir;
    },
  };
  const stateDir = path.join(tmpDir, 'voice-models');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(stateDir, 'state.json'),
    JSON.stringify({
      bundles: [
        {
          id: 'legacy-combo',
          name: '中文 ASR + Kokoro TTS（内置推荐）',
          catalogId: '',
          createdAt: '2026-03-04T05:17:52.529Z',
          asr: {
            modelPath: '/tmp/legacy/asr/sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30/model.int8.onnx',
            tokensPath: '/tmp/legacy/asr/sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30/tokens.txt',
            modelKind: 'zipformer2ctc',
            executionProvider: 'coreml',
          },
          tts: {
            modelPath: '/tmp/legacy/tts/kokoro-multi-lang-v1_0/model.onnx',
            voicesPath: '/tmp/legacy/tts/kokoro-multi-lang-v1_0/voices.bin',
            tokensPath: '/tmp/legacy/tts/kokoro-multi-lang-v1_0/tokens.txt',
            modelKind: 'kokoro',
            executionProvider: 'coreml',
          },
          runtime: null,
        },
      ],
      selectedAsrBundleId: '',
      selectedTtsBundleId: '',
    }),
    'utf-8',
  );

  const library = new VoiceModelLibrary(app, {
    downloadFileImpl: async () => {},
  });
  await library.init();

  const listed = library.listBundles();
  assert.equal(listed.bundles.length, 1);
  assert.ok(listed.bundles.some((bundle) => bundle.catalogId === 'builtin-asr-zh-int8-zipformer-v1'));
  assert.ok(!listed.bundles.some((bundle) => bundle.catalogId === 'builtin-tts-kokoro-v1'));
  assert.ok(!listed.bundles.some((bundle) => bundle.id === 'legacy-combo'));

  const persisted = JSON.parse(await fs.readFile(path.join(stateDir, 'state.json'), 'utf-8'));
  assert.equal(persisted.bundles.length, 1);
  assert.ok(persisted.bundles.some((bundle) => bundle.catalogId === 'builtin-asr-zh-int8-zipformer-v1'));
  assert.ok(!persisted.bundles.some((bundle) => bundle.catalogId === 'builtin-tts-kokoro-v1'));
});
