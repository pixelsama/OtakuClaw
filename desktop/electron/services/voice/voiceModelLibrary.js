const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { execFile, spawn } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');

const { getBuiltInVoiceModelCatalog } = require('./voiceModelCatalog');

const ROOT_DIR_NAME = 'voice-models';
const BUNDLES_DIR_NAME = 'bundles';
const STATE_FILE_NAME = 'state.json';
const MAX_REDIRECTS = 5;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const PYTHON_BRIDGE_SCRIPT_NAME = 'voice_bridge.py';
const PYTHON_BOOTSTRAP_SCRIPT_NAME = 'bootstrap_runtime.py';
const PYTHON_STEP_TIMEOUT_MS = 20 * 60 * 1000;
const PYTHON_MODEL_DOWNLOAD_TIMEOUT_MS = 120 * 60 * 1000;
const PYTHON_EXEC_MAX_BUFFER = 20 * 1024 * 1024;
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

    const pythonExecutablePath = sanitizeText(bundle.runtime.pythonExecutablePath);
    if (!pythonExecutablePath) {
      return null;
    }

    return {
      kind: runtimeKind,
      pythonExecutablePath,
      bridgeScriptPath: sanitizeText(bundle.runtime.bridgeScriptPath),
      bootstrapScriptPath: sanitizeText(bundle.runtime.bootstrapScriptPath),
      asrModelDir: sanitizeText(bundle.runtime.asrModelDir),
      ttsModelDir: sanitizeText(bundle.runtime.ttsModelDir),
      ttsTokenizerDir: sanitizeText(bundle.runtime.ttsTokenizerDir),
      asrLanguage: sanitizeOptionalText(bundle.runtime.asrLanguage, 'auto'),
      ttsLanguage: sanitizeOptionalText(bundle.runtime.ttsLanguage, 'Chinese'),
      ttsMode: sanitizeOptionalText(bundle.runtime.ttsMode, 'custom_voice'),
      ttsSpeaker: sanitizeOptionalText(bundle.runtime.ttsSpeaker, 'Vivian'),
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
    createdAt: sanitizeOptionalText(bundle.createdAt, new Date().toISOString()),
    asr,
    tts,
    runtime,
  };
}

function normalizeState(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const bundles = Array.isArray(source.bundles)
    ? source.bundles.map((item) => normalizeBundleRecord(item)).filter(Boolean)
    : [];
  const idSet = new Set(bundles.map((item) => item.id));
  const selectedBundleId = idSet.has(source.selectedBundleId) ? source.selectedBundleId : '';

  return {
    bundles,
    selectedBundleId,
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

function resolveRuntimePlatformKey() {
  return `${process.platform}-${process.arch}`;
}

function resolvePythonRuntimePackage(runtime = {}) {
  const packages = runtime?.packages && typeof runtime.packages === 'object' ? runtime.packages : {};
  const platformKey = resolveRuntimePlatformKey();
  const selected = packages[platformKey];
  if (!selected || typeof selected !== 'object') {
    throw createVoiceModelError(
      'voice_python_runtime_platform_unsupported',
      `No built-in Python runtime package for ${platformKey}.`,
    );
  }

  const archiveUrl = sanitizeText(selected.archiveUrl);
  if (!archiveUrl) {
    throw createVoiceModelError(
      'voice_python_runtime_catalog_invalid',
      `Missing Python runtime archive URL for ${platformKey}.`,
    );
  }

  return {
    platformKey,
    archiveUrl,
  };
}

function resolvePythonExecutableCandidates(runtimeRootDir) {
  if (process.platform === 'win32') {
    return [
      path.join(runtimeRootDir, 'python.exe'),
      path.join(runtimeRootDir, 'install', 'python.exe'),
      path.join(runtimeRootDir, 'python', 'python.exe'),
      path.join(runtimeRootDir, 'python', 'install', 'python.exe'),
    ];
  }

  return [
    path.join(runtimeRootDir, 'bin', 'python3'),
    path.join(runtimeRootDir, 'bin', 'python'),
    path.join(runtimeRootDir, 'python', 'bin', 'python3'),
    path.join(runtimeRootDir, 'python', 'bin', 'python'),
    path.join(runtimeRootDir, 'install', 'bin', 'python3'),
    path.join(runtimeRootDir, 'install', 'bin', 'python'),
    path.join(runtimeRootDir, 'python', 'install', 'bin', 'python3'),
    path.join(runtimeRootDir, 'python', 'install', 'bin', 'python'),
  ];
}

function resolvePythonExecutablePath(runtimeRootDir) {
  const candidates = resolvePythonExecutableCandidates(runtimeRootDir);
  const found = candidates.find((candidatePath) => fs.existsSync(candidatePath));
  if (!found) {
    throw createVoiceModelError(
      'voice_python_runtime_executable_missing',
      `Python executable not found under ${runtimeRootDir}.`,
    );
  }

  return found;
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

async function runPythonCommand(pythonExecutable, args, { timeoutMs = PYTHON_STEP_TIMEOUT_MS } = {}) {
  try {
    return await execFileAsync(pythonExecutable, args, {
      timeout: timeoutMs,
      maxBuffer: PYTHON_EXEC_MAX_BUFFER,
    });
  } catch (error) {
    const stderr = sanitizeText(stripAnsiCodes(error?.stderr));
    const stdout = sanitizeText(stripAnsiCodes(error?.stdout));
    const message = stderr || stdout || error?.message || 'Python command failed.';
    throw createVoiceModelError('voice_python_runtime_command_failed', message);
  }
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
  constructor(app, { downloadFileImpl = downloadFileFromUrl } = {}) {
    this.app = app;
    this.downloadFileImpl = downloadFileImpl;

    this.rootDir = path.join(this.app.getPath('userData'), ROOT_DIR_NAME);
    this.bundlesDir = path.join(this.rootDir, BUNDLES_DIR_NAME);
    this.stateFilePath = path.join(this.rootDir, STATE_FILE_NAME);
    this.state = normalizeState({});
  }

  async init() {
    await fsp.mkdir(this.bundlesDir, { recursive: true });

    try {
      const raw = await fsp.readFile(this.stateFilePath, 'utf-8');
      this.state = normalizeState(JSON.parse(raw));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to load voice model state:', error);
      }
      await this.persistState();
    }
  }

  listBundles() {
    return {
      rootDir: this.rootDir,
      selectedBundleId: this.state.selectedBundleId,
      bundles: this.state.bundles.map((bundle) => ({
        ...bundle,
      })),
    };
  }

  listCatalog() {
    return getBuiltInVoiceModelCatalog().map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description || '',
      hasAsr: typeof item.hasAsr === 'boolean' ? item.hasAsr : Boolean(item.asr),
      hasTts: typeof item.hasTts === 'boolean' ? item.hasTts : Boolean(item.tts),
    }));
  }

  async installCatalogBundle({ catalogId } = {}, { onProgress } = {}) {
    const normalizedCatalogId = sanitizeText(catalogId);
    const catalogEntry = getBuiltInVoiceModelCatalog().find((item) => item.id === normalizedCatalogId);
    if (!catalogEntry) {
      throw createVoiceModelError('voice_model_catalog_not_found', `Built-in model not found: ${normalizedCatalogId}`);
    }

    if (catalogEntry.runtime?.kind === 'python') {
      return this.installPythonRuntimeCatalogBundle({
        catalogEntry,
        onProgress,
      });
    }

    const id = createBundleId(catalogEntry.name);
    const name = catalogEntry.name;
    const bundleDir = path.join(this.bundlesDir, id);
    await fsp.mkdir(bundleDir, { recursive: true });

    const components = [];
    if (catalogEntry.asr) {
      components.push({
        key: 'asr',
        label: 'ASR',
        archiveUrl: catalogEntry.asr.archiveUrl,
        extractedDir: catalogEntry.asr.extractedDir,
      });
    }
    if (catalogEntry.tts) {
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

    const asrModelPath = catalogEntry.asr
      ? path.join(bundleDir, 'asr', catalogEntry.asr.extractedDir, catalogEntry.asr.modelRelativePath)
      : '';
    const asrTokensPath = catalogEntry.asr
      ? path.join(bundleDir, 'asr', catalogEntry.asr.extractedDir, catalogEntry.asr.tokensRelativePath)
      : '';
    const ttsModelPath = catalogEntry.tts
      ? path.join(bundleDir, 'tts', catalogEntry.tts.extractedDir, catalogEntry.tts.modelRelativePath)
      : '';
    const ttsVoicesPath = catalogEntry.tts
      ? path.join(bundleDir, 'tts', catalogEntry.tts.extractedDir, catalogEntry.tts.voicesRelativePath)
      : '';
    const ttsTokensPath = catalogEntry.tts
      ? path.join(bundleDir, 'tts', catalogEntry.tts.extractedDir, catalogEntry.tts.tokensRelativePath)
      : '';
    const ttsDataDirPath = catalogEntry.tts?.dataDirRelativePath
      ? path.join(bundleDir, 'tts', catalogEntry.tts.extractedDir, catalogEntry.tts.dataDirRelativePath)
      : '';
    const ttsLexiconPath = catalogEntry.tts?.lexiconRelativePath
      ? path.join(bundleDir, 'tts', catalogEntry.tts.extractedDir, catalogEntry.tts.lexiconRelativePath)
      : '';

    if (catalogEntry.asr) {
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
    if (catalogEntry.tts) {
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
      createdAt: new Date().toISOString(),
      asr: catalogEntry.asr
        ? {
            modelPath: asrModelPath,
            tokensPath: asrTokensPath,
            modelKind: sanitizeOptionalText(catalogEntry.asr.modelKind, 'zipformer2ctc'),
            executionProvider: resolveCatalogExecutionProvider(catalogEntry.asr.executionProvider, 'cpu'),
          }
        : null,
      tts: catalogEntry.tts
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
    this.state.selectedBundleId = bundleRecord.id;
    await this.persistState();

    emitProgress({
      phase: 'completed',
      currentFile: '',
      overallProgress: 1,
    });

    return {
      bundle: bundleRecord,
      selectedBundleId: this.state.selectedBundleId,
      bundles: this.state.bundles.map((item) => ({ ...item })),
    };
  }

  async installPythonRuntimeCatalogBundle({ catalogEntry, onProgress }) {
    const runtime = catalogEntry?.runtime && typeof catalogEntry.runtime === 'object'
      ? catalogEntry.runtime
      : {};
    const { archiveUrl } = resolvePythonRuntimePackage(runtime);

    const id = createBundleId(catalogEntry.name);
    const name = catalogEntry.name;
    const bundleDir = path.join(this.bundlesDir, id);
    const runtimeDir = path.join(bundleDir, 'runtime');
    const scriptDir = path.join(bundleDir, 'runtime-scripts');
    const modelsDir = path.join(bundleDir, 'models');
    const asrModelDir = path.join(modelsDir, 'asr');
    const ttsModelDir = path.join(modelsDir, 'tts');
    const ttsTokenizerDir = path.join(modelsDir, 'tts-tokenizer');
    const runtimeArchivePath = path.join(bundleDir, 'python-runtime.tar.gz');
    const pipPackages = Array.isArray(runtime.pipPackages)
      ? runtime.pipPackages.map((item) => sanitizeText(item)).filter(Boolean)
      : [];

    await fsp.mkdir(bundleDir, { recursive: true });
    await fsp.mkdir(modelsDir, { recursive: true });

    const totalTasks = 3 + (pipPackages.length ? 2 : 1);
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
      await this.downloadFileImpl({
        url: archiveUrl,
        destinationPath: runtimeArchivePath,
        onProgress: ({ downloadedBytes, totalBytes, bytesPerSecond, estimatedRemainingSeconds }) => {
          const downloadRatio =
            Number.isFinite(totalBytes) && totalBytes > 0 ? Math.min(1, downloadedBytes / totalBytes) : 0;
          const progress = (completedTasks + downloadRatio) / totalTasks;
          emitProgress({
            phase: 'running',
            currentFile: path.basename(archiveUrl),
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
        currentFile: '已下载 Python 运行时',
        overallProgress: completedTasks / totalTasks,
      });

      emitProgress({
        phase: 'extracting',
        currentFile: '正在解压 Python 运行时',
        overallProgress: (completedTasks + 0.5) / totalTasks,
      });
      await extractTarArchive({
        archivePath: runtimeArchivePath,
        destinationDir: runtimeDir,
      });
      await fsp.rm(runtimeArchivePath, { force: true });
      completedTasks += 1;
      emitProgress({
        phase: 'running',
        currentFile: '已解压 Python 运行时',
        overallProgress: completedTasks / totalTasks,
      });

      const pythonExecutablePath = resolvePythonExecutablePath(runtimeDir);
      const { bridgeScriptPath, bootstrapScriptPath } = await copyPythonBridgeScripts({
        destinationDir: scriptDir,
      });

      emitProgress({
        phase: 'running',
        currentFile: '正在升级 Python pip',
        overallProgress: (completedTasks + 0.5) / totalTasks,
      });
      await runPythonCommand(
        pythonExecutablePath,
        ['-m', 'pip', 'install', '--upgrade', 'pip'],
        { timeoutMs: PYTHON_STEP_TIMEOUT_MS },
      );
      completedTasks += 1;
      emitProgress({
        phase: 'running',
        currentFile: 'pip 升级完成',
        overallProgress: completedTasks / totalTasks,
      });

      if (pipPackages.length) {
        emitProgress({
          phase: 'running',
          currentFile: '正在安装 Python 语音依赖',
          overallProgress: (completedTasks + 0.5) / totalTasks,
        });
        await runPythonCommand(
          pythonExecutablePath,
          ['-m', 'pip', 'install', '--upgrade', ...pipPackages],
          { timeoutMs: PYTHON_STEP_TIMEOUT_MS },
        );
        completedTasks += 1;
        emitProgress({
          phase: 'running',
          currentFile: 'Python 语音依赖安装完成',
          overallProgress: completedTasks / totalTasks,
        });
      }

      emitProgress({
        phase: 'running',
        currentFile: '正在下载 ASR/TTS 模型',
        overallProgress: (completedTasks + 0.5) / totalTasks,
      });

      const bootstrapArgs = [
        bootstrapScriptPath,
        '--asr-model-id',
        sanitizeOptionalText(runtime.asrModelId, 'FunAudioLLM/SenseVoiceSmall'),
        '--tts-model-id',
        sanitizeOptionalText(runtime.ttsModelId, 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice'),
        '--asr-model-dir',
        asrModelDir,
        '--tts-model-dir',
        ttsModelDir,
        '--source',
        sanitizeOptionalText(runtime.modelSource, 'auto'),
      ];
      const ttsTokenizerModelId = sanitizeText(runtime.ttsTokenizerModelId);
      if (ttsTokenizerModelId) {
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
          currentFile: '正在下载 ASR/TTS 模型',
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
        pythonExecutablePath,
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

      const resolvedAsrModelDir = sanitizeOptionalText(bootstrapPayload.asrModelDir, asrModelDir);
      const resolvedTtsModelDir = sanitizeOptionalText(bootstrapPayload.ttsModelDir, ttsModelDir);
      const resolvedTtsTokenizerDir = sanitizeOptionalText(bootstrapPayload.ttsTokenizerDir, ttsTokenizerDir);

      await ensurePathExists(
        resolvedAsrModelDir,
        'voice_python_runtime_model_missing',
        `ASR model directory not found: ${resolvedAsrModelDir}`,
      );
      await ensurePathExists(
        resolvedTtsModelDir,
        'voice_python_runtime_model_missing',
        `TTS model directory not found: ${resolvedTtsModelDir}`,
      );
      if (ttsTokenizerModelId) {
        await ensurePathExists(
          resolvedTtsTokenizerDir,
          'voice_python_runtime_model_missing',
          `TTS tokenizer directory not found: ${resolvedTtsTokenizerDir}`,
        );
      }

      completedTasks += 1;
      emitProgress({
        phase: 'running',
        currentFile: 'ASR/TTS 模型下载完成',
        overallProgress: completedTasks / totalTasks,
      });

      const bundleRecord = normalizeBundleRecord({
        id,
        name,
        createdAt: new Date().toISOString(),
        runtime: {
          kind: 'python',
          pythonExecutablePath,
          bridgeScriptPath,
          bootstrapScriptPath,
          asrModelDir: resolvedAsrModelDir,
          ttsModelDir: resolvedTtsModelDir,
          ttsTokenizerDir: resolvedTtsTokenizerDir,
          asrLanguage: sanitizeOptionalText(runtime.asrLanguage, 'auto'),
          ttsLanguage: sanitizeOptionalText(runtime.ttsLanguage, 'Chinese'),
          ttsMode: sanitizeOptionalText(runtime.ttsMode, 'custom_voice'),
          ttsSpeaker: sanitizeOptionalText(runtime.ttsSpeaker, 'Vivian'),
          modelSource: sanitizeOptionalText(runtime.modelSource, 'auto'),
          device: sanitizeOptionalText(runtime.device, 'auto'),
        },
      });

      if (!bundleRecord) {
        throw createVoiceModelError('voice_model_bundle_invalid', 'Failed to build Python runtime bundle.');
      }

      this.state.bundles = this.state.bundles.filter((item) => item.id !== bundleRecord.id);
      this.state.bundles.unshift(bundleRecord);
      this.state.selectedBundleId = bundleRecord.id;
      await this.persistState();

      emitProgress({
        phase: 'completed',
        currentFile: '',
        overallProgress: 1,
      });

      return {
        bundle: bundleRecord,
        selectedBundleId: this.state.selectedBundleId,
        bundles: this.state.bundles.map((item) => ({ ...item })),
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

  getSelectedBundle() {
    if (!this.state.selectedBundleId) {
      return null;
    }

    return this.state.bundles.find((item) => item.id === this.state.selectedBundleId) || null;
  }

  selectBundle(bundleId) {
    const nextBundleId = sanitizeText(bundleId);
    if (!nextBundleId) {
      this.state.selectedBundleId = '';
      return this.persistState();
    }

    const found = this.state.bundles.some((item) => item.id === nextBundleId);
    if (!found) {
      throw createVoiceModelError('voice_model_bundle_not_found', `Model bundle not found: ${nextBundleId}`);
    }

    this.state.selectedBundleId = nextBundleId;
    return this.persistState();
  }

  getRuntimeEnv(baseEnv = process.env) {
    const env = {
      ...(baseEnv || {}),
    };

    const selectedBundle = this.getSelectedBundle();
    if (!selectedBundle) {
      return env;
    }

    if (selectedBundle.runtime?.kind === 'python') {
      const runtime = selectedBundle.runtime;
      env.VOICE_ASR_PROVIDER = 'python';
      env.VOICE_TTS_PROVIDER = 'python';
      env.VOICE_PYTHON_EXECUTABLE = runtime.pythonExecutablePath;
      if (runtime.bridgeScriptPath) {
        env.VOICE_PYTHON_BRIDGE_SCRIPT = runtime.bridgeScriptPath;
      }
      if (runtime.device) {
        env.VOICE_PYTHON_DEVICE = runtime.device;
      }

      if (runtime.asrModelDir) {
        env.VOICE_ASR_PYTHON_MODEL_DIR = runtime.asrModelDir;
      }
      if (runtime.asrLanguage) {
        env.VOICE_ASR_PYTHON_LANGUAGE = runtime.asrLanguage;
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

      return env;
    }

    if (selectedBundle.asr) {
      env.VOICE_ASR_PROVIDER = 'sherpa-onnx';
      env.VOICE_ASR_SHERPA_MODEL = selectedBundle.asr.modelPath;
      env.VOICE_ASR_SHERPA_TOKENS = selectedBundle.asr.tokensPath;
      env.VOICE_ASR_SHERPA_MODEL_KIND = selectedBundle.asr.modelKind;
      env.VOICE_ASR_SHERPA_EXECUTION_PROVIDER = selectedBundle.asr.executionProvider;
    }

    if (selectedBundle.tts) {
      const runtimeTts = resolveRuntimeTtsBundle(selectedBundle.tts);
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
    this.state.selectedBundleId = bundleRecord.id;
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
      selectedBundleId: this.state.selectedBundleId,
      bundles: this.state.bundles.map((item) => ({ ...item })),
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
