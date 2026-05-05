const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { extractDocxParagraphs } = require('./docxTextExtractor');
const { summarizeBehaviorWorkbook } = require('./behaviorDatasetStore');
const { parseGuideDocParagraphs } = require('./guideDocParser');
const { parseSpotDatasetParagraphs } = require('./spotDatasetParser');

const OFFICIAL_DATASET_ID = 'official-lingshan-2026';
const OFFICIAL_SCENIC_ID = 'lingshan';

const OFFICIAL_SOURCE_FILES = [
  {
    id: 'official-spot-structure-docx',
    fileName: '灵山胜境 景点结构化数据集.docx',
    type: 'docx',
    role: 'spot_structure',
  },
  {
    id: 'official-guide-docx',
    fileName: '灵山胜境：历史、文化、景点特色与个性化游览指南.docx',
    type: 'docx',
    role: 'guide_and_routes',
  },
  {
    id: 'official-behavior-xlsx',
    fileName: '景点景区旅游数据行为分析数据.xlsx',
    type: 'xlsx',
    role: 'tourist_behavior_analytics',
  },
];

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || fallback;
}

function toIpcSafeError(error, fallbackCode = 'official_data_import_failed') {
  return {
    code: error?.code || fallbackCode,
    message: typeof error?.message === 'string' && error.message
      ? error.message
      : 'Official data import failed.',
  };
}

async function fileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const data = await fs.readFile(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function buildSourcePath(directoryPath, source) {
  return path.join(directoryPath, source.fileName);
}

class OfficialDataImporter {
  constructor({
    manifestStore = null,
    knowledgeStore = null,
    sourceFiles = OFFICIAL_SOURCE_FILES,
  } = {}) {
    this.manifestStore = manifestStore;
    this.knowledgeStore = knowledgeStore;
    this.sourceFiles = sourceFiles;
  }

  async inspectDataDirectory(request = {}) {
    const dataDirectory = normalizeText(request.directoryPath || request.dataDirectory);
    if (!dataDirectory) {
      return {
        ok: false,
        error: {
          code: 'data_directory_required',
          message: 'Official data directory is required.',
        },
      };
    }

    let directoryStat = null;
    try {
      directoryStat = await fs.stat(dataDirectory);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'data_directory_not_found',
          message: 'Official data directory was not found.',
          detail: error?.message || '',
        },
      };
    }

    if (!directoryStat.isDirectory()) {
      return {
        ok: false,
        error: {
          code: 'data_directory_invalid',
          message: 'Official data path is not a directory.',
        },
      };
    }

    const sources = [];
    for (const source of this.sourceFiles) {
      const filePath = buildSourcePath(dataDirectory, source);
      try {
        const stat = await fs.stat(filePath);
        sources.push({
          ...source,
          filePath,
          exists: true,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sha256: await fileSha256(filePath),
        });
      } catch {
        sources.push({
          ...source,
          filePath,
          exists: false,
          size: 0,
          mtimeMs: 0,
          sha256: '',
        });
      }
    }

    const missingFiles = sources.filter((source) => !source.exists).map((source) => source.fileName);
    return {
      ok: missingFiles.length === 0,
      dataDirectory,
      missingFiles,
      sources,
      warnings: missingFiles.length > 0
        ? [{ code: 'missing_files', message: `Missing official data files: ${missingFiles.join(', ')}` }]
        : [],
    };
  }

  async importOfficialData(request = {}) {
    const inspection = await this.inspectDataDirectory(request);
    if (!inspection.ok) {
      return inspection;
    }

    try {
      const sourceByRole = new Map(inspection.sources.map((source) => [source.role, source]));
      const spotSource = sourceByRole.get('spot_structure');
      const guideSource = sourceByRole.get('guide_and_routes');
      const behaviorSource = sourceByRole.get('tourist_behavior_analytics');

      const [spotParagraphs, guideParagraphs, behaviorSummary] = await Promise.all([
        extractDocxParagraphs(spotSource.filePath),
        extractDocxParagraphs(guideSource.filePath),
        summarizeBehaviorWorkbook(behaviorSource.filePath),
      ]);
      const spotDataset = parseSpotDatasetParagraphs(spotParagraphs, { sourceId: spotSource.id });
      const guideDataset = parseGuideDocParagraphs(guideParagraphs, { sourceId: guideSource.id });

      const importSummary = {
        spotParagraphCount: spotParagraphs.length,
        spotCount: spotDataset.spots.length,
        spotIds: spotDataset.spots.map((spot) => spot.spotId),
        spotWarnings: spotDataset.warnings,
        guideParagraphCount: guideParagraphs.length,
        guideSectionCount: guideDataset.sections.length,
        routeCount: guideDataset.routes.length,
        routeIds: guideDataset.routes.map((route) => route.routeId),
        behaviorRowCount: behaviorSummary.rowCount,
        behaviorDataRowCount: behaviorSummary.dataRowCount,
        behaviorColumnCount: behaviorSummary.columnCount,
        behaviorHeaders: behaviorSummary.headers,
        behaviorMissingHeaders: behaviorSummary.missingHeaders,
      };

      let knowledgeSummary = null;
      if (this.knowledgeStore && typeof this.knowledgeStore.rebuildFromOfficialData === 'function') {
        await this.knowledgeStore.rebuildFromOfficialData({
          datasetId: OFFICIAL_DATASET_ID,
          scenicId: OFFICIAL_SCENIC_ID,
          sources: inspection.sources,
          importSummary,
          behaviorSummary,
          spots: spotDataset.spots,
          guideSections: guideDataset.sections,
          routes: guideDataset.routes,
        });
        knowledgeSummary =
          typeof this.knowledgeStore.getSummary === 'function'
            ? this.knowledgeStore.getSummary()
            : null;
      }

      const manifest = {
        datasetId: OFFICIAL_DATASET_ID,
        scenicId: OFFICIAL_SCENIC_ID,
        dataDirectory: inspection.dataDirectory,
        importedAt: new Date().toISOString(),
        sources: inspection.sources,
        importSummary,
        knowledgeSummary,
      };

      if (this.manifestStore && typeof this.manifestStore.saveManifest === 'function') {
        await this.manifestStore.saveManifest(manifest);
      }

      return {
        ok: true,
        manifest,
        importSummary,
        knowledgeSummary,
        data: {
          spots: spotDataset.spots,
          guideSections: guideDataset.sections,
          routes: guideDataset.routes,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: toIpcSafeError(error),
      };
    }
  }
}

module.exports = {
  OFFICIAL_DATASET_ID,
  OFFICIAL_SCENIC_ID,
  OFFICIAL_SOURCE_FILES,
  OfficialDataImporter,
  toIpcSafeError,
};
