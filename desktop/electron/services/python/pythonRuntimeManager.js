const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');

const {
  getDefaultPythonVersion,
  resolvePythonRuntimePackage,
} = require('./pythonRuntimeCatalog');

const execFileAsync = promisify(execFile);

const PYTHON_RUNTIME_ROOT_DIR = 'python-runtime';
const PYTHON_RUNTIME_INSTALL_DIR = 'python';
const PYTHON_RUNTIME_DOWNLOADS_DIR = 'downloads';
const PYTHON_RUNTIME_STAGE_DIR = 'stage';
const PYTHON_RUNTIME_STATE_FILE = 'state.json';
const MAX_REDIRECTS = 5;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const COMMAND_TIMEOUT_MS = 20 * 60 * 1000;
const EXEC_MAX_BUFFER = 20 * 1024 * 1024;

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function createPythonRuntimeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveHttpModule(protocol) {
  if (protocol === 'http:') {
    return http;
  }
  if (protocol === 'https:') {
    return https;
  }

  throw createPythonRuntimeError('python_runtime_download_protocol_unsupported', `Unsupported protocol: ${protocol}`);
}

function requestWithRedirect(urlString, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch {
      reject(createPythonRuntimeError('python_runtime_download_invalid_url', `Invalid URL: ${urlString}`));
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
          'user-agent': 'free-agent-vtuber-openclaw/python-runtime-downloader',
        },
        timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const redirectLocation = response.headers.location;
        if (redirectLocation && statusCode >= 300 && statusCode < 400) {
          response.resume();
          if (redirectsLeft <= 0) {
            reject(
              createPythonRuntimeError(
                'python_runtime_download_redirect_overflow',
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
            createPythonRuntimeError(
              'python_runtime_download_http_error',
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
        createPythonRuntimeError(
          'python_runtime_download_timeout',
          `Download timeout for ${urlString}`,
        ),
      );
    });

    request.on('error', (error) => {
      reject(
        createPythonRuntimeError(
          'python_runtime_download_failed',
          error?.message || 'Failed to download Python runtime.',
        ),
      );
    });
  });
}

async function downloadFileFromUrl({ url, destinationPath, onProgress }) {
  const response = await requestWithRedirect(url, MAX_REDIRECTS);
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
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw createPythonRuntimeError(
      'python_runtime_download_failed',
      error?.message || 'Failed to persist Python runtime package.',
    );
  }
}

async function extractTarArchive({ archivePath, destinationDir }) {
  await fsp.mkdir(destinationDir, { recursive: true });

  try {
    await execFileAsync('tar', ['-xf', archivePath, '-C', destinationDir]);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw createPythonRuntimeError(
        'python_runtime_extract_tool_missing',
        'Missing tar command. Please install tar first.',
      );
    }

    throw createPythonRuntimeError(
      'python_runtime_extract_failed',
      `Failed to extract Python runtime: ${error?.message || 'unknown error'}`,
    );
  }
}

async function runCommand(executable, args) {
  try {
    await execFileAsync(executable, args, {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: EXEC_MAX_BUFFER,
    });
  } catch (error) {
    const stderr = sanitizeText(error?.stderr);
    const stdout = sanitizeText(error?.stdout);
    const message = stderr || stdout || error?.message || 'Python runtime command failed.';
    throw createPythonRuntimeError('python_runtime_command_failed', message);
  }
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
  const found = resolvePythonExecutableCandidates(runtimeRootDir).find((candidatePath) => fs.existsSync(candidatePath));
  if (!found) {
    throw createPythonRuntimeError(
      'python_runtime_executable_missing',
      `Python executable not found under ${runtimeRootDir}.`,
    );
  }

  return found;
}

class PythonRuntimeManager {
  constructor(
    app,
    {
      downloadFileImpl = downloadFileFromUrl,
      extractArchiveImpl = extractTarArchive,
      runCommandImpl = runCommand,
    } = {},
  ) {
    this.app = app;
    this.downloadFileImpl = downloadFileImpl;
    this.extractArchiveImpl = extractArchiveImpl;
    this.runCommandImpl = runCommandImpl;

    this.rootDir = path.join(this.app.getPath('userData'), PYTHON_RUNTIME_ROOT_DIR);
    this.installDir = path.join(this.rootDir, PYTHON_RUNTIME_INSTALL_DIR);
    this.downloadsDir = path.join(this.rootDir, PYTHON_RUNTIME_DOWNLOADS_DIR);
    this.stageDir = path.join(this.rootDir, PYTHON_RUNTIME_STAGE_DIR);
    this.stateFilePath = path.join(this.rootDir, PYTHON_RUNTIME_STATE_FILE);

    this.state = {
      installed: false,
      pythonExecutable: '',
      pythonVersion: '',
      archiveUrl: '',
      installedAt: '',
    };
    this.initialized = false;
    this.ensurePromise = null;
  }

  async init() {
    if (this.initialized) {
      return;
    }

    await fsp.mkdir(this.rootDir, { recursive: true });
    await fsp.mkdir(this.downloadsDir, { recursive: true });
    await fsp.mkdir(this.stageDir, { recursive: true });

    try {
      const raw = await fsp.readFile(this.stateFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const pythonExecutable = sanitizeText(parsed?.pythonExecutable);
      this.state = {
        installed: Boolean(parsed?.installed) && Boolean(pythonExecutable),
        pythonExecutable,
        pythonVersion: sanitizeText(parsed?.pythonVersion),
        archiveUrl: sanitizeText(parsed?.archiveUrl),
        installedAt: sanitizeText(parsed?.installedAt),
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to load python runtime state:', error);
      }
      await this.persistState();
    }

    this.initialized = true;
  }

  async persistState() {
    await fsp.mkdir(path.dirname(this.stateFilePath), { recursive: true });
    await fsp.writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  async verifyPythonExecutable(pythonExecutable) {
    await this.runCommandImpl(pythonExecutable, ['--version']);
  }

  getStatus() {
    const pythonExecutable = sanitizeText(this.state.pythonExecutable);
    const installed = Boolean(
      this.state.installed
      && pythonExecutable
      && fs.existsSync(pythonExecutable),
    );
    return {
      installed,
      pythonExecutable: installed ? pythonExecutable : '',
      pythonVersion: installed ? sanitizeText(this.state.pythonVersion) : '',
      archiveUrl: installed ? sanitizeText(this.state.archiveUrl) : '',
      rootDir: this.rootDir,
      installDir: this.installDir,
      managedByApp: installed,
      installing: Boolean(this.ensurePromise),
    };
  }

  async ensureRuntime({ pythonVersion, packages, onProgress } = {}) {
    if (this.ensurePromise) {
      return this.ensurePromise;
    }

    this.ensurePromise = this.ensureRuntimeInternal({ pythonVersion, packages, onProgress }).finally(() => {
      this.ensurePromise = null;
    });
    return this.ensurePromise;
  }

  async ensureRuntimeInternal({ pythonVersion, packages, onProgress } = {}) {
    await this.init();

    const version = sanitizeText(pythonVersion) || getDefaultPythonVersion();
    const resolvedPackage = resolvePythonRuntimePackage(version, packages);
    if (!resolvedPackage.archiveUrl) {
      throw createPythonRuntimeError(
        'python_runtime_platform_unsupported',
        `No built-in Python runtime package for ${resolvedPackage.platformKey} (${version}).`,
      );
    }

    const existing = this.getStatus();
    if (existing.installed && sanitizeText(existing.pythonVersion) === version) {
      await this.verifyPythonExecutable(existing.pythonExecutable);
      return existing;
    }

    const emitProgress = (payload = {}) => {
      if (typeof onProgress === 'function') {
        onProgress(payload);
      }
    };

    const installId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const archivePath = path.join(this.downloadsDir, `python-${installId}.tar.gz`);
    const stagePath = path.join(this.stageDir, installId);

    emitProgress({
      phase: 'started',
      currentFile: '',
      overallProgress: 0,
    });

    try {
      await this.downloadFileImpl({
        url: resolvedPackage.archiveUrl,
        destinationPath: archivePath,
        onProgress: ({ downloadedBytes, totalBytes, bytesPerSecond, estimatedRemainingSeconds }) => {
          const progress =
            Number.isFinite(totalBytes) && totalBytes > 0 ? Math.min(0.5, downloadedBytes / totalBytes / 2) : 0;
          emitProgress({
            phase: 'running',
            currentFile: path.basename(resolvedPackage.archiveUrl),
            fileDownloadedBytes: downloadedBytes,
            fileTotalBytes: totalBytes,
            downloadSpeedBytesPerSec: bytesPerSecond,
            estimatedRemainingSeconds,
            overallProgress: progress,
          });
        },
      });

      emitProgress({
        phase: 'extracting',
        currentFile: '正在解压 Python 运行时',
        overallProgress: 0.75,
      });

      await fsp.rm(stagePath, { recursive: true, force: true });
      await fsp.mkdir(stagePath, { recursive: true });
      await this.extractArchiveImpl({
        archivePath,
        destinationDir: stagePath,
      });

      await fsp.rm(this.installDir, { recursive: true, force: true });
      await fsp.rename(stagePath, this.installDir);

      const pythonExecutable = resolvePythonExecutablePath(this.installDir);
      await this.verifyPythonExecutable(pythonExecutable);

      this.state = {
        installed: true,
        pythonExecutable,
        pythonVersion: version,
        archiveUrl: resolvedPackage.archiveUrl,
        installedAt: new Date().toISOString(),
      };
      await this.persistState();

      emitProgress({
        phase: 'completed',
        currentFile: '',
        overallProgress: 1,
      });
      return this.getStatus();
    } catch (error) {
      emitProgress({
        phase: 'failed',
        currentFile: '',
        overallProgress: 0,
      });
      throw error;
    } finally {
      await fsp.rm(archivePath, { force: true }).catch(() => {});
      await fsp.rm(stagePath, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = {
  PythonRuntimeManager,
  createPythonRuntimeError,
  downloadFileFromUrl,
  extractTarArchive,
};
