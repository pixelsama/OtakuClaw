const { ScenicKnowledgeStore } = require('./scenicKnowledgeStore');

const MATCH_TYPE_EXACT = 'exact';
const MATCH_TYPE_TITLE = 'title';
const MATCH_TYPE_KEYWORD = 'keyword';
const MATCH_TYPE_TEXT = 'text';
const MATCH_TYPE_HYBRID = 'hybrid';

const CONTENT_TYPE_SPOT = 'spot';
const CONTENT_TYPE_ROUTE = 'route';
const CONTENT_TYPE_GUIDE_SECTION = 'guide_section';
const CONTENT_TYPE_FAQ = 'faq';

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || fallback;
}

function simpleChineseTokenize(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const tokens = [];
  let current = '';

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];

    if (/[a-zA-Z0-9]/.test(char)) {
      current += char;
    } else if (current) {
      tokens.push(current.toLowerCase());
      current = '';
    }

    if (/[\u4e00-\u9fa5]/.test(char)) {
      tokens.push(char.toLowerCase());
    }
  }

  if (current) {
    tokens.push(current.toLowerCase());
  }

  return tokens;
}

function buildSearchIndex(knowledgeBlocks = []) {
  const index = {
    byBlockId: new Map(),
    byEntityType: new Map(),
    byContentType: new Map(),
    byKeywords: new Map(),
    fullTextTokens: new Map(),
  };

  (Array.isArray(knowledgeBlocks) ? knowledgeBlocks : []).forEach((block) => {
    const blockId = normalizeText(block.blockId);
    const contentType = normalizeText(block.contentType);
    const entityId = normalizeText(block.entityId);

    if (!blockId) {
      return;
    }

    index.byBlockId.set(blockId, block);

    if (contentType) {
      if (!index.byContentType.has(contentType)) {
        index.byContentType.set(contentType, new Set());
      }
      index.byContentType.get(contentType).add(blockId);
    }

    if (entityId && contentType) {
      const entityKey = `${contentType}:${entityId}`;
      if (!index.byEntityType.has(entityKey)) {
        index.byEntityType.set(entityKey, new Set());
      }
      index.byEntityType.get(entityKey).add(blockId);
    }

    const keywords = Array.isArray(block.keywords) ? block.keywords : [];
    keywords.forEach((keyword) => {
      const normalizedKeyword = normalizeText(keyword);
      if (!normalizedKeyword) {
        return;
      }

      const keywordTokens = simpleChineseTokenize(normalizedKeyword);
      keywordTokens.forEach((token) => {
        if (!index.byKeywords.has(token)) {
          index.byKeywords.set(token, new Set());
        }
        index.byKeywords.get(token).add(blockId);
      });

      const wholeKeyword = normalizedKeyword.toLowerCase();
      if (!index.byKeywords.has(wholeKeyword)) {
        index.byKeywords.set(wholeKeyword, new Set());
      }
      index.byKeywords.get(wholeKeyword).add(blockId);

      for (let i = 0; i < keywordTokens.length - 1; i += 1) {
        const bigram = `${keywordTokens[i]}${keywordTokens[i + 1]}`;
        if (!index.byKeywords.has(bigram)) {
          index.byKeywords.set(bigram, new Set());
        }
        index.byKeywords.get(bigram).add(blockId);
      }
    });

    const titleTokens = simpleChineseTokenize(block.title || '');
    const textTokens = simpleChineseTokenize(block.text || '');
    index.fullTextTokens.set(blockId, new Set([...titleTokens, ...textTokens]));
  });

  return index;
}

function calculateMatchScore(match = {}) {
  const { matchType = '', matchCount = 0, coverage = 0 } = match;

  if (matchType === MATCH_TYPE_EXACT) {
    return 100;
  }

  if (matchType === MATCH_TYPE_TITLE) {
    return 80 + Math.min(coverage * 10, 20);
  }

  if (matchType === MATCH_TYPE_KEYWORD) {
    return 60 + Math.min(matchCount * 5, 20);
  }

  if (matchType === MATCH_TYPE_HYBRID) {
    return 70 + Math.min(matchCount * 3, 15) + Math.min(coverage * 5, 15);
  }

  if (matchType === MATCH_TYPE_TEXT) {
    return 40 + Math.min(coverage * 20, 20);
  }

  return 0;
}

class ScenicSearchIndex {
  constructor({ knowledgeStore = null } = {}) {
    this.knowledgeStore = knowledgeStore;
    this.index = null;
    this.lastRebuiltVersion = -1;
  }

  async ensureIndex() {
    if (!this.knowledgeStore) {
      return false;
    }

    const summary = this.knowledgeStore.getSummary();
    if (summary.version === this.lastRebuiltVersion && this.index) {
      return true;
    }

    return this.rebuildIndex();
  }

  async rebuildIndex() {
    if (!this.knowledgeStore) {
      return false;
    }

    const knowledgeBase = this.knowledgeStore.getKnowledgeBase();
    this.index = buildSearchIndex(knowledgeBase.knowledgeBlocks || []);
    this.lastRebuiltVersion = knowledgeBase.version || 0;
    return true;
  }

  exactMatchSpotId(spotId = '') {
    if (!this.index || !spotId) {
      return [];
    }

    const entityKey = `${CONTENT_TYPE_SPOT}:${normalizeText(spotId)}`;
    const blockIds = this.index.byEntityType.get(entityKey);

    if (!blockIds || blockIds.size === 0) {
      return [];
    }

    return Array.from(blockIds)
      .map((blockId) => this.index.byBlockId.get(blockId))
      .filter((block) => block && block.contentType === CONTENT_TYPE_SPOT)
      .map((block) => ({
        block,
        match: {
          matchType: MATCH_TYPE_EXACT,
          matchCount: 1,
          coverage: 1.0,
          reasons: [`点位ID精确匹配: ${spotId}`],
        },
        score: 100,
      }));
  }

  exactMatchRouteId(routeId = '') {
    if (!this.index || !routeId) {
      return [];
    }

    const entityKey = `${CONTENT_TYPE_ROUTE}:${normalizeText(routeId)}`;
    const blockIds = this.index.byEntityType.get(entityKey);

    if (!blockIds || blockIds.size === 0) {
      return [];
    }

    return Array.from(blockIds)
      .map((blockId) => this.index.byBlockId.get(blockId))
      .filter((block) => block && block.contentType === CONTENT_TYPE_ROUTE)
      .map((block) => ({
        block,
        match: {
          matchType: MATCH_TYPE_EXACT,
          matchCount: 1,
          coverage: 1.0,
          reasons: [`路线ID精确匹配: ${routeId}`],
        },
        score: 100,
      }));
  }

  searchByKeywords(queryTokens = []) {
    if (!this.index || !queryTokens.length) {
      return [];
    }

    const normalizedTokens = queryTokens.map((t) => normalizeText(t).toLowerCase()).filter(Boolean);
    if (!normalizedTokens.length) {
      return [];
    }

    const blockScores = new Map();

    normalizedTokens.forEach((token) => {
      const blockIds = this.index.byKeywords.get(token);
      if (blockIds) {
        blockIds.forEach((blockId) => {
          const current = blockScores.get(blockId) || { matchCount: 0, matchedTokens: new Set() };
          current.matchCount += 1;
          current.matchedTokens.add(token);
          blockScores.set(blockId, current);
        });
      }
    });

    const results = [];
    blockScores.forEach((score, blockId) => {
      const block = this.index.byBlockId.get(blockId);
      if (!block) {
        return;
      }

      const coverage = score.matchedTokens.size / normalizedTokens.length;
      results.push({
        block,
        match: {
          matchType: MATCH_TYPE_KEYWORD,
          matchCount: score.matchCount,
          coverage,
          reasons: [`关键词匹配: ${Array.from(score.matchedTokens).join('、')}`],
        },
        score: calculateMatchScore({
          matchType: MATCH_TYPE_KEYWORD,
          matchCount: score.matchCount,
          coverage,
        }),
      });
    });

    return results.sort((a, b) => b.score - a.score);
  }

  searchByFullText(queryTokens = []) {
    if (!this.index || !queryTokens.length) {
      return [];
    }

    const normalizedTokens = queryTokens.map((t) => normalizeText(t).toLowerCase()).filter(Boolean);
    if (!normalizedTokens.length) {
      return [];
    }

    const results = [];

    this.index.byBlockId.forEach((block, blockId) => {
      const blockTokens = this.index.fullTextTokens.get(blockId);
      if (!blockTokens) {
        return;
      }

      let matchCount = 0;
      const matchedTokens = new Set();

      normalizedTokens.forEach((token) => {
        if (blockTokens.has(token)) {
          matchCount += 1;
          matchedTokens.add(token);
        }
      });

      const keywords = Array.isArray(block.keywords) ? block.keywords : [];
      keywords.forEach((keyword) => {
        const normalizedKeyword = normalizeText(keyword).toLowerCase();
        normalizedTokens.forEach((token) => {
          if (normalizedKeyword.includes(token) || token.includes(normalizedKeyword)) {
            matchCount += 1;
            matchedTokens.add(token);
          }
        });
      });

      if (matchCount === 0) {
        return;
      }

      const coverage = matchedTokens.size / normalizedTokens.length;
      const titleTokens = simpleChineseTokenize(block.title || '');
      const isTitleMatch = titleTokens.some((t) => matchedTokens.has(t));

      results.push({
        block,
        match: {
          matchType: isTitleMatch ? MATCH_TYPE_HYBRID : MATCH_TYPE_TEXT,
          matchCount,
          coverage,
          reasons: isTitleMatch
            ? [`标题和内容匹配: ${Array.from(matchedTokens).join('、')}`]
            : [`内容匹配: ${Array.from(matchedTokens).join('、')}`],
        },
        score: calculateMatchScore({
          matchType: isTitleMatch ? MATCH_TYPE_HYBRID : MATCH_TYPE_TEXT,
          matchCount,
          coverage,
        }),
      });
    });

    return results.sort((a, b) => b.score - a.score);
  }

  async search({
    query = '',
    contentType = '',
    limit = 20,
    minScore = 30,
  } = {}) {
    await this.ensureIndex();

    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery && !contentType) {
      return {
        ok: true,
        hits: [],
        totalHits: 0,
        query: '',
        meta: {
          reason: 'empty_query',
          message: '查询词为空',
        },
      };
    }

    const queryTokens = simpleChineseTokenize(normalizedQuery);
    const allResults = [];

    if (contentType === CONTENT_TYPE_SPOT || !contentType) {
      const spotHits = this.exactMatchSpotId(normalizedQuery);
      allResults.push(...spotHits);
    }

    if (contentType === CONTENT_TYPE_ROUTE || !contentType) {
      const routeHits = this.exactMatchRouteId(normalizedQuery);
      allResults.push(...routeHits);
    }

    if (!contentType || contentType === CONTENT_TYPE_SPOT) {
      const keywordHits = this.searchByKeywords(queryTokens);
      allResults.push(...keywordHits.filter((r) => r.block.contentType === CONTENT_TYPE_SPOT));
    }

    if (!contentType) {
      const fullTextHits = this.searchByFullText(queryTokens);
      allResults.push(...fullTextHits);
    }

    const filteredByContentType = contentType
      ? allResults.filter((r) => r.block.contentType === contentType)
      : allResults;

    const uniqueResults = new Map();
    filteredByContentType.forEach((result) => {
      const existing = uniqueResults.get(result.block.blockId);
      if (!existing || result.score > existing.score) {
        uniqueResults.set(result.block.blockId, result);
      }
    });

    const scoredResults = Array.from(uniqueResults.values())
      .filter((result) => result.score >= (Number.isFinite(minScore) ? minScore : 30))
      .sort((a, b) => b.score - a.score);

    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 20;
    const limitedResults = scoredResults.slice(0, normalizedLimit);

    return {
      ok: true,
      hits: limitedResults.map((result) => ({
        blockId: result.block.blockId,
        contentType: result.block.contentType,
        entityId: result.block.entityId,
        title: result.block.title,
        text: result.block.text,
        score: result.score,
        matchReasons: result.match.reasons,
        versionType: result.block.versionType,
        sourceRefs: result.block.sourceRefs,
      })),
      totalHits: scoredResults.length,
      query: normalizedQuery,
      meta: {
        hasIndex: !!this.index,
        indexVersion: this.lastRebuiltVersion,
        queryTokens,
        resultCount: limitedResults.length,
      },
    };
  }
}

module.exports = {
  MATCH_TYPE_EXACT,
  MATCH_TYPE_HYBRID,
  MATCH_TYPE_KEYWORD,
  MATCH_TYPE_TEXT,
  MATCH_TYPE_TITLE,
  ScenicSearchIndex,
  buildSearchIndex,
  simpleChineseTokenize,
};
