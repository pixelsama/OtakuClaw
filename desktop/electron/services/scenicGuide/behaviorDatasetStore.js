const { ZipArchive } = require('./zipArchive');
const {
  decodeXmlEntities,
  extractTextRuns,
  normalizeExtractedText,
} = require('./xmlText');

const EXPECTED_BEHAVIOR_HEADERS = [
  'tourist_id',
  'user_nickname',
  'age',
  'gender',
  'attraction_name',
  'attraction_content',
  'attraction_type',
  'visit_date',
  'stay_duration',
  'ticket_cost',
  'food_cost',
  'shopping_cost',
  'transport_cost',
  'entertainment_cost',
  'total_cost',
  'group_size',
  'satisfaction',
];

function columnIndexFromCellRef(cellRef = '') {
  const letters = String(cellRef).match(/^[A-Z]+/i)?.[0] || '';
  let value = 0;
  for (const letter of letters.toUpperCase()) {
    value = value * 26 + (letter.charCodeAt(0) - 64);
  }
  return value > 0 ? value - 1 : 0;
}

function parseSharedStrings(sharedStringsXml = '') {
  const items = [];
  const itemPattern = /<si(?:\s[^>]*)?>[\s\S]*?<\/si>/g;
  let match = itemPattern.exec(String(sharedStringsXml));
  while (match) {
    items.push(normalizeExtractedText(extractTextRuns(match[0]).join('')));
    match = itemPattern.exec(String(sharedStringsXml));
  }
  return items;
}

function countRows(sheetXml = '') {
  const pattern = /<row\b/g;
  let count = 0;
  let match = pattern.exec(String(sheetXml));
  while (match) {
    count += 1;
    match = pattern.exec(String(sheetXml));
  }
  return count;
}

function readCellValue(cellXml = '', sharedStrings = []) {
  const type = String(cellXml).match(/\bt="([^"]+)"/)?.[1] || '';
  if (type === 'inlineStr') {
    return normalizeExtractedText(extractTextRuns(cellXml).join(''));
  }

  const value = String(cellXml).match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] || '';
  const decoded = decodeXmlEntities(value);
  if (type === 's') {
    const index = Number.parseInt(decoded, 10);
    return Number.isFinite(index) ? sharedStrings[index] || '' : '';
  }
  return normalizeExtractedText(decoded);
}

function parseHeaderRow(sheetXml = '', sharedStrings = []) {
  const source = String(sheetXml);
  const rowMatch = source.match(/<row\b[^>]*\br="1"[^>]*>[\s\S]*?<\/row>/)
    || source.match(/<row\b[^>]*>[\s\S]*?<\/row>/);
  if (!rowMatch) {
    return [];
  }

  const values = [];
  const cellPattern = /<c\b[^>]*>[\s\S]*?<\/c>/g;
  let match = cellPattern.exec(rowMatch[0]);
  while (match) {
    const cellXml = match[0];
    const ref = cellXml.match(/\br="([^"]+)"/)?.[1] || '';
    const columnIndex = columnIndexFromCellRef(ref);
    values[columnIndex] = readCellValue(cellXml, sharedStrings);
    match = cellPattern.exec(rowMatch[0]);
  }

  return values.map((value) => normalizeExtractedText(value));
}

function parseWorksheetSummary({ sheetXml = '', sharedStrings = [] } = {}) {
  const rowCount = countRows(sheetXml);
  const headers = parseHeaderRow(sheetXml, sharedStrings);
  return {
    rowCount,
    dataRowCount: Math.max(0, rowCount - 1),
    columnCount: headers.length,
    headers,
  };
}

async function summarizeBehaviorWorkbook(filePath) {
  const archive = await ZipArchive.fromFile(filePath);
  const sheetXml = archive.readEntryText('xl/worksheets/sheet1.xml');
  const sharedStrings = archive.hasEntry('xl/sharedStrings.xml')
    ? parseSharedStrings(archive.readEntryText('xl/sharedStrings.xml'))
    : [];
  const summary = parseWorksheetSummary({ sheetXml, sharedStrings });
  return {
    ...summary,
    expectedHeaders: [...EXPECTED_BEHAVIOR_HEADERS],
    missingHeaders: EXPECTED_BEHAVIOR_HEADERS.filter((header) => !summary.headers.includes(header)),
  };
}

module.exports = {
  EXPECTED_BEHAVIOR_HEADERS,
  parseHeaderRow,
  parseSharedStrings,
  parseWorksheetSummary,
  summarizeBehaviorWorkbook,
};
