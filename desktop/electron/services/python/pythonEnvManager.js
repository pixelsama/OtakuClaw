const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { PythonRuntimeManager } = require('./pythonRuntimeManager');
const { getDefaultPythonVersion, resolveRuntimePlatformKey } = require('./pythonRuntimeCatalog');

const execFileAsync = promisify(execFile);

const PYTHON_ENVS_ROOT_DIR = 'python-envs';
const ENV_MANIFEST_FILE = 'manifest.json';
const COMMAND_TIMEOUT_MS = 20 * 60 * 1000;
const EXEC_MAX_BUFFER = 20 * 1024 * 1024;

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizePackageList(value) {
  return Array.isArray(value)
    ? value.map((item) => sanitizeText(item)).filter(Boolean)
    : [];
}

function createPythonEnvError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function runCommand(executable, args, { cwd } = {}) {
  try {
    await execFileAsync(executable, args, {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: EXEC_MAX_BUFFER,
    });
  } catch (error) {
    const stderr = sanitizeText(error?.stderr);
    const stdout = sanitizeText(error?.stdout);
    const message = stderr || stdout || error?.message || 'Python env command failed.';
    throw createPythonEnvError('python_env_command_failed', message);
  }
}

function resolveEnvPythonExecutable(envDir) {
  if (process.platform === 'win32') {
    return path.join(envDir, 'Scripts', 'python.exe');
  }
  return path.join(envDir, 'bin', 'python3');
}

function normalizeEnvRecord(raw = {}) {
  const envId = sanitizeText(raw?.envId);
  if (!envId) {
    return null;
  }

  const envDir = sanitizeText(raw?.envDir);
  const envPythonExecutable = sanitizeText(raw?.envPythonExecutable);
  if (!envDir || !envPythonExecutable) {
    return null;
  }

  return {
    version: 1,
    envId,
    profile: sanitizeText(raw?.profile),
    pythonVersion: sanitizeText(raw?.pythonVersion),
    runtimePythonExecutable: sanitizeText(raw?.runtimePythonExecutable),
    envDir,
    envPythonExecutable,
    lockHash: sanitizeText(raw?.lockHash),
    platform: sanitizeText(raw?.platform),
    pipPackages: sanitizePackageList(raw?.pipPackages),
    installedAt: sanitizeText(raw?.installedAt),
    lastUsedAt: sanitizeText(raw?.lastUsedAt),
  };
}

function computeLockHash({ profile, pythonVersion, pipPackages }) {
  const payload = JSON.stringify({
    profile: sanitizeText(profile),
    pythonVersion: sanitizeText(pythonVersion),
    platform: resolveRuntimePlatformKey(),
    pipPackages: sanitizePackageList(pipPackages),
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

function createEnvId({ profile, pythonVersion, lockHash }) {
  const sanitizedProfile = sanitizeText(profile)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const versionSuffix = sanitizeText(pythonVersion).replace(/\./g, '');
  return `${sanitizedProfile || 'python-env'}-py${versionSuffix || 'unknown'}-${lockHash}`;
}

class PythonEnvManager {
  constructor(
    app,
    {
      pythonRuntimeManager = null,
      runCommandImpl = runCommand,
    } = {},
  ) {
    this.app = app;
    this.runCommandImpl = runCommandImpl;
    this.pythonRuntimeManager =
      pythonRuntimeManager instanceof PythonRuntimeManager
        ? pythonRuntimeManager
        : (pythonRuntimeManager || new PythonRuntimeManager(app));

    this.rootDir = path.join(this.app.getPath('userData'), PYTHON_ENVS_ROOT_DIR);
    this.envs = new Map();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) {
      return;
    }

    await this.pythonRuntimeManager.init();
    await fsp.mkdir(this.rootDir, { recursive: true });
    const entries = await fsp.readdir(this.rootDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const envDir = path.join(this.rootDir, entry.name);
      const manifestPath = path.join(envDir, ENV_MANIFEST_FILE);
      try {
        const raw = await fsp.readFile(manifestPath, 'utf-8');
        const record = normalizeEnvRecord(JSON.parse(raw));
        if (record && fs.existsSync(record.envPythonExecutable)) {
          this.envs.set(record.envId, record);
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          console.warn('Failed to load python env manifest:', error);
        }
      }
    }
    this.initialized = true;
  }

  getEnvById(envId) {
    const normalizedId = sanitizeText(envId);
    if (!normalizedId) {
      return null;
    }
    const found = this.envs.get(normalizedId) || null;
    if (!found || !fs.existsSync(found.envPythonExecutable)) {
      return null;
    }
    return {
      ...found,
      pipPackages: [...found.pipPackages],
    };
  }

  async persistEnvRecord(record) {
    const envDir = sanitizeText(record?.envDir);
    if (!envDir) {
      return;
    }

    await fsp.mkdir(envDir, { recursive: true });
    await fsp.writeFile(
      path.join(envDir, ENV_MANIFEST_FILE),
      JSON.stringify(record, null, 2),
      'utf-8',
    );
  }

  async touchEnv(envId) {
    const record = this.getEnvById(envId);
    if (!record) {
      return null;
    }

    const updated = {
      ...record,
      lastUsedAt: new Date().toISOString(),
    };
    this.envs.set(updated.envId, updated);
    await this.persistEnvRecord(updated);
    return updated;
  }

  async ensureEnv({
    profile,
    pythonVersion,
    runtimePackages,
    pipPackages,
    onProgress,
  } = {}) {
    await this.init();

    const resolvedProfile = sanitizeText(profile) || 'default';
    const resolvedPythonVersion = sanitizeText(pythonVersion) || getDefaultPythonVersion();
    const resolvedPipPackages = sanitizePackageList(pipPackages);
    const lockHash = computeLockHash({
      profile: resolvedProfile,
      pythonVersion: resolvedPythonVersion,
      pipPackages: resolvedPipPackages,
    });
    const envId = createEnvId({
      profile: resolvedProfile,
      pythonVersion: resolvedPythonVersion,
      lockHash,
    });
    const existing = this.getEnvById(envId);
    if (existing) {
      return this.touchEnv(envId);
    }

    const emitProgress = (payload = {}) => {
      if (typeof onProgress === 'function') {
        onProgress(payload);
      }
    };

    const runtime = await this.pythonRuntimeManager.ensureRuntime({
      pythonVersion: resolvedPythonVersion,
      packages: runtimePackages,
      onProgress: (payload) => {
        emitProgress({
          phase: payload.phase,
          currentFile: payload.currentFile || '准备 Python 运行时',
          overallProgress:
            typeof payload.overallProgress === 'number' ? Math.min(0.45, payload.overallProgress * 0.45) : 0,
        });
      },
    });

    const envDir = path.join(this.rootDir, envId);
    const envPythonExecutable = resolveEnvPythonExecutable(envDir);
    await fsp.rm(envDir, { recursive: true, force: true });

    emitProgress({
      phase: 'running',
      currentFile: '正在创建 Python env',
      overallProgress: 0.55,
    });
    await this.runCommandImpl(runtime.pythonExecutable, ['-m', 'venv', envDir]);

    emitProgress({
      phase: 'running',
      currentFile: '正在初始化 pip / setuptools / wheel',
      overallProgress: 0.7,
    });
    await this.runCommandImpl(envPythonExecutable, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel']);

    if (resolvedPipPackages.length) {
      emitProgress({
        phase: 'running',
        currentFile: '正在安装 Python 依赖',
        overallProgress: 0.85,
      });
      await this.runCommandImpl(envPythonExecutable, ['-m', 'pip', 'install', '--upgrade', ...resolvedPipPackages]);
    }

    const record = {
      version: 1,
      envId,
      profile: resolvedProfile,
      pythonVersion: resolvedPythonVersion,
      runtimePythonExecutable: runtime.pythonExecutable,
      envDir,
      envPythonExecutable,
      lockHash,
      platform: resolveRuntimePlatformKey(),
      pipPackages: resolvedPipPackages,
      installedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    };
    this.envs.set(envId, record);
    await this.persistEnvRecord(record);

    emitProgress({
      phase: 'completed',
      currentFile: '',
      overallProgress: 1,
    });

    return {
      ...record,
      pipPackages: [...record.pipPackages],
    };
  }
}

module.exports = {
  PythonEnvManager,
  createPythonEnvError,
};
