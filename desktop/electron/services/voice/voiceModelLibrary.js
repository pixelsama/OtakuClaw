const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { execFile, spawn } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');

const { PythonRuntimeManager } = require('../python/pythonRuntimeManager');
const { PythonEnvManager } = require('../python/pythonEnvManager');
const { getDefaultPythonVersion } = require('../python/pythonRuntimeCatalog');
const { getBuiltInVoiceModelCatalog } = require('./voiceModelCatalog');

const ROOT_DIR_NAME = 'voice-models';
const BUNDLES_DIR_NAME = 'bundles';
const STATE_FILE_NAME = 'state.json';
const MAX_REDIRECTS = 5;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const PYTHON_BRIDGE_SCRIPT_NAME = 'voice_bridge.py';
const PYTHON_BOOTSTRAP_SCRIPT_NAME = 'bootstrap_runtime.py';
const PYTHON_RUNTIME_SCRIPTS_DIR_NAME = 'python-scripts';
const PYTHON_STEP_TIMEOUT_MS = 20 * 60 * 1000;
const PYTHON_MODEL_DOWNLOAD_TIMEOUT_MS = 120 * 60 * 1000;
const PYTHON_EXEC_MAX_BUFFER = 20 * 1024 * 1024;
const DEPRECATED_BUILT_IN_TTS_CATALOG_IDS = new Set([
  'builtin-tts-kokoro-v1',
  'builtin-tts-qwen3tts-v1',
]);
const execFileAsync = promisify(execFile);

function createVoiceModelError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeOptionalText(value, fallback = '') {
  const text = sanitizeText(value);
  return text || fallback;
}

function stripAnsiCodes(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function parseSizeToBytes(value, unit = '') {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }

  const normalizedUnit = sanitizeText(unit).toUpperCase();
  if (normalizedUnit === 'K') {
    return Math.round(numeric * 1024);
  }
  if (normalizedUnit === 'M') {
    return Math.round(numeric * 1024 * 1024);
  }
  if (normalizedUnit === 'G') {
    return Math.round(numeric * 1024 * 1024 * 1024);
  }
  if (normalizedUnit === 'T') {
    return Math.round(numeric * 1024 * 1024 * 1024 * 1024);
  }
  return Math.round(numeric);
}

function normalizeBundleRecord(bundle = {}) {
  const id = sanitizeText(bundle.id);
  const name = sanitizeText(bundle.name);
  if (!id || !name) {
    return null;
  }

  const normalizeAsr = () => {
    if (!bundle.asr || typeof bundle.asr !== 'object') {
      return null;
    }

    const modelPath = sanitizeText(bundle.asr.modelPath);
    const tokensPath = sanitizeText(bundle.asr.tokensPath);
    if (!modelPath || !tokensPath) {
      return null;
    }

    return {
      modelPath,
      tokensPath,
      modelKind: sanitizeOptionalText(bundle.asr.modelKind, 'zipformerctc'),
      executionProvider: sanitizeOptionalText(bundle.asr.executionProvider, 'cpu'),
    };
  };

  const normalizeTts = () => {
    if (!bundle.tts || typeof bundle.tts !== 'object') {
      return null;
    }

    const modelPath = sanitizeText(bundle.tts.modelPath);
    const voicesPath = sanitizeText(bundle.tts.voicesPath);
    const tokensPath = sanitizeText(bundle.tts.tokensPath);
    if (!modelPath || !voicesPath || !tokensPath) {
      return null;
    }

    return {
      modelPath,
      voicesPath,
      tokensPath,
      modelKind: sanitizeOptionalText(bundle.tts.modelKind, 'kokoro'),
      executionProvider: sanitizeOptionalText(bundle.tts.executionProvider, 'cpu'),
      lexiconPath: sanitizeOptionalText(bundle.tts.lexiconPath),
      dataDir: sanitizeOptionalText(bundle.tts.dataDir),
      lang: sanitizeOptionalText(bundle.tts.lang),
      sid: sanitizeOptionalText(bundle.tts.sid),
      speed: sanitizeOptionalText(bundle.tts.speed),
    };
  };

  const asr = normalizeAsr();
  const tts = normalizeTts();
  const normalizeRuntime = () => {
    if (!bundle.runtime || typeof bundle.runtime !== 'object') {
      return null;
    }

    const runtimeKind = sanitizeOptionalText(bundle.runtime.kind).toLowerCase();
    if (runtimeKind !== 'python') {
      return null;
    }

    const pythonEnvId = sanitizeText(bundle.runtime.pythonEnvId);
    const pythonExecutablePath = sanitizeText(bundle.runtime.pythonExecutablePath);
    if (!pythonEnvId && !pythonExecutablePath) {
      return null;
    }

    return {
      kind: runtimeKind,
      pythonEnvId,
      pythonEnvProfile: sanitizeText(bundle.runtime.pythonEnvProfile),
      pythonVersion: sanitizeText(bundle.runtime.pythonVersion),
      pythonExecutablePath,
      bridgeScriptPath: sanitizeText(bundle.runtime.bridgeScriptPath),
      bootstrapScriptPath: sanitizeText(bundle.runtime.bootstrapScriptPath),
      asrModelDir: sanitizeText(bundle.runtime.asrModelDir),
      ttsModelDir: sanitizeText(bundle.runtime.ttsModelDir),
      ttsTokenizerDir: sanitizeText(bundle.runtime.ttsTokenizerDir),
      asrLanguage: sanitizeOptionalText(bundle.runtime.asrLanguage, 'auto'),
      ttsLanguage: sanitizeOptionalText(bundle.runtime.ttsLanguage, 'Chinese'),
      ttsMode: sanitizeOptionalText(bundle.runtime.ttsMode, 'custom_voice'),
      ttsEngine: sanitizeOptionalText(bundle.runtime.ttsEngine, 'qwen3-mlx'),
      ttsSpeaker: sanitizeOptionalText(bundle.runtime.ttsSpeaker, 'vivian'),
      ttsVoice: sanitizeOptionalText(bundle.runtime.ttsVoice),
      ttsRate: sanitizeOptionalText(bundle.runtime.ttsRate),
      ttsPitch: sanitizeOptionalText(bundle.runtime.ttsPitch),
      ttsVolume: sanitizeOptionalText(bundle.runtime.ttsVolume),
      modelSource: sanitizeOptionalText(bundle.runtime.modelSource, 'auto'),
      device: sanitizeOptionalText(bundle.runtime.device, 'auto'),
    };
  };

  const runtime = normalizeRuntime();
  if (!asr && !tts && !runtime) {
    return null;
  }

  return {
    id,
    name,
    catalogId: sanitizeOptionalText(bundle.catalogId),
    createdAt: sanitizeOptionalText(bundle.createdAt, new Date().toISOString()),
    asr,
    tts,
    runtime,
  };
}

function bundleSupportsAsr(bundle = {}) {
  if (!bundle || typeof bundle !== 'object') {
    return false;
  }

  if (bundle.asr && typeof bundle.asr === 'object') {
    return Boolean(sanitizeText(bundle.asr.modelPath) && sanitizeText(bundle.asr.tokensPath));
  }

  if (bundle.runtime?.kind === 'python') {
    return Boolean(sanitizeText(bundle.runtime.asrModelDir));
  }

  return false;
}

function bundleSupportsTts(bundle = {}) {
  if (!bundle || typeof bundle !== 'object') {
    return false;
  }

  if (bundle.tts && typeof bundle.tts === 'object') {
    return Boolean(
      sanitizeText(bundle.tts.modelPath)
      && sanitizeText(bundle.tts.voicesPath)
      && sanitizeText(bundle.tts.tokensPath),
    );
  }

  if (bundle.runtime?.kind === 'python') {
    const runtime = bundle.runtime;
    const ttsEngine = sanitizeOptionalText(runtime.ttsEngine).toLowerCase();
    if (ttsEngine === 'edge') {
      return true;
    }
    return Boolean(sanitizeText(runtime.ttsModelDir));
  }

  return false;
}

function isLegacySherpaKokoroBundle(bundle = {}) {
  if (!bundle || typeof bundle !== 'object') {
    return false;
  }

  if (sanitizeText(bundle.catalogId)) {
    return false;
  }

  const asrModelPath = sanitizeText(bundle.asr?.modelPath);
  const ttsModelPath = sanitizeText(bundle.tts?.modelPath);
  return (
    bundleSupportsAsr(bundle)
    && bundleSupportsTts(bundle)
    && asrModelPath.includes('sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30')
    && ttsModelPath.includes('kokoro-multi-lang-v1_0')
  );
}

function splitLegacySherpaKokoroBundle(bundle = {}) {
  const createdAt = sanitizeOptionalText(bundle.createdAt, new Date().toISOString());
  const baseId = sanitizeText(bundle.id);
  const asrBundle = normalizeBundleRecord({
    id: `${baseId}-asr`,
    name: '中文 ASR（Sherpa Zipformer）',
    catalogId: 'builtin-asr-zh-int8-zipformer-v1',
    createdAt,
    asr: bundle.asr,
  });
  const ttsBundle = normalizeBundleRecord({
    id: `${baseId}-tts`,
    name: 'Kokoro TTS（内置推荐）',
    catalogId: 'builtin-tts-kokoro-v1',
    createdAt,
    tts: bundle.tts,
  });
  return [asrBundle, ttsBundle].filter(Boolean);
}

function migrateLegacyState(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const originalBundles = Array.isArray(source.bundles)
    ? source.bundles.map((item) => normalizeBundleRecord(item)).filter(Boolean)
    : [];
  const bundles = [];
  let migrated = false;
  const selectedBundleId = sanitizeText(source.selectedBundleId);
  let selectedAsrBundleId = sanitizeText(source.selectedAsrBundleId);
  let selectedTtsBundleId = sanitizeText(source.selectedTtsBundleId);

  for (const bundle of originalBundles) {
    if (isLegacySherpaKokoroBundle(bundle)) {
      const [asrBundle, ttsBundle] = splitLegacySherpaKokoroBundle(bundle);
      if (asrBundle) {
        bundles.push(asrBundle);
      }
      if (ttsBundle) {
        bundles.push(ttsBundle);
      }

      if (selectedBundleId && selectedBundleId === bundle.id) {
        selectedAsrBundleId = asrBundle?.id || selectedAsrBundleId;
        selectedTtsBundleId = ttsBundle?.id || selectedTtsBundleId;
      }
      if (selectedAsrBundleId && selectedAsrBundleId === bundle.id) {
        selectedAsrBundleId = asrBundle?.id || '';
      }
      if (selectedTtsBundleId && selectedTtsBundleId === bundle.id) {
        selectedTtsBundleId = ttsBundle?.id || '';
      }

      migrated = true;
      continue;
    }

    bundles.push(bundle);
  }

  return {
    migrated,
    rawState: {
      bundles,
      selectedBundleId,
      selectedAsrBundleId,
      selectedTtsBundleId,
    },
  };
}

function normalizeState(raw = {}) {
  const migration = migrateLegacyState(raw);
  const source = migration.rawState;
  const bundles = Array.isArray(source.bundles)
    ? source.bundles.filter(
      (item) => !DEPRECATED_BUILT_IN_TTS_CATALOG_IDS.has(sanitizeText(item?.catalogId)),
    )
    : [];
  const idSet = new Set(bundles.map((item) => item.id));
  const asrIdSet = new Set(bundles.filter((item) => bundleSupportsAsr(item)).map((item) => item.id));
  const ttsIdSet = new Set(bundles.filter((item) => bundleSupportsTts(item)).map((item) => item.id));
  const legacySelectedBundleId = idSet.has(source.selectedBundleId) ? source.selectedBundleId : '';
  const selectedAsrCandidate = sanitizeOptionalText(source.selectedAsrBundleId, legacySelectedBundleId);
  const selectedTtsCandidate = sanitizeOptionalText(source.selectedTtsBundleId, legacySelectedBundleId);

  return {
    bundles,
    selectedAsrBundleId: asrIdSet.has(selectedAsrCandidate) ? selectedAsrCandidate : '',
    selectedTtsBundleId: ttsIdSet.has(selectedTtsCandidate) ? selectedTtsCandidate : '',
    migrated: migration.migrated,
  };
}

function resolveExistingPathCandidate(pathValue) {
  const normalizedPath = sanitizeText(pathValue);
  if (!normalizedPath) {
    return '';
  }

  return fs.existsSync(normalizedPath) ? normalizedPath : '';
}

function resolveRuntimeTtsBundle(tts = {}) {
  const normalizedTts = tts && typeof tts === 'object' ? { ...tts } : {};
  const modelKind = sanitizeOptionalText(normalizedTts.modelKind, 'kokoro').toLowerCase();
  const modelPath = sanitizeText(normalizedTts.modelPath);
  const modelDir = modelPath ? path.dirname(modelPath) : '';

  let dataDir = sanitizeText(normalizedTts.dataDir);
  let lexiconPath = sanitizeText(normalizedTts.lexiconPath);
  let lang = sanitizeText(normalizedTts.lang);
  let sid = sanitizeText(normalizedTts.sid);

  if (modelKind === 'kokoro' && modelDir) {
    dataDir = dataDir || resolveExistingPathCandidate(path.join(modelDir, 'espeak-ng-data'));
    if (!lexiconPath) {
      const zhLexicon = resolveExistingPathCandidate(path.join(modelDir, 'lexicon-zh.txt'));
      if (zhLexicon) {
        lexiconPath = zhLexicon;
      }
    }
    if (!lang && lexiconPath && path.basename(lexiconPath).toLowerCase().includes('zh')) {
      lang = 'zh';
    }
    if (!sid && (!lang || lang === 'zh')) {
      // Default to a sweeter Chinese female timbre for kokoro legacy bundles.
      sid = '46'; // zf_xiaoni
    }
  }

  return {
    ...normalizedTts,
    dataDir: dataDir || '',
    lexiconPath: lexiconPath || '',
    lang: lang || '',
    sid: sid || '',
  };
}

function resolveRuntimeTtsExecutionProvider(tts = {}) {
  const modelKind = sanitizeOptionalText(tts.modelKind, 'kokoro').toLowerCase();
  const executionProvider = sanitizeOptionalText(tts.executionProvider, 'cpu').toLowerCase();

  // Work around current sherpa-onnx CoreML memory instability for kokoro on macOS.
  if (process.platform === 'darwin' && modelKind === 'kokoro' && executionProvider === 'coreml') {
    return 'cpu';
  }

  return executionProvider || 'cpu';
}

function createBundleId(bundleName) {
  const normalized = sanitizeText(bundleName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const prefix = normalized || 'voice-model';
  return `${prefix}-${suffix}`;
}

function resolveCatalogExecutionProvider(value, fallback = 'cpu') {
  const normalized = sanitizeText(value).toLowerCase();
  if (normalized && normalized !== 'auto') {
    return normalized;
  }

  if (process.platform === 'darwin') {
    return 'coreml';
  }

  return fallback;
}

function getModelShortName(modelId) {
  const normalized = sanitizeText(modelId);
  if (!normalized) {
    return '';
  }
  const parts = normalized.split('/');
  return sanitizeOptionalText(parts.at(-1), normalized);
}

function resolveCatalogAsrLabel(item = {}) {
  if (item.runtime?.kind === 'python') {
    return getModelShortName(item.runtime.asrModelId) || 'Python ASR';
  }
  if (item.asr?.extractedDir) {
    return sanitizeText(item.asr.extractedDir);
  }
  return sanitizeText(item.name) || 'ASR';
}

function resolveCatalogTtsLabel(item = {}) {
  if (item.runtime?.kind === 'python') {
    const ttsEngine = sanitizeOptionalText(item.runtime.ttsEngine).toLowerCase();
    if (ttsEngine === 'edge') {
      return sanitizeText(item.runtime.ttsVoice) || 'Edge TTS';
    }
    return getModelShortName(item.runtime.ttsModelId) || 'Python TTS';
  }
  if (item.tts?.extractedDir) {
    return sanitizeText(item.tts.extractedDir);
  }
  return sanitizeText(item.name) || 'TTS';
}

async function copyPythonBridgeScripts({ destinationDir }) {
  await fsp.mkdir(destinationDir, { recursive: true });
  const sourceDir = path.join(__dirname, 'providers', 'python');

  const bridgeScriptSourcePath = path.join(sourceDir, PYTHON_BRIDGE_SCRIPT_NAME);
  const bootstrapScriptSourcePath = path.join(sourceDir, PYTHON_BOOTSTRAP_SCRIPT_NAME);
  const bridgeScriptPath = path.join(destinationDir, PYTHON_BRIDGE_SCRIPT_NAME);
  const bootstrapScriptPath = path.join(destinationDir, PYTHON_BOOTSTRAP_SCRIPT_NAME);

  await ensurePathExists(
    bridgeScriptSourcePath,
    'voice_python_runtime_script_missing',
    `Python bridge script not found: ${bridgeScriptSourcePath}`,
  );
  await ensurePathExists(
    bootstrapScriptSourcePath,
    'voice_python_runtime_script_missing',
    `Python bootstrap script not found: ${bootstrapScriptSourcePath}`,
  );

  await fsp.copyFile(bridgeScriptSourcePath, bridgeScriptPath);
  await fsp.copyFile(bootstrapScriptSourcePath, bootstrapScriptPath);
  await fsp.chmod(bridgeScriptPath, 0o755).catch(() => {});
  await fsp.chmod(bootstrapScriptPath, 0o755).catch(() => {});

  return {
    bridgeScriptPath,
    bootstrapScriptPath,
  };
}

async function runPythonCommandStreaming(
  pythonExecutable,
  args,
  {
    timeoutMs = PYTHON_STEP_TIMEOUT_MS,
    onStdoutChunk = null,
    onStderrChunk = null,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdoutText = '';
    let stderrText = '';
    let settled = false;
    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
    timeoutId.unref?.();

    const finalizeReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      reject(error);
    };

    const finalizeResolve = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve(payload);
    };

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      stdoutText += text;
      if (typeof onStdoutChunk === 'function') {
        onStdoutChunk(text);
      }
    });

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      stderrText += text;
      if (typeof onStderrChunk === 'function') {
        onStderrChunk(text);
      }
    });

    child.on('error', (error) => {
      finalizeReject(
        createVoiceModelError(
          'voice_python_runtime_command_failed',
          error?.message || 'Python command failed.',
        ),
      );
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        finalizeResolve({
          stdout: stdoutText,
          stderr: stderrText,
        });
        return;
      }

      const stderr = sanitizeText(stripAnsiCodes(stderrText));
      const stdout = sanitizeText(stripAnsiCodes(stdoutText));
      const message =
        stderr
        || stdout
        || `Python command failed with exit code ${code ?? 'unknown'} (signal: ${signal || 'none'}).`;
      finalizeReject(createVoiceModelError('voice_python_runtime_command_failed', message));
    });
  });
}

function parseJsonOutput(rawText, code, fallbackMessage) {
  const text = sanitizeText(rawText);
  if (!text) {
    throw createVoiceModelError(code, fallbackMessage);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw createVoiceModelError(code, fallbackMessage);
  }
}

async function ensurePathExists(pathValue, code, message) {
  try {
    await fsp.access(pathValue);
  } catch {
    throw createVoiceModelError(code, message);
  }
}

async function extractTarArchive({ archivePath, destinationDir }) {
  await fsp.mkdir(destinationDir, { recursive: true });

  try {
    await execFileAsync('tar', ['-xf', archivePath, '-C', destinationDir]);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw createVoiceModelError(
        'voice_model_extract_tool_missing',
        'Missing tar command. Please install tar first.',
      );
    }
    throw createVoiceModelError(
      'voice_model_extract_failed',
      `Failed to extract model archive: ${error?.message || 'unknown error'}`,
    );
  }
}

function resolveHttpModule(protocol) {
  if (protocol === 'http:') {
    return http;
  }
  if (protocol === 'https:') {
    return https;
  }

  throw createVoiceModelError('voice_model_download_protocol_unsupported', `Unsupported protocol: ${protocol}`);
}

function requestWithRedirect(urlString, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch {
      reject(createVoiceModelError('voice_model_download_invalid_url', `Invalid URL: ${urlString}`));
      return;
    }

    let client = null;
    try {
      client = resolveHttpModule(parsedUrl.protocol);
    } catch (error) {
      reject(error);
      return;
    }
    const request = client.get(
      parsedUrl,
      {
        headers: {
          'user-agent': 'free-agent-vtuber-openclaw/voice-model-downloader',
        },
        timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const redirectLocation = response.headers.location;
        if (
          redirectLocation
          && statusCode >= 300
          && statusCode < 400
        ) {
          response.resume();
          if (redirectsLeft <= 0) {
            reject(
              createVoiceModelError(
                'voice_model_download_redirect_overflow',
                `Too many redirects while downloading: ${urlString}`,
              ),
            );
            return;
          }

          const nextUrl = new URL(redirectLocation, parsedUrl).toString();
          requestWithRedirect(nextUrl, redirectsLeft - 1).then(resolve).catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(
            createVoiceModelError(
              'voice_model_download_http_error',
              `Download failed (${statusCode}) for ${urlString}`,
            ),
          );
          return;
        }

        resolve({
          response,
          finalUrl: parsedUrl.toString(),
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(
        createVoiceModelError(
          'voice_model_download_timeout',
          `Download timeout for ${urlString}`,
        ),
      );
    });
    request.on('error', (error) => {
      reject(error);
    });
  });
}

async function downloadFileFromUrl({ url, destinationPath, onProgress }) {
  const { response } = await requestWithRedirect(url, MAX_REDIRECTS);
  const totalBytes = Number.parseInt(response.headers['content-length'], 10);
  const hasTotalBytes = Number.isFinite(totalBytes) && totalBytes > 0;
  const expectedTotal = hasTotalBytes ? totalBytes : 0;

  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  const tempPath = `${destinationPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const writeStream = fs.createWriteStream(tempPath);

  let downloadedBytes = 0;
  const startedAt = Date.now();
  response.on('data', (chunk) => {
    downloadedBytes += chunk.length;
    if (typeof onProgress === 'function') {
      const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
      const bytesPerSecond = downloadedBytes / elapsedSeconds;
      const estimatedRemainingSeconds =
        expectedTotal > 0 && bytesPerSecond > 0
          ? Math.max(0, (expectedTotal - downloadedBytes) / bytesPerSecond)
          : null;
      onProgress({
        downloadedBytes,
        totalBytes: expectedTotal,
        bytesPerSecond,
        estimatedRemainingSeconds,
      });
    }
  });

  try {
    await pipeline(response, writeStream);
    await fsp.rename(tempPath, destinationPath);
  } catch (error) {
    try {
      await fsp.rm(tempPath, { force: true });
    } catch {
      // noop
    }
    throw error;
  }

  return {
    downloadedBytes,
    totalBytes: expectedTotal,
  };
}

class VoiceModelLibrary {
  constructor(
    app,
    {
      downloadFileImpl = downloadFileFromUrl,
      pythonRuntimeManager = null,
      pythonEnvManager = null,
    } = {},
  ) {
    this.app = app;
    this.downloadFileImpl = downloadFileImpl;
    this.pythonRuntimeManager =
      pythonRuntimeManager instanceof PythonRuntimeManager
        ? pythonRuntimeManager
        : (pythonRuntimeManager || new PythonRuntimeManager(app, { downloadFileImpl }));
    this.pythonEnvManager =
      pythonEnvManager instanceof PythonEnvManager
        ? pythonEnvManager
        : (pythonEnvManager || new PythonEnvManager(app, { pythonRuntimeManager: this.pythonRuntimeManager }));

    this.rootDir = path.join(this.app.getPath('userData'), ROOT_DIR_NAME);
    this.bundlesDir = path.join(this.rootDir, BUNDLES_DIR_NAME);
    this.stateFilePath = path.join(this.rootDir, STATE_FILE_NAME);
    this.state = normalizeState({});
  }

  async init() {
    await this.pythonRuntimeManager.init();
    await this.pythonEnvManager.init();
    await fsp.mkdir(this.bundlesDir, { recursive: true });

    try {
      const raw = await fsp.readFile(this.stateFilePath, 'utf-8');
      const normalizedState = normalizeState(JSON.parse(raw));
      const { migrated, ...state } = normalizedState;
      this.state = state;
      if (migrated) {
        await this.persistState();
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to load voice model state:', error);
      }
      const normalizedState = normalizeState({});
      const { migrated: _migrated, ...state } = normalizedState;
      this.state = state;
      await this.persistState();
    }
  }

  listBundles() {
    const selectedBundleId =
      this.state.selectedAsrBundleId && this.state.selectedAsrBundleId === this.state.selectedTtsBundleId
        ? this.state.selectedAsrBundleId
        : '';

    return {
      rootDir: this.rootDir,
      selectedAsrBundleId: this.state.selectedAsrBundleId,
      selectedTtsBundleId: this.state.selectedTtsBundleId,
      selectedBundleId,
      bundles: this.state.bundles.map((bundle) => ({
        ...bundle,
        hasAsr: bundleSupportsAsr(bundle),
        hasTts: bundleSupportsTts(bundle),
      })),
    };
  }

  listCatalog() {
    return getBuiltInVoiceModelCatalog().map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description || '',
      asrOptionLabel: resolveCatalogAsrLabel(item),
      ttsOptionLabel: resolveCatalogTtsLabel(item),
      hasAsr: typeof item.hasAsr === 'boolean' ? item.hasAsr : Boolean(item.asr),
      hasTts: typeof item.hasTts === 'boolean' ? item.hasTts : Boolean(item.tts),
    }));
  }

  async installCatalogBundle({ catalogId, installAsr, installTts } = {}, { onProgress } = {}) {
    const normalizedCatalogId = sanitizeText(catalogId);
    const catalogEntry = getBuiltInVoiceModelCatalog().find((item) => item.id === normalizedCatalogId);
    if (!catalogEntry) {
      throw createVoiceModelError('voice_model_catalog_not_found', `Built-in model not found: ${normalizedCatalogId}`);
    }

    const catalogHasAsr = typeof catalogEntry.hasAsr === 'boolean' ? catalogEntry.hasAsr : Boolean(catalogEntry.asr);
    const catalogHasTts = typeof catalogEntry.hasTts === 'boolean' ? catalogEntry.hasTts : Boolean(catalogEntry.tts);
    const shouldInstallAsr = typeof installAsr === 'boolean' ? installAsr : catalogHasAsr;
    const shouldInstallTts = typeof installTts === 'boolean' ? installTts : catalogHasTts;

    if (!shouldInstallAsr && !shouldInstallTts) {
      throw createVoiceModelError(
        'voice_model_download_invalid_input',
        'Please choose at least one component to install.',
      );
    }
    if (shouldInstallAsr && !catalogHasAsr) {
      throw createVoiceModelError(
        'voice_model_catalog_component_not_found',
        `Selected model does not provide ASR component: ${normalizedCatalogId}`,
      );
    }
    if (shouldInstallTts && !catalogHasTts) {
      throw createVoiceModelError(
        'voice_model_catalog_component_not_found',
        `Selected model does not provide TTS component: ${normalizedCatalogId}`,
      );
    }

    if (catalogEntry.runtime?.kind === 'python') {
      return this.installPythonRuntimeCatalogBundle({
        catalogEntry,
        installAsr: shouldInstallAsr,
        installTts: shouldInstallTts,
        onProgress,
      });
    }

    const id = createBundleId(catalogEntry.name);
    const name = catalogEntry.name;
    const bundleDir = path.join(this.bundlesDir, id);
    await fsp.mkdir(bundleDir, { recursive: true });

    const components = [];
    if (catalogEntry.asr && shouldInstallAsr) {
      components.push({
        key: 'asr',
        label: 'ASR',
        archiveUrl: catalogEntry.asr.archiveUrl,
        extractedDir: catalogEntry.asr.extractedDir,
      });
    }
    if (catalogEntry.tts && shouldInstallTts) {
      components.push({
        key: 'tts',
        label: 'TTS',
        archiveUrl: catalogEntry.tts.archiveUrl,
        extractedDir: catalogEntry.tts.extractedDir,
      });
    }

    const totalTasks = components.length * 2;
    let completedTasks = 0;
    const emitProgress = ({
      phase,
      currentFile = '',
      fileDownloadedBytes = 0,
      fileTotalBytes = 0,
      downloadSpeedBytesPerSec = 0,
      estimatedRemainingSeconds = null,
      overallProgress = null,
    }) => {
      if (typeof onProgress !== 'function') {
        return;
      }

      onProgress({
        type: 'download-progress',
        phase,
        bundleId: id,
        bundleName: name,
        completedTasks,
        totalTasks,
        currentFile,
        fileDownloadedBytes,
        fileTotalBytes,
        downloadSpeedBytesPerSec,
        estimatedRemainingSeconds,
        overallProgress,
      });
    };

    emitProgress({
      phase: 'started',
      overallProgress: 0,
    });

    try {
      for (const component of components) {
        const archivePath = path.join(bundleDir, `${component.key}.tar.bz2`);
        const extractedBaseDir = path.join(bundleDir, component.key);

        await this.downloadFileImpl({
          url: component.archiveUrl,
          destinationPath: archivePath,
          onProgress: ({ downloadedBytes, totalBytes, bytesPerSecond, estimatedRemainingSeconds }) => {
            const downloadRatio =
              Number.isFinite(totalBytes) && totalBytes > 0 ? Math.min(1, downloadedBytes / totalBytes) : 0;
            const progress = (completedTasks + downloadRatio) / totalTasks;
            emitProgress({
              phase: 'running',
              currentFile: path.basename(component.archiveUrl),
              fileDownloadedBytes: downloadedBytes,
              fileTotalBytes: totalBytes,
              downloadSpeedBytesPerSec: Number.isFinite(bytesPerSecond) ? bytesPerSecond : 0,
              estimatedRemainingSeconds:
                Number.isFinite(estimatedRemainingSeconds) && estimatedRemainingSeconds >= 0
                  ? estimatedRemainingSeconds
                  : null,
              overallProgress: progress,
            });
          },
        });
        completedTasks += 1;
        emitProgress({
          phase: 'running',
          currentFile: `已下载 ${component.label} 压缩包`,
          overallProgress: completedTasks / totalTasks,
        });

        emitProgress({
          phase: 'extracting',
          currentFile: `正在解压 ${component.label} 模型`,
          overallProgress: (completedTasks + 0.5) / totalTasks,
        });
        await extractTarArchive({
          archivePath,
          destinationDir: extractedBaseDir,
        });
        completedTasks += 1;
        emitProgress({
          phase: 'running',
          currentFile: `已解压 ${component.label} 模型`,
          overallProgress: completedTasks / totalTasks,
        });

        await fsp.rm(archivePath, { force: true });
      }
    } catch (error) {
      emitProgress({
        phase: 'failed',
        currentFile: '',
      });
      try {
        await fsp.rm(bundleDir, { recursive: true, force: true });
      } catch {
        // noop
      }
      throw error;
    }

    const asrModelPath = catalogEntry.asr && shouldInstallAsr
      ? path.join(bundleDir, 'asr', catalogEntry.asr.extractedDir, catalogEntry.asr.modelRelativePath)
      : '';
    const asrTokensPath = catalogEntry.asr && shouldInstallAsr
      ? path.join(bundleDir, 'asr', catalogEntry.asr.extractedDir, catalogEntry.asr.tokensRelativePath)
      : '';
    const ttsModelPath = catalogEntry.tts && shouldInstallTts
      ? path.join(bundleDir, 'tts', catalogEntry.tts.extractedDir, catalogEntry.tts.modelRelativePath)
      : '';
    const ttsVoicesPath = catalogEntry.tts && shouldInstallTts
      ? path.join(bundleDir, 'tts', catalogEntry.tts.extractedDir, catalogEntry.tts.voicesRelativePath)
      : '';
    const ttsTokensPath = catalogEntry.tts && shouldInstallTts
      ? path.join(bundleDir, 'tts', catalogEntry.tts.extractedDir, catalogEntry.tts.tokensRelativePath)
      : '';
    const ttsDataDirPath = catalogEntry.tts?.dataDirRelativePath && shouldInstallTts
      ? path.join(bundleDir, 'tts', catalogEntry.tts.extractedDir, catalogEntry.tts.dataDirRelativePath)
      : '';
    const ttsLexiconPath = catalogEntry.tts?.lexiconRelativePath && shouldInstallTts
      ? path.join(bundleDir, 'tts', catalogEntry.tts.extractedDir, catalogEntry.tts.lexiconRelativePath)
      : '';

    if (catalogEntry.asr && shouldInstallAsr) {
      await ensurePathExists(
        asrModelPath,
        'voice_model_catalog_file_missing',
        `ASR model file not found after extraction: ${asrModelPath}`,
      );
      await ensurePathExists(
        asrTokensPath,
        'voice_model_catalog_file_missing',
        `ASR tokens file not found after extraction: ${asrTokensPath}`,
      );
    }
    if (catalogEntry.tts && shouldInstallTts) {
      await ensurePathExists(
        ttsModelPath,
        'voice_model_catalog_file_missing',
        `TTS model file not found after extraction: ${ttsModelPath}`,
      );
      await ensurePathExists(
        ttsVoicesPath,
        'voice_model_catalog_file_missing',
        `TTS voices file not found after extraction: ${ttsVoicesPath}`,
      );
      await ensurePathExists(
        ttsTokensPath,
        'voice_model_catalog_file_missing',
        `TTS tokens file not found after extraction: ${ttsTokensPath}`,
      );
      if (catalogEntry.tts.dataDirRelativePath) {
        await ensurePathExists(
          ttsDataDirPath,
          'voice_model_catalog_file_missing',
          `TTS data dir not found after extraction: ${ttsDataDirPath}`,
        );
      }
      if (catalogEntry.tts.lexiconRelativePath) {
        await ensurePathExists(
          ttsLexiconPath,
          'voice_model_catalog_file_missing',
          `TTS lexicon file not found after extraction: ${ttsLexiconPath}`,
        );
      }
    }

    const bundleRecord = normalizeBundleRecord({
      id,
      name,
      catalogId: normalizedCatalogId,
      createdAt: new Date().toISOString(),
      asr: catalogEntry.asr && shouldInstallAsr
        ? {
            modelPath: asrModelPath,
            tokensPath: asrTokensPath,
            modelKind: sanitizeOptionalText(catalogEntry.asr.modelKind, 'zipformer2ctc'),
            executionProvider: resolveCatalogExecutionProvider(catalogEntry.asr.executionProvider, 'cpu'),
          }
        : null,
      tts: catalogEntry.tts && shouldInstallTts
        ? {
            modelPath: ttsModelPath,
            voicesPath: ttsVoicesPath,
            tokensPath: ttsTokensPath,
            modelKind: sanitizeOptionalText(catalogEntry.tts.modelKind, 'kokoro'),
            executionProvider: resolveCatalogExecutionProvider(catalogEntry.tts.executionProvider, 'cpu'),
            dataDir: sanitizeOptionalText(ttsDataDirPath),
            lexiconPath: sanitizeOptionalText(ttsLexiconPath),
            lang: sanitizeOptionalText(catalogEntry.tts.lang),
            sid: sanitizeOptionalText(catalogEntry.tts.sid),
            speed: sanitizeOptionalText(catalogEntry.tts.speed),
          }
        : null,
    });

    if (!bundleRecord) {
      throw createVoiceModelError('voice_model_bundle_invalid', 'Failed to build model bundle record.');
    }

    this.state.bundles = this.state.bundles.filter((item) => item.id !== bundleRecord.id);
    this.state.bundles.unshift(bundleRecord);
    this.selectInstalledBundleCapabilities(bundleRecord);
    await this.persistState();

    emitProgress({
      phase: 'completed',
      currentFile: '',
      overallProgress: 1,
    });

    return {
      bundle: bundleRecord,
      ...this.listBundles(),
    };
  }

  async installPythonRuntimeCatalogBundle({
    catalogEntry,
    installAsr = true,
    installTts = true,
    onProgress,
  }) {
    const runtime = catalogEntry?.runtime && typeof catalogEntry.runtime === 'object'
      ? catalogEntry.runtime
      : {};
    const shouldInstallAsr = Boolean(installAsr);
    const shouldInstallTts = Boolean(installTts);
    if (!shouldInstallAsr && !shouldInstallTts) {
      throw createVoiceModelError(
        'voice_model_download_invalid_input',
        'Please choose at least one component to install.',
      );
    }

    const id = createBundleId(catalogEntry.name);
    const name = catalogEntry.name;
    const bundleDir = path.join(this.bundlesDir, id);
    const scriptDir = path.join(bundleDir, PYTHON_RUNTIME_SCRIPTS_DIR_NAME);
    const modelsDir = path.join(bundleDir, 'models');
    const asrModelDir = path.join(modelsDir, 'asr');
    const ttsModelDir = path.join(modelsDir, 'tts');
    const ttsTokenizerDir = path.join(modelsDir, 'tts-tokenizer');
    const pythonVersion = sanitizeOptionalText(runtime.pythonVersion, getDefaultPythonVersion());
    const pythonEnvProfile = sanitizeOptionalText(runtime.pythonEnvProfile, 'voice-default');
    const pipPackages = Array.isArray(runtime.pipPackages)
      ? runtime.pipPackages.map((item) => sanitizeText(item)).filter(Boolean)
      : [];
    const asrModelId = shouldInstallAsr ? sanitizeText(runtime.asrModelId) : '';
    const ttsModelId = shouldInstallTts ? sanitizeText(runtime.ttsModelId) : '';
    const ttsTokenizerModelId = shouldInstallTts ? sanitizeText(runtime.ttsTokenizerModelId) : '';
    const needsModelDownload = Boolean(asrModelId || ttsModelId || ttsTokenizerModelId);
    const modelTargetLabel = shouldInstallAsr && shouldInstallTts
      ? 'ASR/TTS 模型'
      : shouldInstallAsr
        ? 'ASR 模型'
        : 'TTS 模型';

    await fsp.mkdir(bundleDir, { recursive: true });
    await fsp.mkdir(modelsDir, { recursive: true });

    const totalTasks = 2 + (needsModelDownload ? 1 : 0);
    let completedTasks = 0;
    const emitProgress = ({
      phase,
      currentFile = '',
      fileDownloadedBytes = 0,
      fileTotalBytes = 0,
      downloadSpeedBytesPerSec = 0,
      estimatedRemainingSeconds = null,
      overallProgress = null,
    }) => {
      if (typeof onProgress !== 'function') {
        return;
      }

      onProgress({
        type: 'download-progress',
        phase,
        bundleId: id,
        bundleName: name,
        completedTasks,
        totalTasks,
        currentFile,
        fileDownloadedBytes,
        fileTotalBytes,
        downloadSpeedBytesPerSec,
        estimatedRemainingSeconds,
        overallProgress,
      });
    };

    emitProgress({
      phase: 'started',
      overallProgress: 0,
    });

    try {
      const envRecord = await this.pythonEnvManager.ensureEnv({
        profile: pythonEnvProfile,
        pythonVersion,
        runtimePackages: runtime.packages,
        pipPackages,
        onProgress: (payload = {}) => {
          const progress = typeof payload.overallProgress === 'number'
            ? (payload.overallProgress / totalTasks)
            : (completedTasks / totalTasks);
          emitProgress({
            phase: payload.phase || 'running',
            currentFile: payload.currentFile || '正在准备共享 Python 运行时',
            overallProgress: progress,
          });
        },
      });
      completedTasks += 1;
      emitProgress({
        phase: 'running',
        currentFile: '共享 Python 运行时和 env 已准备完成',
        overallProgress: completedTasks / totalTasks,
      });

      const { bridgeScriptPath, bootstrapScriptPath } = await copyPythonBridgeScripts({
        destinationDir: scriptDir,
      });
      completedTasks += 1;
      emitProgress({
        phase: 'running',
        currentFile: '语音桥接脚本已同步',
        overallProgress: completedTasks / totalTasks,
      });

      let resolvedAsrModelDir = '';
      let resolvedTtsModelDir = '';
      let resolvedTtsTokenizerDir = '';

      if (needsModelDownload) {
        emitProgress({
          phase: 'running',
          currentFile: `正在下载 ${modelTargetLabel}`,
          overallProgress: (completedTasks + 0.5) / totalTasks,
        });

        const bootstrapArgs = [
          bootstrapScriptPath,
          '--source',
          sanitizeOptionalText(runtime.modelSource, 'auto'),
        ];
        if (shouldInstallAsr && asrModelId) {
          bootstrapArgs.push(
            '--asr-model-id',
            asrModelId,
            '--asr-model-dir',
            asrModelDir,
          );
        }
        if (shouldInstallTts && ttsModelId) {
          bootstrapArgs.push(
            '--tts-model-id',
            ttsModelId,
            '--tts-model-dir',
            ttsModelDir,
          );
        }
        if (shouldInstallTts && ttsTokenizerModelId) {
          bootstrapArgs.push(
            '--tts-tokenizer-model-id',
            ttsTokenizerModelId,
            '--tts-tokenizer-dir',
            ttsTokenizerDir,
          );
        }

        const bootstrapTaskFileProgress = new Map();
        let bootstrapProgressRateBytesPerSec = 0;
        let bootstrapProgressBuffer = '';
        let bootstrapLastEmitAt = 0;

        const emitBootstrapDownloadProgress = ({ force = false } = {}) => {
          const totals = Array.from(bootstrapTaskFileProgress.values()).reduce(
            (acc, item) => {
              if (!Number.isFinite(item.totalBytes) || item.totalBytes <= 0) {
                return acc;
              }
              acc.totalBytes += item.totalBytes;
              acc.downloadedBytes += Math.min(item.downloadedBytes, item.totalBytes);
              return acc;
            },
            {
              downloadedBytes: 0,
              totalBytes: 0,
            },
          );

          if (totals.totalBytes <= 0) {
            return;
          }

          const now = Date.now();
          if (!force && now - bootstrapLastEmitAt < 250) {
            return;
          }
          bootstrapLastEmitAt = now;

          const downloadRatio = Math.min(1, totals.downloadedBytes / totals.totalBytes);
          const overallProgress = (completedTasks + downloadRatio) / totalTasks;
          const estimatedRemainingSeconds =
            bootstrapProgressRateBytesPerSec > 0
              ? Math.max(0, (totals.totalBytes - totals.downloadedBytes) / bootstrapProgressRateBytesPerSec)
              : null;

          emitProgress({
            phase: 'running',
            currentFile: `正在下载 ${modelTargetLabel}`,
            fileDownloadedBytes: totals.downloadedBytes,
            fileTotalBytes: totals.totalBytes,
            downloadSpeedBytesPerSec: bootstrapProgressRateBytesPerSec,
            estimatedRemainingSeconds,
            overallProgress,
          });
        };

        const parseBootstrapLine = (line) => {
          const downloadMatches = line.matchAll(
            /Downloading \[([^\]]+)\]:.*?([0-9]+(?:\.[0-9]+)?)\s*([kMGT]?)(?:i?B?)\/([0-9]+(?:\.[0-9]+)?)\s*([kMGT]?)(?:i?B?)/gi,
          );
          let hasProgressUpdate = false;
          for (const match of downloadMatches) {
            const fileName = sanitizeText(match?.[1]);
            const downloadedBytes = parseSizeToBytes(match?.[2], match?.[3]);
            const totalBytes = parseSizeToBytes(match?.[4], match?.[5]);
            if (!fileName || totalBytes <= 0) {
              continue;
            }
            bootstrapTaskFileProgress.set(fileName, {
              downloadedBytes,
              totalBytes,
            });
            hasProgressUpdate = true;
          }

          const rateMatch = line.match(/,\s*([0-9]+(?:\.[0-9]+)?)\s*([kMGT]?)(?:i?B?)\/s\]/i);
          if (rateMatch) {
            const rateBytesPerSec = parseSizeToBytes(rateMatch[1], rateMatch[2]);
            if (rateBytesPerSec > 0) {
              bootstrapProgressRateBytesPerSec = rateBytesPerSec;
            }
          }

          if (hasProgressUpdate) {
            emitBootstrapDownloadProgress();
          }
        };

        const bootstrapResult = await runPythonCommandStreaming(
          envRecord.envPythonExecutable,
          bootstrapArgs,
          {
            timeoutMs: PYTHON_MODEL_DOWNLOAD_TIMEOUT_MS,
            onStderrChunk: (chunkText) => {
              bootstrapProgressBuffer += stripAnsiCodes(chunkText);
              const lines = bootstrapProgressBuffer.split(/[\r\n]+/);
              bootstrapProgressBuffer = lines.pop() || '';
              for (const line of lines) {
                parseBootstrapLine(line);
              }
            },
          },
        );
        if (bootstrapProgressBuffer) {
          parseBootstrapLine(bootstrapProgressBuffer);
        }
        emitBootstrapDownloadProgress({ force: true });
        const bootstrapPayload = parseJsonOutput(
          bootstrapResult.stdout,
          'voice_python_runtime_bootstrap_invalid_output',
          'Invalid Python runtime bootstrap output.',
        );

        resolvedAsrModelDir = shouldInstallAsr && asrModelId
          ? sanitizeOptionalText(bootstrapPayload.asrModelDir, asrModelDir)
          : '';
        resolvedTtsModelDir = shouldInstallTts && ttsModelId
          ? sanitizeOptionalText(bootstrapPayload.ttsModelDir, ttsModelDir)
          : '';
        resolvedTtsTokenizerDir = shouldInstallTts && ttsTokenizerModelId
          ? sanitizeOptionalText(bootstrapPayload.ttsTokenizerDir, ttsTokenizerDir)
          : '';

        if (shouldInstallAsr && asrModelId) {
          await ensurePathExists(
            resolvedAsrModelDir,
            'voice_python_runtime_model_missing',
            `ASR model directory not found: ${resolvedAsrModelDir}`,
          );
        }
        if (shouldInstallTts && ttsModelId) {
          await ensurePathExists(
            resolvedTtsModelDir,
            'voice_python_runtime_model_missing',
            `TTS model directory not found: ${resolvedTtsModelDir}`,
          );
        }
        if (shouldInstallTts && ttsTokenizerModelId) {
          await ensurePathExists(
            resolvedTtsTokenizerDir,
            'voice_python_runtime_model_missing',
            `TTS tokenizer directory not found: ${resolvedTtsTokenizerDir}`,
          );
        }

        completedTasks += 1;
        emitProgress({
          phase: 'running',
          currentFile: `${modelTargetLabel}下载完成`,
          overallProgress: completedTasks / totalTasks,
        });
      }

      const bundleRecord = normalizeBundleRecord({
        id,
        name,
        catalogId: sanitizeText(catalogEntry.id),
        createdAt: new Date().toISOString(),
        runtime: {
          kind: 'python',
          pythonEnvId: envRecord.envId,
          pythonEnvProfile,
          pythonVersion,
          bridgeScriptPath,
          bootstrapScriptPath,
          asrModelDir: shouldInstallAsr ? resolvedAsrModelDir : '',
          ttsModelDir: shouldInstallTts ? resolvedTtsModelDir : '',
          ttsTokenizerDir: shouldInstallTts ? resolvedTtsTokenizerDir : '',
          asrLanguage: shouldInstallAsr ? sanitizeOptionalText(runtime.asrLanguage, 'auto') : '',
          ttsLanguage: shouldInstallTts ? sanitizeOptionalText(runtime.ttsLanguage, 'Chinese') : '',
          ttsMode: shouldInstallTts ? sanitizeOptionalText(runtime.ttsMode, 'custom_voice') : '',
          ttsEngine: shouldInstallTts ? sanitizeOptionalText(runtime.ttsEngine, 'qwen3-mlx') : '',
          ttsSpeaker: shouldInstallTts ? sanitizeOptionalText(runtime.ttsSpeaker, 'vivian') : '',
          ttsVoice: shouldInstallTts ? sanitizeOptionalText(runtime.ttsVoice) : '',
          ttsRate: shouldInstallTts ? sanitizeOptionalText(runtime.ttsRate) : '',
          ttsPitch: shouldInstallTts ? sanitizeOptionalText(runtime.ttsPitch) : '',
          ttsVolume: shouldInstallTts ? sanitizeOptionalText(runtime.ttsVolume) : '',
          modelSource: sanitizeOptionalText(runtime.modelSource, 'auto'),
          device: sanitizeOptionalText(runtime.device, 'auto'),
        },
      });

      if (!bundleRecord) {
        throw createVoiceModelError('voice_model_bundle_invalid', 'Failed to build Python runtime bundle.');
      }

      this.state.bundles = this.state.bundles.filter((item) => item.id !== bundleRecord.id);
      this.state.bundles.unshift(bundleRecord);
      this.selectInstalledBundleCapabilities(bundleRecord);
      await this.persistState();

      emitProgress({
        phase: 'completed',
        currentFile: '',
        overallProgress: 1,
      });

      return {
        bundle: bundleRecord,
        ...this.listBundles(),
      };
    } catch (error) {
      emitProgress({
        phase: 'failed',
        currentFile: '',
      });
      try {
        await fsp.rm(bundleDir, { recursive: true, force: true });
      } catch {
        // noop
      }
      throw error;
    }
  }

  selectInstalledBundleCapabilities(bundleRecord) {
    if (bundleSupportsAsr(bundleRecord)) {
      this.state.selectedAsrBundleId = bundleRecord.id;
    }
    if (bundleSupportsTts(bundleRecord)) {
      this.state.selectedTtsBundleId = bundleRecord.id;
    }
  }

  getSelectedAsrBundle() {
    if (!this.state.selectedAsrBundleId) {
      return null;
    }

    const found = this.state.bundles.find((item) => item.id === this.state.selectedAsrBundleId) || null;
    return bundleSupportsAsr(found) ? found : null;
  }

  getSelectedTtsBundle() {
    if (!this.state.selectedTtsBundleId) {
      return null;
    }

    const found = this.state.bundles.find((item) => item.id === this.state.selectedTtsBundleId) || null;
    return bundleSupportsTts(found) ? found : null;
  }

  getSelectedBundle() {
    const asrBundle = this.getSelectedAsrBundle();
    const ttsBundle = this.getSelectedTtsBundle();
    if (asrBundle && ttsBundle && asrBundle.id === ttsBundle.id) {
      return asrBundle;
    }
    return asrBundle || ttsBundle || null;
  }

  selectBundle(bundleId) {
    return this.selectBundles({ bundleId });
  }

  selectBundles(payload = {}) {
    const request = payload && typeof payload === 'object' ? payload : {};
    const hasAsrKey = Object.prototype.hasOwnProperty.call(request, 'asrBundleId');
    const hasTtsKey = Object.prototype.hasOwnProperty.call(request, 'ttsBundleId');
    const hasLegacyBundleKey = Object.prototype.hasOwnProperty.call(request, 'bundleId');

    let nextAsrBundleId = this.state.selectedAsrBundleId;
    let nextTtsBundleId = this.state.selectedTtsBundleId;

    const resolveBundleRecord = (bundleId, capability) => {
      const found = this.state.bundles.find((item) => item.id === bundleId);
      if (!found) {
        throw createVoiceModelError('voice_model_bundle_not_found', `Model bundle not found: ${bundleId}`);
      }
      if (capability === 'asr' && !bundleSupportsAsr(found)) {
        throw createVoiceModelError(
          'voice_model_bundle_capability_missing',
          `Model bundle does not include ASR assets: ${bundleId}`,
        );
      }
      if (capability === 'tts' && !bundleSupportsTts(found)) {
        throw createVoiceModelError(
          'voice_model_bundle_capability_missing',
          `Model bundle does not include TTS assets: ${bundleId}`,
        );
      }
    };

    const applySelection = (inputValue, capability) => {
      const candidateId = sanitizeText(inputValue);
      if (!candidateId) {
        return '';
      }
      resolveBundleRecord(candidateId, capability);
      return candidateId;
    };

    if (hasLegacyBundleKey && !hasAsrKey && !hasTtsKey) {
      const legacyBundleId = sanitizeText(request.bundleId);
      if (!legacyBundleId) {
        nextAsrBundleId = '';
        nextTtsBundleId = '';
      } else {
        const found = this.state.bundles.find((item) => item.id === legacyBundleId);
        if (!found) {
          throw createVoiceModelError('voice_model_bundle_not_found', `Model bundle not found: ${legacyBundleId}`);
        }
        if (!bundleSupportsAsr(found) && !bundleSupportsTts(found)) {
          throw createVoiceModelError(
            'voice_model_bundle_capability_missing',
            `Model bundle does not include ASR or TTS assets: ${legacyBundleId}`,
          );
        }
        nextAsrBundleId = bundleSupportsAsr(found) ? legacyBundleId : '';
        nextTtsBundleId = bundleSupportsTts(found) ? legacyBundleId : '';
      }
    } else {
      if (hasAsrKey) {
        nextAsrBundleId = applySelection(request.asrBundleId, 'asr');
      }
      if (hasTtsKey) {
        nextTtsBundleId = applySelection(request.ttsBundleId, 'tts');
      }
    }

    this.state.selectedAsrBundleId = nextAsrBundleId;
    this.state.selectedTtsBundleId = nextTtsBundleId;
    return this.persistState();
  }

  getRuntimeEnv(baseEnv = process.env) {
    const env = {
      ...(baseEnv || {}),
    };

    const selectedAsrBundle = this.getSelectedAsrBundle();
    const selectedTtsBundle = this.getSelectedTtsBundle();
    if (!selectedAsrBundle && !selectedTtsBundle) {
      return env;
    }

    const resolvePythonRuntime = (bundle) => {
      if (!bundle || bundle.runtime?.kind !== 'python') {
        return null;
      }
      const runtime = bundle.runtime;
      if (sanitizeText(runtime.pythonEnvId)) {
        const pythonEnv = this.pythonEnvManager.getEnvById(runtime.pythonEnvId);
        if (pythonEnv?.envPythonExecutable) {
          return {
            ...runtime,
            resolvedPythonExecutable: pythonEnv.envPythonExecutable,
          };
        }
      }
      if (sanitizeText(runtime.pythonExecutablePath)) {
        return {
          ...runtime,
          resolvedPythonExecutable: runtime.pythonExecutablePath,
        };
      }
      return null;
    };

    const pythonRuntime = resolvePythonRuntime(selectedTtsBundle) || resolvePythonRuntime(selectedAsrBundle);
    if (pythonRuntime) {
      env.VOICE_PYTHON_EXECUTABLE = pythonRuntime.resolvedPythonExecutable;
      if (pythonRuntime.bridgeScriptPath) {
        env.VOICE_PYTHON_BRIDGE_SCRIPT = pythonRuntime.bridgeScriptPath;
      }
      if (pythonRuntime.device) {
        env.VOICE_PYTHON_DEVICE = pythonRuntime.device;
      }
    }

    if (selectedAsrBundle) {
      if (
        selectedAsrBundle.runtime?.kind === 'python'
        && sanitizeText(selectedAsrBundle.runtime.asrModelDir)
      ) {
        const runtime = selectedAsrBundle.runtime;
        env.VOICE_ASR_PROVIDER = 'python';
        env.VOICE_ASR_PYTHON_MODEL_DIR = runtime.asrModelDir;
        if (runtime.asrLanguage) {
          env.VOICE_ASR_PYTHON_LANGUAGE = runtime.asrLanguage;
        }
      } else if (selectedAsrBundle.asr) {
        env.VOICE_ASR_PROVIDER = 'sherpa-onnx';
        env.VOICE_ASR_SHERPA_MODEL = selectedAsrBundle.asr.modelPath;
        env.VOICE_ASR_SHERPA_TOKENS = selectedAsrBundle.asr.tokensPath;
        env.VOICE_ASR_SHERPA_MODEL_KIND = selectedAsrBundle.asr.modelKind;
        env.VOICE_ASR_SHERPA_EXECUTION_PROVIDER = selectedAsrBundle.asr.executionProvider;
      }
    }

    if (selectedTtsBundle) {
      if (
        selectedTtsBundle.runtime?.kind === 'python'
        && bundleSupportsTts(selectedTtsBundle)
      ) {
        const runtime = selectedTtsBundle.runtime;
        env.VOICE_TTS_PROVIDER = 'python';
        if (runtime.ttsEngine) {
          env.VOICE_TTS_PYTHON_ENGINE = runtime.ttsEngine;
        }
        if (runtime.ttsModelDir) {
          env.VOICE_TTS_PYTHON_MODEL_DIR = runtime.ttsModelDir;
        }
        if (runtime.ttsTokenizerDir) {
          env.VOICE_TTS_PYTHON_TOKENIZER_DIR = runtime.ttsTokenizerDir;
        }
        if (runtime.ttsLanguage) {
          env.VOICE_TTS_PYTHON_LANGUAGE = runtime.ttsLanguage;
        }
        if (runtime.ttsMode) {
          env.VOICE_TTS_PYTHON_MODE = runtime.ttsMode;
        }
        if (runtime.ttsSpeaker) {
          env.VOICE_TTS_PYTHON_SPEAKER = runtime.ttsSpeaker;
        }
        if (runtime.ttsVoice) {
          env.VOICE_TTS_PYTHON_EDGE_VOICE = runtime.ttsVoice;
        }
        if (runtime.ttsRate) {
          env.VOICE_TTS_PYTHON_EDGE_RATE = runtime.ttsRate;
        }
        if (runtime.ttsPitch) {
          env.VOICE_TTS_PYTHON_EDGE_PITCH = runtime.ttsPitch;
        }
        if (runtime.ttsVolume) {
          env.VOICE_TTS_PYTHON_EDGE_VOLUME = runtime.ttsVolume;
        }
      } else if (selectedTtsBundle.tts) {
        const runtimeTts = resolveRuntimeTtsBundle(selectedTtsBundle.tts);
        env.VOICE_TTS_PROVIDER = 'sherpa-onnx';
        env.VOICE_TTS_SHERPA_MODEL_KIND = runtimeTts.modelKind;
        env.VOICE_TTS_SHERPA_MODEL = runtimeTts.modelPath;
        env.VOICE_TTS_SHERPA_VOICES = runtimeTts.voicesPath;
        env.VOICE_TTS_SHERPA_TOKENS = runtimeTts.tokensPath;
        env.VOICE_TTS_SHERPA_EXECUTION_PROVIDER = resolveRuntimeTtsExecutionProvider(runtimeTts);
        if (runtimeTts.lexiconPath) {
          env.VOICE_TTS_SHERPA_LEXICON = runtimeTts.lexiconPath;
        }
        if (runtimeTts.dataDir) {
          env.VOICE_TTS_SHERPA_DATA_DIR = runtimeTts.dataDir;
        }
        if (runtimeTts.lang) {
          env.VOICE_TTS_SHERPA_LANG = runtimeTts.lang;
        }
        if (runtimeTts.sid) {
          env.VOICE_TTS_SHERPA_SID = runtimeTts.sid;
        }
        if (runtimeTts.speed) {
          env.VOICE_TTS_SHERPA_SPEED = runtimeTts.speed;
        }
        if (!sanitizeText(env.VOICE_TTS_SHERPA_ENABLE_EXTERNAL_BUFFER)) {
          env.VOICE_TTS_SHERPA_ENABLE_EXTERNAL_BUFFER = '0';
        }
      }
    }

    return env;
  }

  async downloadBundle(
    {
      bundleName,
      asr = {},
      tts = {},
    } = {},
    { onProgress } = {},
  ) {
    const asrModelUrl = sanitizeText(asr.modelUrl);
    const asrTokensUrl = sanitizeText(asr.tokensUrl);
    const ttsModelUrl = sanitizeText(tts.modelUrl);
    const ttsVoicesUrl = sanitizeText(tts.voicesUrl);
    const ttsTokensUrl = sanitizeText(tts.tokensUrl);

    const hasAsr = Boolean(asrModelUrl || asrTokensUrl);
    const hasTts = Boolean(ttsModelUrl || ttsVoicesUrl || ttsTokensUrl);
    if (!hasAsr && !hasTts) {
      throw createVoiceModelError(
        'voice_model_download_invalid_input',
        'Please provide ASR or TTS download URLs.',
      );
    }

    if (hasAsr && (!asrModelUrl || !asrTokensUrl)) {
      throw createVoiceModelError(
        'voice_model_download_invalid_input',
        'ASR requires both model URL and tokens URL.',
      );
    }

    if (hasTts && (!ttsModelUrl || !ttsVoicesUrl || !ttsTokensUrl)) {
      throw createVoiceModelError(
        'voice_model_download_invalid_input',
        'TTS requires model/voices/tokens URLs.',
      );
    }

    const id = createBundleId(bundleName);
    const name = sanitizeOptionalText(bundleName, id);
    const bundleDir = path.join(this.bundlesDir, id);
    await fsp.mkdir(bundleDir, { recursive: true });

    const downloadTasks = [];
    if (hasAsr) {
      downloadTasks.push({
        key: 'asr.model',
        fileName: 'asr-model.onnx',
        destinationPath: path.join(bundleDir, 'asr-model.onnx'),
        url: asrModelUrl,
      });
      downloadTasks.push({
        key: 'asr.tokens',
        fileName: 'asr-tokens.txt',
        destinationPath: path.join(bundleDir, 'asr-tokens.txt'),
        url: asrTokensUrl,
      });
    }
    if (hasTts) {
      downloadTasks.push({
        key: 'tts.model',
        fileName: 'tts-model.onnx',
        destinationPath: path.join(bundleDir, 'tts-model.onnx'),
        url: ttsModelUrl,
      });
      downloadTasks.push({
        key: 'tts.voices',
        fileName: 'tts-voices.bin',
        destinationPath: path.join(bundleDir, 'tts-voices.bin'),
        url: ttsVoicesUrl,
      });
      downloadTasks.push({
        key: 'tts.tokens',
        fileName: 'tts-tokens.txt',
        destinationPath: path.join(bundleDir, 'tts-tokens.txt'),
        url: ttsTokensUrl,
      });
    }

    const taskProgressMap = new Map();
    const emitProgress = ({
      phase,
      currentTask,
      downloadedBytes,
      totalBytes,
      bytesPerSecond = 0,
      estimatedRemainingSeconds = null,
      completedTasks,
    }) => {
      if (typeof onProgress !== 'function') {
        return;
      }

      if (currentTask) {
        taskProgressMap.set(currentTask.key, {
          downloadedBytes,
          totalBytes,
        });
      }

      const totals = Array.from(taskProgressMap.values()).reduce(
        (acc, item) => {
          const hasTotal = Number.isFinite(item.totalBytes) && item.totalBytes > 0;
          if (hasTotal) {
            acc.knownTotalBytes += item.totalBytes;
            acc.knownDownloadedBytes += Math.min(item.downloadedBytes, item.totalBytes);
          }
          return acc;
        },
        {
          knownTotalBytes: 0,
          knownDownloadedBytes: 0,
        },
      );

      const overallProgress =
        phase === 'completed'
          ? 1
          : totals.knownTotalBytes > 0
            ? totals.knownDownloadedBytes / totals.knownTotalBytes
            : null;

      onProgress({
        type: 'download-progress',
        phase,
        bundleId: id,
        bundleName: name,
        completedTasks,
        totalTasks: downloadTasks.length,
        currentFile: currentTask?.fileName || '',
        fileDownloadedBytes: downloadedBytes || 0,
        fileTotalBytes: totalBytes || 0,
        downloadSpeedBytesPerSec: Number.isFinite(bytesPerSecond) ? bytesPerSecond : 0,
        estimatedRemainingSeconds:
          Number.isFinite(estimatedRemainingSeconds) && estimatedRemainingSeconds >= 0
            ? estimatedRemainingSeconds
            : null,
        overallProgress,
      });
    };

    emitProgress({
      phase: 'started',
      completedTasks: 0,
      currentTask: null,
      downloadedBytes: 0,
      totalBytes: 0,
    });

    let completedTasks = 0;
    try {
      for (const task of downloadTasks) {
        await this.downloadFileImpl({
          url: task.url,
          destinationPath: task.destinationPath,
          onProgress: ({ downloadedBytes, totalBytes, bytesPerSecond, estimatedRemainingSeconds }) => {
            emitProgress({
              phase: 'running',
              currentTask: task,
              downloadedBytes,
              totalBytes,
              bytesPerSecond,
              estimatedRemainingSeconds,
              completedTasks,
            });
          },
        });

        completedTasks += 1;
        emitProgress({
          phase: 'running',
          currentTask: null,
          downloadedBytes: 0,
          totalBytes: 0,
          completedTasks,
        });
      }
    } catch (error) {
      emitProgress({
        phase: 'failed',
        completedTasks,
        currentTask: null,
        downloadedBytes: 0,
        totalBytes: 0,
      });
      try {
        await fsp.rm(bundleDir, { recursive: true, force: true });
      } catch {
        // noop
      }
      throw error;
    }

    const bundleRecord = normalizeBundleRecord({
      id,
      name,
      createdAt: new Date().toISOString(),
      asr: hasAsr
        ? {
            modelPath: path.join(bundleDir, 'asr-model.onnx'),
            tokensPath: path.join(bundleDir, 'asr-tokens.txt'),
            modelKind: sanitizeOptionalText(asr.modelKind, 'zipformerctc'),
            executionProvider: sanitizeOptionalText(asr.executionProvider, 'cpu'),
          }
        : null,
      tts: hasTts
        ? {
            modelPath: path.join(bundleDir, 'tts-model.onnx'),
            voicesPath: path.join(bundleDir, 'tts-voices.bin'),
            tokensPath: path.join(bundleDir, 'tts-tokens.txt'),
            modelKind: sanitizeOptionalText(tts.modelKind, 'kokoro'),
            executionProvider: sanitizeOptionalText(tts.executionProvider, 'cpu'),
            sid: sanitizeOptionalText(tts.sid),
            speed: sanitizeOptionalText(tts.speed),
          }
        : null,
    });

    if (!bundleRecord) {
      throw createVoiceModelError('voice_model_bundle_invalid', 'Failed to build model bundle record.');
    }

    this.state.bundles = this.state.bundles.filter((item) => item.id !== bundleRecord.id);
    this.state.bundles.unshift(bundleRecord);
    this.selectInstalledBundleCapabilities(bundleRecord);
    await this.persistState();

    emitProgress({
      phase: 'completed',
      completedTasks: downloadTasks.length,
      currentTask: null,
      downloadedBytes: 0,
      totalBytes: 0,
    });

    return {
      bundle: bundleRecord,
      ...this.listBundles(),
    };
  }

  async persistState() {
    await fsp.mkdir(this.rootDir, { recursive: true });
    await fsp.writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }
}

module.exports = {
  VoiceModelLibrary,
  downloadFileFromUrl,
  createVoiceModelError,
};
