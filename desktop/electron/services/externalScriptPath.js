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

  if (fs.existsSync(normalized)) {
    return normalized;
  }

  const asarSegment = `${path.sep}app.asar${path.sep}`;
  if (!normalized.includes(asarSegment)) {
    return normalized;
  }

  const unpackedPath = normalized.replace(asarSegment, `${path.sep}app.asar.unpacked${path.sep}`);
  if (fs.existsSync(unpackedPath)) {
    return unpackedPath;
  }

  return unpackedPath;
}

module.exports = {
  resolveExternalScriptPath,
};
