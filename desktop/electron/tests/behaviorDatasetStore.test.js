const assert = require('node:assert/strict');
const test = require('node:test');

const {
  EXPECTED_BEHAVIOR_HEADERS,
  parseSharedStrings,
  parseWorksheetSummary,
} = require('../services/scenicGuide/behaviorDatasetStore');

test('parseWorksheetSummary reads shared string headers and row counts', () => {
  const sharedStrings = parseSharedStrings(`
    <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      ${EXPECTED_BEHAVIOR_HEADERS.map((header) => `<si><t>${header}</t></si>`).join('')}
    </sst>
  `);
  const headerCells = EXPECTED_BEHAVIOR_HEADERS
    .map((_, index) => {
      const column = String.fromCharCode('A'.charCodeAt(0) + index);
      return `<c r="${column}1" t="s"><v>${index}</v></c>`;
    })
    .join('');
  const sheetXml = `
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">${headerCells}</row>
        <row r="2"><c r="A2" t="s"><v>0</v></c></row>
        <row r="3"><c r="A3" t="s"><v>0</v></c></row>
      </sheetData>
    </worksheet>
  `;

  const summary = parseWorksheetSummary({ sheetXml, sharedStrings });

  assert.equal(summary.rowCount, 3);
  assert.equal(summary.dataRowCount, 2);
  assert.equal(summary.columnCount, EXPECTED_BEHAVIOR_HEADERS.length);
  assert.deepEqual(summary.headers, EXPECTED_BEHAVIOR_HEADERS);
});
