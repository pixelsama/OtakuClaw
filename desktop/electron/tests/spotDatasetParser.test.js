const assert = require('node:assert/strict');
const test = require('node:test');

const { parseSpotDatasetParagraphs } = require('../services/scenicGuide/spotDatasetParser');

test('parseSpotDatasetParagraphs converts official structured paragraphs into spots', () => {
  const result = parseSpotDatasetParagraphs([
    { index: 0, text: '灵山胜境核心区' },
    { index: 1, text: 'LS-001' },
    { index: 2, text: '灵山大照壁' },
    { index: 3, text: '景区入口处' },
    { index: 4, text: '长39.8m，高7m' },
    { index: 5, text: '景区标志性门户' },
    { index: 6, text: '赵朴初先生题写' },
    { index: 7, text: '入口视觉序章' },
    { index: 8, text: '打卡合影，解读诗刻文化' },
    { index: 9, text: '全天开放' },
    { index: 10, text: '入园第一处打卡点' },
    { index: 11, text: '拈花湾' },
    { index: 12, text: 'NH-001' },
    { index: 13, text: '香月花街' },
    { index: 14, text: '拈花湾主街区' },
    { index: 15, text: '步行街区' },
    { index: 16, text: '休闲商业体验' },
    { index: 17, text: '禅意生活美学' },
    { index: 18, text: '夜游核心街区' },
    { index: 19, text: '夜景灯光与街区漫游' },
    { index: 20, text: '按街区运营时间开放' },
    { index: 21, text: '适合夜游' },
  ]);

  assert.equal(result.warnings.length, 0);
  assert.equal(result.spots.length, 2);
  assert.equal(result.spots[0].spotId, 'LS-001');
  assert.equal(result.spots[0].name, '灵山大照壁');
  assert.equal(result.spots[0].section, '灵山胜境');
  assert.deepEqual(result.spots[0].highlights, ['打卡合影，解读诗刻文化']);
  assert.equal(result.spots[1].spotId, 'NH-001');
  assert.equal(result.spots[1].section, '拈花湾');
});

test('parseSpotDatasetParagraphs skips malformed spot records with warnings', () => {
  const result = parseSpotDatasetParagraphs([
    { index: 0, text: '灵山胜境核心区' },
    { index: 1, text: 'LS-999' },
  ]);

  assert.equal(result.spots.length, 0);
  assert.deepEqual(result.warnings, [
    {
      code: 'spot_name_missing',
      spotId: 'LS-999',
      paragraphIndex: 1,
    },
  ]);
});
