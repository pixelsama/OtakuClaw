function decodeXmlEntities(value = '') {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&#([0-9]+);/g, (_match, decimal) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
    });
}

function normalizeExtractedText(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTextRuns(xml = '') {
  const source = String(xml);
  const runs = [];
  const textPattern = /<(?:[^:\/>\s]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[^:\/>\s]+:)?t>/g;
  let match = textPattern.exec(source);
  while (match) {
    runs.push(decodeXmlEntities(match[1] || ''));
    match = textPattern.exec(source);
  }
  return runs;
}

module.exports = {
  decodeXmlEntities,
  extractTextRuns,
  normalizeExtractedText,
};
