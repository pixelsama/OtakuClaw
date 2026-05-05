const assert = require('node:assert/strict');
const test = require('node:test');

const { parseDocxParagraphs } = require('../services/scenicGuide/docxTextExtractor');

test('parseDocxParagraphs extracts ordered non-empty paragraph text', () => {
  const paragraphs = parseDocxParagraphs(`
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>灵山胜境</w:t></w:r></w:p>
        <w:p><w:r><w:t>  </w:t></w:r></w:p>
        <w:p><w:r><w:t>灵山</w:t></w:r><w:r><w:t>大佛</w:t></w:r></w:p>
        <w:p><w:r><w:t>五明桥 &amp; 香水海</w:t></w:r></w:p>
      </w:body>
    </w:document>
  `);

  assert.deepEqual(paragraphs, [
    { index: 0, text: '灵山胜境' },
    { index: 2, text: '灵山大佛' },
    { index: 3, text: '五明桥 & 香水海' },
  ]);
});
