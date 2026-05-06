const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MATCH_TYPE_EXACT,
  MATCH_TYPE_KEYWORD,
  MATCH_TYPE_TEXT,
  MATCH_TYPE_TITLE,
  ScenicSearchIndex,
  buildSearchIndex,
  simpleChineseTokenize,
} = require('../services/scenicGuide/scenicSearchIndex');
const {
  VERSION_TYPE_OFFICIAL,
  buildOfficialKnowledgeBlocks,
} = require('../services/scenicGuide/scenicKnowledgeStore');

const mockSpots = [
  {
    spotId: 'LS-011',
    name: '灵山大佛',
    section: '灵山胜境',
    locationText: '核心景观区',
    coreFunction: '礼佛、观景与文化讲解',
    culture: '佛教文化核心象征',
    introduction: '灵山大佛是景区标志性景观，高88米。',
    highlights: ['宏伟壮观', '适合远眺与合影', '佛教圣地'],
    sourceRefs: [{ sourceId: 'official-spot-structure-docx', paragraphIndex: 80 }],
  },
  {
    spotId: 'LS-005',
    name: '九龙灌浴',
    section: '灵山胜境',
    introduction: '大型动态音乐喷泉景观，展示太子诞生传说。',
    highlights: ['适合亲子观看', '音乐喷泉表演'],
    sourceRefs: [{ sourceId: 'official-spot-structure-docx', paragraphIndex: 42 }],
  },
  {
    spotId: 'LS-008',
    name: '灵山梵宫',
    section: '灵山胜境',
    introduction: '佛教艺术宫殿，被誉为佛教艺术的卢浮宫。',
    highlights: ['建筑艺术', '佛教文化'],
    sourceRefs: [{ sourceId: 'official-spot-structure-docx', paragraphIndex: 60 }],
  },
];

const mockRoutes = [
  {
    routeId: 'history-lovers',
    name: '历史文化爱好者路线',
    durationMinutes: 180,
    stopNames: ['灵山胜境门楼', '灵山大佛', '灵山梵宫', '祥符禅寺'],
    interestTags: ['历史文化', '佛教文化'],
    audienceTags: ['成人', '老人'],
    planText: '这条路线深度体验灵山胜境的佛教文化内涵。',
    emphasis: ['佛教文化', '历史渊源', '艺术鉴赏'],
    sourceRefs: [{ sourceId: 'official-guide-docx', chapterIndex: 3 }],
  },
  {
    routeId: 'family-route',
    name: '亲子家庭路线',
    durationMinutes: 120,
    stopNames: ['九龙灌浴', '灵山大佛', '五印坛城'],
    interestTags: ['亲子互动', '自然风光'],
    audienceTags: ['亲子', '儿童'],
    planText: '适合带孩子的家庭游览，节奏轻松。',
    emphasis: ['轻松休闲', '互动体验', '寓教于乐'],
    sourceRefs: [{ sourceId: 'official-guide-docx', chapterIndex: 4 }],
  },
  {
    routeId: 'nature-route',
    name: '自然风光爱好者路线',
    durationMinutes: 150,
    stopNames: ['胜境门楼', '灵山大佛', '九龙灌浴'],
    interestTags: ['自然风光', '摄影'],
    audienceTags: ['摄影爱好者', '情侣'],
    planText: '欣赏灵山胜境的自然美景。',
    emphasis: ['自然景观', '拍照打卡'],
    sourceRefs: [{ sourceId: 'official-guide-docx', chapterIndex: 5 }],
  },
];

const mockGuideSections = [
  {
    title: '景点详解：灵山大佛',
    paragraphIndex: 15,
    text: '灵山大佛是景区核心景点，佛教文化象征。',
    sourceRefs: [{ sourceId: 'official-guide-docx', paragraphIndex: 15 }],
  },
  {
    title: '景点详解：九龙灌浴',
    paragraphIndex: 18,
    text: '九龙灌浴展示佛教故事，适合亲子观看。',
    sourceRefs: [{ sourceId: 'official-guide-docx', paragraphIndex: 18 }],
  },
];

function createMockKnowledgeStore() {
  const knowledgeBlocks = buildOfficialKnowledgeBlocks({
    spots: mockSpots,
    routes: mockRoutes,
    guideSections: mockGuideSections,
  });

  return {
    getSummary: () => ({
      version: 1,
      knowledgeBlockCount: knowledgeBlocks.length,
    }),
    getKnowledgeBase: () => ({
      version: 1,
      knowledgeBlocks,
    }),
  };
}

test('simpleChineseTokenize - 基础分词', (t) => {
  const result = simpleChineseTokenize('灵山大佛');
  assert.deepEqual(result, ['灵', '山', '大', '佛']);
});

test('simpleChineseTokenize - 混合分词', (t) => {
  const result = simpleChineseTokenize('LS-011点位');
  assert.deepEqual(result, ['ls', '011', '点', '位']);
});

test('simpleChineseTokenize - 空字符串', (t) => {
  const result = simpleChineseTokenize('');
  assert.deepEqual(result, []);
});

test('buildSearchIndex - 构建索引', (t) => {
  const knowledgeBlocks = buildOfficialKnowledgeBlocks({
    spots: mockSpots,
    routes: mockRoutes,
  });

  const index = buildSearchIndex(knowledgeBlocks);

  assert.ok(index.byBlockId.size > 0);
  assert.ok(index.byKeywords.has('灵山大佛'.toLowerCase()));
  assert.ok(index.byKeywords.has('ls-011'));
});

test('ScenicSearchIndex.exactMatchSpotId - 精确匹配点位ID', async (t) => {
  const mockStore = createMockKnowledgeStore();
  const searchIndex = new ScenicSearchIndex({ knowledgeStore: mockStore });

  await searchIndex.rebuildIndex();

  const results = searchIndex.exactMatchSpotId('LS-011');
  assert.equal(results.length, 1);
  assert.equal(results[0].block.entityId, 'LS-011');
  assert.equal(results[0].block.title, '灵山大佛 LS-011');
  assert.equal(results[0].score, 100);
  assert.equal(results[0].match.matchType, MATCH_TYPE_EXACT);
});

test('ScenicSearchIndex.exactMatchRouteId - 精确匹配路线ID', async (t) => {
  const mockStore = createMockKnowledgeStore();
  const searchIndex = new ScenicSearchIndex({ knowledgeStore: mockStore });

  await searchIndex.rebuildIndex();

  const results = searchIndex.exactMatchRouteId('family-route');
  assert.equal(results.length, 1);
  assert.equal(results[0].block.entityId, 'family-route');
  assert.equal(results[0].block.title, '亲子家庭路线');
  assert.equal(results[0].score, 100);
});

test('ScenicSearchIndex.searchByKeywords - 关键词匹配', async (t) => {
  const mockStore = createMockKnowledgeStore();
  const searchIndex = new ScenicSearchIndex({ knowledgeStore: mockStore });

  await searchIndex.rebuildIndex();

  const results = searchIndex.searchByKeywords(['灵山', '大佛']);
  assert.ok(results.length > 0, '应该找到包含关键词的结果');

  const topResult = results[0];
  assert.ok(topResult.score > 60);
  assert.equal(topResult.match.matchType, MATCH_TYPE_KEYWORD);
  assert.ok(topResult.match.matchCount >= 1);
});

test('ScenicSearchIndex.searchByFullText - 全文检索', async (t) => {
  const mockStore = createMockKnowledgeStore();
  const searchIndex = new ScenicSearchIndex({ knowledgeStore: mockStore });

  await searchIndex.rebuildIndex();

  const results = searchIndex.searchByFullText(['佛教', '文化']);
  assert.ok(results.length > 0);

  assert.ok(results.every((r) => r.score >= 40));
});

test('ScenicSearchIndex.search - 灵山大佛匹配LS-011和指南章节', async (t) => {
  const mockStore = createMockKnowledgeStore();
  const searchIndex = new ScenicSearchIndex({ knowledgeStore: mockStore });

  const result = await searchIndex.search({ query: '灵山大佛' });

  assert.ok(result.ok);
  assert.equal(result.query, '灵山大佛');
  assert.ok(result.totalHits > 0);

  const hits = result.hits;
  const spotHit = result.hits.find((h) => h.contentType === 'spot' && h.entityId === 'LS-011');
  assert.ok(spotHit, '应该命中 LS-011 灵山大佛');
  assert.ok(spotHit.score >= 80);
  assert.ok(spotHit.matchReasons.length > 0);

  const sectionHits = hits.filter((h) => h.contentType === 'guide_section');
  assert.ok(sectionHits.length > 0, '应该命中指南章节');
});

test('ScenicSearchIndex.search - 九龙灌浴亲子命中景点与路线', async (t) => {
  const mockStore = createMockKnowledgeStore();
  const searchIndex = new ScenicSearchIndex({ knowledgeStore: mockStore });

  const result = await searchIndex.search({ query: '九龙灌浴亲子' });

  assert.ok(result.ok);
  assert.equal(result.query, '九龙灌浴亲子');
  assert.ok(result.totalHits > 0);

  const spotHit = result.hits.find((h) => h.contentType === 'spot' && h.entityId === 'LS-005');
  assert.ok(spotHit, '应该命中 LS-005 九龙灌浴');

  const routeHits = result.hits.filter((h) => h.contentType === 'route');
  assert.ok(routeHits.length > 0, '应该命中路线');

  const familyRoute = routeHits.find((h) => h.entityId === 'family-route');
  assert.ok(familyRoute, '应该命中亲子家庭路线');
});

test('ScenicSearchIndex.search - 未命中时返回空结果', async (t) => {
  const mockStore = createMockKnowledgeStore();
  const searchIndex = new ScenicSearchIndex({ knowledgeStore: mockStore });

  const result = await searchIndex.search({ query: '不存在的景点名称xyz123', minScore: 85 });

  assert.ok(result.ok);
  assert.equal(result.totalHits, 0);
  assert.equal(result.hits.length, 0);
});

test('ScenicSearchIndex.search - 按contentType过滤', async (t) => {
  const mockStore = createMockKnowledgeStore();
  const searchIndex = new ScenicSearchIndex({ knowledgeStore: mockStore });

  const spotResult = await searchIndex.search({ query: '灵山', contentType: 'spot' });
  assert.ok(spotResult.ok);
  assert.ok(spotResult.hits.every((h) => h.contentType === 'spot'));

  const routeResult = await searchIndex.search({ query: '灵山', contentType: 'route' });
  assert.ok(routeResult.ok);
  assert.ok(routeResult.hits.every((h) => h.contentType === 'route'));
});

test('ScenicSearchIndex.search - 限制返回数量', async (t) => {
  const mockStore = createMockKnowledgeStore();
  const searchIndex = new ScenicSearchIndex({ knowledgeStore: mockStore });

  const result = await searchIndex.search({ query: '灵山', limit: 2 });
  assert.ok(result.ok);
  assert.ok(result.hits.length <= 2);
});

test('ScenicSearchIndex.search - 最低分数过滤', async (t) => {
  const mockStore = createMockKnowledgeStore();
  const searchIndex = new ScenicSearchIndex({ knowledgeStore: mockStore });

  const result = await searchIndex.search({ query: '灵山', minScore: 90 });
  assert.ok(result.ok);
  assert.ok(result.hits.every((h) => h.score >= 90));
});

test('ScenicSearchIndex.search - 空查询返回空结果', async (t) => {
  const mockStore = createMockKnowledgeStore();
  const searchIndex = new ScenicSearchIndex({ knowledgeStore: mockStore });

  const result = await searchIndex.search({ query: '' });
  assert.ok(result.ok);
  assert.equal(result.totalHits, 0);
  assert.equal(result.meta.reason, 'empty_query');
});

test('ScenicSearchIndex - 自动重建索引', async (t) => {
  let version = 1;
  const mockStore = {
    getSummary: () => ({ version }),
    getKnowledgeBase: () => ({
      version,
      knowledgeBlocks: buildOfficialKnowledgeBlocks({ spots: mockSpots }),
    }),
  };

  const searchIndex = new ScenicSearchIndex({ knowledgeStore: mockStore });

  await searchIndex.search({ query: '灵山大佛' });
  assert.equal(searchIndex.lastRebuiltVersion, 1);

  version = 2;
  await searchIndex.search({ query: '灵山大佛' });
  assert.equal(searchIndex.lastRebuiltVersion, 2);
});
