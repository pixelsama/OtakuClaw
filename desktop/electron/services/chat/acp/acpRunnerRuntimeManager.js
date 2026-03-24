const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const {
  buildStableDownloadPath,
  downloadFileWithRetry,
} = require('../../shared/resumableDownloader');

const execFileAsync = promisify(execFile);

const ACP_RUNNER_ROOT_DIR = 'acp-runners';
const ACP_RUNNER_DOWNLOADS_DIR = 'downloads';
const ACP_RUNNER_STAGE_DIR = 'stage';
const ACP_RUNNER_INSTALL_DIR = 'install';
const ACP_RUNNER_STATE_FILE = 'state.json';
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const EXEC_MAX_BUFFER = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 30_000;

const SUPPORTED_BACKENDS = ['codex', 'claude-code'];

const ACP_RUNNER_CATALOG = {
  codex: {
    backend: 'codex',
    displayName: 'Codex',
    binaryName: process.platform === 'win32' ? 'codex-acp.exe' : 'codex-acp',
    version: '0.10.0',
    releasePrefix: 'https://github.com/zed-industries/codex-acp/releases/download/v0.10.0/',
    assets: {
      'darwin-arm64': 'codex-acp-0.10.0-aarch64-apple-darwin.tar.gz',
      'darwin-x64': 'codex-acp-0.10.0-x86_64-apple-darwin.tar.gz',
      'linux-arm64': 'codex-acp-0.10.0-aarch64-unknown-linux-gnu.tar.gz',
      'linux-x64': 'codex-acp-0.10.0-x86_64-unknown-linux-gnu.tar.gz',
      'win32-arm64': 'codex-acp-0.10.0-aarch64-pc-windows-msvc.zip',
      'win32-x64': 'codex-acp-0.10.0-x86_64-pc-windows-msvc.zip',
    },
  },
  'claude-code': {
    backend: 'claude-code',
    displayName: 'Claude Code',
    binaryName: process.platform === 'win32' ? 'claude-agent-acp.exe' : 'claude-agent-acp',
    version: '0.22.2',
    releasePrefix: 'https://github.com/zed-industries/claude-agent-acp/releases/download/v0.22.2/',
    assets: {
      'darwin-arm64': 'claude-agent-acp-darwin-arm64.zip',
      'darwin-x64': 'claude-agent-acp-darwin-x64.zip',
      'linux-arm64': 'claude-agent-acp-linux-arm64.tar.gz',
      'linux-x64': 'claude-agent-acp-linux-x64.tar.gz',
      'win32-arm64': 'claude-agent-acp-windows-arm64.zip',
      'win32-x64': 'claude-agent-acp-windows-x64.zip',
    },
  },
};

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBackend(value) {
  const normalized = sanitizeText(value).toLowerCase();
  if (normalized === 'codex') {
    return 'codex';
  }
  if (normalized === 'claude-code' || normalized === 'claude code' || normalized === 'claudecode' || normalized === 'claude_code') {
    return 'claude-code';
  }
  return '';
}

function normalizePlatform(value) {
  const normalized = sanitizeText(value).toLowerCase();
  if (normalized === 'darwin' || normalized === 'linux' || normalized === 'win32') {
    return normalized;
  }
  return process.platform;
}

function normalizeArch(value) {
  const normalized = sanitizeText(value).toLowerCase();
  if (normalized === 'arm64' || normalized === 'x64') {
    return normalized;
  }
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

function createRunnerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function inferArchiveKind(fileName = '') {
  const normalized = sanitizeText(fileName).toLowerCase();
  if (!normalized) {
    return 'unknown';
  }
  if (normalized.endsWith('.zip')) {
    return 'zip';
  }
  if (normalized.endsWith('.tar.gz') || normalized.endsWith('.tgz') || normalized.endsWith('.tar')) {
    return 'tar';
  }
  return 'unknown';
}

function createEmptyState() {
  return {
    backends: {
      codex: {
        commandPath: '',
        version: '',
        archiveUrl: '',
        installedAt: '',
      },
      'claude-code': {
        commandPath: '',
        version: '',
        archiveUrl: '',
        installedAt: '',
      },
    },
  };
}

function normalizeStateBackendEntry(source = {}) {
  return {
    commandPath: sanitizeText(source.commandPath),
    version: sanitizeText(source.version),
    archiveUrl: sanitizeText(source.archiveUrl),
    installedAt: sanitizeText(source.installedAt),
  };
}

async function downloadFileFromUrl({ url, destinationPath, signal, onProgress }) {
  return downloadFileWithRetry({
    url,
    destinationPath,
    signal,
    onProgress,
    createError: createRunnerError,
    errorCodes: {
      protocolUnsupported: 'acp_runner_download_protocol_unsupported',
      invalidUrl: 'acp_runner_download_invalid_url',
      redirectOverflow: 'acp_runner_download_redirect_overflow',
      httpError: 'acp_runner_download_http_error',
      timeout: 'acp_runner_download_timeout',
      downloadFailed: 'acp_runner_download_failed',
    },
    userAgent: 'free-agent-vtuber-openclaw/acp-runner-downloader',
    maxRedirects: MAX_REDIRECTS,
    requestTimeoutMs: DOWNLOAD_TIMEOUT_MS,
  });
}

async function runCommand(executable, args) {
  try {
    await execFileAsync(executable, args, {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: EXEC_MAX_BUFFER,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const missingToolError = createRunnerError(
        'ENOENT',
        `${sanitizeText(executable) || 'tool'} command not found.`,
      );
      missingToolError.cause = error;
      throw missingToolError;
    }
    const stderr = sanitizeText(error?.stderr);
    const stdout = sanitizeText(error?.stdout);
    const detail = stderr || stdout || error?.message || 'unknown error';
    throw createRunnerError(
      'acp_runner_extract_failed',
      `${sanitizeText(executable) || 'extract'} failed: ${detail}`,
    );
  }
}

async function extractArchive({ archivePath, destinationDir, platform, runCommandImpl = runCommand }) {
  await fsp.mkdir(destinationDir, { recursive: true });
  const archiveKind = inferArchiveKind(path.basename(archivePath));

  const runTarExtract = async () => {
    await runCommandImpl('tar', ['-xf', archivePath, '-C', destinationDir]);
  };

  if (archiveKind === 'tar') {
    try {
      await runTarExtract();
      return;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw createRunnerError(
          'acp_runner_extract_tool_missing',
          'Missing tar command. Please install tar first.',
        );
      }
      throw error;
    }
  }

  if (archiveKind === 'zip') {
    try {
      await runTarExtract();
      return;
    } catch (tarError) {
      if (platform === 'win32') {
        const escapedArchive = archivePath.replace(/'/g, "''");
        const escapedDestination = destinationDir.replace(/'/g, "''");
        try {
          await runCommandImpl('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`,
          ]);
          return;
        } catch (pwshError) {
          if (pwshError?.code === 'ENOENT' && tarError?.code === 'ENOENT') {
            throw createRunnerError(
              'acp_runner_extract_tool_missing',
              'Missing extraction tool. Install tar or PowerShell Expand-Archive support first.',
            );
          }
          throw pwshError;
        }
      }

      try {
        await runCommandImpl('unzip', ['-oq', archivePath, '-d', destinationDir]);
        return;
      } catch (unzipError) {
        if (unzipError?.code === 'ENOENT' && tarError?.code === 'ENOENT') {
          throw createRunnerError(
            'acp_runner_extract_tool_missing',
            'Missing extraction tool. Install tar or unzip first.',
          );
        }
        throw unzipError;
      }
    }
  }

  throw createRunnerError(
    'acp_runner_extract_failed',
    `Unsupported archive format: ${archivePath}`,
  );
}

async function findCommandInDirectory(rootDir, commandName, { maxDepth = 8 } = {}) {
  const normalizedCommandName = sanitizeText(commandName);
  if (!normalizedCommandName) {
    return '';
  }

  const queue = [{ dir: rootDir, depth: 0 }];
  const loweredCommandName = normalizedCommandName.toLowerCase();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > maxDepth) {
      continue;
    }

    let entries = [];
    try {
      entries = await fsp.readdir(current.dir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      const entryPath = path.join(current.dir, entry.name);
      if (entry.isFile()) {
        if (entry.name.toLowerCase() === loweredCommandName) {
          return entryPath;
        }
        continue;
      }
      if (entry.isDirectory()) {
        queue.push({
          dir: entryPath,
          depth: current.depth + 1,
        });
      }
    }
  }

  return '';
}

class AcpRunnerRuntimeManager {
  constructor(
    app,
    {
      env = process.env,
      platform = process.platform,
      arch = process.arch,
      downloadFileImpl = downloadFileFromUrl,
      extractArchiveImpl = extractArchive,
      runCommandImpl = runCommand,
    } = {},
  ) {
    this.app = app;
    this.env = env;
    this.platform = normalizePlatform(platform);
    this.arch = normalizeArch(arch);
    this.downloadFileImpl = downloadFileImpl;
    this.extractArchiveImpl = extractArchiveImpl;
    this.runCommandImpl = runCommandImpl;

    this.rootDir = path.join(this.app.getPath('userData'), ACP_RUNNER_ROOT_DIR);
    this.downloadsDir = path.join(this.rootDir, ACP_RUNNER_DOWNLOADS_DIR);
    this.stageDir = path.join(this.rootDir, ACP_RUNNER_STAGE_DIR);
    this.installDir = path.join(this.rootDir, ACP_RUNNER_INSTALL_DIR);
    this.stateFilePath = path.join(this.rootDir, ACP_RUNNER_STATE_FILE);

    this.state = createEmptyState();
    this.installPromises = new Map();
  }

  async init() {
    await fsp.mkdir(this.rootDir, { recursive: true });
    await fsp.mkdir(this.downloadsDir, { recursive: true });
    await fsp.mkdir(this.stageDir, { recursive: true });
    await fsp.mkdir(this.installDir, { recursive: true });

    try {
      const raw = await fsp.readFile(this.stateFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const backends = parsed?.backends && typeof parsed.backends === 'object' ? parsed.backends : {};
      this.state = {
        backends: {
          codex: normalizeStateBackendEntry(backends.codex),
          'claude-code': normalizeStateBackendEntry(backends['claude-code']),
        },
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to load ACP runner state:', error);
      }
      this.state = createEmptyState();
      await this.persistState();
    }
  }

  async persistState() {
    await fsp.mkdir(path.dirname(this.stateFilePath), { recursive: true });
    await fsp.writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  resolveAssetSpec(backend) {
    const normalizedBackend = normalizeBackend(backend);
    if (!normalizedBackend) {
      throw createRunnerError('acp_runner_backend_invalid', `Unsupported backend: ${backend}`);
    }

    const catalog = ACP_RUNNER_CATALOG[normalizedBackend];
    if (!catalog) {
      throw createRunnerError('acp_runner_backend_invalid', `Unsupported backend: ${backend}`);
    }

    const overrideEnvName = normalizedBackend === 'codex'
      ? 'OPENCLAW_ACP_CODEX_RUNNER_URL'
      : 'OPENCLAW_ACP_CLAUDE_RUNNER_URL';
    const overriddenUrl = sanitizeText(this.env?.[overrideEnvName]);
    if (overriddenUrl) {
      let archiveFileName = '';
      try {
        archiveFileName = path.basename(new URL(overriddenUrl).pathname || '');
      } catch {
        archiveFileName = path.basename(overriddenUrl);
      }
      const binaryName = this.platform === 'win32'
        ? `${catalog.binaryName.replace(/\.exe$/i, '')}.exe`
        : catalog.binaryName.replace(/\.exe$/i, '');
      return {
        backend: normalizedBackend,
        displayName: catalog.displayName,
        version: catalog.version,
        archiveUrl: overriddenUrl,
        archiveFileName,
        archiveKind: inferArchiveKind(overriddenUrl),
        binaryName,
      };
    }

    const platformArchKey = `${this.platform}-${this.arch}`;
    const assetName = catalog.assets?.[platformArchKey];
    if (!assetName) {
      throw createRunnerError(
        'acp_runner_asset_unsupported',
        `${catalog.displayName} runner does not have a build for ${this.platform}/${this.arch}.`,
      );
    }

    const binaryName = this.platform === 'win32'
      ? `${catalog.binaryName.replace(/\.exe$/i, '')}.exe`
      : catalog.binaryName.replace(/\.exe$/i, '');

    return {
      backend: normalizedBackend,
      displayName: catalog.displayName,
      version: catalog.version,
      archiveUrl: `${catalog.releasePrefix}${assetName}`,
      archiveFileName: assetName,
      archiveKind: inferArchiveKind(assetName),
      binaryName,
    };
  }

  resolveManagedCommandPath(backend) {
    const normalizedBackend = normalizeBackend(backend);
    if (!normalizedBackend) {
      return '';
    }
    const commandPath = sanitizeText(this.state?.backends?.[normalizedBackend]?.commandPath);
    if (!commandPath || !fs.existsSync(commandPath)) {
      return '';
    }
    return commandPath;
  }

  getBackendStatus(backend) {
    const normalizedBackend = normalizeBackend(backend);
    if (!normalizedBackend) {
      return {
        backend: '',
        displayName: '',
        installed: false,
        installing: false,
        managedByApp: false,
        commandPath: '',
        version: '',
        expectedVersion: '',
        rootDir: this.installDir,
      };
    }

    const catalog = ACP_RUNNER_CATALOG[normalizedBackend] || {
      displayName: normalizedBackend,
      version: '',
    };
    const commandPath = this.resolveManagedCommandPath(normalizedBackend);
    const rawEntry = this.state?.backends?.[normalizedBackend] || {};
    const installed = Boolean(commandPath);

    return {
      backend: normalizedBackend,
      displayName: catalog.displayName,
      installed,
      installing: this.installPromises.has(normalizedBackend),
      managedByApp: installed,
      commandPath,
      version: installed ? sanitizeText(rawEntry.version) : '',
      expectedVersion: sanitizeText(catalog.version),
      archiveUrl: installed ? sanitizeText(rawEntry.archiveUrl) : '',
      installedAt: installed ? sanitizeText(rawEntry.installedAt) : '',
      rootDir: path.join(this.installDir, normalizedBackend),
    };
  }

  getStatus({ backend } = {}) {
    const normalizedBackend = normalizeBackend(backend);
    if (normalizedBackend) {
      return {
        ok: true,
        backend: normalizedBackend,
        status: this.getBackendStatus(normalizedBackend),
      };
    }

    return {
      ok: true,
      rootDir: this.rootDir,
      backends: {
        codex: this.getBackendStatus('codex'),
        'claude-code': this.getBackendStatus('claude-code'),
      },
    };
  }

  async installRunner({ backend, force = false, signal, onProgress } = {}) {
    const normalizedBackend = normalizeBackend(backend);
    if (!normalizedBackend) {
      throw createRunnerError('acp_runner_backend_invalid', `Unsupported backend: ${backend}`);
    }

    const existing = this.installPromises.get(normalizedBackend);
    if (existing) {
      return existing;
    }

    const promise = this.installRunnerInternal({
      backend: normalizedBackend,
      force,
      signal,
      onProgress,
    }).finally(() => {
      this.installPromises.delete(normalizedBackend);
    });
    this.installPromises.set(normalizedBackend, promise);
    return promise;
  }

  async installRunnerInternal({
    backend,
    force = false,
    signal,
    onProgress,
  }) {
    const emitProgress = (payload = {}) => {
      if (typeof onProgress !== 'function') {
        return;
      }
      try {
        onProgress(payload);
      } catch (error) {
        console.warn('acp runner progress emit failed:', error);
      }
    };

    const spec = this.resolveAssetSpec(backend);
    const currentStatus = this.getBackendStatus(backend);
    if (currentStatus.installed && !force) {
      return {
        ok: true,
        ...currentStatus,
      };
    }

    const taskId = `acp-runner:${backend}`;
    const taskTitle = `${spec.displayName} Runner Download & Install`;

    emitProgress({
      backend,
      taskId,
      taskTitle,
      phase: 'started',
      completedTasks: 0,
      totalTasks: 3,
      currentFile: '',
      overallProgress: 0,
    });

    const stageSuffix = `${backend}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const stageDir = path.join(this.stageDir, stageSuffix);

    try {
      await fsp.mkdir(stageDir, { recursive: true });
      await fsp.mkdir(path.join(this.installDir, backend), { recursive: true });

      const archivePath = buildStableDownloadPath(
        this.downloadsDir,
        spec.archiveUrl,
        spec.archiveFileName || `${spec.binaryName}.${spec.archiveKind === 'zip' ? 'zip' : 'tar.gz'}`,
      );

      emitProgress({
        backend,
        taskId,
        taskTitle,
        phase: 'running',
        completedTasks: 1,
        totalTasks: 3,
        currentFile: spec.archiveFileName || path.basename(archivePath),
      });

      await this.downloadFileImpl({
        url: spec.archiveUrl,
        destinationPath: archivePath,
        signal,
        onProgress: (downloadPayload = {}) => {
          emitProgress({
            backend,
            taskId,
            taskTitle,
            phase: 'running',
            completedTasks: 1,
            totalTasks: 3,
            currentFile: spec.archiveFileName || path.basename(archivePath),
            overallProgress: Number.isFinite(downloadPayload?.overallProgress) ? downloadPayload.overallProgress : null,
            fileDownloadedBytes: Number.isFinite(downloadPayload?.fileDownloadedBytes)
              ? downloadPayload.fileDownloadedBytes
              : 0,
            fileTotalBytes: Number.isFinite(downloadPayload?.fileTotalBytes) ? downloadPayload.fileTotalBytes : 0,
            downloadSpeedBytesPerSec: Number.isFinite(downloadPayload?.downloadSpeedBytesPerSec)
              ? downloadPayload.downloadSpeedBytesPerSec
              : 0,
            estimatedRemainingSeconds: Number.isFinite(downloadPayload?.estimatedRemainingSeconds)
              ? downloadPayload.estimatedRemainingSeconds
              : null,
          });
        },
      });

      emitProgress({
        backend,
        taskId,
        taskTitle,
        phase: 'extracting',
        completedTasks: 2,
        totalTasks: 3,
        currentFile: spec.archiveFileName || path.basename(archivePath),
      });

      await this.extractArchiveImpl({
        archivePath,
        destinationDir: stageDir,
        platform: this.platform,
        runCommandImpl: this.runCommandImpl,
      });

      const discoveredCommandPath = await findCommandInDirectory(stageDir, spec.binaryName);
      if (!discoveredCommandPath) {
        throw createRunnerError(
          'acp_runner_executable_missing',
          `Executable ${spec.binaryName} not found after extraction.`,
        );
      }

      const backendInstallDir = path.join(this.installDir, backend, `v${spec.version}`);
      const finalCommandPath = path.join(backendInstallDir, spec.binaryName);
      await fsp.mkdir(backendInstallDir, { recursive: true });
      await fsp.rm(finalCommandPath, { force: true }).catch(() => {});
      await fsp.copyFile(discoveredCommandPath, finalCommandPath);
      if (this.platform !== 'win32') {
        await fsp.chmod(finalCommandPath, 0o755);
      }

      this.state.backends[backend] = {
        commandPath: finalCommandPath,
        version: spec.version,
        archiveUrl: spec.archiveUrl,
        installedAt: new Date().toISOString(),
      };
      await this.persistState();

      const finalStatus = this.getBackendStatus(backend);
      emitProgress({
        backend,
        taskId,
        taskTitle,
        phase: 'completed',
        completedTasks: 3,
        totalTasks: 3,
        currentFile: '',
      });

      return {
        ok: true,
        ...finalStatus,
      };
    } catch (error) {
      emitProgress({
        backend,
        taskId,
        taskTitle,
        phase: 'failed',
        completedTasks: 3,
        totalTasks: 3,
        currentFile: '',
        error: {
          code: sanitizeText(error?.code) || 'acp_runner_install_failed',
          message: sanitizeText(error?.message) || 'Failed to install ACP runner.',
        },
      });
      throw error;
    } finally {
      await fsp.rm(stageDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = {
  AcpRunnerRuntimeManager,
  ACP_RUNNER_CATALOG,
  SUPPORTED_BACKENDS,
  createRunnerError,
};
