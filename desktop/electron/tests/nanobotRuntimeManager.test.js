const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { NanobotRuntimeManager } = require('../services/chat/nanobot/nanobotRuntimeManager');

async function createTestManager({
  env = {},
  pythonRuntimeManager = null,
  pythonEnvManager = null,
  downloadFileImpl,
  extractArchiveImpl,
  runCommandImpl,
} = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nanobot-runtime-manager-test-'));
  const app = {
    getPath(key) {
      if (key === 'userData') {
        return tmpDir;
      }
      return tmpDir;
    },
    getAppPath() {
      return tmpDir;
    },
  };

  const manager = new NanobotRuntimeManager(app, {
    env,
    pythonRuntimeManager,
    pythonEnvManager,
    downloadFileImpl,
    extractArchiveImpl,
    runCommandImpl,
  });
  await manager.init();

  return {
    manager,
    tmpDir,
  };
}

test('nanobot runtime manager does not resolve external repo path from env', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nanobot-runtime-env-test-'));
  const repoPath = path.join(tmpDir, 'nanobot');
  await fs.mkdir(repoPath, { recursive: true });

  const { manager } = await createTestManager({
    env: {
      NANOBOT_REPO_PATH: repoPath,
      NANOBOT_PYTHON_BIN: '/usr/bin/python3',
    },
    runCommandImpl: async () => {},
  });

  const status = manager.getStatus();
  assert.equal(status.installed, false);
  assert.equal(status.repoPath, '');
  assert.equal(status.source, '');
  assert.equal(status.pythonExecutable, '/usr/bin/python3');
});

test('nanobot runtime manager installs runtime into app data', async () => {
  const runCommands = [];
  const { manager, tmpDir } = await createTestManager({
    env: {
      NANOBOT_PYTHON_BIN: '/usr/bin/python3',
      NANOBOT_RUNTIME_ARCHIVE_URL: 'https://example.com/nanobot.tar.gz',
    },
    downloadFileImpl: async ({ destinationPath }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, 'archive');
    },
    extractArchiveImpl: async ({ destinationDir }) => {
      const extractedRoot = path.join(destinationDir, 'nanobot-main');
      await fs.mkdir(path.join(extractedRoot, 'nanobot'), { recursive: true });
      await fs.writeFile(path.join(extractedRoot, 'pyproject.toml'), '[project]\nname="nanobot-ai"\n');
    },
    runCommandImpl: async (executable, args) => {
      runCommands.push([executable, ...args]);
    },
  });

  const installed = await manager.installRuntime();
  assert.equal(installed.ok, true);
  assert.equal(installed.installed, true);
  assert.equal(installed.source, 'downloaded');
  assert.equal(installed.repoPath, path.join(tmpDir, 'nanobot-runtime', 'repo'));

  const status = manager.getStatus();
  assert.equal(status.managedByApp, true);
  assert.equal(status.installed, true);
  assert.equal(status.repoPath, path.join(tmpDir, 'nanobot-runtime', 'repo'));

  assert.deepEqual(runCommands[0], ['/usr/bin/python3', '--version']);
  assert.deepEqual(
    runCommands[1],
    ['/usr/bin/python3', '-m', 'pip', 'install', '--upgrade', '-e', path.join(tmpDir, 'nanobot-runtime', 'repo')],
  );
});

test('nanobot runtime manager uses managed python env when available', async () => {
  const runCommands = [];
  const managedEnv = {
    envId: 'nanobot-default-py312-abcd1234',
    envPythonExecutable: '/tmp/python-envs/nanobot/bin/python3',
  };
  const { manager, tmpDir } = await createTestManager({
    env: {
      NANOBOT_RUNTIME_ARCHIVE_URL: 'https://example.com/nanobot.tar.gz',
    },
    pythonRuntimeManager: {
      init: async () => {},
    },
    pythonEnvManager: {
      init: async () => {},
      async ensureEnv() {
        return managedEnv;
      },
      getEnvById(envId) {
        return envId === managedEnv.envId ? managedEnv : null;
      },
    },
    downloadFileImpl: async ({ destinationPath }) => {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, 'archive');
    },
    extractArchiveImpl: async ({ destinationDir }) => {
      const extractedRoot = path.join(destinationDir, 'nanobot-main');
      await fs.mkdir(path.join(extractedRoot, 'nanobot'), { recursive: true });
      await fs.writeFile(path.join(extractedRoot, 'pyproject.toml'), '[project]\nname="nanobot-ai"\n');
    },
    runCommandImpl: async (executable, args) => {
      runCommands.push([executable, ...args]);
    },
  });

  const installed = await manager.installRuntime();
  assert.equal(installed.pythonEnvId, managedEnv.envId);
  assert.equal(installed.pythonExecutable, managedEnv.envPythonExecutable);
  assert.deepEqual(runCommands[0], [managedEnv.envPythonExecutable, '--version']);
  assert.deepEqual(
    runCommands[1],
    [managedEnv.envPythonExecutable, '-m', 'pip', 'install', '--upgrade', '-e', path.join(tmpDir, 'nanobot-runtime', 'repo')],
  );
});

test('nanobot runtime manager clears missing legacy voice bundle python path', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nanobot-runtime-migrate-test-'));
  const app = {
    getPath(key) {
      if (key === 'userData') {
        return tmpDir;
      }
      return tmpDir;
    },
    getAppPath() {
      return tmpDir;
    },
  };
  const stateDir = path.join(tmpDir, 'nanobot-runtime');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(stateDir, 'state.json'),
    JSON.stringify({
      repoPath: path.join(tmpDir, 'nanobot-runtime', 'repo'),
      pythonExecutable: path.join(tmpDir, 'voice-models', 'bundles', 'old', 'runtime', 'python', 'bin', 'python3'),
      source: 'downloaded',
      installedAt: '2026-03-06T00:00:00.000Z',
    }),
    'utf-8',
  );

  const manager = new NanobotRuntimeManager(app, {
    pythonRuntimeManager: {
      init: async () => {},
    },
    pythonEnvManager: {
      init: async () => {},
      getEnvById() {
        return null;
      },
    },
    runCommandImpl: async () => {},
  });
  await manager.init();

  assert.equal(manager.state.pythonExecutable, '');
});
