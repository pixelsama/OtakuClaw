const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  OFFICIAL_SOURCE_FILES,
  OfficialDataImporter,
} = require('../services/scenicGuide/officialDataImporter');

test('official data importer reports missing files during inspection', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'official-data-importer-test-'));
  const importer = new OfficialDataImporter();

  const result = await importer.inspectDataDirectory({ directoryPath: tmpDir });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missingFiles.sort(), OFFICIAL_SOURCE_FILES.map((item) => item.fileName).sort());
  assert.equal(result.sources.length, OFFICIAL_SOURCE_FILES.length);
});

test('official data importer inspects all expected source files', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'official-data-importer-test-'));
  for (const source of OFFICIAL_SOURCE_FILES) {
    await fs.writeFile(path.join(tmpDir, source.fileName), `fixture:${source.id}`, 'utf8');
  }
  const importer = new OfficialDataImporter();

  const result = await importer.inspectDataDirectory({ directoryPath: tmpDir });

  assert.equal(result.ok, true);
  assert.deepEqual(result.missingFiles, []);
  assert.equal(result.sources.length, OFFICIAL_SOURCE_FILES.length);
  for (const source of result.sources) {
    assert.equal(source.exists, true);
    assert.equal(typeof source.sha256, 'string');
    assert.equal(source.sha256.length, 64);
    assert.ok(source.size > 0);
  }
});
