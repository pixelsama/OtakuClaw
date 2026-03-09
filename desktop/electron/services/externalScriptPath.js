const fs = require('node:fs');
const path = require('node:path');

function normalizePath(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveExternalScriptPath(scriptPath = '') {
  const normalized = normalizePath(scriptPath);
  if (!normalized) {
    return '';
  }

  const asarSegment = `${path.sep}app.asar${path.sep}`;
  if (normalized.includes(asarSegment)) {
    const unpackedPath = normalized.replace(asarSegment, `${path.sep}app.asar.unpacked${path.sep}`);
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath;
    }
    return unpackedPath;
  }

  if (fs.existsSync(normalized)) {
    return normalized;
  }

  return normalized;
}

module.exports = {
  resolveExternalScriptPath,
};
