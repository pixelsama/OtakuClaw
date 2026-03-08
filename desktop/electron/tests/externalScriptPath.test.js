const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resolveExternalScriptPath } = require('../services/externalScriptPath');

test('resolveExternalScriptPath rewrites app.asar path to app.asar.unpacked when unpacked file exists', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-script-path-'));
  const asarDir = path.join(tmpDir, 'My.app', 'Contents', 'Resources', 'app.asar', 'desktop', 'electron', 'services');
  const unpackedDir = path.join(
    tmpDir,
    'My.app',
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'desktop',
    'electron',
    'services',
  );

  await fs.mkdir(unpackedDir, { recursive: true });
  await fs.writeFile(path.join(unpackedDir, 'worker.py'), '#!/usr/bin/env python3\n', 'utf-8');

  const original = path.join(asarDir, 'worker.py');
  const resolved = resolveExternalScriptPath(original);

  assert.equal(resolved, path.join(unpackedDir, 'worker.py'));
});
