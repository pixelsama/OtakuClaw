const assert = require('node:assert/strict');
const test = require('node:test');

const { ScenicRagService } = require('../services/scenicGuide/scenicRagService');
const { buildOfficialKnowledgeBlocks } = require('../services/scenicGuide/scenicKnowledgeStore');

const mockSpots = [
  {
    spotId: 'LS-011',
    name: '灵山大佛',
    section: '灵山胜境',
    locationText: '核心景观区',
    coreFunction: '礼佛、观景与文化讲解',
    culture: '佛教文化核心象征',
    introduction: '灵山大佛是景区标志性景观，高88米。',
    highlights: ['宏伟壮观', '适合远眺与合影'],
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
];

const mockRoutes = [
  {
    routeId: 'official-family-4h',
    name: '亲子家庭路线',
    durationMinutes: 240,
    stopNames: ['南门入园', '九龙灌浴', '灵山大佛', '百子戏弥勒'],
    interestTags: ['亲子互动', '轻松休闲'],
    audienceTags: ['亲子家庭', '儿童游客'],
    planText: '路线规划：南门入园 -> 九龙灌浴 -> 灵山大佛 -> 百子戏弥勒',
    emphasis: ['适合家庭游客。'],
    sourceRefs: [{ sourceId: 'official-guide-docx', paragraphIndex: 100 }],
  },
];

const mockGuideSections = [
  {
    title: '灵山胜境景区概况',
    paragraphIndex: 12,
    sourceRefs: [{ sourceId: 'official-guide-docx', paragraphIndex: 12 }],
  },
];

function createKnowledgeStore() {
  const knowledgeBlocks = buildOfficialKnowledgeBlocks({
    spots: mockSpots,
    routes: mockRoutes,
    guideSections: mockGuideSections,
  });

  return {
    getSummary() {
      return {
        datasetId: 'official-lingshan-2026',
        scenicId: 'lingshan',
        version: 1,
        knowledgeBlockCount: knowledgeBlocks.length,
      };
    },
    getKnowledgeBase() {
      return {
        version: 1,
        knowledgeBlocks,
      };
    },
  };
}

test('ScenicRagService answers scenic questions with traceable sources', async () => {
  const service = new ScenicRagService({
    knowledgeStore: createKnowledgeStore(),
  });

  const result = await service.askQuestion({
    question: '灵山大佛有什么特色？',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'answered');
  assert.match(result.answer, /灵山大佛/);
  assert.match(result.answer, /官方资料/);
  assert.ok(result.confidence >= 0.6);
  assert.ok(Array.isArray(result.sources));
  assert.ok(result.sources.length >= 1);
  assert.equal(result.sources[0].sourceRefs[0].sourceId, 'official-spot-structure-docx');
});

test('ScenicRagService prefers route material for route recommendation questions', async () => {
  const service = new ScenicRagService({
    knowledgeStore: createKnowledgeStore(),
  });

  const result = await service.askQuestion({
    question: '亲子家庭适合走哪条路线？',
  });

  assert.equal(result.ok, true);
  assert.match(result.answer, /亲子家庭路线/);
  assert.match(result.answer, /九龙灌浴/);
  assert.ok(result.sources.some((source) => source.contentType === 'route'));
});

test('ScenicRagService rejects empty questions and missing imported data', async () => {
  const emptyQuestionService = new ScenicRagService({
    knowledgeStore: createKnowledgeStore(),
  });
  const emptyQuestionResult = await emptyQuestionService.askQuestion({
    question: '   ',
  });
  assert.equal(emptyQuestionResult.ok, false);
  assert.equal(emptyQuestionResult.error.code, 'empty_scenic_question');

  const missingDataService = new ScenicRagService({
    knowledgeStore: {
      getSummary() {
        return {
          knowledgeBlockCount: 0,
        };
      },
      getKnowledgeBase() {
        return {
          version: 0,
          knowledgeBlocks: [],
        };
      },
    },
  });
  const missingDataResult = await missingDataService.askQuestion({
    question: '灵山大佛有什么特色？',
  });
  assert.equal(missingDataResult.ok, false);
  assert.equal(missingDataResult.error.code, 'official_data_not_imported');
});
