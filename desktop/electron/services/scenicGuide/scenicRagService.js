const crypto = require('node:crypto');

const { ScenicSearchIndex } = require('./scenicSearchIndex');

const DEFAULT_LIMIT = 5;
const DEFAULT_MIN_SCORE = 35;

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || fallback;
}

function truncateText(value = '', maxLength = 220) {
  const normalized = normalizeText(value).replace(/\s+/g, ' ');
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function getTextLines(value = '') {
  return normalizeText(value)
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function stripLeadingLabel(line = '') {
  return normalizeText(line).replace(/^(点位|路线|位置|参数|核心功能|文化内涵|介绍|游览亮点|开放信息|提示|推荐时长|途经点位|兴趣标签|适合人群)：/, '');
}

function findLabeledValue(text = '', labels = []) {
  const lines = getTextLines(text);
  for (const label of Array.isArray(labels) ? labels : []) {
    const line = lines.find((item) => item.startsWith(`${label}：`));
    if (line) {
      return stripLeadingLabel(line);
    }
  }
  return '';
}

function getUsefulLines(hit = {}, limit = 4) {
  return getTextLines(hit.text)
    .map(stripLeadingLabel)
    .filter(Boolean)
    .slice(0, limit);
}

function getSpotLines(hit = {}) {
  const prioritized = [
    findLabeledValue(hit.text, ['介绍']),
    findLabeledValue(hit.text, ['核心功能']),
    findLabeledValue(hit.text, ['文化内涵']),
    findLabeledValue(hit.text, ['游览亮点']),
    findLabeledValue(hit.text, ['开放信息']),
    findLabeledValue(hit.text, ['位置']),
  ].filter(Boolean);

  return prioritized.length ? prioritized.slice(0, 3) : getUsefulLines(hit, 3);
}

function getRouteLines(hit = {}) {
  const prioritized = [
    findLabeledValue(hit.text, ['推荐时长']),
    findLabeledValue(hit.text, ['途经点位']),
    findLabeledValue(hit.text, ['兴趣标签']),
    findLabeledValue(hit.text, ['适合人群']),
  ].filter(Boolean);

  return prioritized.length ? prioritized.slice(0, 4) : getUsefulLines(hit, 4);
}

function normalizeLimit(value) {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 10) : DEFAULT_LIMIT;
}

function normalizeSourceRef(ref = {}) {
  const normalized = ref && typeof ref === 'object' ? ref : {};
  return {
    sourceId: normalizeText(normalized.sourceId),
    section: normalizeText(normalized.section),
    paragraphIndex: Number.isFinite(normalized.paragraphIndex) ? normalized.paragraphIndex : null,
    chapterIndex: Number.isFinite(normalized.chapterIndex) ? normalized.chapterIndex : null,
  };
}

function normalizeSources(hits = []) {
  return hits.map((hit, index) => {
    const sourceRefs = (Array.isArray(hit.sourceRefs) ? hit.sourceRefs : [])
      .map(normalizeSourceRef)
      .filter((ref) => ref.sourceId);
    return {
      sourceId: sourceRefs[0]?.sourceId || '',
      sourceRefs,
      rank: index + 1,
      blockId: normalizeText(hit.blockId),
      title: normalizeText(hit.title, '官方资料片段'),
      contentType: normalizeText(hit.contentType),
      entityId: normalizeText(hit.entityId),
      score: Number.isFinite(hit.score) ? hit.score : 0,
      matchReasons: Array.isArray(hit.matchReasons) ? [...hit.matchReasons] : [],
      excerpt: truncateText(hit.text, 260),
    };
  });
}

function getConfidence(topHit = null) {
  if (!topHit || !Number.isFinite(topHit.score)) {
    return 0;
  }
  return Math.max(0.35, Math.min(0.96, topHit.score / 100));
}

function selectPrimaryHit(question = '', hits = []) {
  const wantsRoute = /路线|怎么走|游览|亲子|家庭|适合|推荐|几个小时|多久/.test(question);
  if (wantsRoute) {
    return hits.find((hit) => hit.contentType === 'route') || hits[0] || null;
  }
  return hits[0] || null;
}

function buildHitSentence(hit = {}) {
  const lines =
    hit.contentType === 'spot'
      ? getSpotLines(hit)
      : hit.contentType === 'route'
        ? getRouteLines(hit)
        : getUsefulLines(hit, 4);
  if (!lines.length) {
    return normalizeText(hit.title, '这条资料暂时缺少摘要。');
  }

  if (hit.contentType === 'route') {
    return lines.join('；');
  }

  return lines.slice(0, 3).join('；');
}

function buildRelatedSentence(primaryHit = {}, hits = []) {
  const related = hits
    .filter((hit) => hit.blockId !== primaryHit.blockId)
    .slice(0, 2)
    .map((hit) => {
      const sentence = buildHitSentence(hit);
      return `「${hit.title}」：${truncateText(sentence, 90)}`;
    });

  if (!related.length) {
    return '';
  }

  return `相关资料还提到：${related.join('；')}。`;
}

function buildAnswer({ question = '', hits = [] } = {}) {
  const primaryHit = selectPrimaryHit(question, hits);
  if (!primaryHit) {
    return {
      answer: '我没有在已导入的灵山胜境官方资料中找到足够依据。可以换一个更具体的景点、路线或游玩偏好再问。',
      status: 'no_hit',
      confidence: 0,
    };
  }

  const primarySentence = buildHitSentence(primaryHit);
  const relatedSentence = buildRelatedSentence(primaryHit, hits);
  const lead =
    primaryHit.contentType === 'route'
      ? `可以优先参考「${primaryHit.title}」。${primarySentence}。`
      : `根据官方资料，「${primaryHit.title}」的关键信息是：${primarySentence}。`;
  const tail = relatedSentence ? `\n\n${relatedSentence}` : '';

  return {
    answer: `${lead}${tail}\n\n以上回答来自已导入的灵山胜境官方资料。`,
    status: 'answered',
    confidence: getConfidence(primaryHit),
  };
}

function createAnswerId(question = '', answer = '') {
  return crypto.createHash('sha1').update(`${question}\n${answer}`).digest('hex').slice(0, 16);
}

class ScenicRagService {
  constructor({
    knowledgeStore = null,
    searchIndex = null,
  } = {}) {
    this.knowledgeStore = knowledgeStore;
    this.searchIndex = searchIndex || new ScenicSearchIndex({ knowledgeStore });
  }

  getKnowledgeSummary() {
    return this.knowledgeStore && typeof this.knowledgeStore.getSummary === 'function'
      ? this.knowledgeStore.getSummary()
      : null;
  }

  async askQuestion({
    question = '',
    limit = DEFAULT_LIMIT,
    minScore = DEFAULT_MIN_SCORE,
  } = {}) {
    const normalizedQuestion = normalizeText(question);
    if (!normalizedQuestion) {
      return {
        ok: false,
        error: {
          code: 'empty_scenic_question',
          message: '请先输入要咨询的景区问题。',
        },
      };
    }

    const summary = this.getKnowledgeSummary();
    if (!summary || Number(summary.knowledgeBlockCount || 0) <= 0) {
      return {
        ok: false,
        error: {
          code: 'official_data_not_imported',
          message: '请先在景区管理后台导入灵山胜境官方资料包。',
        },
      };
    }

    const searchResult = await this.searchIndex.search({
      query: normalizedQuestion,
      limit: normalizeLimit(limit),
      minScore: Number.isFinite(minScore) ? minScore : DEFAULT_MIN_SCORE,
    });
    const hits = Array.isArray(searchResult?.hits) ? searchResult.hits : [];
    const answerResult = buildAnswer({ question: normalizedQuestion, hits });
    const sources = normalizeSources(hits);

    return {
      ok: true,
      answerId: createAnswerId(normalizedQuestion, answerResult.answer),
      question: normalizedQuestion,
      answer: answerResult.answer,
      status: answerResult.status,
      confidence: answerResult.confidence,
      sources,
      hits,
      generatedAt: new Date().toISOString(),
      retrieval: {
        totalHits: Number.isFinite(searchResult?.totalHits) ? searchResult.totalHits : hits.length,
        queryTokens: Array.isArray(searchResult?.meta?.queryTokens) ? searchResult.meta.queryTokens : [],
        indexVersion: Number.isFinite(searchResult?.meta?.indexVersion) ? searchResult.meta.indexVersion : 0,
      },
    };
  }
}

module.exports = {
  ScenicRagService,
  buildAnswer,
  normalizeSources,
};
