const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const KNOWLEDGE_FILE_NAME = 'scenic-guide-knowledge.json';
const VERSION_TYPE_OFFICIAL = 'official';
const VERSION_TYPE_MANUAL = 'manual';
const VERSION_TYPE_DERIVED = 'derived';

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

function createEmptyKnowledgeBase() {
  return {
    datasetId: '',
    scenicId: 'lingshan',
    version: 0,
    rebuiltAt: '',
    sources: [],
    behaviorSummary: null,
    spots: [],
    guideSections: [],
    routes: [],
    faqs: [],
    knowledgeBlocks: [],
  };
}

function compactText(parts = []) {
  return parts
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join('\n');
}

function dedupe(values = []) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function hashText(value = '') {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

function ensureSourceRefs(sourceRefs = []) {
  return (Array.isArray(sourceRefs) ? sourceRefs : [])
    .filter((ref) => ref && typeof ref === 'object')
    .map((ref) => ({ ...ref }));
}

function buildSpotKnowledgeBlock(spot = {}) {
  const title = `${spot.name || spot.spotId} ${spot.spotId || ''}`.trim();
  const text = compactText([
    `点位：${spot.name || spot.spotId}`,
    spot.section ? `景区分区：${spot.section}` : '',
    spot.locationText ? `位置：${spot.locationText}` : '',
    spot.parameters ? `参数：${spot.parameters}` : '',
    spot.coreFunction ? `核心功能：${spot.coreFunction}` : '',
    spot.culture ? `文化内涵：${spot.culture}` : '',
    spot.introduction ? `介绍：${spot.introduction}` : '',
    Array.isArray(spot.highlights) && spot.highlights.length
      ? `游览亮点：${spot.highlights.join('；')}`
      : '',
    spot.openInfo ? `开放信息：${spot.openInfo}` : '',
    spot.notes ? `提示：${spot.notes}` : '',
  ]);

  return {
    blockId: `official:spot:${spot.spotId || hashText(title)}`,
    versionType: VERSION_TYPE_OFFICIAL,
    contentType: 'spot',
    entityId: spot.spotId || '',
    title,
    text,
    keywords: dedupe([
      spot.spotId,
      spot.name,
      spot.section,
      ...(Array.isArray(spot.highlights) ? spot.highlights : []),
    ]),
    sourceRefs: ensureSourceRefs(spot.sourceRefs),
    updatedAt: '',
  };
}

function buildRouteKnowledgeBlock(route = {}) {
  const title = route.title || route.name || route.routeId;
  const text = compactText([
    `路线：${route.name || route.routeId}`,
    route.durationMinutes ? `推荐时长：${route.durationMinutes}分钟` : '',
    Array.isArray(route.stopNames) && route.stopNames.length
      ? `途经点位：${route.stopNames.join(' -> ')}`
      : '',
    route.planText,
    Array.isArray(route.interestTags) && route.interestTags.length
      ? `兴趣标签：${route.interestTags.join('、')}`
      : '',
    Array.isArray(route.audienceTags) && route.audienceTags.length
      ? `适合人群：${route.audienceTags.join('、')}`
      : '',
    Array.isArray(route.emphasis) && route.emphasis.length
      ? route.emphasis.join('\n')
      : '',
  ]);

  return {
    blockId: `official:route:${route.routeId || hashText(title)}`,
    versionType: VERSION_TYPE_OFFICIAL,
    contentType: 'route',
    entityId: route.routeId || '',
    title,
    text,
    keywords: dedupe([
      route.routeId,
      route.name,
      ...(Array.isArray(route.stopNames) ? route.stopNames : []),
      ...(Array.isArray(route.interestTags) ? route.interestTags : []),
      ...(Array.isArray(route.audienceTags) ? route.audienceTags : []),
    ]),
    sourceRefs: ensureSourceRefs(route.sourceRefs),
    updatedAt: '',
  };
}

function buildGuideSectionKnowledgeBlock(section = {}) {
  const title = section.title || `指南章节 ${section.paragraphIndex ?? ''}`.trim();
  return {
    blockId: `official:section:${hashText(`${title}:${section.paragraphIndex ?? ''}`)}`,
    versionType: VERSION_TYPE_OFFICIAL,
    contentType: 'guide_section',
    entityId: title,
    title,
    text: title,
    keywords: dedupe([title]),
    sourceRefs: ensureSourceRefs(section.sourceRefs),
    updatedAt: '',
  };
}

function buildOfficialKnowledgeBlocks({ spots = [], guideSections = [], routes = [] } = {}) {
  return [
    ...(Array.isArray(spots) ? spots : []).map(buildSpotKnowledgeBlock),
    ...(Array.isArray(routes) ? routes : []).map(buildRouteKnowledgeBlock),
    ...(Array.isArray(guideSections) ? guideSections : []).map(buildGuideSectionKnowledgeBlock),
  ].filter((block) => block.text && block.sourceRefs.length > 0);
}

function matchesQuery(record = {}, query = '') {
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    record.spotId,
    record.routeId,
    record.name,
    record.title,
    record.section,
    record.text,
    ...(Array.isArray(record.keywords) ? record.keywords : []),
    ...(Array.isArray(record.stopNames) ? record.stopNames : []),
  ].map((value) => normalizeText(value).toLowerCase()).join('\n');

  if (haystack.includes(normalizedQuery)) {
    return true;
  }

  if (normalizedQuery.length < 4) {
    return false;
  }

  let cursor = 0;
  let matchedChars = 0;
  while (cursor < normalizedQuery.length) {
    let matchedLength = 0;
    const maxLength = Math.min(8, normalizedQuery.length - cursor);
    for (let length = maxLength; length >= 2; length -= 1) {
      const fragment = normalizedQuery.slice(cursor, cursor + length);
      if (haystack.includes(fragment)) {
        matchedLength = length;
        break;
      }
    }

    if (matchedLength > 0) {
      matchedChars += matchedLength;
      cursor += matchedLength;
    } else {
      cursor += 1;
    }
  }

  return matchedChars >= Math.min(normalizedQuery.length, 4);
}

function limitRecords(records = [], limit = 50) {
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 50;
  return records.slice(0, normalizedLimit);
}

class ScenicKnowledgeStore {
  constructor({
    app = null,
    storeFilePath = '',
    fileName = KNOWLEDGE_FILE_NAME,
  } = {}) {
    this.app = app;
    this.storeFilePath = normalizeText(storeFilePath);
    this.fileName = normalizeText(fileName, KNOWLEDGE_FILE_NAME);
    this.knowledgeBase = createEmptyKnowledgeBase();
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
      this.knowledgeBase = {
        ...createEmptyKnowledgeBase(),
        ...(parsed && typeof parsed === 'object' ? parsed : {}),
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to load scenic knowledge store:', error);
      }
      this.knowledgeBase = createEmptyKnowledgeBase();
    }
  }

  getKnowledgeBase() {
    return clone(this.knowledgeBase);
  }

  getSummary() {
    const base = this.knowledgeBase;
    return {
      datasetId: base.datasetId,
      scenicId: base.scenicId,
      version: base.version,
      rebuiltAt: base.rebuiltAt,
      spotCount: base.spots.length,
      guideSectionCount: base.guideSections.length,
      routeCount: base.routes.length,
      faqCount: base.faqs.length,
      knowledgeBlockCount: base.knowledgeBlocks.length,
      officialKnowledgeBlockCount: base.knowledgeBlocks
        .filter((block) => block.versionType === VERSION_TYPE_OFFICIAL).length,
      manualKnowledgeBlockCount: base.knowledgeBlocks
        .filter((block) => block.versionType === VERSION_TYPE_MANUAL).length,
    };
  }

  async persist() {
    const filePath = this.resolveStoreFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(this.knowledgeBase, null, 2), 'utf8');
    return this.getKnowledgeBase();
  }

  async rebuildFromOfficialData({
    datasetId = '',
    scenicId = 'lingshan',
    sources = [],
    importSummary = null,
    behaviorSummary = null,
    spots = [],
    guideSections = [],
    routes = [],
  } = {}) {
    const currentManualBlocks = this.knowledgeBase.knowledgeBlocks
      .filter((block) => block.versionType === VERSION_TYPE_MANUAL);
    const rebuiltAt = new Date().toISOString();
    const officialBlocks = buildOfficialKnowledgeBlocks({ spots, guideSections, routes })
      .map((block) => ({
        ...block,
        updatedAt: rebuiltAt,
      }));

    this.knowledgeBase = {
      ...createEmptyKnowledgeBase(),
      datasetId: normalizeText(datasetId),
      scenicId: normalizeText(scenicId, 'lingshan'),
      version: (Number.isFinite(this.knowledgeBase.version) ? this.knowledgeBase.version : 0) + 1,
      rebuiltAt,
      sources: Array.isArray(sources) ? clone(sources) : [],
      behaviorSummary: behaviorSummary || importSummary || null,
      spots: Array.isArray(spots) ? clone(spots) : [],
      guideSections: Array.isArray(guideSections) ? clone(guideSections) : [],
      routes: Array.isArray(routes) ? clone(routes) : [],
      faqs: Array.isArray(this.knowledgeBase.faqs) ? clone(this.knowledgeBase.faqs) : [],
      knowledgeBlocks: [
        ...officialBlocks,
        ...currentManualBlocks,
      ],
    };

    await this.persist();
    return this.getKnowledgeBase();
  }

  listSpots({ query = '', section = '', limit = 50 } = {}) {
    const normalizedSection = normalizeText(section).toLowerCase();
    const records = this.knowledgeBase.spots.filter((spot) => {
      if (normalizedSection && normalizeText(spot.section).toLowerCase() !== normalizedSection) {
        return false;
      }
      return matchesQuery(spot, query);
    });
    return clone(limitRecords(records, limit));
  }

  listRoutes({ query = '', limit = 50 } = {}) {
    const records = this.knowledgeBase.routes.filter((route) => matchesQuery(route, query));
    return clone(limitRecords(records, limit));
  }

  listKnowledgeBlocks({ query = '', contentType = '', versionType = '', limit = 50 } = {}) {
    const normalizedContentType = normalizeText(contentType).toLowerCase();
    const normalizedVersionType = normalizeText(versionType).toLowerCase();
    const records = this.knowledgeBase.knowledgeBlocks.filter((block) => {
      if (normalizedContentType && normalizeText(block.contentType).toLowerCase() !== normalizedContentType) {
        return false;
      }
      if (normalizedVersionType && normalizeText(block.versionType).toLowerCase() !== normalizedVersionType) {
        return false;
      }
      return matchesQuery(block, query);
    });
    return clone(limitRecords(records, limit));
  }

  async addManualKnowledgeBlock(block = {}) {
    const now = new Date().toISOString();
    const requestedId = normalizeText(block.blockId);
    const officialCollision = requestedId && this.knowledgeBase.knowledgeBlocks.some(
      (existing) => existing.blockId === requestedId && existing.versionType === VERSION_TYPE_OFFICIAL,
    );
    const blockId = officialCollision || !requestedId
      ? `manual:${hashText(`${block.title || ''}:${block.text || ''}:${now}`)}`
      : requestedId;

    this.knowledgeBase.knowledgeBlocks.push({
      blockId,
      versionType: VERSION_TYPE_MANUAL,
      contentType: normalizeText(block.contentType, 'manual_note'),
      entityId: normalizeText(block.entityId),
      title: normalizeText(block.title, '人工补充知识'),
      text: normalizeText(block.text),
      keywords: dedupe(block.keywords || []),
      sourceRefs: ensureSourceRefs(block.sourceRefs),
      updatedAt: now,
    });

    await this.persist();
    return this.getKnowledgeBase();
  }

  async clear() {
    this.knowledgeBase = createEmptyKnowledgeBase();
    const filePath = this.resolveStoreFilePath();
    await fs.rm(filePath, { force: true });
    return this.getKnowledgeBase();
  }
}

module.exports = {
  KNOWLEDGE_FILE_NAME,
  VERSION_TYPE_DERIVED,
  VERSION_TYPE_MANUAL,
  VERSION_TYPE_OFFICIAL,
  ScenicKnowledgeStore,
  buildOfficialKnowledgeBlocks,
  createEmptyKnowledgeBase,
};
