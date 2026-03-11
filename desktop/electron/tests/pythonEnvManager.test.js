const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { PythonEnvManager } = require('../services/python/pythonEnvManager');

function createApp(tmpDir) {
  return {
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
}

test('ensureEnv installs pip packages one-by-one and forwards runtime download stats', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'python-env-manager-test-'));
  const runCommands = [];
  const progressEvents = [];

  const manager = new PythonEnvManager(createApp(tmpDir), {
    pythonRuntimeManager: {
      init: async () => {},
      async ensureRuntime({ onProgress }) {
        onProgress?.({
          phase: 'running',
          currentFile: 'python-runtime.tar.gz',
          overallProgress: 0.4,
          fileDownloadedBytes: 1024,
          fileTotalBytes: 4096,
          downloadSpeedBytesPerSec: 512,
          estimatedRemainingSeconds: 6,
        });
        return {
          pythonExecutable: '/usr/bin/python3',
        };
      },
    },
    runCommandImpl: async (executable, args) => {
      runCommands.push([executable, ...args]);
    },
  });

  const result = await manager.ensureEnv({
    profile: 'voice-default',
    pythonVersion: '3.12.12',
    pipPackages: ['pkg-a==1.0.0', 'pkg-b==2.0.0'],
    onProgress: (payload) => {
      progressEvents.push(payload);
    },
  });

  assert.equal(typeof result.envId, 'string');
  assert.equal(runCommands.length, 4);
  assert.deepEqual(runCommands[0], ['/usr/bin/python3', '-m', 'venv', result.envDir]);
  assert.deepEqual(
    runCommands[1],
    [result.envPythonExecutable, '-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'],
  );
  assert.deepEqual(
    runCommands[2],
    [result.envPythonExecutable, '-m', 'pip', 'install', '--upgrade', 'pkg-a==1.0.0'],
  );
  assert.deepEqual(
    runCommands[3],
    [result.envPythonExecutable, '-m', 'pip', 'install', '--upgrade', 'pkg-b==2.0.0'],
  );

  const runtimeStatsEvent = progressEvents.find((event) => event.currentFile === 'python-runtime.tar.gz');
  assert.ok(runtimeStatsEvent);
  assert.equal(runtimeStatsEvent.fileDownloadedBytes, 1024);
  assert.equal(runtimeStatsEvent.fileTotalBytes, 4096);
  assert.equal(runtimeStatsEvent.downloadSpeedBytesPerSec, 512);
  assert.equal(runtimeStatsEvent.estimatedRemainingSeconds, 6);

  const dependencyEvents = progressEvents.filter((event) => typeof event.currentFile === 'string' && event.currentFile.includes('正在安装 Python 依赖'));
  assert.equal(dependencyEvents.length, 2);
  assert.equal(dependencyEvents[0].currentFile, '正在安装 Python 依赖 1/2');
  assert.equal(dependencyEvents[1].currentFile, '正在安装 Python 依赖 2/2');
});

