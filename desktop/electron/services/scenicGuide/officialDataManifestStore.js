const fs = require('node:fs/promises');
const path = require('node:path');

const MANIFEST_FILE_NAME = 'scenic-guide-official-data-manifest.json';

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEmptyManifest() {
  return {
    datasetId: '',
    scenicId: 'lingshan',
    dataDirectory: '',
    importedAt: '',
    sources: [],
    importSummary: null,
  };
}

class OfficialDataManifestStore {
  constructor({
    app = null,
    storeFilePath = '',
    fileName = MANIFEST_FILE_NAME,
  } = {}) {
    this.app = app;
    this.storeFilePath = normalizeText(storeFilePath);
    this.fileName = normalizeText(fileName, MANIFEST_FILE_NAME);
    this.manifest = createEmptyManifest();
  }

  resolveStoreFilePath() {
    if (this.storeFilePath) {
      return this.storeFilePath;
    }
    const userDataDir =
      this.app && typeof this.app.getPath === 'function'
        ? this.app.getPath('userData')
        : process.cwd();
    return path.join(userDataDir, this.fileName);
  }

  async init() {
    try {
      const raw = await fs.readFile(this.resolveStoreFilePath(), 'utf8');
      const parsed = JSON.parse(raw);
      this.manifest = {
        ...createEmptyManifest(),
        ...(parsed && typeof parsed === 'object' ? parsed : {}),
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to load official data manifest:', error);
      }
      this.manifest = createEmptyManifest();
    }
  }

  getManifest() {
    return clone(this.manifest);
  }

  async saveManifest(manifest = {}) {
    this.manifest = {
      ...createEmptyManifest(),
      ...(manifest && typeof manifest === 'object' ? manifest : {}),
    };
    const filePath = this.resolveStoreFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(this.manifest, null, 2), 'utf8');
    return this.getManifest();
  }

  async clear() {
    this.manifest = createEmptyManifest();
    const filePath = this.resolveStoreFilePath();
    await fs.rm(filePath, { force: true });
    return this.getManifest();
  }
}

module.exports = {
  MANIFEST_FILE_NAME,
  OfficialDataManifestStore,
  createEmptyManifest,
};
