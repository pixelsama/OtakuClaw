const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PIXEL_PACK_PROTOCOL = 'openclaw-pixel-pack';
const PIXEL_PACK_LIBRARY_DIR_NAME = 'pixel-packs';
const PIXEL_PACK_LIBRARY_TEMP_DIR_NAME = '.tmp';
const PIXEL_PACK_MANIFEST_FILE_NAME = 'manifest.json';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim();
}

function cloneJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]),
    );
  }
  return value;
}

function createPixelPackError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
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

function normalizeZipEntry(entry) {
  return String(entry || '').replace(/\\/g, '/').trim();
}

function hasUnsafeAbsolutePathPrefix(entry) {
  return (
    entry.startsWith('/')
    || entry.startsWith('//')
    || /^[A-Za-z]:/.test(entry)
  );
}

function assertZipEntriesSafe(entries = []) {
  for (const rawEntry of entries) {
    const entry = normalizeZipEntry(rawEntry);
    if (!entry) {
      continue;
    }

    if (hasUnsafeAbsolutePathPrefix(entry)) {
      throw createPixelPackError(
        'pixel_pack_invalid_archive',
        `ZIP contains unsafe entry path: ${entry}`,
      );
    }

    const segments = entry.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      throw createPixelPackError(
        'pixel_pack_invalid_archive',
        `ZIP contains path traversal entry: ${entry}`,
      );
    }
  }
}

function normalizePackId(packId) {
  const value = normalizeText(packId);
  if (!value || value === '.' || value === '..') {
    return '';
  }
  if (value.includes('/') || value.includes('\\') || value.includes('\0')) {
    return '';
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value)) {
    return '';
  }
  return value;
}

function normalizePackVersion(version) {
  const value = normalizeText(version);
  if (!value || value === '.' || value === '..') {
    return '';
  }
  if (value.includes('/') || value.includes('\\') || value.includes('\0')) {
    return '';
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value)) {
    return '';
  }
  return value;
}

function normalizeAssetPath(assetPath) {
  const value = normalizeZipEntry(assetPath);
  if (!value) {
    return '';
  }
  if (hasUnsafeAbsolutePathPrefix(value)) {
    return '';
  }

  const segments = value.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return '';
  }

  return segments.join('/');
}

function normalizeAssetKey(assetKey) {
  return normalizeText(assetKey);
}

function pathStartsWithinRoot(targetPath, rootPath) {
  const resolved = path.resolve(targetPath);
  const rootResolved = path.resolve(rootPath);
  const rootWithSeparator = rootResolved.endsWith(path.sep)
    ? rootResolved
    : `${rootResolved}${path.sep}`;
  return resolved === rootResolved || resolved.startsWith(rootWithSeparator);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function removeIfExists(targetPath) {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch {
    // noop
  }
}

function cloneManifest(manifest) {
  if (!isObject(manifest)) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(manifest));
  } catch {
    return null;
  }
}

function addValidationError(errors, code, message, pathName = '') {
  errors.push({
    code,
    message,
    path: pathName,
  });
}

function walkForAssetKeyRefs(value, visitor, currentPath = '') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkForAssetKeyRefs(item, visitor, `${currentPath}[${index}]`);
    });
    return;
  }

  if (!isObject(value)) {
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    const nextPath = currentPath ? `${currentPath}.${key}` : key;
    if (key === 'assetKey') {
      visitor(item, nextPath);
    }
    walkForAssetKeyRefs(item, visitor, nextPath);
  }
}

function validateSpritesheetAsset(asset, assetPath, errors) {
  const cols = Number.parseInt(asset.cols, 10);
  const rows = Number.parseInt(asset.rows, 10);
  if (!Number.isFinite(cols) || cols <= 0) {
    addValidationError(errors, 'pixel_pack_invalid_asset', 'Spritesheet asset must define a positive cols value.', `${assetPath}.cols`);
  }
  if (!Number.isFinite(rows) || rows <= 0) {
    addValidationError(errors, 'pixel_pack_invalid_asset', 'Spritesheet asset must define a positive rows value.', `${assetPath}.rows`);
  }
}

async function validatePackManifest(manifest, { baseDir = '' } = {}) {
  const errors = [];
  const warnings = [];
  const normalizedManifest = cloneManifest(manifest);

  if (!normalizedManifest) {
    addValidationError(errors, 'pixel_pack_invalid_manifest', 'manifest.json must contain a JSON object.');
    return {
      ok: false,
      valid: false,
      errors,
      warnings,
      manifest: null,
      pack: null,
    };
  }

  if (normalizedManifest.schemaVersion !== 1) {
    addValidationError(
      errors,
      'pixel_pack_unsupported_schema',
      'schemaVersion must be 1.',
      'schemaVersion',
    );
  }

  const packId = normalizePackId(normalizedManifest.packId);
  const version = normalizePackVersion(normalizedManifest.version);
  const engine = normalizeText(normalizedManifest.engine);
  const name = normalizeText(normalizedManifest.name, packId || '');
  const contractRevision = normalizeText(normalizedManifest.contractRevision, '');

  if (!packId) {
    addValidationError(errors, 'pixel_pack_invalid_pack_id', 'packId is missing or invalid.', 'packId');
  }
  if (!version) {
    addValidationError(errors, 'pixel_pack_invalid_version', 'version is missing or invalid.', 'version');
  }
  if (!engine) {
    addValidationError(errors, 'pixel_pack_invalid_engine', 'engine is required.', 'engine');
  }

  const assetsSource = isObject(normalizedManifest.assets) ? normalizedManifest.assets : null;
  if (!assetsSource) {
    addValidationError(errors, 'pixel_pack_invalid_assets', 'assets must be an object.', 'assets');
  }

  const assetKeys = new Set();
  const assetEntries = Object.entries(assetsSource || {});

  for (const [rawAssetKey, asset] of assetEntries) {
    const assetKey = normalizeAssetKey(rawAssetKey);
    const assetPath = `assets.${rawAssetKey}`;
    if (!assetKey) {
      addValidationError(errors, 'pixel_pack_invalid_asset_key', 'Asset key is missing or invalid.', assetPath);
      continue;
    }

    if (assetKeys.has(assetKey)) {
      addValidationError(errors, 'pixel_pack_duplicate_asset_key', `Duplicate asset key: ${assetKey}`, assetPath);
      continue;
    }

    assetKeys.add(assetKey);

    if (!isObject(asset)) {
      addValidationError(errors, 'pixel_pack_invalid_asset', 'Asset entry must be an object.', assetPath);
      continue;
    }

    const relativeAssetPath = normalizeAssetPath(asset.path);
    if (!relativeAssetPath) {
      addValidationError(errors, 'pixel_pack_invalid_asset_path', 'Asset path is missing or invalid.', `${assetPath}.path`);
    } else if (baseDir) {
      const absoluteAssetPath = path.resolve(baseDir, relativeAssetPath);
      if (!pathStartsWithinRoot(absoluteAssetPath, baseDir)) {
        addValidationError(errors, 'pixel_pack_invalid_asset_path', 'Asset path escapes the pack root.', `${assetPath}.path`);
      } else if (!(await pathExists(absoluteAssetPath))) {
        addValidationError(errors, 'pixel_pack_missing_asset', `Asset file not found: ${relativeAssetPath}`, `${assetPath}.path`);
      }
    }

    const assetType = normalizeText(asset.type);
    if (!assetType) {
      addValidationError(errors, 'pixel_pack_invalid_asset', 'Asset type is required.', `${assetPath}.type`);
    } else if (assetType !== 'image' && assetType !== 'spritesheet') {
      addValidationError(
        errors,
        'pixel_pack_invalid_asset',
        `Unsupported asset type: ${assetType}`,
        `${assetPath}.type`,
      );
    } else if (assetType === 'spritesheet') {
      validateSpritesheetAsset(asset, assetPath, errors);
    }
  }

  walkForAssetKeyRefs(normalizedManifest, (assetKey, refPath) => {
    const normalizedAssetKey = normalizeAssetKey(assetKey);
    if (!normalizedAssetKey) {
      addValidationError(errors, 'pixel_pack_invalid_asset_reference', 'assetKey must be a non-empty string.', refPath);
      return;
    }

    if (!assetKeys.has(normalizedAssetKey)) {
      addValidationError(
        errors,
        'pixel_pack_missing_asset_reference',
        `Referenced assetKey does not exist: ${normalizedAssetKey}`,
        refPath,
      );
    }
  });

  if (contractRevision && contractRevision !== '1.1') {
    warnings.push({
      code: 'pixel_pack_contract_revision_unrecognized',
      message: `contractRevision ${contractRevision} is not explicitly recognized by Phase 1.`,
      path: 'contractRevision',
    });
  }

  const valid = errors.length === 0;
  const assetBaseUrl = valid && packId && version
    ? `${PIXEL_PACK_PROTOCOL}:///${encodeURIComponent(packId)}/${encodeURIComponent(version)}/`
    : '';

  return {
    ok: valid,
    valid,
    errors,
    warnings,
    manifest: valid ? normalizedManifest : normalizedManifest,
    pack: {
      packId,
      version,
      name,
      description: normalizeText(normalizedManifest.description, ''),
      schemaVersion: normalizedManifest.schemaVersion,
      contractRevision,
      engine,
      assetCount: assetKeys.size,
      assetBaseUrl,
    },
  };
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

function createImportFolderName(zipPath) {
  const baseName = path.basename(zipPath, path.extname(zipPath));
  const normalized = baseName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const safeName = normalized || 'pixel-pack';
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${safeName}-${timestamp}-${suffix}`;
}

function createExportFileName(packId, version) {
  const normalized = `${normalizeText(packId)}-${normalizeText(version)}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${normalized || 'pixel-pack'}.zip`;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json' || ext === '.manifest') {
    return 'application/json; charset=utf-8';
  }
  if (ext === '.png') {
    return 'image/png';
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg';
  }
  if (ext === '.webp') {
    return 'image/webp';
  }
  if (ext === '.gif') {
    return 'image/gif';
  }
  if (ext === '.svg') {
    return 'image/svg+xml';
  }
  if (ext === '.mp4') {
    return 'video/mp4';
  }
  return 'application/octet-stream';
}

class PixelPackLibrary {
  constructor(app, { settingsStore = null } = {}) {
    this.app = app;
    this.settingsStore = settingsStore;
    this.rootDir = path.join(this.app.getPath('userData'), PIXEL_PACK_LIBRARY_DIR_NAME);
    this.tempDir = path.join(this.rootDir, PIXEL_PACK_LIBRARY_TEMP_DIR_NAME);
  }

  async init() {
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  getProtocol() {
    return PIXEL_PACK_PROTOCOL;
  }

  getRootDir() {
    return this.rootDir;
  }

  getActivePackSelection() {
    const settings = this.settingsStore?.getForMain?.() || {};
    const pixelPack = isObject(settings.ui?.pixelPack) ? settings.ui.pixelPack : {};
    return {
      activePackId: normalizeText(pixelPack.activePackId, ''),
      activeVersion: normalizeText(pixelPack.activeVersion, ''),
      overrides: cloneJsonValue(pixelPack.overrides || {}),
    };
  }

  toAssetUrl(packId, version, relativeAssetPath = '') {
    const normalizedPackId = normalizePackId(packId);
    const normalizedVersion = normalizePackVersion(version);
    const normalizedAssetPath = normalizeAssetPath(relativeAssetPath);
    if (!normalizedPackId || !normalizedVersion) {
      throw createPixelPackError('pixel_pack_invalid_target', 'Pack id and version are required.');
    }

    const segments = [normalizedPackId, normalizedVersion];
    if (normalizedAssetPath) {
      segments.push(...normalizedAssetPath.split('/'));
    }

    return `${PIXEL_PACK_PROTOCOL}:///${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
  }

  toPackRootUrl(packId, version) {
    return this.toAssetUrl(packId, version);
  }

  resolveProtocolUrl(requestUrl) {
    const parsed = new URL(requestUrl);
    if (parsed.protocol !== `${PIXEL_PACK_PROTOCOL}:`) {
      throw createPixelPackError('pixel_pack_invalid_protocol', 'Unsupported pixel pack protocol.');
    }

    const hostPart = parsed.host ? parsed.host.replace(/^\/+/, '') : '';
    const pathnamePart = parsed.pathname ? parsed.pathname.replace(/^\/+/, '') : '';
    const encodedRelativePath = [hostPart, pathnamePart].filter(Boolean).join('/');
    const relativePath = decodeURIComponent(encodedRelativePath).replace(/^\/+/, '');
    if (!relativePath) {
      throw createPixelPackError('pixel_pack_empty_path', 'Pixel pack asset path is empty.');
    }

    const resolved = path.resolve(this.rootDir, relativePath);
    if (!pathStartsWithinRoot(resolved, this.rootDir)) {
      throw createPixelPackError('pixel_pack_invalid_path', 'Pixel pack asset path escapes the library root.');
    }

    return resolved;
  }

  async readAssetFromProtocolUrl(requestUrl) {
    const absolutePath = this.resolveProtocolUrl(requestUrl);
    const buffer = await fs.readFile(absolutePath);
    return {
      buffer,
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

  async createZipArchive(sourceDir, destinationZipPath) {
    await fs.mkdir(path.dirname(destinationZipPath), { recursive: true });

    if (process.platform === 'win32') {
      const escapedSourceDir = escapePowerShellLiteral(sourceDir);
      const escapedDestination = escapePowerShellLiteral(destinationZipPath);
      const command = [
        '$ErrorActionPreference = "Stop"',
        `Compress-Archive -Path (Join-Path '${escapedSourceDir}' '*') -DestinationPath '${escapedDestination}' -Force`,
      ].join('; ');
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

    await runCommand('zip', ['-qry', destinationZipPath, '.'], { cwd: sourceDir });
  }

  async readManifestFromDirectory(directory) {
    const manifestPath = path.join(directory, PIXEL_PACK_MANIFEST_FILE_NAME);
    if (!(await pathExists(manifestPath))) {
      throw createPixelPackError(
        'pixel_pack_missing_manifest',
        'manifest.json was not found at the pack root.',
      );
    }

    try {
      return await readJsonFile(manifestPath);
    } catch (error) {
      throw createPixelPackError(
        'pixel_pack_invalid_manifest',
        error?.message || 'manifest.json could not be parsed.',
      );
    }
  }

  async listPackDirectories() {
    await this.init();

    const packs = [];
    const packEntries = await fs.readdir(this.rootDir, { withFileTypes: true });
    for (const packEntry of packEntries) {
      if (!packEntry.isDirectory() || packEntry.name === PIXEL_PACK_LIBRARY_TEMP_DIR_NAME) {
        continue;
      }

      const packId = normalizePackId(packEntry.name);
      if (!packId) {
        continue;
      }

      const packRootDir = path.join(this.rootDir, packId);
      const versionEntries = await fs.readdir(packRootDir, { withFileTypes: true }).catch(() => []);
      for (const versionEntry of versionEntries) {
        if (!versionEntry.isDirectory() || versionEntry.name === PIXEL_PACK_LIBRARY_TEMP_DIR_NAME) {
          continue;
        }

        const version = normalizePackVersion(versionEntry.name);
        if (!version) {
          continue;
        }

        const packDir = path.join(packRootDir, version);
        const manifestPath = path.join(packDir, PIXEL_PACK_MANIFEST_FILE_NAME);
        if (!(await pathExists(manifestPath))) {
          continue;
        }

        packs.push({
          packId,
          version,
          packDir,
          manifestPath,
        });
      }
    }

    return packs.sort((a, b) => {
      const packCompare = a.packId.localeCompare(b.packId, 'en-US');
      if (packCompare !== 0) {
        return packCompare;
      }
      return a.version.localeCompare(b.version, 'en-US');
    });
  }

  async validateZip(zipPath) {
    await this.init();

    const resolvedZipPath = path.resolve(String(zipPath || ''));
    if (!resolvedZipPath || path.extname(resolvedZipPath).toLowerCase() !== '.zip') {
      throw createPixelPackError('pixel_pack_invalid_archive', 'Please choose a ZIP file.');
    }

    const zipEntries = await this.listZipEntries(resolvedZipPath);
    assertZipEntriesSafe(zipEntries);

    const workspace = path.join(
      this.tempDir,
      `validate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const extractedDir = path.join(workspace, 'content');
    await fs.mkdir(extractedDir, { recursive: true });

    try {
      await this.extractZip(resolvedZipPath, extractedDir);
      const manifest = await this.readManifestFromDirectory(extractedDir);
      return await validatePackManifest(manifest, { baseDir: extractedDir });
    } finally {
      await removeIfExists(workspace);
    }
  }

  async importZip(zipPath) {
    const validation = await this.validateZip(zipPath);
    if (!validation.valid) {
      throw createPixelPackError('pixel_pack_invalid_manifest', 'Pixel pack manifest validation failed.', {
        validation,
      });
    }

    const { packId, version } = validation.pack;
    const targetDir = path.join(this.rootDir, packId, version);
    if (await pathExists(targetDir)) {
      throw createPixelPackError(
        'pixel_pack_conflict',
        `Pixel pack already exists: ${packId}@${version}`,
        { validation },
      );
    }

    const workspace = path.join(
      this.tempDir,
      `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const extractedDir = path.join(workspace, 'content');
    await fs.mkdir(extractedDir, { recursive: true });

    try {
      await this.extractZip(path.resolve(String(zipPath || '')), extractedDir);
      const manifest = await this.readManifestFromDirectory(extractedDir);
      const revalidation = await validatePackManifest(manifest, { baseDir: extractedDir });
      if (!revalidation.valid) {
        throw createPixelPackError('pixel_pack_invalid_manifest', 'Pixel pack manifest validation failed.', {
          validation: revalidation,
        });
      }

      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      await fs.rename(extractedDir, targetDir);

      const installed = await this.readPackManifestFromDirectory(targetDir);
      return {
        importedPack: {
          ...validation.pack,
          manifest: cloneManifest(installed),
          assetBaseUrl: this.toPackRootUrl(packId, version),
        },
        validation,
        packs: await this.listPacks(),
      };
    } finally {
      await removeIfExists(workspace);
    }
  }

  async readPackManifestFromDirectory(packDir) {
    return this.readManifestFromDirectory(packDir);
  }

  async validatePack(packId, version) {
    await this.init();
    const normalizedPackId = normalizePackId(packId);
    const normalizedVersion = normalizePackVersion(version);
    if (!normalizedPackId || !normalizedVersion) {
      throw createPixelPackError('pixel_pack_invalid_target', 'Pack id and version are required.');
    }

    const packDir = path.join(this.rootDir, normalizedPackId, normalizedVersion);
    const manifest = await this.readPackManifestFromDirectory(packDir);
    return validatePackManifest(manifest, { baseDir: packDir });
  }

  async listPacks() {
    await this.init();

    const activePack = this.getActivePackSelection();
    const packDirectories = await this.listPackDirectories();
    const packs = [];

    for (const packDirectory of packDirectories) {
      try {
        const manifest = await this.readPackManifestFromDirectory(packDirectory.packDir);
        const validation = await validatePackManifest(manifest, { baseDir: packDirectory.packDir });
        const displayPackId = validation.pack.packId || packDirectory.packId;
        const displayVersion = validation.pack.version || packDirectory.version;
        packs.push({
          ...validation.pack,
          packId: displayPackId,
          version: displayVersion,
          manifest: cloneManifest(validation.manifest),
          assetBaseUrl: this.toPackRootUrl(displayPackId, displayVersion),
          packDir: packDirectory.packDir,
          active:
            activePack.activePackId === displayPackId
            && activePack.activeVersion === displayVersion,
          validation,
        });
      } catch (error) {
        packs.push({
          packId: packDirectory.packId,
          version: packDirectory.version,
          name: packDirectory.packId,
          description: '',
          schemaVersion: 0,
          contractRevision: '',
          engine: '',
          assetCount: 0,
          assetBaseUrl: this.toPackRootUrl(packDirectory.packId, packDirectory.version),
          packDir: packDirectory.packDir,
          active:
            activePack.activePackId === packDirectory.packId
            && activePack.activeVersion === packDirectory.version,
          validation: {
            ok: false,
            valid: false,
            errors: [{
              code: error?.code || 'pixel_pack_invalid_manifest',
              message: typeof error?.message === 'string' && error.message ? error.message : 'Pixel pack validation failed.',
              path: '',
            }],
            warnings: [],
            manifest: null,
            pack: {
              packId: packDirectory.packId,
              version: packDirectory.version,
              name: packDirectory.packId,
              description: '',
              schemaVersion: 0,
              contractRevision: '',
              engine: '',
              assetCount: 0,
              assetBaseUrl: this.toPackRootUrl(packDirectory.packId, packDirectory.version),
            },
          },
        });
      }
    }

    return {
      libraryPath: this.rootDir,
      activePackId: activePack.activePackId,
      activeVersion: activePack.activeVersion,
      packs: packs.sort((a, b) => {
        const packCompare = a.packId.localeCompare(b.packId, 'en-US');
        if (packCompare !== 0) {
          return packCompare;
        }
        return a.version.localeCompare(b.version, 'en-US');
      }),
    };
  }

  async activatePack(packId, version) {
    const validation = await this.validatePack(packId, version);
    if (!validation.valid) {
      throw createPixelPackError('pixel_pack_invalid_manifest', 'Pixel pack manifest validation failed.', {
        validation,
      });
    }

    await this.settingsStore?.save?.({
      ui: {
        pixelPack: {
          activePackId: validation.pack.packId,
          activeVersion: validation.pack.version,
        },
      },
    });

    return {
      activePackId: validation.pack.packId,
      activeVersion: validation.pack.version,
      manifest: cloneManifest(validation.manifest),
      validation,
      pack: {
        ...validation.pack,
        assetBaseUrl: this.toPackRootUrl(validation.pack.packId, validation.pack.version),
      },
      settings: this.settingsStore?.getPublic?.() || {},
    };
  }

  async removePack(packId, version) {
    const normalizedPackId = normalizePackId(packId);
    const normalizedVersion = normalizePackVersion(version);
    if (!normalizedPackId || !normalizedVersion) {
      throw createPixelPackError('pixel_pack_invalid_target', 'Pack id and version are required.');
    }

    const packDir = path.join(this.rootDir, normalizedPackId, normalizedVersion);
    if (!(await pathExists(packDir))) {
      throw createPixelPackError(
        'pixel_pack_not_found',
        `Pixel pack not found: ${normalizedPackId}@${normalizedVersion}`,
      );
    }

    await fs.rm(packDir, { recursive: true, force: true });

    const packRootDir = path.join(this.rootDir, normalizedPackId);
    try {
      const remainingEntries = await fs.readdir(packRootDir, { withFileTypes: true });
      const hasVersionDirs = remainingEntries.some((entry) => entry.isDirectory());
      if (!hasVersionDirs) {
        await fs.rm(packRootDir, { recursive: true, force: true });
      }
    } catch {
      // noop
    }

    const activePack = this.getActivePackSelection();
    if (activePack.activePackId === normalizedPackId && activePack.activeVersion === normalizedVersion) {
      await this.settingsStore?.save?.({
        ui: {
          pixelPack: {
            activePackId: '',
            activeVersion: '',
          },
        },
      });
    }

    return {
      removedPackId: normalizedPackId,
      removedVersion: normalizedVersion,
      packs: await this.listPacks(),
      settings: this.settingsStore?.getPublic?.() || {},
    };
  }

  async exportPack(packId, version, destinationZipPath) {
    const validation = await this.validatePack(packId, version);
    if (!validation.valid) {
      throw createPixelPackError('pixel_pack_invalid_manifest', 'Pixel pack manifest validation failed.', {
        validation,
      });
    }

    const packDir = path.join(this.rootDir, validation.pack.packId, validation.pack.version);
    const normalizedDestinationText = normalizeText(destinationZipPath, '');
    if (!normalizedDestinationText) {
      throw createPixelPackError('pixel_pack_invalid_target', 'Destination path is required.');
    }
    const normalizedDestination = path.resolve(normalizedDestinationText);

    await this.createZipArchive(packDir, normalizedDestination);

    return {
      ok: true,
      destinationPath: normalizedDestination,
      pack: {
        ...validation.pack,
        assetBaseUrl: this.toPackRootUrl(validation.pack.packId, validation.pack.version),
      },
    };
  }

  async getActiveManifest() {
    const activePack = this.getActivePackSelection();
    if (!activePack.activePackId || !activePack.activeVersion) {
      return {
        found: false,
        activePackId: activePack.activePackId,
        activeVersion: activePack.activeVersion,
        manifest: null,
        validation: null,
        pack: null,
      };
    }

    const packDir = path.join(this.rootDir, activePack.activePackId, activePack.activeVersion);
    if (!(await pathExists(packDir))) {
      return {
        found: false,
        activePackId: activePack.activePackId,
        activeVersion: activePack.activeVersion,
        manifest: null,
        validation: null,
        pack: null,
      };
    }

    const manifest = await this.readPackManifestFromDirectory(packDir);
    const validation = await validatePackManifest(manifest, { baseDir: packDir });
    return {
      found: validation.valid,
      activePackId: activePack.activePackId,
      activeVersion: activePack.activeVersion,
      manifest: cloneManifest(validation.manifest),
      validation,
      pack: {
        ...validation.pack,
        assetBaseUrl: this.toPackRootUrl(validation.pack.packId, validation.pack.version),
      },
    };
  }
}

module.exports = {
  PIXEL_PACK_PROTOCOL,
  PIXEL_PACK_LIBRARY_DIR_NAME,
  PIXEL_PACK_LIBRARY_TEMP_DIR_NAME,
  PIXEL_PACK_MANIFEST_FILE_NAME,
  PixelPackLibrary,
  validatePackManifest,
  assertZipEntriesSafe,
  normalizePackId,
  normalizePackVersion,
  normalizeAssetPath,
};
