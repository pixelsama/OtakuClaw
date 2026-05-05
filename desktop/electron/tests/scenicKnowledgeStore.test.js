const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  VERSION_TYPE_MANUAL,
  VERSION_TYPE_OFFICIAL,
  ScenicKnowledgeStore,
  buildOfficialKnowledgeBlocks,
} = require('../services/scenicGuide/scenicKnowledgeStore');

const officialFixture = {
  datasetId: 'official-lingshan-2026',
  scenicId: 'lingshan',
  sources: [{ id: 'official-spot-structure-docx' }],
  importSummary: {
    spotCount: 2,
    routeCount: 1,
  },
  spots: [
    {
      scenicId: 'lingshan',
      spotId: 'LS-011',
      name: '灵山大佛',
      section: '灵山胜境',
      locationText: '核心景观区',
      coreFunction: '礼佛、观景与文化讲解',
      culture: '佛教文化核心象征',
      introduction: '灵山大佛是景区标志性景观。',
      highlights: ['适合远眺与合影'],
      sourceRefs: [{ sourceId: 'official-spot-structure-docx', paragraphIndex: 80 }],
    },
    {
      scenicId: 'lingshan',
      spotId: 'LS-005',
      name: '九龙灌浴',
      section: '灵山胜境',
      introduction: '大型动态音乐喷泉景观。',
      highlights: ['适合亲子观看'],
      sourceRefs: [{ sourceId: 'official-spot-structure-docx', paragraphIndex: 42 }],
    },
  ],
  guideSections: [
    {
      title: '景点详解',
      paragraphIndex: 12,
      sourceRefs: [{ sourceId: 'official-guide-docx', paragraphIndex: 12 }],
    },
  ],
  routes: [
    {
      routeId: 'official-family-4h',
      name: '亲子家庭路线',
      title: '亲子家庭路线（4小时轻松游）',
      durationMinutes: 240,
      stopNames: ['南门入园', '九龙灌浴', '百子戏弥勒'],
      interestTags: ['亲子互动'],
      audienceTags: ['亲子家庭'],
      planText: '路线规划：南门入园 -> 九龙灌浴 -> 百子戏弥勒',
      emphasis: ['适合家庭游客。'],
      sourceRefs: [{ sourceId: 'official-guide-docx', paragraphIndex: 100 }],
    },
  ],
};

test('buildOfficialKnowledgeBlocks creates source-traceable blocks', () => {
  const blocks = buildOfficialKnowledgeBlocks(officialFixture);

  assert.equal(blocks.length, 4);
  assert.ok(blocks.every((block) => block.versionType === VERSION_TYPE_OFFICIAL));
  assert.ok(blocks.every((block) => block.sourceRefs.length > 0));
  assert.ok(blocks.some((block) => block.blockId === 'official:spot:LS-011'));
  assert.ok(blocks.some((block) => block.blockId === 'official:route:official-family-4h'));
});

test('scenic knowledge store rebuilds, queries, preserves manual notes, and reloads', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scenic-knowledge-store-test-'));
  const storeFilePath = path.join(tmpDir, 'knowledge.json');
  const store = new ScenicKnowledgeStore({ storeFilePath });
  await store.init();

  await store.rebuildFromOfficialData(officialFixture);

  let summary = store.getSummary();
  assert.equal(summary.datasetId, 'official-lingshan-2026');
  assert.equal(summary.spotCount, 2);
  assert.equal(summary.routeCount, 1);
  assert.equal(summary.knowledgeBlockCount, 4);
  assert.equal(summary.officialKnowledgeBlockCount, 4);

  const buddhaSpots = store.listSpots({ query: '灵山大佛' });
  assert.equal(buddhaSpots.length, 1);
  assert.equal(buddhaSpots[0].spotId, 'LS-011');

  const familyRoutes = store.listRoutes({ query: '亲子' });
  assert.equal(familyRoutes.length, 1);
  assert.equal(familyRoutes[0].routeId, 'official-family-4h');

  const blocks = store.listKnowledgeBlocks({ query: '九龙灌浴亲子' });
  assert.ok(blocks.some((block) => block.contentType === 'spot'));
  assert.ok(blocks.some((block) => block.contentType === 'route'));

  await store.addManualKnowledgeBlock({
    blockId: 'official:spot:LS-011',
    title: '人工补充讲解',
    text: '人工补充内容不会覆盖官方原文。',
    keywords: ['人工补充'],
  });
  summary = store.getSummary();
  assert.equal(summary.officialKnowledgeBlockCount, 4);
  assert.equal(summary.manualKnowledgeBlockCount, 1);
  assert.equal(
    store.listKnowledgeBlocks({ versionType: VERSION_TYPE_OFFICIAL, query: '灵山大佛' })[0].blockId,
    'official:spot:LS-011',
  );
  assert.equal(store.listKnowledgeBlocks({ versionType: VERSION_TYPE_MANUAL }).length, 1);

  const reloaded = new ScenicKnowledgeStore({ storeFilePath });
  await reloaded.init();
  assert.equal(reloaded.getSummary().knowledgeBlockCount, 5);
  assert.equal(reloaded.listSpots({ query: '九龙灌浴' })[0].spotId, 'LS-005');

  await reloaded.clear();
  assert.equal(reloaded.getSummary().knowledgeBlockCount, 0);
  await assert.rejects(() => fs.readFile(storeFilePath, 'utf8'), { code: 'ENOENT' });
});
