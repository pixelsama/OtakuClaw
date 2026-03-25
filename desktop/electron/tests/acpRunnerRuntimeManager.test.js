const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  AcpRunnerRuntimeManager,
} = require('../services/chat/acp/acpRunnerRuntimeManager');

function toSha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function createTestManager({
  platform = 'darwin',
  arch = 'arm64',
  env = {},
  downloadFileImpl,
  extractArchiveImpl,
  runCommandImpl,
} = {}) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'acp-runner-runtime-test-'));
  const app = {
    getPath(name) {
      if (name === 'userData') {
        return tmpDir;
      }
      return tmpDir;
    },
  };

  const manager = new AcpRunnerRuntimeManager(app, {
    platform,
    arch,
    env,
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

test('acp runner manager reports default status before install', async () => {
  const { manager } = await createTestManager();
  const status = manager.getStatus();
  assert.equal(status.ok, true);
  assert.equal(status.backends.codex.installed, false);
  assert.equal(status.backends['claude-code'].installed, false);
});

test('acp runner manager installs codex runner into app-owned directory', async () => {
  const progressEvents = [];
  const downloadUrls = [];
  const archiveContent = 'archive-v1';
  const { manager, tmpDir } = await createTestManager({
    platform: 'darwin',
    arch: 'arm64',
    env: {
      OPENCLAW_ACP_CODEX_RUNNER_URL: 'https://example.com/codex-acp-test.tar.gz',
      OPENCLAW_ACP_CODEX_RUNNER_SHA256: toSha256Hex(archiveContent),
    },
    downloadFileImpl: async ({ url, destinationPath, onProgress }) => {
      downloadUrls.push(url);
      await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
      await fsp.writeFile(destinationPath, archiveContent);
      onProgress?.({
        fileDownloadedBytes: 100,
        fileTotalBytes: 200,
        downloadSpeedBytesPerSec: 20,
        estimatedRemainingSeconds: 5,
        overallProgress: 0.5,
      });
    },
    extractArchiveImpl: async ({ destinationDir }) => {
      const binDir = path.join(destinationDir, 'bundle', 'bin');
      await fsp.mkdir(binDir, { recursive: true });
      await fsp.writeFile(path.join(binDir, 'codex-acp'), '#!/bin/sh\necho codex\n', 'utf-8');
    },
  });

  const result = await manager.installRunner({
    backend: 'codex',
    onProgress: (payload) => progressEvents.push(payload),
  });
  assert.equal(result.ok, true);
  assert.equal(result.backend, 'codex');
  assert.equal(result.installed, true);
  assert.ok(result.commandPath.includes(path.join('acp-runners', 'install', 'codex')));
  assert.equal(fs.existsSync(result.commandPath), true);

  assert.equal(downloadUrls.length > 0, true);
  assert.equal(downloadUrls[0].includes('https://example.com/codex-acp-test.tar.gz'), true);
  assert.equal(progressEvents.some((item) => item.phase === 'running'), true);
  assert.equal(progressEvents.some((item) => item.phase === 'verifying'), true);
  assert.equal(progressEvents.at(-1).phase, 'completed');

  const status = manager.getStatus();
  assert.equal(status.backends.codex.installed, true);
  assert.equal(status.backends.codex.commandPath, result.commandPath);
  assert.equal(status.backends['claude-code'].installed, false);
  assert.equal(result.commandPath.startsWith(path.join(tmpDir, 'acp-runners')), true);
});

test('acp runner manager supports force reinstall and archive-url based reinstall', async () => {
  let downloadCount = 0;
  const env = {
    OPENCLAW_ACP_CODEX_RUNNER_URL: 'https://example.com/codex-acp-test-v1.tar.gz',
    OPENCLAW_ACP_CODEX_RUNNER_SHA256: toSha256Hex('archive-v1'),
  };
  const { manager } = await createTestManager({
    platform: 'darwin',
    arch: 'arm64',
    env,
    downloadFileImpl: async ({ destinationPath, onProgress, url }) => {
      downloadCount += 1;
      const content = String(url).includes('-v2') ? 'archive-v2' : 'archive-v1';
      await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
      await fsp.writeFile(destinationPath, content);
      onProgress?.({
        fileDownloadedBytes: 1,
        fileTotalBytes: 1,
        overallProgress: 1,
      });
    },
    extractArchiveImpl: async ({ destinationDir }) => {
      const binDir = path.join(destinationDir, 'bundle', 'bin');
      await fsp.mkdir(binDir, { recursive: true });
      await fsp.writeFile(path.join(binDir, 'codex-acp'), '#!/bin/sh\necho codex\n', 'utf-8');
    },
  });

  await manager.installRunner({ backend: 'codex' });
  assert.equal(downloadCount, 1);

  await manager.installRunner({ backend: 'codex' });
  assert.equal(downloadCount, 1);

  await manager.installRunner({ backend: 'codex', force: true });
  assert.equal(downloadCount, 2);

  env.OPENCLAW_ACP_CODEX_RUNNER_URL = 'https://example.com/codex-acp-test-v2.tar.gz';
  env.OPENCLAW_ACP_CODEX_RUNNER_SHA256 = toSha256Hex('archive-v2');
  await manager.installRunner({ backend: 'codex' });
  assert.equal(downloadCount, 3);
});

test('acp runner manager rejects checksum mismatch', async () => {
  const { manager } = await createTestManager({
    platform: 'darwin',
    arch: 'arm64',
    env: {
      OPENCLAW_ACP_CODEX_RUNNER_URL: 'https://example.com/codex-acp-test.tar.gz',
      OPENCLAW_ACP_CODEX_RUNNER_SHA256: toSha256Hex('not-match'),
    },
    downloadFileImpl: async ({ destinationPath }) => {
      await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
      await fsp.writeFile(destinationPath, 'archive');
    },
    extractArchiveImpl: async ({ destinationDir }) => {
      const binDir = path.join(destinationDir, 'bundle', 'bin');
      await fsp.mkdir(binDir, { recursive: true });
      await fsp.writeFile(path.join(binDir, 'codex-acp'), '#!/bin/sh\necho codex\n', 'utf-8');
    },
  });

  await assert.rejects(
    () => manager.installRunner({ backend: 'codex' }),
    (error) => error?.code === 'acp_runner_checksum_mismatch',
  );
});

test('acp runner manager rejects unsupported backend id', async () => {
  const { manager } = await createTestManager({
    platform: 'darwin',
    arch: 'arm64',
  });
  await assert.rejects(
    () => manager.installRunner({ backend: 'unknown-backend' }),
    (error) => error?.code === 'acp_runner_backend_invalid',
  );
});
