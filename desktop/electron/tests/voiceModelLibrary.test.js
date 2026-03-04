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
  assert.equal(runtimeEnv.VOICE_TTS_AUTO_ON_ASR_FINAL, '1');
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
