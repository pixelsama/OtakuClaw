function normalizeText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function normalizeOptionalNumber(value, fallback = null) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function normalizeFrameDimension(value, fallback = 1) {
  const numeric = normalizeOptionalNumber(value, null);
  const resolvedFallback = Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : 1;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return resolvedFallback;
  }

  return Math.max(1, Math.round(numeric));
}

function normalizeAssetPath(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return '';
  }
  return normalized
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function joinAssetUrl(baseUrl = '', relativePath = '') {
  const normalizedBase = normalizeText(baseUrl, '');
  const normalizedPath = normalizeAssetPath(relativePath);
  if (!normalizedBase || !normalizedPath) {
    return '';
  }

  const encodedPath = normalizedPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const baseWithSlash = normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`;
  return `${baseWithSlash}${encodedPath}`;
}

function normalizePixelPackError(error = null) {
  if (!error) {
    return '';
  }

  if (typeof error === 'string') {
    return error.trim();
  }

  if (typeof error === 'object') {
    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim();
    }

    if (typeof error.reason === 'string' && error.reason.trim()) {
      return error.reason.trim();
    }

    if (typeof error.code === 'string' && error.code.trim()) {
      return error.code.trim();
    }
  }

  return '';
}

function normalizePixelPackAssetEntry(value = {}, fallbackKey = '', { assetBaseUrl = '' } = {}) {
  const source = normalizePlainObject(value);
  const assetKey = normalizeText(source.assetKey || source.key || fallbackKey, fallbackKey);
  const sourcePath = normalizeAssetPath(source.path || source.src || '');
  const sourceAssetUrl = normalizeText(source.assetUrl || source.url, '');
  const assetUrl = sourceAssetUrl || joinAssetUrl(assetBaseUrl, sourcePath);
  const cols = normalizeFrameDimension(source.cols, 1);
  const rows = normalizeFrameDimension(source.rows, 1);

  if (!assetKey) {
    return null;
  }

  return {
    key: assetKey,
    assetKey,
    assetUrl,
    url: assetUrl,
    path: sourcePath,
    label: normalizeText(source.label || source.name, assetKey),
    cols,
    rows,
  };
}

function normalizePixelPackAssetMap(value = {}, options = {}) {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .map((item, index) => normalizePixelPackAssetEntry(
          item,
          normalizeText(item?.assetKey || item?.key, `asset-${index + 1}`),
          options,
        ))
        .filter(Boolean)
        .map((asset) => [asset.assetKey, asset]),
    );
  }

  const source = normalizePlainObject(value);
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, item]) => normalizePixelPackAssetEntry(item, key, options))
      .filter(Boolean)
      .map((asset) => [asset.assetKey, asset]),
  );
}

function resolvePixelPackManifestSource(source = {}) {
  const normalizedSource = normalizePlainObject(source);
  const nestedManifest = normalizePlainObject(normalizedSource.manifest);
  const nestedOfficeScene = normalizePlainObject(normalizedSource.officeScene || normalizedSource.scene || {});
  const assetBaseUrl = normalizeText(
    normalizedSource.assetBaseUrl
      || nestedManifest.assetBaseUrl
      || normalizedSource.pack?.assetBaseUrl,
    '',
  );
  const assets = normalizePixelPackAssetMap(
    normalizedSource.assets
    || nestedOfficeScene.assets
    || normalizedSource.sceneAssets
    || nestedManifest.assets,
    { assetBaseUrl },
  );

  return {
    id: normalizeText(normalizedSource.id || normalizedSource.packId || nestedManifest.id, ''),
    name: normalizeText(normalizedSource.name || nestedManifest.name, ''),
    description: normalizeText(normalizedSource.description || nestedManifest.description, ''),
    version: normalizeText(normalizedSource.version || nestedManifest.version, ''),
    author: normalizeText(normalizedSource.author || nestedManifest.author, ''),
    sourcePath: normalizeText(normalizedSource.sourcePath || normalizedSource.path || nestedManifest.sourcePath, ''),
    updatedAt: normalizeText(normalizedSource.updatedAt || nestedManifest.updatedAt, ''),
    assetBaseUrl,
    assets,
    officeScene: nestedOfficeScene,
  };
}

export function normalizePixelPackManifest(source = {}) {
  return resolvePixelPackManifestSource(source);
}

export function normalizePixelPackRecord(source = {}) {
  const normalizedSource = normalizePlainObject(source);
  const manifest = normalizePixelPackManifest({
    ...(normalizedSource.manifest || normalizedSource),
    assetBaseUrl: normalizedSource.assetBaseUrl,
  });
  const rawPackId = normalizeText(normalizedSource.packId || normalizedSource.id || manifest.id, manifest.id || '');
  const packId = rawPackId.includes('@') ? rawPackId.split('@')[0] : rawPackId;
  const version = normalizeText(normalizedSource.version || manifest.version, '');
  const id = version ? `${packId}@${version}` : packId;
  const name = normalizeText(normalizedSource.name || manifest.name, id || 'Pixel Pack');
  const error = normalizePixelPackError(normalizedSource.error || normalizedSource.validationError || normalizedSource.lastError);
  const status = normalizeText(
    normalizedSource.status,
    error
      ? 'error'
      : normalizedSource.active === true || normalizedSource.isActive === true
        ? 'active'
        : 'installed',
  );
  const active = normalizedSource.active === true || normalizedSource.isActive === true || status === 'active';
  const assetCount = Number.isFinite(normalizedSource.assetCount)
    ? normalizedSource.assetCount
    : Object.keys(manifest.assets || {}).length;
  const validated = normalizedSource.validated === true ? true : !error && normalizedSource.validated !== false;

  return {
    id,
    packId,
    name,
    description: normalizeText(normalizedSource.description || manifest.description, ''),
    version,
    author: normalizeText(normalizedSource.author || manifest.author, ''),
    sourcePath: normalizeText(normalizedSource.sourcePath || normalizedSource.path || manifest.sourcePath, ''),
    status,
    active,
    validated,
    assetCount,
    manifest,
    error,
    canActivate: normalizedSource.canActivate !== false,
    canRemove: normalizedSource.canRemove !== false,
    canExport: normalizedSource.canExport !== false,
  };
}

function isSamePack(left = {}, rightPackId = '', rightVersion = '') {
  if (!left || !rightPackId) {
    return false;
  }
  if (left.packId !== rightPackId) {
    return false;
  }
  if (!rightVersion) {
    return true;
  }
  return left.version === rightVersion;
}

export function normalizePixelPackState(source = {}) {
  const normalizedSource = normalizePlainObject(source);
  const rawPacks = Array.isArray(normalizedSource.packs)
    ? normalizedSource.packs
    : Array.isArray(normalizedSource.availablePacks)
      ? normalizedSource.availablePacks
      : Array.isArray(normalizedSource.library)
        ? normalizedSource.library
        : [];
  const packs = rawPacks.map(normalizePixelPackRecord).filter((pack) => Boolean(pack.id));
  const activePackId = normalizeText(
    normalizedSource.activePackId || normalizedSource.activeId || normalizedSource.selectedPackId,
    '',
  );
  const activeVersion = normalizeText(normalizedSource.activeVersion || normalizedSource.selectedVersion, '');
  const explicitActivePack = normalizedSource.activePack
    ? normalizePixelPackRecord({
      ...normalizedSource.activePack,
      active: true,
      status: 'active',
      })
    : null;
  const resolvedActivePack =
    explicitActivePack
    || packs.find((pack) => isSamePack(pack, activePackId, activeVersion))
    || packs.find((pack) => pack.active)
    || null;
  const normalizedActivePack = resolvedActivePack
    ? {
        ...resolvedActivePack,
        active: true,
        status: resolvedActivePack.status === 'error' ? 'error' : 'active',
      }
    : null;
  const mergedPacks = normalizedActivePack && !packs.some((pack) => pack.id === normalizedActivePack.id)
    ? [...packs, normalizedActivePack]
    : packs;

  return {
    revision: Number.isFinite(normalizedSource.revision) ? normalizedSource.revision : 0,
    updatedAt: normalizeText(normalizedSource.updatedAt, ''),
    supported: normalizedSource.supported !== false,
    loading: Boolean(normalizedSource.loading),
    activePackId: normalizedActivePack?.packId || activePackId,
    activeVersion: normalizedActivePack?.version || activeVersion,
    activePack: normalizedActivePack,
    packs: mergedPacks,
    error: normalizePixelPackError(normalizedSource.error || normalizedSource.lastError),
    lastEvent: normalizedSource.lastEvent || null,
  };
}

export function buildOfficeSceneAssetRegistry(baseRegistry = {}, pixelPackSource = null) {
  const mergedRegistry = normalizePlainObject(baseRegistry);
  const manifestSource = pixelPackSource?.activePack?.manifest
    || pixelPackSource?.manifest
    || pixelPackSource?.activePack
    || pixelPackSource;
  const manifest = normalizePixelPackManifest(manifestSource);

  for (const [assetKey, asset] of Object.entries(manifest.assets || {})) {
    const builtIn = normalizePlainObject(mergedRegistry[assetKey]);
    const assetUrl = normalizeText(asset.assetUrl || asset.url, normalizeText(builtIn.assetUrl || builtIn.url, ''));
    if (!assetUrl && !builtIn.assetUrl && !builtIn.url) {
      continue;
    }

    mergedRegistry[assetKey] = {
      ...builtIn,
      ...asset,
      key: normalizeText(asset.key, assetKey),
      assetKey: normalizeText(asset.assetKey, assetKey),
      assetUrl: assetUrl || normalizeText(builtIn.assetUrl || builtIn.url, ''),
      url: assetUrl || normalizeText(builtIn.url || builtIn.assetUrl, ''),
      asset: assetUrl || normalizeText(builtIn.asset || builtIn.url || builtIn.assetUrl, ''),
      cols: normalizeFrameDimension(asset.cols, builtIn.cols || 1),
      rows: normalizeFrameDimension(asset.rows, builtIn.rows || 1),
    };
  }

  return mergedRegistry;
}
