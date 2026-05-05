const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { OfficialDataManifestStore } = require('../services/scenicGuide/officialDataManifestStore');

test('official data manifest store persists and reloads manifest', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'official-data-manifest-test-'));
  const storeFilePath = path.join(tmpDir, 'manifest.json');
  const store = new OfficialDataManifestStore({ storeFilePath });
  await store.init();

  assert.equal(store.getManifest().scenicId, 'lingshan');
  assert.equal(store.getManifest().datasetId, '');

  await store.saveManifest({
    datasetId: 'official-lingshan-2026',
    scenicId: 'lingshan',
    dataDirectory: 'D:/official',
    importedAt: '2026-05-05T00:00:00.000Z',
    sources: [{ id: 'source-1' }],
    importSummary: { spotParagraphCount: 259 },
  });

  const reloaded = new OfficialDataManifestStore({ storeFilePath });
  await reloaded.init();
  const manifest = reloaded.getManifest();
  assert.equal(manifest.datasetId, 'official-lingshan-2026');
  assert.equal(manifest.dataDirectory, 'D:/official');
  assert.equal(manifest.sources.length, 1);
  assert.equal(manifest.importSummary.spotParagraphCount, 259);

  await reloaded.clear();
  assert.equal(reloaded.getManifest().datasetId, '');
  await assert.rejects(() => fs.readFile(storeFilePath, 'utf8'), { code: 'ENOENT' });
});
