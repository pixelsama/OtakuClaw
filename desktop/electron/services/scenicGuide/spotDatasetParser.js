const SPOT_ID_PATTERN = /^(LS|NH)-\d{3}$/;

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

function toSpotSection(value = '') {
  const text = normalizeText(value);
  if (text === '拈花湾' || text.includes('拈花湾')) {
    return '拈花湾';
  }
  return '灵山胜境';
}

function parseSpotDatasetParagraphs(paragraphs = [], { sourceId = 'official-spot-structure-docx' } = {}) {
  const items = toTextItems(paragraphs);
  const spots = [];
  const warnings = [];

  for (let index = 0; index < items.length; index += 1) {
    const spotId = items[index].text;
    if (!SPOT_ID_PATTERN.test(spotId)) {
      continue;
    }

    const sectionText = items[index - 1]?.text || '';
    const fields = {
      name: items[index + 1]?.text || '',
      locationText: items[index + 2]?.text || '',
      parameters: items[index + 3]?.text || '',
      coreFunction: items[index + 4]?.text || '',
      culture: items[index + 5]?.text || '',
      introduction: items[index + 6]?.text || '',
      highlightsText: items[index + 7]?.text || '',
      openInfo: items[index + 8]?.text || '',
      notes: items[index + 9]?.text || '',
    };

    if (!fields.name) {
      warnings.push({
        code: 'spot_name_missing',
        spotId,
        paragraphIndex: items[index].index,
      });
      continue;
    }

    spots.push({
      scenicId: 'lingshan',
      spotId,
      name: fields.name,
      section: toSpotSection(sectionText || (spotId.startsWith('NH-') ? '拈花湾' : '灵山胜境')),
      locationText: fields.locationText,
      parameters: fields.parameters,
      coreFunction: fields.coreFunction,
      culture: fields.culture,
      introduction: fields.introduction,
      highlights: fields.highlightsText ? [fields.highlightsText] : [],
      openInfo: fields.openInfo,
      notes: fields.notes,
      sourceRefs: [
        {
          sourceId,
          spotId,
          paragraphIndex: items[index].index,
        },
      ],
    });
  }

  return {
    spots,
    warnings,
  };
}

module.exports = {
  SPOT_ID_PATTERN,
  parseSpotDatasetParagraphs,
};
