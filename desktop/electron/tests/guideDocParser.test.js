const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isOfficialRouteHeading,
  parseGuideDocParagraphs,
  parseRouteStops,
} = require('../services/scenicGuide/guideDocParser');

test('parseRouteStops extracts clean stop names from official route text', () => {
  assert.deepEqual(
    parseRouteStops('路线规划：南门入园 → 灵山大照壁（20分钟） → 胜境广场（30分钟）'),
    ['南门入园', '灵山大照壁', '胜境广场'],
  );
});

test('parseGuideDocParagraphs extracts official routes and metadata', () => {
  const result = parseGuideDocParagraphs([
    { index: 0, text: '个性化游览路线推荐' },
    { index: 1, text: '历史文化爱好者路线（6小时深度游）' },
    { index: 2, text: '路线规划：南门入园 → 灵山大照壁（20分钟） → 祥符禅寺（60分钟）' },
    { index: 3, text: '重点讲解佛教文化与建筑礼制。' },
    { index: 4, text: '自然风光爱好者路线（5小时全景游）' },
    { index: 5, text: '路线规划：南门入园 → 佛足坛（20分钟） → 九龙灌浴（30分钟）' },
    { index: 6, text: '适合摄影和湖山观景。' },
    { index: 7, text: '亲子家庭路线（4小时轻松游）' },
    { index: 8, text: '路线规划：南门入园 → 九龙灌浴（30分钟） → 百子戏弥勒（20分钟）' },
    { index: 9, text: '实用游览贴士' },
  ]);

  assert.equal(result.routes.length, 3);
  assert.equal(result.routes[0].routeId, 'official-history-culture-6h');
  assert.equal(result.routes[0].durationMinutes, 360);
  assert.equal(result.routes[0].name, '历史文化爱好者路线');
  assert.deepEqual(result.routes[0].stopNames, ['南门入园', '灵山大照壁', '祥符禅寺']);
  assert.ok(result.routes[0].interestTags.includes('佛教文化'));
  assert.equal(result.routes[2].routeId, 'official-family-4h');
  assert.equal(result.routes[2].durationMinutes, 240);
});

test('isOfficialRouteHeading only accepts official route heading names', () => {
  assert.equal(isOfficialRouteHeading('历史文化爱好者路线（6小时深度游）'), true);
  assert.equal(isOfficialRouteHeading('自然风光爱好者路线（5小时全景游）'), true);
  assert.equal(isOfficialRouteHeading('普通推荐路线（2小时）'), false);
});
