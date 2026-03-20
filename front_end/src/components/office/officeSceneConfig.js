import { resolveOfficeSceneAsset } from './officeSceneAssets.js';

export const OFFICE_PRIMARY_AGENT_ID = 'main';
export const DEFAULT_OFFICE_THEME_ID = 'star-office-classic';

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
    assetKey: 'coffeeMachine',
    left: 40.7,
    top: 42.3,
    width: 18,
    aspectRatio: '1 / 1',
    zIndex: 9,
  },
  'sofa-shadow': {
    id: 'sofa-shadow',
    label: 'Sofa Shadow',
    kind: 'shadow',
    assetKey: 'sofaShadow',
    left: 52.3,
    top: 20,
    width: 20,
    aspectRatio: '1 / 1',
    zIndex: 6,
    opacity: 0.72,
  },
  sofa: {
    id: 'sofa',
    label: 'Sofa',
    kind: 'furniture',
    assetKey: 'sofa',
    left: 52.3,
    top: 20,
    width: 20,
    aspectRatio: '1 / 1',
    zIndex: 7,
  },
  bug: {
    id: 'bug',
    label: 'Bug Alert',
    kind: 'status',
    assetKey: 'errorBug',
    left: 71.8,
    top: 18.2,
    width: 13.75,
    aspectRatio: '176 / 180',
    zIndex: 6,
    visibleWhenStates: ['error'],
  },
};

export const OFFICE_ROOM_THEMES = {
  [DEFAULT_OFFICE_THEME_ID]: {
    id: DEFAULT_OFFICE_THEME_ID,
    label: 'Star Office Classic',
    backdrop: {
      assetKey: 'starOfficeBackdrop',
    },
    furnitureIds: ['desk', 'coffee', 'sofa-shadow', 'sofa', 'bug'],
  },
  'star-office-minimal': {
    id: 'star-office-minimal',
    label: 'Star Office Minimal',
    backdrop: {
      assetKey: 'starOfficeBackdrop',
    },
    furnitureIds: ['desk', 'sofa-shadow', 'sofa', 'bug'],
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

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function normalizeBackdrop(backdrop = {}) {
  const source = backdrop && typeof backdrop === 'object' ? backdrop : {};
  const assetKey = normalizeString(source.assetKey, DEFAULT_OFFICE_SCENE_CONFIG.backdrop.assetKey);
  const asset = resolveOfficeSceneAsset(assetKey);
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
} = {}) {
  if (visibleWhenStates.length === 1 && hiddenWhenStates.length === 0) {
    return `${formatStateLabel(visibleWhenStates[0])}-only`;
  }

  if (visibleWhenStates.length > 0 || hiddenWhenStates.length > 0) {
    return 'State furniture';
  }

  return 'Always';
}

function normalizeFurnitureItem(item = {}, activeStates = []) {
  const source = item && typeof item === 'object' ? item : {};
  const assetKey = normalizeString(source.assetKey, '');
  const asset = resolveOfficeSceneAsset(assetKey);
  const visibleWhenStates = normalizeStringList(source.visibleWhenStates);
  const hiddenWhenStates = normalizeStringList(source.hiddenWhenStates);
  const hidden = source.hidden === true;
  const shouldShowForVisibleStates = visibleWhenStates.length === 0
    || visibleWhenStates.some((state) => activeStates.includes(state));
  const shouldHideForHiddenStates = hiddenWhenStates.some((state) => activeStates.includes(state));

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
    isVisible: !hidden && shouldShowForVisibleStates && !shouldHideForHiddenStates,
  };
}

function normalizeFurniture(items = [], activeStates = []) {
  return cloneFurniture(items)
    .map((item) => normalizeFurnitureItem(item, activeStates))
    .filter((item) => item.assetUrl);
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

export function normalizeOfficeSceneLayout(layout = {}) {
  const source = isObject(layout) ? layout : {};
  return {
    themeId: normalizeThemeId(source.themeId),
    furnitureOverrides: normalizeFurnitureOverrides(source.furnitureOverrides),
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
  activeStates = [],
} = {}) {
  if (Array.isArray(furniture) && furniture.length > 0) {
    return normalizeFurniture(furniture, activeStates);
  }

  const theme = resolveOfficeRoomTheme(themeId);
  const overrides = normalizeFurnitureOverrides(furnitureOverrides);
  const items = (theme.furnitureIds || [])
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

  return normalizeFurniture(items, activeStates);
}

export function resolveOfficeSceneEditorState({
  sceneConfig = DEFAULT_OFFICE_SCENE_CONFIG,
  officeState = {},
} = {}) {
  const normalizedLayout = normalizeOfficeSceneLayout(sceneConfig);
  const normalizedState = normalizeOfficeState(officeState);
  const activeStates = normalizedState.agents.map((agent) => normalizeString(agent.businessState, 'idle').toLowerCase());
  const theme = resolveOfficeRoomTheme(normalizedLayout.themeId);
  const furniture = (theme.furnitureIds || [])
    .map((furnitureId) => {
      const baseItem = getOfficeFurnitureCatalogItem(furnitureId);
      if (!baseItem) {
        return null;
      }

      const override = normalizedLayout.furnitureOverrides[furnitureId] || {};
      const normalized = normalizeFurnitureItem({
        ...baseItem,
        ...override,
      }, activeStates);

      return {
        id: normalized.id,
        label: normalized.label,
        kind: normalized.kind,
        hidden: normalized.hidden,
        isVisible: normalized.isVisible,
        ruleLabel: buildFurnitureRuleLabel({
          visibleWhenStates: normalized.visibleWhenStates,
          hiddenWhenStates: normalized.hiddenWhenStates,
        }),
        left: normalized.left,
        top: normalized.top,
        width: normalized.width,
        zIndex: normalized.zIndex,
        visibleWhenStates: normalized.visibleWhenStates,
        hiddenWhenStates: normalized.hiddenWhenStates,
        defaultLeft: Number.isFinite(baseItem.left) ? baseItem.left : normalized.left,
        defaultTop: Number.isFinite(baseItem.top) ? baseItem.top : normalized.top,
      };
    })
    .filter(Boolean);

  return {
    themeId: theme.id,
    themeLabel: theme.label,
    themeOptions: listOfficeRoomThemes(),
    furniture,
  };
}

function normalizeStateMap(map = {}) {
  return {
    ...DEFAULT_OFFICE_SCENE_CONFIG.stateMap,
    ...(map && typeof map === 'object' ? map : {}),
  };
}

export function normalizeOfficeAgent(agent = {}, fallbackId = OFFICE_PRIMARY_AGENT_ID) {
  const source = agent && typeof agent === 'object' ? agent : {};
  const agentId = normalizeString(source.agentId || source.id, fallbackId);
  const businessState = normalizeString(source.businessState, 'idle').toLowerCase();
  return {
    agentId,
    id: agentId,
    displayName: normalizeString(source.displayName || source.name, agentId === OFFICE_PRIMARY_AGENT_ID ? 'OtakuClaw' : 'Agent'),
    businessState,
    detail: normalizeString(source.detail, ''),
    sceneState: normalizeString(source.sceneState, ''),
    role: normalizeString(source.role, agentId === OFFICE_PRIMARY_AGENT_ID ? 'primary' : 'support'),
    updatedAt: normalizeString(source.updatedAt, ''),
    isPrimary: source.isPrimary !== false && agentId === normalizeString(source.activeAgentId || agentId, agentId),
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
    .map((agent, index) => normalizeOfficeAgent(agent, index === 0 ? OFFICE_PRIMARY_AGENT_ID : `agent-${index + 1}`))
    .filter(Boolean);
  const activeAgentId = normalizeString(source.activeAgentId, agents[0]?.agentId || OFFICE_PRIMARY_AGENT_ID);
  const normalizedAgents = agents.length > 0
    ? agents.map((agent) => ({
        ...agent,
        isPrimary: agent.agentId === activeAgentId,
      }))
    : [
        {
          agentId: OFFICE_PRIMARY_AGENT_ID,
          id: OFFICE_PRIMARY_AGENT_ID,
          displayName: 'OtakuClaw',
          businessState: 'idle',
          detail: '',
          sceneState: '',
          role: 'primary',
          updatedAt: '',
          isPrimary: true,
        },
      ];

  return {
    revision: Number.isFinite(source.revision) ? source.revision : 0,
    activeAgentId,
    agents: normalizedAgents,
  };
}

export function derivePrimaryOfficeAgent({
  agentId = OFFICE_PRIMARY_AGENT_ID,
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
  }, agentId);
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
  const normalizedPrimaryAgent = primaryAgent ? normalizeOfficeAgent(primaryAgent, OFFICE_PRIMARY_AGENT_ID) : null;
  const hasPrimaryAgent = normalizedSnapshot.agents.some((agent) => agent.agentId === OFFICE_PRIMARY_AGENT_ID);
  const baseState =
    hasPrimaryAgent || !normalizedPrimaryAgent
      ? normalizedSnapshot
      : normalizeOfficeState({
          ...normalizedSnapshot,
          activeAgentId: OFFICE_PRIMARY_AGENT_ID,
          agents: [normalizedPrimaryAgent, ...normalizedSnapshot.agents],
        });

  if (normalizeString(previewMode, 'live') !== 'error') {
    return baseState;
  }

  return normalizeOfficeState({
    ...baseState,
    activeAgentId: OFFICE_PRIMARY_AGENT_ID,
    agents: baseState.agents.map((agent) => (
      agent.agentId !== OFFICE_PRIMARY_AGENT_ID
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
} = {}) {
  const normalizedState = normalizeOfficeState(officeState);
  const normalizedLabels = normalizeLabels(labels);
  const activeStates = normalizedState.agents.map((agent) => normalizeString(agent.businessState, 'idle').toLowerCase());
  const theme = resolveOfficeRoomTheme(sceneConfig?.themeId || DEFAULT_OFFICE_SCENE_CONFIG.themeId);
  const config = {
    themeId: theme.id,
    themeLabel: theme.label,
    backdrop: normalizeBackdrop(sceneConfig?.backdrop || theme.backdrop || DEFAULT_OFFICE_SCENE_CONFIG.backdrop),
    areas: sceneConfig?.areas || DEFAULT_OFFICE_SCENE_CONFIG.areas,
    furniture: resolveThemeFurniture({
      themeId: sceneConfig?.themeId || DEFAULT_OFFICE_SCENE_CONFIG.themeId,
      furniture: sceneConfig?.furniture,
      furnitureOverrides: sceneConfig?.furnitureOverrides || DEFAULT_OFFICE_SCENE_CONFIG.furnitureOverrides,
      activeStates,
    }),
    stateMap: normalizeStateMap(sceneConfig?.stateMap),
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
