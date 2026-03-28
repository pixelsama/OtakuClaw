import { OFFICE_SCENE_ASSET_REGISTRY, resolveOfficeSceneAsset } from './officeSceneAssets.js';
export const DEFAULT_OFFICE_THEME_ID = 'star-office-classic';
const OFFICE_FURNITURE_CATEGORY_LABELS = {
  workstation: 'Workstations',
  seating: 'Seating',
  wall: 'Wall Decor',
  plants: 'Plants',
  companions: 'Companions',
  status: 'Status FX',
};

const DEFAULT_LABELS = {
  title: 'Pixel Room',
  subtitle: 'Star office preview',
  idle: 'Breakroom',
  writing: 'Writing desk',
  researching: 'Research desk',
  executing: 'Tool desk',
  syncing: 'Sync dock',
  error: 'Bug nook',
  multiAgentReady: 'Multi-agent ready',
  primaryAgent: 'Primary agent',
};

export const OFFICE_FURNITURE_CATALOG = {
  desk: {
    id: 'desk',
    label: 'Desk',
    kind: 'furniture',
    category: 'workstation',
    assetKey: 'desk',
    left: 6.3,
    top: 43.1,
    width: 21.6,
    aspectRatio: '276 / 214',
    zIndex: 8,
  },
  coffee: {
    id: 'coffee',
    label: 'Coffee Bar',
    kind: 'furniture',
    category: 'workstation',
    assetKey: 'coffeeMachine',
    left: 40.7,
    top: 42.3,
    width: 18,
    aspectRatio: '1 / 1',
    zIndex: 9,
    layers: [
      {
        id: 'coffee-shadow',
        kind: 'shadow',
        category: 'workstation',
        assetKey: 'coffeeMachineShadow',
        aspectRatio: '1 / 1',
        zIndex: 8,
      },
      {
        id: 'coffee-machine',
        kind: 'furniture',
        category: 'workstation',
        assetKey: 'coffeeMachine',
        aspectRatio: '1 / 1',
        zIndex: 9,
        animation: {
          fromFrame: 0,
          toFrame: 94,
          fps: 12.5,
        },
      },
    ],
  },
  sofa: {
    id: 'sofa',
    label: 'Sofa',
    kind: 'furniture',
    category: 'seating',
    assetKey: 'sofa',
    left: 52.3,
    top: 20,
    width: 20,
    aspectRatio: '1 / 1',
    zIndex: 7,
    layers: [
      {
        id: 'sofa-shadow',
        kind: 'shadow',
        assetKey: 'sofaShadow',
        aspectRatio: '1 / 1',
        zIndex: 6,
        opacity: 0.72,
      },
      {
        id: 'sofa',
        kind: 'furniture',
        assetKey: 'sofa',
        aspectRatio: '1 / 1',
        zIndex: 7,
      },
    ],
  },
  bug: {
    id: 'bug',
    label: 'Bug Alert',
    kind: 'status',
    category: 'status',
    assetKey: 'errorBug',
    left: 71.8,
    top: 18.2,
    width: 13.75,
    aspectRatio: '176 / 180',
    zIndex: 6,
    visibleWhenStates: ['error'],
  },
  poster: {
    id: 'poster',
    label: 'Friends Poster',
    kind: 'decor',
    category: 'wall',
    assetKey: 'posters',
    left: 13.4,
    top: 1.2,
    width: 12.5,
    aspectRatio: '1 / 1',
    zIndex: 4,
    frameIndex: 6,
  },
  memoBoard: {
    id: 'memoBoard',
    label: 'Claw Note',
    kind: 'decor',
    category: 'wall',
    assetKey: 'memoBoard',
    left: 78.4,
    top: 40.2,
    width: 18,
    aspectRatio: '4 / 3',
    zIndex: 3,
    opacity: 0.94,
  },
  plantLeft: {
    id: 'plantLeft',
    label: 'Lounge Plant',
    kind: 'decor',
    category: 'plants',
    assetKey: 'plants',
    left: 11.7,
    top: 14.6,
    width: 12.5,
    aspectRatio: '1 / 1',
    zIndex: 5,
    frameIndex: 5,
  },
  plantCenter: {
    id: 'plantCenter',
    label: 'Divider Plant',
    kind: 'decor',
    category: 'plants',
    assetKey: 'plants',
    left: 37.9,
    top: 13.6,
    width: 12.5,
    aspectRatio: '1 / 1',
    zIndex: 5,
    frameIndex: 1,
  },
  plantBedroom: {
    id: 'plantBedroom',
    label: 'Bedroom Plant',
    kind: 'decor',
    category: 'plants',
    assetKey: 'plants',
    left: 70.1,
    top: 57.8,
    width: 12.5,
    aspectRatio: '1 / 1',
    zIndex: 5,
    frameIndex: 10,
  },
  flowers: {
    id: 'flowers',
    label: 'Desk Flowers',
    kind: 'decor',
    category: 'plants',
    assetKey: 'flowers',
    left: 20.2,
    top: 47.1,
    width: 8,
    aspectRatio: '1 / 1',
    zIndex: 10,
    frameIndex: 7,
    stateVariants: {
      error: {
        frameIndex: 14,
      },
    },
  },
  cat: {
    id: 'cat',
    label: 'Cat Cushion',
    kind: 'decor',
    category: 'companions',
    assetKey: 'cats',
    left: 1.1,
    top: 66.2,
    width: 12.5,
    aspectRatio: '1 / 1',
    zIndex: 14,
    frameIndex: 3,
    stateVariants: {
      syncing: {
        frameIndex: 8,
      },
      error: {
        frameIndex: 12,
      },
    },
  },
  guestStandee1: {
    id: 'guestStandee1',
    label: 'Guest Standee 1',
    kind: 'decor',
    category: 'companions',
    assetKey: 'guestRole1',
    left: 11,
    top: 58.5,
    width: 9.5,
    aspectRatio: '1 / 1',
    zIndex: 13,
    frameIndex: 0,
    animation: {
      frames: [0, 1],
      fps: 3,
    },
  },
  guestStandee2: {
    id: 'guestStandee2',
    label: 'Guest Standee 2',
    kind: 'decor',
    category: 'companions',
    assetKey: 'guestRole2',
    left: 21,
    top: 58.5,
    width: 9.5,
    aspectRatio: '1 / 1',
    zIndex: 13,
    frameIndex: 0,
    animation: {
      frames: [0, 1],
      fps: 3,
    },
  },
  guestStandee3: {
    id: 'guestStandee3',
    label: 'Guest Standee 3',
    kind: 'decor',
    category: 'companions',
    assetKey: 'guestRole3',
    left: 31,
    top: 58.5,
    width: 9.5,
    aspectRatio: '1 / 1',
    zIndex: 13,
    frameIndex: 0,
    animation: {
      frames: [0, 1],
      fps: 3,
    },
  },
  guestStandee4: {
    id: 'guestStandee4',
    label: 'Guest Standee 4',
    kind: 'decor',
    category: 'companions',
    assetKey: 'guestRole4',
    left: 41,
    top: 58.5,
    width: 9.5,
    aspectRatio: '1 / 1',
    zIndex: 13,
    frameIndex: 0,
    animation: {
      frames: [0, 1],
      fps: 3,
    },
  },
  guestStandee5: {
    id: 'guestStandee5',
    label: 'Guest Standee 5',
    kind: 'decor',
    category: 'companions',
    assetKey: 'guestRole5',
    left: 51,
    top: 58.5,
    width: 9.5,
    aspectRatio: '1 / 1',
    zIndex: 13,
    frameIndex: 0,
    animation: {
      frames: [0, 1],
      fps: 3,
    },
  },
  guestStandee6: {
    id: 'guestStandee6',
    label: 'Guest Standee 6',
    kind: 'decor',
    category: 'companions',
    assetKey: 'guestRole6',
    left: 61,
    top: 58.5,
    width: 9.5,
    aspectRatio: '1 / 1',
    zIndex: 13,
    frameIndex: 0,
    animation: {
      frames: [0, 1],
      fps: 3,
    },
  },
  serverroom: {
    id: 'serverroom',
    label: 'Server Room',
    kind: 'status',
    category: 'status',
    assetKey: 'serverRoom',
    left: 72.7,
    top: 2.3,
    width: 14.1,
    aspectRatio: '180 / 251',
    zIndex: 2,
    frameIndex: 0,
    stateVariants: {
      writing: {
        frameIndex: 6,
      },
      researching: {
        frameIndex: 9,
      },
      executing: {
        frameIndex: 12,
      },
      syncing: {
        frameIndex: 18,
      },
      error: {
        frameIndex: 24,
      },
    },
  },
  syncBeacon: {
    id: 'syncBeacon',
    label: 'Sync Beacon',
    kind: 'status',
    category: 'status',
    assetKey: 'syncAnimation',
    left: 80.4,
    top: 64.4,
    width: 20,
    aspectRatio: '1 / 1',
    zIndex: 4,
    frameIndex: 0,
    visibleWhenStates: ['syncing'],
    animation: {
      fromFrame: 1,
      toFrame: 47,
      fps: 12,
    },
  },
};

export const OFFICE_ROOM_THEMES = {
  [DEFAULT_OFFICE_THEME_ID]: {
    id: DEFAULT_OFFICE_THEME_ID,
    label: 'Star Office Classic',
    backdrop: {
      assetKey: 'starOfficeBackdrop',
    },
    furnitureIds: [
      'poster',
      'memoBoard',
      'plantLeft',
      'plantCenter',
      'serverroom',
      'desk',
      'flowers',
      'coffee',
      'sofa',
      'bug',
      'syncBeacon',
      'cat',
      'plantBedroom',
    ],
  },
  'star-office-minimal': {
    id: 'star-office-minimal',
    label: 'Star Office Minimal',
    backdrop: {
      assetKey: 'starOfficeBackdrop',
    },
    furnitureIds: ['poster', 'plantLeft', 'desk', 'sofa', 'bug', 'cat'],
  },
};

export function listOfficeRoomThemes() {
  return Object.values(OFFICE_ROOM_THEMES).map((theme) => ({
    id: theme.id,
    label: theme.label,
  }));
}

export const DEFAULT_OFFICE_SCENE_CONFIG = {
  themeId: DEFAULT_OFFICE_THEME_ID,
  backdrop: {
    assetKey: 'starOfficeBackdrop',
  },
  areas: {
    lounge: {
      id: 'lounge',
      label: 'Lounge',
      x: 59,
      y: 18,
      slots: [
        { x: 60, y: 26 },
        { x: 67, y: 26 },
        { x: 63, y: 35 },
      ],
    },
    desk: {
      id: 'desk',
      label: 'Desk',
      x: 21,
      y: 47,
      slots: [
        { x: 18, y: 50 },
        { x: 26, y: 53 },
        { x: 22, y: 60 },
      ],
    },
    syncDock: {
      id: 'syncDock',
      label: 'Sync Dock',
      x: 88,
      y: 70,
      slots: [
        { x: 86, y: 70 },
        { x: 92, y: 68 },
        { x: 89, y: 77 },
      ],
    },
    bugNook: {
      id: 'bugNook',
      label: 'Bug Nook',
      x: 82,
      y: 24,
      slots: [
        { x: 82, y: 28 },
        { x: 88, y: 26 },
        { x: 84, y: 35 },
      ],
    },
  },
  furnitureOverrides: {},
  enabledFurnitureIds: [],
  disabledFurnitureIds: [],
  stateMap: {
    idle: { areaId: 'lounge', mood: 'resting', palette: 'idle' },
    writing: { areaId: 'desk', mood: 'typing', palette: 'focus' },
    researching: { areaId: 'desk', mood: 'thinking', palette: 'focus' },
    executing: { areaId: 'desk', mood: 'working', palette: 'focus' },
    syncing: { areaId: 'syncDock', mood: 'syncing', palette: 'sync' },
    error: { areaId: 'bugNook', mood: 'alert', palette: 'error' },
    chatting: { areaId: 'lounge', mood: 'chatting', palette: 'idle' },
    singing: { areaId: 'lounge', mood: 'performing', palette: 'focus' },
    gaming: { areaId: 'desk', mood: 'playing', palette: 'focus' },
    comforting: { areaId: 'lounge', mood: 'comforting', palette: 'idle' },
    sleeping: { areaId: 'lounge', mood: 'sleeping', palette: 'idle' },
    streaming: { areaId: 'desk', mood: 'broadcasting', palette: 'focus' },
    thinking: { areaId: 'desk', mood: 'thinking', palette: 'focus' },
  },
};

function normalizeString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeOptionalNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalObject(value) {
  return isObject(value) ? { ...value } : null;
}

function normalizeLabels(labels = {}) {
  return {
    ...DEFAULT_LABELS,
    ...(labels && typeof labels === 'object' ? labels : {}),
  };
}

function cloneFurniture(items = []) {
  return items.map((item) => ({ ...item }));
}

function normalizeThemeId(value) {
  return normalizeString(value, DEFAULT_OFFICE_THEME_ID);
}

export function resolveOfficeRoomTheme(themeId = DEFAULT_OFFICE_THEME_ID) {
  const resolvedThemeId = normalizeThemeId(themeId);
  return OFFICE_ROOM_THEMES[resolvedThemeId] || OFFICE_ROOM_THEMES[DEFAULT_OFFICE_THEME_ID];
}

function normalizeBackdrop(backdrop = {}, assetRegistry = OFFICE_SCENE_ASSET_REGISTRY) {
  const source = backdrop && typeof backdrop === 'object' ? backdrop : {};
  const assetKey = normalizeString(source.assetKey, DEFAULT_OFFICE_SCENE_CONFIG.backdrop.assetKey);
  const asset = resolveOfficeSceneAsset(assetKey, assetRegistry);
  return {
    assetKey,
    assetUrl: asset?.url || '',
  };
}

function normalizeStringList(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => normalizeString(value, '').toLowerCase())
    .filter(Boolean);
}

function normalizeUniqueStringList(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => normalizeString(value, ''))
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index);
}

function formatStateLabel(state = '') {
  const normalized = normalizeString(state, '').toLowerCase();
  if (!normalized) {
    return '';
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildFurnitureRuleLabel({
  visibleWhenStates = [],
  hiddenWhenStates = [],
  variantStates = [],
} = {}) {
  if (visibleWhenStates.length === 1 && hiddenWhenStates.length === 0) {
    return `${formatStateLabel(visibleWhenStates[0])}-only`;
  }

  if (visibleWhenStates.length > 0 || hiddenWhenStates.length > 0 || variantStates.length > 0) {
    return 'State furniture';
  }

  return 'Always';
}

const OFFICE_VARIANT_STATE_PRIORITY = [
  'error',
  'syncing',
  'executing',
  'researching',
  'writing',
  'thinking',
  'streaming',
  'gaming',
  'singing',
  'comforting',
  'chatting',
  'sleeping',
  'idle',
];

function sortBusinessStates(states = []) {
  const normalizedStates = normalizeUniqueStringList(states)
    .map((state) => normalizeString(state, '').toLowerCase())
    .filter(Boolean);

  return [...normalizedStates].sort((left, right) => {
    const leftPriority = OFFICE_VARIANT_STATE_PRIORITY.indexOf(left);
    const rightPriority = OFFICE_VARIANT_STATE_PRIORITY.indexOf(right);
    const normalizedLeftPriority = leftPriority >= 0 ? leftPriority : Number.MAX_SAFE_INTEGER;
    const normalizedRightPriority = rightPriority >= 0 ? rightPriority : Number.MAX_SAFE_INTEGER;
    if (normalizedLeftPriority !== normalizedRightPriority) {
      return normalizedLeftPriority - normalizedRightPriority;
    }
    return left.localeCompare(right);
  });
}

function normalizeStateVariants(variants = {}) {
  if (!isObject(variants)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(variants)
      .map(([state, value]) => [normalizeString(state, '').toLowerCase(), value])
      .filter(([state, value]) => state && isObject(value)),
  );
}

function pickMatchingVariantState(variants = {}, activeStates = []) {
  const normalizedVariants = normalizeStateVariants(variants);
  const normalizedActiveStates = normalizeStringList(activeStates);
  const prioritizedState = OFFICE_VARIANT_STATE_PRIORITY.find(
    (state) => normalizedActiveStates.includes(state) && normalizedVariants[state],
  );
  if (prioritizedState) {
    return prioritizedState;
  }

  return normalizedActiveStates.find((state) => normalizedVariants[state]) || '';
}

function applyMatchingStateVariant(source = {}, activeStates = []) {
  const normalizedSource = source && typeof source === 'object' ? source : {};
  const normalizedVariants = normalizeStateVariants(normalizedSource.stateVariants);
  const matchedState = pickMatchingVariantState(normalizedVariants, activeStates);
  if (!matchedState) {
    return {
      ...normalizedSource,
      stateVariants: normalizedVariants,
      activeVariantState: '',
    };
  }

  return {
    ...normalizedSource,
    ...(normalizedVariants[matchedState] || {}),
    stateVariants: normalizedVariants,
    activeVariantState: matchedState,
  };
}

function normalizeFrameIndex(value, cols = 1, rows = 1) {
  const numeric = Number.isFinite(value) ? value : Number(value);
  const frameCount = Math.max(1, (Number(cols) || 1) * (Number(rows) || 1));
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(frameCount - 1, Math.round(numeric)));
}

function resolveFramePosition(frameIndex = 0, cols = 1, rows = 1) {
  const safeCols = Math.max(1, Number(cols) || 1);
  const safeRows = Math.max(1, Number(rows) || 1);
  const normalizedFrameIndex = normalizeFrameIndex(frameIndex, safeCols, safeRows);
  const frameColumn = normalizedFrameIndex % safeCols;
  const frameRow = Math.floor(normalizedFrameIndex / safeCols);
  return {
    frameIndex: normalizedFrameIndex,
    backgroundPositionX: safeCols === 1 ? 0 : Number(((frameColumn / (safeCols - 1)) * 100).toFixed(4)),
    backgroundPositionY: safeRows === 1 ? 0 : Number(((frameRow / (safeRows - 1)) * 100).toFixed(4)),
  };
}

function normalizeFurnitureItem(item = {}, activeStates = [], assetRegistry = OFFICE_SCENE_ASSET_REGISTRY) {
  const source = applyMatchingStateVariant(item, activeStates);
  const assetKey = normalizeString(source.assetKey, '');
  const asset = resolveOfficeSceneAsset(assetKey, assetRegistry);
  const visibleWhenStates = normalizeStringList(source.visibleWhenStates);
  const hiddenWhenStates = normalizeStringList(source.hiddenWhenStates);
  const variantStates = Object.keys(normalizeStateVariants(source.stateVariants));
  const hidden = source.hidden === true;
  const shouldShowForVisibleStates = visibleWhenStates.length === 0
    || visibleWhenStates.some((state) => activeStates.includes(state));
  const shouldHideForHiddenStates = hiddenWhenStates.some((state) => activeStates.includes(state));
  const frame = resolveFramePosition(
    source.frameIndex,
    Number.isFinite(source.cols) ? source.cols : asset?.cols || 1,
    Number.isFinite(source.rows) ? source.rows : asset?.rows || 1,
  );

  return {
    ...source,
    id: normalizeString(source.id, assetKey || 'furniture'),
    label: normalizeString(source.label, normalizeString(source.id, assetKey || 'Furniture')),
    kind: normalizeString(source.kind, 'furniture'),
    assetKey,
    assetUrl: asset?.url || '',
    cols: Number.isFinite(source.cols) ? source.cols : asset?.cols || 1,
    rows: Number.isFinite(source.rows) ? source.rows : asset?.rows || 1,
    left: Number.isFinite(source.left) ? source.left : 0,
    top: Number.isFinite(source.top) ? source.top : 0,
    width: Number.isFinite(source.width) ? source.width : 10,
    aspectRatio: normalizeString(source.aspectRatio, '1 / 1'),
    zIndex: Number.isFinite(source.zIndex) ? source.zIndex : 1,
    opacity: Number.isFinite(source.opacity) ? source.opacity : 1,
    hidden,
    visibleWhenStates,
    hiddenWhenStates,
    variantStates,
    activeVariantState: normalizeString(source.activeVariantState, '').toLowerCase(),
    frameIndex: frame.frameIndex,
    backgroundPositionX: frame.backgroundPositionX,
    backgroundPositionY: frame.backgroundPositionY,
    isVisible: !hidden && shouldShowForVisibleStates && !shouldHideForHiddenStates,
  };
}

function normalizeFurnitureLayers(item = {}, activeStates = [], assetRegistry = OFFICE_SCENE_ASSET_REGISTRY) {
  const source = item && typeof item === 'object' ? item : {};
  const itemId = normalizeString(source.id, 'furniture');
  const itemWidth = Number.isFinite(source.width) ? source.width : 10;
  const itemAspectRatio = normalizeString(source.aspectRatio, '1 / 1');
  const itemOpacity = Number.isFinite(source.opacity) ? source.opacity : 1;
  const itemZIndex = Number.isFinite(source.zIndex) ? source.zIndex : 1;
  const sourceLayers = Array.isArray(source.layers) && source.layers.length > 0
    ? source.layers
    : [{
        id: itemId,
        kind: normalizeString(source.kind, 'furniture'),
        category: normalizeString(source.category, 'misc'),
        assetKey: source.assetKey,
        cols: source.cols,
        rows: source.rows,
        width: itemWidth,
        aspectRatio: itemAspectRatio,
        zIndex: itemZIndex,
        opacity: itemOpacity,
        frameIndex: source.frameIndex,
        animation: source.animation,
      }];

  return sourceLayers
    .map((layer, index) => {
      const layerSource = applyMatchingStateVariant(layer, activeStates);
      const layerAssetKey = normalizeString(layerSource.assetKey, '');
      const layerAsset = resolveOfficeSceneAsset(layerAssetKey, assetRegistry);
      if (!layerAsset?.url) {
        return null;
      }
      const cols = Number.isFinite(layerSource.cols) ? layerSource.cols : layerAsset.cols || 1;
      const rows = Number.isFinite(layerSource.rows) ? layerSource.rows : layerAsset.rows || 1;
      const frame = resolveFramePosition(layerSource.frameIndex, cols, rows);

      return {
        ...layerSource,
        id: normalizeString(layerSource.id, `${itemId}-layer-${index + 1}`),
        kind: normalizeString(layerSource.kind, normalizeString(source.kind, 'furniture')),
        assetKey: layerAssetKey,
        assetUrl: layerAsset.url,
        cols,
        rows,
        width: Number.isFinite(layerSource.width) ? layerSource.width : itemWidth,
        aspectRatio: normalizeString(layerSource.aspectRatio, itemAspectRatio),
        zIndex: Number.isFinite(layerSource.zIndex) ? layerSource.zIndex : itemZIndex,
        opacity: Number.isFinite(layerSource.opacity) ? layerSource.opacity : itemOpacity,
        frameIndex: frame.frameIndex,
        backgroundPositionX: frame.backgroundPositionX,
        backgroundPositionY: frame.backgroundPositionY,
      };
    })
    .filter(Boolean);
}

function normalizeFurniture(items = [], activeStates = [], assetRegistry = OFFICE_SCENE_ASSET_REGISTRY) {
  return cloneFurniture(items)
    .map((item) => {
      const normalizedItem = normalizeFurnitureItem(item, activeStates, assetRegistry);
      const normalizedLayers = normalizeFurnitureLayers(normalizedItem, activeStates, assetRegistry);
      return {
        ...normalizedItem,
        assetUrl: normalizedLayers[normalizedLayers.length - 1]?.assetUrl || normalizedItem.assetUrl,
        cols: normalizedLayers[normalizedLayers.length - 1]?.cols || normalizedItem.cols,
        rows: normalizedLayers[normalizedLayers.length - 1]?.rows || normalizedItem.rows,
        aspectRatio: normalizedLayers[normalizedLayers.length - 1]?.aspectRatio || normalizedItem.aspectRatio,
        zIndex: normalizedLayers[normalizedLayers.length - 1]?.zIndex || normalizedItem.zIndex,
        opacity: normalizedLayers[normalizedLayers.length - 1]?.opacity || normalizedItem.opacity,
        layers: normalizedLayers,
      };
    })
    .filter((item) => item.layers.length > 0);
}

function normalizeFurnitureOverrides(overrides = {}) {
  if (!isObject(overrides)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(overrides)
      .map(([key, value]) => [normalizeString(key, ''), value])
      .filter(([key, value]) => key && value && typeof value === 'object' && !Array.isArray(value)),
  );
}

function normalizeAnimationForEditor(animation = null) {
  if (!isObject(animation)) {
    return null;
  }

  const normalizedAnimation = {
    ...animation,
  };

  const normalizedFps = normalizeOptionalNumber(normalizedAnimation.fps);
  if (normalizedFps === null) {
    delete normalizedAnimation.fps;
  } else {
    normalizedAnimation.fps = normalizedFps;
  }

  if (Array.isArray(normalizedAnimation.frames)) {
    const frames = normalizedAnimation.frames
      .map((frame) => normalizeOptionalNumber(frame))
      .filter((frame) => Number.isFinite(frame))
      .map((frame) => Math.round(frame));
    normalizedAnimation.frames = frames;
    delete normalizedAnimation.fromFrame;
    delete normalizedAnimation.toFrame;
    return frames.length > 0 ? normalizedAnimation : null;
  }

  const fromFrame = normalizeOptionalNumber(normalizedAnimation.fromFrame);
  const toFrame = normalizeOptionalNumber(normalizedAnimation.toFrame);
  if (fromFrame === null || toFrame === null) {
    return normalizedAnimation.fps ? normalizedAnimation : null;
  }

  normalizedAnimation.fromFrame = Math.round(fromFrame);
  normalizedAnimation.toFrame = Math.round(toFrame);
  delete normalizedAnimation.frames;
  return normalizedAnimation;
}

export function normalizeOfficeSceneLayout(layout = {}) {
  const source = isObject(layout) ? layout : {};
  return {
    themeId: normalizeThemeId(source.themeId),
    furnitureOverrides: normalizeFurnitureOverrides(source.furnitureOverrides),
    enabledFurnitureIds: normalizeUniqueStringList(source.enabledFurnitureIds),
    disabledFurnitureIds: normalizeUniqueStringList(source.disabledFurnitureIds),
  };
}

export function getOfficeFurnitureCatalogItem(furnitureId = '') {
  const normalizedId = normalizeString(furnitureId, '');
  if (!normalizedId || !OFFICE_FURNITURE_CATALOG[normalizedId]) {
    return null;
  }

  return {
    ...OFFICE_FURNITURE_CATALOG[normalizedId],
  };
}

function resolveThemeFurniture({
  themeId = DEFAULT_OFFICE_THEME_ID,
  furniture = null,
  furnitureOverrides = {},
  enabledFurnitureIds = [],
  disabledFurnitureIds = [],
  activeStates = [],
  assetRegistry = OFFICE_SCENE_ASSET_REGISTRY,
} = {}) {
  if (Array.isArray(furniture) && furniture.length > 0) {
    return normalizeFurniture(furniture, activeStates, assetRegistry);
  }

  const theme = resolveOfficeRoomTheme(themeId);
  const overrides = normalizeFurnitureOverrides(furnitureOverrides);
  const defaultFurnitureIds = normalizeUniqueStringList(theme.furnitureIds || []);
  const enabledIds = normalizeUniqueStringList(enabledFurnitureIds);
  const disabledIds = new Set(normalizeUniqueStringList(disabledFurnitureIds));
  const resolvedFurnitureIds = [
    ...defaultFurnitureIds.filter((id) => !disabledIds.has(id)),
    ...enabledIds.filter((id) => !defaultFurnitureIds.includes(id)),
  ];
  const items = resolvedFurnitureIds
    .map((catalogId) => {
      const item = OFFICE_FURNITURE_CATALOG[catalogId];
      if (!item) {
        return null;
      }

      return {
        ...item,
        ...(overrides[item.id] || {}),
      };
    })
    .filter(Boolean);

  return normalizeFurniture(items, activeStates, assetRegistry);
}

export function resolveOfficeSceneEditorState({
  sceneConfig = DEFAULT_OFFICE_SCENE_CONFIG,
  officeState = {},
  assetRegistry = OFFICE_SCENE_ASSET_REGISTRY,
} = {}) {
  const normalizedLayout = normalizeOfficeSceneLayout(sceneConfig);
  const normalizedState = normalizeOfficeState(officeState);
  const activeStates = normalizedState.agents.map((agent) => normalizeString(agent.businessState, 'idle').toLowerCase());
  const theme = resolveOfficeRoomTheme(normalizedLayout.themeId);
  const defaultFurnitureIds = normalizeUniqueStringList(theme.furnitureIds || []);
  const resolvedFurniture = resolveThemeFurniture({
    themeId: normalizedLayout.themeId,
    furnitureOverrides: normalizedLayout.furnitureOverrides,
    enabledFurnitureIds: normalizedLayout.enabledFurnitureIds,
    disabledFurnitureIds: normalizedLayout.disabledFurnitureIds,
    activeStates,
    assetRegistry,
  });
  const furniture = resolvedFurniture.map((normalized) => {
    const baseItem = getOfficeFurnitureCatalogItem(normalized.id);
    const baseNormalizedItem = baseItem ? normalizeFurnitureItem(baseItem, activeStates, assetRegistry) : null;
    const baseNormalizedLayers = baseNormalizedItem
      ? normalizeFurnitureLayers(baseNormalizedItem, activeStates, assetRegistry)
      : [];
    const baseLayerMap = new Map(baseNormalizedLayers.map((layer) => [layer.id, layer]));
    const layers = (Array.isArray(normalized.layers) ? normalized.layers : []).map((layer, index) => {
      const baseLayer = baseLayerMap.get(layer.id) || baseNormalizedLayers[index] || null;
      return {
        id: layer.id,
        label: normalizeString(layer.label, layer.id),
        kind: normalizeString(layer.kind, 'furniture'),
        assetKey: normalizeString(layer.assetKey, ''),
        cols: Number.isFinite(layer.cols) ? layer.cols : 1,
        rows: Number.isFinite(layer.rows) ? layer.rows : 1,
        width: Number.isFinite(layer.width) ? layer.width : normalized.width,
        zIndex: Number.isFinite(layer.zIndex) ? layer.zIndex : normalized.zIndex,
        opacity: Number.isFinite(layer.opacity) ? layer.opacity : 1,
        frameIndex: Number.isFinite(layer.frameIndex) ? layer.frameIndex : 0,
        aspectRatio: normalizeString(layer.aspectRatio, normalized.aspectRatio),
        animation: normalizeAnimationForEditor(layer.animation),
        variantStates: sortBusinessStates(Object.keys(normalizeStateVariants(layer.stateVariants))),
        activeVariantState: normalizeString(layer.activeVariantState, '').toLowerCase(),
        defaultAssetKey: normalizeString(baseLayer?.assetKey, normalizeString(layer.assetKey, '')),
        defaultWidth: Number.isFinite(baseLayer?.width) ? baseLayer.width : (Number.isFinite(layer.width) ? layer.width : normalized.width),
        defaultZIndex: Number.isFinite(baseLayer?.zIndex) ? baseLayer.zIndex : (Number.isFinite(layer.zIndex) ? layer.zIndex : normalized.zIndex),
        defaultOpacity: Number.isFinite(baseLayer?.opacity) ? baseLayer.opacity : (Number.isFinite(layer.opacity) ? layer.opacity : 1),
        defaultFrameIndex: Number.isFinite(baseLayer?.frameIndex) ? baseLayer.frameIndex : (Number.isFinite(layer.frameIndex) ? layer.frameIndex : 0),
        defaultAspectRatio: normalizeString(baseLayer?.aspectRatio, normalizeString(layer.aspectRatio, normalized.aspectRatio)),
        defaultCols: Number.isFinite(baseLayer?.cols) ? baseLayer.cols : (Number.isFinite(layer.cols) ? layer.cols : 1),
        defaultRows: Number.isFinite(baseLayer?.rows) ? baseLayer.rows : (Number.isFinite(layer.rows) ? layer.rows : 1),
        defaultAnimation: normalizeAnimationForEditor(baseLayer?.animation),
      };
    });

    return {
      id: normalized.id,
      label: normalized.label,
      kind: normalized.kind,
      category: normalizeString(baseItem?.category, 'misc'),
      hidden: normalized.hidden,
      isVisible: normalized.isVisible,
      isInRoom: true,
      ruleLabel: buildFurnitureRuleLabel({
        visibleWhenStates: normalized.visibleWhenStates,
        hiddenWhenStates: normalized.hiddenWhenStates,
        variantStates: normalized.variantStates,
      }),
      left: normalized.left,
      top: normalized.top,
      width: normalized.width,
      zIndex: normalized.zIndex,
      opacity: normalized.opacity,
      frameIndex: normalized.frameIndex,
      aspectRatio: normalized.aspectRatio,
      assetKey: normalized.assetKey,
      cols: normalized.cols,
      rows: normalized.rows,
      animation: normalizeAnimationForEditor(normalized.animation),
      visibleWhenStates: normalized.visibleWhenStates,
      hiddenWhenStates: normalized.hiddenWhenStates,
      variantStates: sortBusinessStates(normalized.variantStates),
      activeVariantState: normalized.activeVariantState,
      defaultLeft: Number.isFinite(baseItem?.left) ? baseItem.left : normalized.left,
      defaultTop: Number.isFinite(baseItem?.top) ? baseItem.top : normalized.top,
      defaultWidth: Number.isFinite(baseItem?.width) ? baseItem.width : normalized.width,
      defaultZIndex: Number.isFinite(baseItem?.zIndex) ? baseItem.zIndex : normalized.zIndex,
      defaultOpacity: Number.isFinite(baseItem?.opacity) ? baseItem.opacity : normalized.opacity,
      defaultFrameIndex: Number.isFinite(baseItem?.frameIndex) ? baseItem.frameIndex : normalized.frameIndex,
      defaultAspectRatio: normalizeString(baseItem?.aspectRatio, normalized.aspectRatio),
      defaultAssetKey: normalizeString(baseItem?.assetKey, normalized.assetKey),
      defaultVisibleWhenStates: sortBusinessStates(baseItem?.visibleWhenStates || []),
      defaultHiddenWhenStates: sortBusinessStates(baseItem?.hiddenWhenStates || []),
      layers,
    };
  });
  const catalog = Object.values(OFFICE_FURNITURE_CATALOG)
    .map((item) => {
      const normalizedId = normalizeString(item.id, '');
      const defaultEnabled = defaultFurnitureIds.includes(normalizedId);
      const enabled = furniture.some((furnitureItem) => furnitureItem.id === normalizedId);
      return {
        id: normalizedId,
        label: normalizeString(item.label, normalizedId),
        category: normalizeString(item.category, 'misc'),
        categoryLabel: OFFICE_FURNITURE_CATEGORY_LABELS[normalizeString(item.category, 'misc')] || 'Misc',
        enabled,
        defaultEnabled,
        ruleLabel: buildFurnitureRuleLabel({
          visibleWhenStates: normalizeStringList(item.visibleWhenStates),
          hiddenWhenStates: normalizeStringList(item.hiddenWhenStates),
          variantStates: Object.keys(normalizeStateVariants(item.stateVariants)),
        }),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
  const catalogCategories = [
    { id: 'all', label: 'All' },
    ...normalizeUniqueStringList(catalog.map((item) => item.category)).map((categoryId) => ({
      id: categoryId,
      label: OFFICE_FURNITURE_CATEGORY_LABELS[categoryId] || formatStateLabel(categoryId),
    })),
  ];
  const availableStates = sortBusinessStates(Object.keys(normalizeStateMap(sceneConfig?.stateMap)));
  const assetOptions = Object.entries(assetRegistry && typeof assetRegistry === 'object' ? assetRegistry : {})
    .map(([assetKey, asset]) => {
      const resolvedAsset = resolveOfficeSceneAsset(assetKey, assetRegistry);
      const assetUrl = normalizeString(
        resolvedAsset?.url
        || asset?.assetUrl
        || asset?.url
        || asset?.asset,
        '',
      );
      if (!assetUrl) {
        return null;
      }

      return {
        assetKey,
        label: normalizeString(asset?.label || asset?.name, assetKey),
        cols: Number.isFinite(asset?.cols) ? asset.cols : Number.isFinite(resolvedAsset?.cols) ? resolvedAsset.cols : 1,
        rows: Number.isFinite(asset?.rows) ? asset.rows : Number.isFinite(resolvedAsset?.rows) ? resolvedAsset.rows : 1,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.label.localeCompare(right.label));

  return {
    themeId: theme.id,
    themeLabel: theme.label,
    themeOptions: listOfficeRoomThemes(),
    furniture,
    catalog,
    catalogCategories,
    availableStates,
    assetOptions,
  };
}

function normalizeStateMap(map = {}) {
  return {
    ...DEFAULT_OFFICE_SCENE_CONFIG.stateMap,
    ...(map && typeof map === 'object' ? map : {}),
  };
}

export function normalizeOfficeAgent(agent = {}, fallbackId = '') {
  const source = agent && typeof agent === 'object' ? agent : {};
  const agentId = normalizeString(source.agentId || source.id, fallbackId);
  if (!agentId) {
    return null;
  }
  const businessState = normalizeString(source.businessState, 'idle').toLowerCase();
  const activeAgentId = normalizeString(source.activeAgentId, '');
  const isPrimary = Boolean(source.isPrimary) || (activeAgentId ? agentId === activeAgentId : false);
  return {
    agentId,
    id: agentId,
    displayName: normalizeString(source.displayName || source.name, 'Agent'),
    businessState,
    detail: normalizeString(source.detail, ''),
    sceneState: normalizeString(source.sceneState, ''),
    role: normalizeString(source.role, isPrimary ? 'primary' : 'support'),
    updatedAt: normalizeString(source.updatedAt, ''),
    isPrimary,
    backend: normalizeString(source.backend, ''),
    profileId: normalizeString(source.profileId, ''),
    routeKey: normalizeString(source.routeKey, ''),
    sessionId: normalizeString(source.sessionId, ''),
    sessionNamespace: normalizeString(source.sessionNamespace, ''),
    turnId: normalizeString(source.turnId, ''),
    mood: normalizeOptionalNumber(source.mood),
    affinity: normalizeOptionalNumber(source.affinity),
    stats: normalizeOptionalObject(source.stats),
    valueState: normalizeOptionalObject(source.valueState),
  };
}

export function normalizeOfficeState(state = {}) {
  const source = state && typeof state === 'object' ? state : {};
  const rawAgents = Array.isArray(source.agents)
    ? source.agents
    : source.agents && typeof source.agents === 'object'
      ? Object.values(source.agents)
      : [];
  const agents = rawAgents
    .map((agent, index) => normalizeOfficeAgent(agent, `agent-${index + 1}`))
    .filter(Boolean);
  const requestedActiveAgentId = normalizeString(source.activeAgentId, '');
  const activeAgentId = agents.some((agent) => agent.agentId === requestedActiveAgentId)
    ? requestedActiveAgentId
    : normalizeString(agents[0]?.agentId, '');
  const normalizedAgents = agents.map((agent) => ({
    ...agent,
    role: normalizeString(agent.role, agent.agentId === activeAgentId ? 'primary' : 'support'),
    isPrimary: agent.agentId === activeAgentId,
  }));

  return {
    revision: Number.isFinite(source.revision) ? source.revision : 0,
    activeAgentId,
    agents: normalizedAgents,
  };
}

export function derivePrimaryOfficeAgent({
  agentId = 'primary',
  displayName = 'OtakuClaw',
  isStreaming = false,
  activeDownloadTasks = [],
  errorMessage = '',
  activityState = '',
  activityDetail = '',
  detail = '',
  updatedAt = '',
  businessStateOverride = '',
} = {}) {
  const normalizedError = normalizeString(errorMessage, '');
  const tasks = Array.isArray(activeDownloadTasks) ? activeDownloadTasks : [];
  const normalizedActivityState = normalizeString(activityState, '').toLowerCase();
  const normalizedActivityDetail = normalizeString(activityDetail, '');
  const normalizedDetail = normalizeString(detail, '');
  const fallbackBusinessState = normalizedError
    ? 'error'
    : tasks.length > 0
      ? 'syncing'
      : normalizedActivityState
        ? normalizedActivityState
      : isStreaming
        ? 'writing'
        : 'idle';
  const businessState = normalizeString(businessStateOverride, fallbackBusinessState).toLowerCase();
  const primaryDetail = normalizedError
    ? normalizedError
    : businessState === 'syncing'
      ? normalizeString(tasks[0]?.currentFile || tasks[0]?.title, 'Synchronizing local runtime assets.')
      : normalizedActivityState && businessState === normalizedActivityState
        ? normalizedActivityDetail || normalizedDetail
      : normalizedDetail || (businessState === 'writing' ? 'The assistant is actively responding.' : 'Ready for the next prompt.');

  return normalizeOfficeAgent({
    agentId,
    displayName,
    businessState,
    detail: primaryDetail,
    role: 'primary',
    updatedAt: normalizeString(updatedAt, new Date().toISOString()),
    isPrimary: true,
  }, agentId || 'primary');
}

export function reduceOfficeActivityHint(currentHint = null, event = {}) {
  if (!event || typeof event !== 'object') {
    return currentHint;
  }

  const channel = normalizeString(event.channel, '').toLowerCase();
  if (channel !== 'chat') {
    return currentHint;
  }

  const type = normalizeString(event.type, '').toLowerCase();
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const streamId = normalizeString(event.streamId, '');
  const updatedAt = normalizeString(event.timestamp || payload.updatedAt, new Date().toISOString());

  if (type === 'agent-state') {
    const businessState = normalizeString(payload.businessState, '').toLowerCase();
    if (!businessState) {
      return currentHint;
    }

    return {
      streamId,
      businessState,
      detail: normalizeString(payload.detail, ''),
      updatedAt,
    };
  }

  if (type === 'text-delta') {
    if (!currentHint) {
      return currentHint;
    }

    if (currentHint.streamId && streamId && currentHint.streamId !== streamId) {
      return currentHint;
    }

    if (payload.final !== true) {
      return currentHint;
    }

    return {
      ...currentHint,
      streamId: streamId || currentHint.streamId || '',
      businessState: 'writing',
      detail: '',
      updatedAt,
    };
  }

  if (type !== 'done' && type !== 'error') {
    return currentHint;
  }

  if (!currentHint) {
    return currentHint;
  }

  if (currentHint.streamId && streamId && currentHint.streamId !== streamId) {
    return currentHint;
  }

  return null;
}

export function buildOfficeDisplayState({
  officeState = {},
  primaryAgent = null,
  previewMode = 'live',
} = {}) {
  const normalizedSnapshot = normalizeOfficeState(officeState);
  const normalizedPrimaryAgent = primaryAgent ? normalizeOfficeAgent(primaryAgent, 'primary') : null;
  const baseState = normalizedSnapshot;

  if (normalizeString(previewMode, 'live') !== 'error') {
    return baseState;
  }

  const previewAgentId = normalizedPrimaryAgent?.agentId
    || normalizeString(baseState.activeAgentId, '')
    || normalizeString(baseState.agents[0]?.agentId, '');
  if (!previewAgentId) {
    return baseState;
  }

  return normalizeOfficeState({
    ...baseState,
    activeAgentId: normalizeString(baseState.activeAgentId, previewAgentId),
    agents: baseState.agents.map((agent) => (
      agent.agentId !== previewAgentId
        ? agent
        : {
            ...agent,
            businessState: 'error',
            detail: 'Previewing error-state furniture.',
            updatedAt: new Date().toISOString(),
          }
    )),
  });
}

function resolveSceneSlot(area, index) {
  const slots = Array.isArray(area?.slots) && area.slots.length > 0 ? area.slots : [{ x: area?.x || 50, y: area?.y || 50 }];
  return slots[index % slots.length] || slots[0];
}

function buildOccupants({ agents, config, activeAgentId }) {
  const buckets = new Map();
  const stateMap = config.stateMap;
  const normalizedAgents = agents.map((agent) => {
    const sceneState = stateMap[agent.businessState] || stateMap.idle;
    const areaId = normalizeString(agent.sceneState, sceneState.areaId || 'lounge');
    const areaBucket = buckets.get(areaId) || [];
    const slotIndex = areaBucket.length;
    areaBucket.push(agent.agentId);
    buckets.set(areaId, areaBucket);
    const slot = resolveSceneSlot(config.areas[areaId], slotIndex);
    return {
      ...agent,
      areaId,
      mood: sceneState.mood,
      palette: sceneState.palette,
      slot,
      isPrimary: agent.agentId === activeAgentId,
    };
  });

  return normalizedAgents.sort((left, right) => {
    if (left.isPrimary && !right.isPrimary) {
      return -1;
    }
    if (!left.isPrimary && right.isPrimary) {
      return 1;
    }
    return left.displayName.localeCompare(right.displayName);
  });
}

export function resolveOfficeSceneState({
  officeState = {},
  labels = {},
  sceneConfig = DEFAULT_OFFICE_SCENE_CONFIG,
  subtitle = '',
  caption = '',
  assetRegistry = OFFICE_SCENE_ASSET_REGISTRY,
} = {}) {
  const normalizedState = normalizeOfficeState(officeState);
  const normalizedLabels = normalizeLabels(labels);
  const activeStates = normalizedState.agents.map((agent) => normalizeString(agent.businessState, 'idle').toLowerCase());
  const theme = resolveOfficeRoomTheme(sceneConfig?.themeId || DEFAULT_OFFICE_SCENE_CONFIG.themeId);
  const config = {
    themeId: theme.id,
    themeLabel: theme.label,
    backdrop: normalizeBackdrop(sceneConfig?.backdrop || theme.backdrop || DEFAULT_OFFICE_SCENE_CONFIG.backdrop, assetRegistry),
    areas: sceneConfig?.areas || DEFAULT_OFFICE_SCENE_CONFIG.areas,
    furniture: resolveThemeFurniture({
      themeId: sceneConfig?.themeId || DEFAULT_OFFICE_SCENE_CONFIG.themeId,
      furniture: sceneConfig?.furniture,
      furnitureOverrides: sceneConfig?.furnitureOverrides || DEFAULT_OFFICE_SCENE_CONFIG.furnitureOverrides,
      enabledFurnitureIds: sceneConfig?.enabledFurnitureIds || DEFAULT_OFFICE_SCENE_CONFIG.enabledFurnitureIds,
      disabledFurnitureIds: sceneConfig?.disabledFurnitureIds || DEFAULT_OFFICE_SCENE_CONFIG.disabledFurnitureIds,
      activeStates,
      assetRegistry,
    }),
    stateMap: normalizeStateMap(sceneConfig?.stateMap),
    assetRegistry,
  };
  const occupants = buildOccupants({
    agents: normalizedState.agents,
    config,
    activeAgentId: normalizedState.activeAgentId,
  });
  const primaryAgent = occupants.find((agent) => agent.isPrimary) || occupants[0];
  const areaSummaries = Object.values(config.areas).map((area) => ({
    id: area.id,
    label: area.label,
    occupantCount: occupants.filter((agent) => agent.areaId === area.id).length,
  }));

  return {
    labels: normalizedLabels,
    title: normalizedLabels.title,
    subtitle: subtitle || normalizedLabels.subtitle,
    caption: normalizeString(caption, ''),
    revision: normalizedState.revision,
    activeAgentId: normalizedState.activeAgentId,
    config,
    occupants,
    primaryAgent,
    areaSummaries,
    agentCount: occupants.length,
  };
}

export { normalizeString, normalizeLabels };
