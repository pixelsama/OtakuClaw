function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toTextItems(paragraphs = []) {
  return (Array.isArray(paragraphs) ? paragraphs : [])
    .map((item, index) => ({
      index: Number.isFinite(item?.index) ? item.index : index,
      text: normalizeText(typeof item === 'string' ? item : item?.text),
    }))
    .filter((item) => item.text);
}

function parseDurationMinutes(routeTitle = '') {
  const hours = Number.parseFloat(String(routeTitle).match(/（(\d+(?:\.\d+)?)小时/)?.[1] || '');
  return Number.isFinite(hours) ? Math.round(hours * 60) : 0;
}

function normalizeRouteId(routeTitle = '') {
  if (routeTitle.includes('历史文化')) {
    return 'official-history-culture-6h';
  }
  if (routeTitle.includes('自然风光')) {
    return 'official-nature-view-5h';
  }
  if (routeTitle.includes('亲子家庭')) {
    return 'official-family-4h';
  }
  return `official-route-${Buffer.from(routeTitle).toString('hex').slice(0, 16)}`;
}

function inferInterestTags(routeTitle = '') {
  if (routeTitle.includes('历史文化')) {
    return ['历史文化', '佛教文化', '深度讲解'];
  }
  if (routeTitle.includes('自然风光')) {
    return ['自然风光', '全景游', '轻松观景'];
  }
  if (routeTitle.includes('亲子家庭')) {
    return ['亲子互动', '轻松休闲', '文化启蒙'];
  }
  return [];
}

function inferAudienceTags(routeTitle = '') {
  if (routeTitle.includes('历史文化')) {
    return ['历史文化爱好者', '研学团队', '成人游客'];
  }
  if (routeTitle.includes('自然风光')) {
    return ['自然风光爱好者', '摄影游客', '轻体力游客'];
  }
  if (routeTitle.includes('亲子家庭')) {
    return ['亲子家庭', '儿童游客', '家庭游客'];
  }
  return [];
}

function parseRouteStops(planText = '') {
  const plan = normalizeText(planText).replace(/^路线规划：/, '');
  return plan
    .split('→')
    .map((item) => normalizeText(item).replace(/（[^）]*）/g, ''))
    .filter(Boolean);
}

function isOfficialRouteHeading(text = '') {
  return /^(历史文化爱好者路线|自然风光爱好者路线|亲子家庭路线)（\d+(?:\.\d+)?小时/.test(text);
}

function parseGuideDocParagraphs(paragraphs = [], { sourceId = 'official-guide-docx' } = {}) {
  const items = toTextItems(paragraphs);
  const routes = [];
  const sections = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.text.length <= 40 && !item.text.includes('：') && !item.text.startsWith('- ')) {
      sections.push({
        title: item.text,
        paragraphIndex: item.index,
        sourceRefs: [{ sourceId, paragraphIndex: item.index }],
      });
    }

    if (!isOfficialRouteHeading(item.text)) {
      continue;
    }

    const routeParagraphs = [];
    for (let cursor = index + 1; cursor < items.length; cursor += 1) {
      if (isOfficialRouteHeading(items[cursor].text) || items[cursor].text.startsWith('实用游览贴士')) {
        break;
      }
      routeParagraphs.push(items[cursor]);
    }

    const planText = routeParagraphs.find((paragraph) => paragraph.text.startsWith('路线规划：'))?.text || '';
    const emphasis = routeParagraphs
      .filter((paragraph) => !paragraph.text.startsWith('路线规划：'))
      .map((paragraph) => paragraph.text);

    routes.push({
      routeId: normalizeRouteId(item.text),
      name: item.text.replace(/（.*$/, ''),
      title: item.text,
      durationMinutes: parseDurationMinutes(item.text),
      interestTags: inferInterestTags(item.text),
      audienceTags: inferAudienceTags(item.text),
      stopNames: parseRouteStops(planText),
      planText,
      emphasis,
      sourceType: 'official',
      sourceRefs: [
        {
          sourceId,
          section: item.text,
          paragraphIndex: item.index,
        },
      ],
    });
  }

  return {
    sections,
    routes,
  };
}

module.exports = {
  isOfficialRouteHeading,
  parseGuideDocParagraphs,
  parseRouteStops,
};
