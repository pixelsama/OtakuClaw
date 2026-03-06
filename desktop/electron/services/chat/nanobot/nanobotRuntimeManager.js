const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');

const { PythonRuntimeManager } = require('../../python/pythonRuntimeManager');
const { PythonEnvManager } = require('../../python/pythonEnvManager');
const { getDefaultPythonVersion } = require('../../python/pythonRuntimeCatalog');

const execFileAsync = promisify(execFile);

const NANOBOT_RUNTIME_ROOT_DIR = 'nanobot-runtime';
const NANOBOT_RUNTIME_DOWNLOADS_DIR = 'downloads';
const NANOBOT_RUNTIME_STAGE_DIR = 'stage';
const NANOBOT_RUNTIME_REPO_DIR = 'repo';
const NANOBOT_RUNTIME_STATE_FILE = 'state.json';
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const EXEC_MAX_BUFFER = 20 * 1024 * 1024;
const DEFAULT_NANOBOT_ARCHIVE_URL = 'https://codeload.github.com/HKUDS/nanobot/tar.gz/refs/heads/main';

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function createRuntimeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isTruthyEnv(value) {
  const normalized = sanitizeText(value).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function resolveDefaultPythonBin() {
  return process.platform === 'win32' ? 'python' : 'python3';
}

function pathLooksLikeVoiceBundlePython(pythonExecutable) {
  const normalized = sanitizeText(pythonExecutable);
  if (!normalized) {
    return false;
  }

  return normalized.includes(`${path.sep}voice-models${path.sep}`) && normalized.includes(`${path.sep}bundles${path.sep}`);
}

function resolveHttpModule(protocol) {
  if (protocol === 'http:') {
    return http;
  }
  if (protocol === 'https:') {
    return https;
  }

  throw createRuntimeError('nanobot_runtime_download_failed', `Unsupported protocol: ${protocol}`);
}

function requestWithRedirect(urlString, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch {
      reject(createRuntimeError('nanobot_runtime_download_failed', `Invalid URL: ${urlString}`));
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
          'user-agent': 'free-agent-vtuber-openclaw/nanobot-runtime-downloader',
        },
        timeout: DOWNLOAD_TIMEOUT_MS,
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const redirectLocation = response.headers.location;
        if (redirectLocation && statusCode >= 300 && statusCode < 400) {
          response.resume();
          if (redirectsLeft <= 0) {
            reject(
              createRuntimeError(
                'nanobot_runtime_download_failed',
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
            createRuntimeError(
              'nanobot_runtime_download_failed',
              `Download failed (${statusCode}) for ${urlString}`,
            ),
          );
          return;
        }

        resolve(response);
      },
    );

    request.on('timeout', () => {
      request.destroy(
        createRuntimeError(
          'nanobot_runtime_download_failed',
          `Download timeout for ${urlString}`,
        ),
      );
    });

    request.on('error', (error) => {
      reject(
        createRuntimeError(
          'nanobot_runtime_download_failed',
          error?.message || 'Failed to download Nanobot runtime.',
        ),
      );
    });
  });
}

async function downloadFileFromUrl({ url, destinationPath, onProgress }) {
  const response = await requestWithRedirect(url, MAX_REDIRECTS);
  const totalBytes = Number.parseInt(response.headers['content-length'], 10);
  const hasTotalBytes = Number.isFinite(totalBytes) && totalBytes > 0;
  const expectedTotalBytes = hasTotalBytes ? totalBytes : 0;

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
        expectedTotalBytes > 0 && bytesPerSecond > 0
          ? Math.max(0, (expectedTotalBytes - downloadedBytes) / bytesPerSecond)
          : null;
      onProgress({
        downloadedBytes,
        totalBytes: expectedTotalBytes,
        bytesPerSecond,
        estimatedRemainingSeconds,
      });
    }
  });

  try {
    await pipeline(response, writeStream);
    await fsp.rename(tempPath, destinationPath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw createRuntimeError(
      'nanobot_runtime_download_failed',
      error?.message || 'Failed to persist Nanobot runtime package.',
    );
  }
}

async function extractTarArchive({ archivePath, destinationDir }) {
  await fsp.mkdir(destinationDir, { recursive: true });
  try {
    await execFileAsync('tar', ['-xf', archivePath, '-C', destinationDir]);
  } catch (error) {
    throw createRuntimeError(
      'nanobot_runtime_install_failed',
      error?.code === 'ENOENT'
        ? 'Missing tar command. Please install tar first.'
        : `Failed to extract Nanobot archive: ${error?.message || 'unknown error'}`,
    );
  }
}

async function runCommand(executable, args, { cwd } = {}) {
  try {
    await execFileAsync(executable, args, {
      cwd,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: EXEC_MAX_BUFFER,
    });
  } catch (error) {
    const stderr = sanitizeText(error?.stderr);
    const stdout = sanitizeText(error?.stdout);
    const detail = stderr || stdout || error?.message || 'unknown error';
    throw createRuntimeError('nanobot_runtime_install_failed', detail);
  }
}

class NanobotRuntimeManager {
  constructor(
    app,
    {
      env = process.env,
      pythonRuntimeManager = null,
      pythonEnvManager = null,
      downloadFileImpl = downloadFileFromUrl,
      extractArchiveImpl = extractTarArchive,
      runCommandImpl = runCommand,
    } = {},
  ) {
    this.app = app;
    this.env = env;
    this.pythonRuntimeManager =
      pythonRuntimeManager instanceof PythonRuntimeManager
        ? pythonRuntimeManager
        : (pythonRuntimeManager || new PythonRuntimeManager(app));
    this.pythonEnvManager =
      pythonEnvManager instanceof PythonEnvManager
        ? pythonEnvManager
        : (pythonEnvManager || new PythonEnvManager(app, { pythonRuntimeManager: this.pythonRuntimeManager }));
    this.downloadFileImpl = downloadFileImpl;
    this.extractArchiveImpl = extractArchiveImpl;
    this.runCommandImpl = runCommandImpl;

    this.rootDir = path.join(this.app.getPath('userData'), NANOBOT_RUNTIME_ROOT_DIR);
    this.downloadsDir = path.join(this.rootDir, NANOBOT_RUNTIME_DOWNLOADS_DIR);
    this.stageDir = path.join(this.rootDir, NANOBOT_RUNTIME_STAGE_DIR);
    this.repoDir = path.join(this.rootDir, NANOBOT_RUNTIME_REPO_DIR);
    this.stateFilePath = path.join(this.rootDir, NANOBOT_RUNTIME_STATE_FILE);

    this.state = {
      repoPath: '',
      pythonEnvId: '',
      pythonExecutable: '',
      source: '',
      installedAt: '',
    };
    this.installPromise = null;
  }

  async init() {
    await this.pythonRuntimeManager.init();
    await this.pythonEnvManager.init();
    await fsp.mkdir(this.rootDir, { recursive: true });

    try {
      const raw = await fsp.readFile(this.stateFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const pythonExecutable = sanitizeText(parsed?.pythonExecutable);
      const pythonEnvId = sanitizeText(parsed?.pythonEnvId);
      const shouldClearLegacyBundlePath =
        pythonExecutable
        && pathLooksLikeVoiceBundlePython(pythonExecutable)
        && !fs.existsSync(pythonExecutable);
      this.state = {
        repoPath: sanitizeText(parsed?.repoPath),
        pythonEnvId,
        pythonExecutable: shouldClearLegacyBundlePath ? '' : pythonExecutable,
        source: sanitizeText(parsed?.source),
        installedAt: sanitizeText(parsed?.installedAt),
      };
      if (shouldClearLegacyBundlePath) {
        await this.persistState();
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to load nanobot runtime state:', error);
      }
      await this.persistState();
    }
  }

  async persistState() {
    await fsp.mkdir(path.dirname(this.stateFilePath), { recursive: true });
    await fsp.writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  resolveArchiveUrl() {
    return (
      sanitizeText(this.env.NANOBOT_RUNTIME_ARCHIVE_URL)
      || sanitizeText(this.env.NANOBOT_DOWNLOAD_URL)
      || DEFAULT_NANOBOT_ARCHIVE_URL
    );
  }

  resolveInstalledRepoPath() {
    const pyprojectPath = path.join(this.repoDir, 'pyproject.toml');
    const packageDir = path.join(this.repoDir, 'nanobot');
    if (fs.existsSync(this.repoDir) && fs.existsSync(pyprojectPath) && fs.existsSync(packageDir)) {
      return {
        path: this.repoDir,
        source: 'downloaded',
      };
    }
    return null;
  }

  resolveRepoPath() {
    return this.resolveInstalledRepoPath() || null;
  }

  resolvePythonExecutable({ allowDefault = true } = {}) {
    const configured = sanitizeText(this.env.NANOBOT_PYTHON_BIN);
    if (configured) {
      return configured;
    }

    const envRecord = this.pythonEnvManager.getEnvById(this.state.pythonEnvId);
    if (envRecord?.envPythonExecutable) {
      return envRecord.envPythonExecutable;
    }

    const fromState = sanitizeText(this.state.pythonExecutable);
    if (fromState && fs.existsSync(fromState)) {
      return fromState;
    }

    return allowDefault ? resolveDefaultPythonBin() : '';
  }

  getStatus() {
    const repo = this.resolveRepoPath();
    const pythonExecutable = this.resolvePythonExecutable();

    return {
      ok: true,
      installed: Boolean(repo?.path),
      repoPath: repo?.path || '',
      source: repo?.source || '',
      pythonEnvId: sanitizeText(this.state.pythonEnvId),
      pythonExecutable,
      archiveUrl: this.resolveArchiveUrl(),
      managedByApp: repo?.source === 'downloaded',
      installing: Boolean(this.installPromise),
    };
  }

  resolveLaunchConfig() {
    const status = {
      ...this.getStatus(),
      pythonExecutable: this.resolvePythonExecutable({ allowDefault: false }),
    };
    if (!status.installed || !status.repoPath) {
      throw createRuntimeError(
        'nanobot_runtime_not_ready',
        'Nanobot 运行时未安装，请在设置里先下载 Nanobot 运行时。',
      );
    }
    if (!sanitizeText(status.pythonExecutable)) {
      throw createRuntimeError(
        'nanobot_runtime_not_ready',
        'Nanobot Python env 未准备好，请重新安装 Nanobot 运行时。',
      );
    }

    return {
      pythonBin: status.pythonExecutable,
      nanobotRepoPath: status.repoPath,
    };
  }

  async verifyPythonExecutable(pythonExecutable) {
    await this.runCommandImpl(pythonExecutable, ['--version']);
  }

  async findExtractedRepoPath(stageDir) {
    const entries = await fsp.readdir(stageDir, { withFileTypes: true });
    const candidates = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(stageDir, entry.name));

    if (candidates.length === 0) {
      return '';
    }

    for (const candidate of candidates) {
      const pyprojectPath = path.join(candidate, 'pyproject.toml');
      const packageDir = path.join(candidate, 'nanobot');
      if (fs.existsSync(pyprojectPath) && fs.existsSync(packageDir)) {
        return candidate;
      }
    }

    return candidates[0];
  }

  async installRuntime({ force = false, onProgress } = {}) {
    if (this.installPromise) {
      return this.installPromise;
    }

    this.installPromise = this.installRuntimeInternal({ force, onProgress }).finally(() => {
      this.installPromise = null;
    });
    return this.installPromise;
  }

  async installRuntimeInternal({ force = false, onProgress } = {}) {
    const emitProgress = (payload = {}) => {
      if (typeof onProgress !== 'function') {
        return;
      }
      try {
        onProgress(payload);
      } catch (error) {
        console.warn('nanobot runtime progress emit failed:', error);
      }
    };

    const existingStatus = this.getStatus();
    if (
      existingStatus.installed
      && existingStatus.managedByApp
      && sanitizeText(this.resolvePythonExecutable({ allowDefault: false }))
      && !force
    ) {
      return existingStatus;
    }

    const useExternalPython = Boolean(sanitizeText(this.env.NANOBOT_PYTHON_BIN));
    const totalTasks = useExternalPython ? 4 : 5;
    emitProgress({
      phase: 'started',
      completedTasks: 0,
      totalTasks,
      currentFile: '',
      overallProgress: 0,
    });

    let pythonExecutable = '';
    let pythonEnvId = '';
    if (useExternalPython) {
      pythonExecutable = this.resolvePythonExecutable();
      await this.verifyPythonExecutable(pythonExecutable);
    } else {
      const pythonVersion =
        sanitizeText(this.env.NANOBOT_PYTHON_VERSION)
        || getDefaultPythonVersion();
      const envProfile = sanitizeText(this.env.NANOBOT_PYTHON_ENV_PROFILE) || 'nanobot-default';
      const envRecord = await this.pythonEnvManager.ensureEnv({
        profile: envProfile,
        pythonVersion,
        pipPackages: [],
        onProgress: (payload = {}) => {
          emitProgress({
            phase: payload.phase || 'running',
            completedTasks: 0,
            totalTasks,
            currentFile: payload.currentFile || '正在准备共享 Python 运行时',
            overallProgress:
              typeof payload.overallProgress === 'number'
                ? Math.min(1 / totalTasks, payload.overallProgress / totalTasks)
                : 0,
          });
        },
      });
      pythonExecutable = envRecord.envPythonExecutable;
      pythonEnvId = envRecord.envId;
      await this.verifyPythonExecutable(pythonExecutable);
      emitProgress({
        phase: 'running',
        completedTasks: 1,
        totalTasks,
        currentFile: '共享 Python 运行时和 env 已准备完成',
        overallProgress: 1 / totalTasks,
      });
    }

    const archiveUrl = this.resolveArchiveUrl();
    const installId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const archivePath = path.join(this.downloadsDir, `nanobot-${installId}.tar.gz`);
    const stagePath = path.join(this.stageDir, installId);

    await fsp.mkdir(this.downloadsDir, { recursive: true });
    await fsp.mkdir(this.stageDir, { recursive: true });

    try {
      emitProgress({
        phase: 'running',
        completedTasks: useExternalPython ? 0 : 1,
        totalTasks,
        currentFile: path.basename(archiveUrl),
        overallProgress: useExternalPython ? 0 : 1 / totalTasks,
      });
      await this.downloadFileImpl({
        url: archiveUrl,
        destinationPath: archivePath,
        onProgress: ({ downloadedBytes, totalBytes, bytesPerSecond, estimatedRemainingSeconds }) => {
          const ratio = totalBytes > 0 ? Math.min(1, downloadedBytes / totalBytes) : 0;
          const baseTasks = useExternalPython ? 0 : 1;
          emitProgress({
            phase: 'running',
            completedTasks: baseTasks,
            totalTasks,
            currentFile: path.basename(archiveUrl),
            overallProgress: (baseTasks + ratio) / totalTasks,
            fileDownloadedBytes: downloadedBytes,
            fileTotalBytes: totalBytes,
            downloadSpeedBytesPerSec: bytesPerSecond,
            estimatedRemainingSeconds,
          });
        },
      });

      emitProgress({
        phase: 'extracting',
        completedTasks: useExternalPython ? 1 : 2,
        totalTasks,
        currentFile: path.basename(archivePath),
        overallProgress: (useExternalPython ? 1 : 2) / totalTasks,
      });
      await fsp.rm(stagePath, { recursive: true, force: true });
      await fsp.mkdir(stagePath, { recursive: true });
      await this.extractArchiveImpl({
        archivePath,
        destinationDir: stagePath,
      });

      const extractedRepoPath = await this.findExtractedRepoPath(stagePath);
      if (!extractedRepoPath) {
        throw createRuntimeError('nanobot_runtime_install_failed', 'Downloaded Nanobot archive is empty.');
      }

      emitProgress({
        phase: 'running',
        completedTasks: useExternalPython ? 2 : 3,
        totalTasks,
        currentFile: 'moving runtime files',
        overallProgress: (useExternalPython ? 2 : 3) / totalTasks,
      });
      await fsp.rm(this.repoDir, { recursive: true, force: true });
      await fsp.rename(extractedRepoPath, this.repoDir);
      await fsp.rm(stagePath, { recursive: true, force: true }).catch(() => {});

      emitProgress({
        phase: 'installing',
        completedTasks: useExternalPython ? 3 : 4,
        totalTasks,
        currentFile: 'pip install -e nanobot',
        overallProgress: (useExternalPython ? 3 : 4) / totalTasks,
      });
      await this.runCommandImpl(
        pythonExecutable,
        ['-m', 'pip', 'install', '--upgrade', '-e', this.repoDir],
        { cwd: this.repoDir },
      );

      this.state = {
        repoPath: this.repoDir,
        pythonEnvId,
        pythonExecutable: useExternalPython ? pythonExecutable : '',
        source: 'downloaded',
        installedAt: new Date().toISOString(),
      };
      await this.persistState();

      emitProgress({
        phase: 'completed',
        completedTasks: totalTasks,
        totalTasks,
        currentFile: '',
        overallProgress: 1,
      });
    } catch (error) {
      emitProgress({
        phase: 'failed',
        completedTasks: 0,
        totalTasks,
        currentFile: '',
        overallProgress: 0,
        error: {
          code: error?.code || 'nanobot_runtime_install_failed',
          message: error?.message || 'Nanobot runtime install failed.',
        },
      });
      throw error;
    } finally {
      if (!isTruthyEnv(this.env.NANOBOT_KEEP_ARCHIVE)) {
        await fsp.rm(archivePath, { force: true }).catch(() => {});
      }
      await fsp.rm(stagePath, { recursive: true, force: true }).catch(() => {});
    }

    return this.getStatus();
  }
}

module.exports = {
  NanobotRuntimeManager,
  createRuntimeError,
  downloadFileFromUrl,
  extractTarArchive,
};
