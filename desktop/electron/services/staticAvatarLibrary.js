const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const AVATAR_PROTOCOL = 'openclaw-avatar';
const AVATAR_LIBRARY_DIR = 'static-avatars';
const AVATAR_TMP_DIR = '.tmp';
const MANIFEST_FILE = 'manifest.json';

const REQUIRED_STATES = ['idle', 'writing', 'researching', 'executing', 'error'];
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);
const MAX_SINGLE_FILE_SIZE_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_PACK_SIZE_BYTES = 180 * 1024 * 1024;

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim();
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function createImportFolderName(packId = '') {
  const normalized = normalizeText(packId)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const safeName = normalized || 'static-avatar';
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${safeName}-${timestamp}-${suffix}`;
}

function createLibraryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeZipEntry(entry) {
  return String(entry || '').replace(/\\/g, '/').trim();
}

function assertZipEntriesSafe(entries = []) {
  for (const rawEntry of entries) {
    const entry = normalizeZipEntry(rawEntry);
    if (!entry) {
      continue;
    }

    if (entry.startsWith('/') || entry.startsWith('//') || /^[A-Za-z]:/.test(entry)) {
      throw createLibraryError(
        'static_avatar_invalid_archive',
        `ZIP contains unsafe entry path: ${entry}`,
      );
    }

    const segments = entry.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      throw createLibraryError(
        'static_avatar_invalid_archive',
        `ZIP contains path traversal entry: ${entry}`,
      );
    }
  }
}

function escapePowerShellLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

function runCommand(command, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function removeIfExists(targetPath) {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch {
    // noop
  }
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') {
    return 'image/png';
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg';
  }
  if (ext === '.webp') {
    return 'image/webp';
  }
  if (ext === '.avif') {
    return 'image/avif';
  }
  if (ext === '.json') {
    return 'application/json; charset=utf-8';
  }
  return 'application/octet-stream';
}

function normalizeHitTest(hitTest = {}) {
  const source = hitTest && typeof hitTest === 'object' ? hitTest : {};
  const mode = normalizeText(source.mode, 'alpha').toLowerCase() === 'rect' ? 'rect' : 'alpha';
  const thresholdRaw = Number.parseInt(source.alphaThreshold, 10);
  const alphaThreshold = Number.isFinite(thresholdRaw)
    ? Math.max(0, Math.min(255, thresholdRaw))
    : 10;

  return {
    mode,
    alphaThreshold,
  };
}

function normalizePackPath(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  const standardized = normalized.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!standardized || standardized.startsWith('../') || standardized.includes('/../') || standardized.includes('..\\')) {
    return '';
  }
  if (standardized.includes('\0') || standardized.includes('/./') || standardized === '.') {
    return '';
  }
  if (path.isAbsolute(standardized)) {
    return '';
  }
  return standardized;
}

function assertSafeResolvedPath(rootDir, targetPath) {
  const resolved = path.resolve(rootDir, targetPath);
  const rootWithSeparator = rootDir.endsWith(path.sep)
    ? rootDir
    : `${rootDir}${path.sep}`;
  if (resolved !== rootDir && !resolved.startsWith(rootWithSeparator)) {
    throw createLibraryError('static_avatar_invalid_manifest', 'Manifest contains invalid asset path.');
  }
  return resolved;
}

function parseManifest(content = '') {
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw createLibraryError('static_avatar_invalid_manifest', 'manifest.json is not valid JSON.');
  }

  const schemaVersion = Number.parseInt(parsed?.schemaVersion, 10);
  if (schemaVersion !== 1) {
    throw createLibraryError('static_avatar_unsupported_schema', 'Unsupported avatar manifest schemaVersion.');
  }

  const packId = normalizeText(parsed?.packId);
  const name = normalizeText(parsed?.name);
  if (!packId || !name) {
    throw createLibraryError('static_avatar_invalid_manifest', 'Manifest packId/name is required.');
  }

  const states = parsed?.states && typeof parsed.states === 'object' ? parsed.states : null;
  if (!states) {
    throw createLibraryError('static_avatar_invalid_manifest', 'Manifest states is required.');
  }

  const normalizedStates = {};
  for (const stateKey of REQUIRED_STATES) {
    const normalizedPath = normalizePackPath(states[stateKey]);
    if (!normalizedPath) {
      throw createLibraryError(
        'static_avatar_invalid_manifest',
        `Manifest state path is invalid: ${stateKey}`,
      );
    }
    const ext = path.extname(normalizedPath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw createLibraryError(
        'static_avatar_invalid_asset_type',
        `Unsupported image format for state ${stateKey}: ${ext || '(none)'}`,
      );
    }
    normalizedStates[stateKey] = normalizedPath;
  }

  return {
    schemaVersion: 1,
    packId,
    name,
    version: normalizeText(parsed?.version, '1.0.0'),
    engine: normalizeText(parsed?.engine, ''),
    states: normalizedStates,
    hitTest: normalizeHitTest(parsed?.hitTest),
  };
}

async function collectFilesRecursively(rootDir) {
  const files = [];

  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const stats = await fs.stat(absolutePath);
      files.push({
        absolutePath,
        size: stats.size,
      });
    }
  }

  await walk(rootDir);
  return files;
}

async function findManifestFiles(rootDir) {
  const results = [];

  async function walk(directory, depth = 0) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, depth + 1);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === MANIFEST_FILE) {
        results.push({ absolutePath, depth });
      }
    }
  }

  await walk(rootDir, 0);
  return results.sort((a, b) => a.depth - b.depth);
}

class StaticAvatarLibrary {
  constructor(app) {
    this.app = app;
    this.rootDir = path.join(this.app.getPath('userData'), AVATAR_LIBRARY_DIR);
    this.tempDir = path.join(this.rootDir, AVATAR_TMP_DIR);
  }

  async init() {
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  getProtocol() {
    return AVATAR_PROTOCOL;
  }

  getRootDir() {
    return this.rootDir;
  }

  toAvatarUrl(absolutePath) {
    const relativePath = toPosixPath(path.relative(this.rootDir, absolutePath));
    const encoded = relativePath
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${AVATAR_PROTOCOL}:///${encoded}`;
  }

  resolveProtocolUrl(requestUrl) {
    const parsed = new URL(requestUrl);
    if (parsed.protocol !== `${AVATAR_PROTOCOL}:`) {
      throw new Error('unsupported_protocol');
    }

    const hostPart = parsed.host ? parsed.host.replace(/^\/+/, '') : '';
    const pathnamePart = parsed.pathname ? parsed.pathname.replace(/^\/+/, '') : '';
    const encodedRelativePath = [hostPart, pathnamePart].filter(Boolean).join('/');
    const relativePath = decodeURIComponent(encodedRelativePath).replace(/^\/+/, '');
    if (!relativePath) {
      throw new Error('empty_avatar_path');
    }

    const resolved = path.resolve(this.rootDir, relativePath);
    const rootWithSeparator = this.rootDir.endsWith(path.sep)
      ? this.rootDir
      : `${this.rootDir}${path.sep}`;

    if (resolved !== this.rootDir && !resolved.startsWith(rootWithSeparator)) {
      throw new Error('invalid_avatar_path');
    }

    return resolved;
  }

  async readAssetFromProtocolUrl(requestUrl) {
    const absolutePath = this.resolveProtocolUrl(requestUrl);
    const data = await fs.readFile(absolutePath);
    return {
      buffer: data,
      mimeType: getMimeType(absolutePath),
    };
  }

  async listZipEntries(zipPath) {
    if (process.platform === 'win32') {
      const escapedZipPath = escapePowerShellLiteral(zipPath);
      const command = [
        '$ErrorActionPreference = "Stop"',
        'Add-Type -AssemblyName System.IO.Compression.FileSystem',
        `$zip = [System.IO.Compression.ZipFile]::OpenRead('${escapedZipPath}')`,
        'try { foreach ($entry in $zip.Entries) { [Console]::Out.WriteLine($entry.FullName) } } finally { $zip.Dispose() }',
      ].join('; ');
      const result = await runCommand('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        command,
      ]);
      return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    }

    const result = await runCommand('unzip', ['-Z1', zipPath]);
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  async extractZip(zipPath, outputDir) {
    if (process.platform === 'win32') {
      const escapedZipPath = escapePowerShellLiteral(zipPath);
      const escapedOutputDir = escapePowerShellLiteral(outputDir);
      const command = `Expand-Archive -LiteralPath '${escapedZipPath}' -DestinationPath '${escapedOutputDir}' -Force`;
      await runCommand('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        command,
      ]);
      return;
    }

    await runCommand('unzip', ['-oq', zipPath, '-d', outputDir]);
  }

  async readPackManifest(packDir) {
    const manifestPath = path.join(packDir, MANIFEST_FILE);
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const manifest = parseManifest(raw);    for (const stateKey of REQUIRED_STATES) {
      const relativePath = manifest.states[stateKey];
      const absolutePath = assertSafeResolvedPath(packDir, relativePath);
      const stats = await fs.stat(absolutePath);
      if (!stats.isFile()) {
        throw createLibraryError(
          'static_avatar_invalid_manifest',
          `State asset not found for ${stateKey}: ${relativePath}`,
        );
      }
      if (stats.size > MAX_SINGLE_FILE_SIZE_BYTES) {
        throw createLibraryError(
          'static_avatar_asset_too_large',
          `State asset exceeds size limit (${stateKey}).`,
        );
      }    }

    const allFiles = await collectFilesRecursively(packDir);
    const totalSize = allFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_TOTAL_PACK_SIZE_BYTES) {
      throw createLibraryError(
        'static_avatar_pack_too_large',
        'Avatar pack exceeds total size limit.',
      );
    }

    return {
      ...manifest,
      folder: path.basename(packDir),
      totalSize,
      states: Object.fromEntries(
        REQUIRED_STATES.map((stateKey) => {
          const absolutePath = assertSafeResolvedPath(packDir, manifest.states[stateKey]);
          return [stateKey, this.toAvatarUrl(absolutePath)];
        }),
      ),
    };
  }

  async listPacks() {
    await this.init();

    const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    const packs = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === AVATAR_TMP_DIR) {
        continue;
      }

      const packDir = path.join(this.rootDir, entry.name);
      try {
        const parsed = await this.readPackManifest(packDir);
        packs.push({
          id: parsed.packId,
          packId: parsed.packId,
          name: parsed.name,
          version: parsed.version,
          engine: parsed.engine,
          schemaVersion: parsed.schemaVersion,
          folder: parsed.folder,
          states: parsed.states,
          hitTest: parsed.hitTest,
          totalSize: parsed.totalSize,
        });
      } catch (error) {
        console.warn(`Skip invalid static avatar pack at ${packDir}:`, error?.message || error);
      }
    }

    const deduped = new Map();
    for (const pack of packs) {
      const current = deduped.get(pack.packId);
      if (!current || pack.folder > current.folder) {
        deduped.set(pack.packId, pack);
      }
    }

    return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  async importZip(zipPath) {
    await this.init();

    const resolvedZipPath = path.resolve(String(zipPath || ''));
    if (!resolvedZipPath || path.extname(resolvedZipPath).toLowerCase() !== '.zip') {
      throw createLibraryError('static_avatar_invalid_archive', 'Please choose a ZIP file.');
    }

    const zipEntries = await this.listZipEntries(resolvedZipPath);
    assertZipEntriesSafe(zipEntries);

    const workspace = path.join(
      this.tempDir,
      `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const extractedDir = path.join(workspace, 'content');

    await fs.mkdir(extractedDir, { recursive: true });

    try {
      await this.extractZip(resolvedZipPath, extractedDir);
      const manifests = await findManifestFiles(extractedDir);
      if (!manifests.length) {
        throw createLibraryError('static_avatar_manifest_missing', 'manifest.json not found in avatar ZIP.');
      }

      const manifestPath = manifests[0].absolutePath;
      const packRootDir = path.dirname(manifestPath);
      const parsedPack = await this.readPackManifest(packRootDir);

      const existing = await this.listPacks();
      const duplicated = existing.filter((item) => item.packId === parsedPack.packId);
      for (const item of duplicated) {
        await removeIfExists(path.join(this.rootDir, item.folder));
      }

      const targetFolder = createImportFolderName(parsedPack.packId);
      const targetDir = path.join(this.rootDir, targetFolder);
      await fs.rename(packRootDir, targetDir);

      const importedPack = await this.readPackManifest(targetDir);
      const packs = await this.listPacks();

      return {
        imported: {
          id: importedPack.packId,
          packId: importedPack.packId,
          name: importedPack.name,
          version: importedPack.version,
          schemaVersion: importedPack.schemaVersion,
          folder: importedPack.folder,
          states: importedPack.states,
          hitTest: importedPack.hitTest,
        },
        packs,
      };
    } finally {
      await removeIfExists(workspace);
    }
  }

  async removePack(packId) {
    const normalizedPackId = normalizeText(packId);
    if (!normalizedPackId) {
      throw createLibraryError('static_avatar_pack_required', 'packId is required.');
    }

    const packs = await this.listPacks();
    const target = packs.find((item) => item.packId === normalizedPackId);
    if (!target) {
      throw createLibraryError('static_avatar_not_found', 'Avatar pack not found.');
    }

    await removeIfExists(path.join(this.rootDir, target.folder));
    return {
      removedPackId: normalizedPackId,
      packs: await this.listPacks(),
    };
  }
}

module.exports = {
  StaticAvatarLibrary,
  AVATAR_PROTOCOL,
};
