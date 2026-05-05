const { ZipArchive } = require('./zipArchive');
const {
  decodeXmlEntities,
  extractTextRuns,
  normalizeExtractedText,
} = require('./xmlText');

function parseDocxParagraphs(documentXml = '') {
  const source = String(documentXml);
  const paragraphs = [];
  const paragraphPattern = /<[^:/>]+:p(?:\s[^>]*)?>[\s\S]*?<\/[^:/>]+:p>/g;
  let match = paragraphPattern.exec(source);
  let paragraphIndex = 0;

  while (match) {
    const paragraphXml = match[0];
    const text = normalizeExtractedText(extractTextRuns(paragraphXml).join(''));
    if (text) {
      paragraphs.push({
        index: paragraphIndex,
        text,
      });
    }
    paragraphIndex += 1;
    match = paragraphPattern.exec(source);
  }

  return paragraphs;
}

async function extractDocxParagraphs(filePath) {
  const archive = await ZipArchive.fromFile(filePath);
  const documentXml = archive.readEntryText('word/document.xml');
  return parseDocxParagraphs(documentXml);
}

module.exports = {
  decodeXmlEntities,
  extractDocxParagraphs,
  parseDocxParagraphs,
};
