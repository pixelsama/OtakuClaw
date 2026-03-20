export const OFFICE_PRIMARY_AGENT_ID = 'main';

const DEFAULT_LABELS = {
  title: 'Pixel Room',
  subtitle: 'Local office scene',
  idle: 'Idle lounge',
  writing: 'Writing desk',
  researching: 'Research alcove',
  executing: 'Tool bench',
  syncing: 'Sync dock',
  error: 'Bug nook',
  multiAgentReady: 'Multi-agent ready',
  primaryAgent: 'Primary agent',
};

export const DEFAULT_OFFICE_SCENE_CONFIG = {
  areas: {
    lounge: {
      id: 'lounge',
      label: 'Lounge',
      x: 14,
      y: 58,
      slots: [
        { x: 18, y: 68 },
        { x: 28, y: 64 },
        { x: 24, y: 76 },
      ],
    },
    desk: {
      id: 'desk',
      label: 'Desk',
      x: 46,
      y: 50,
      slots: [
        { x: 48, y: 66 },
        { x: 58, y: 62 },
        { x: 52, y: 74 },
      ],
    },
    syncDock: {
      id: 'syncDock',
      label: 'Sync Dock',
      x: 73,
      y: 54,
      slots: [
        { x: 76, y: 66 },
        { x: 84, y: 62 },
        { x: 80, y: 74 },
      ],
    },
    bugNook: {
      id: 'bugNook',
      label: 'Bug Nook',
      x: 74,
      y: 24,
      slots: [
        { x: 76, y: 36 },
        { x: 84, y: 32 },
        { x: 80, y: 44 },
      ],
    },
  },
  furniture: [
    { id: 'window', kind: 'window', x: 14, y: 12, w: 19, h: 18 },
    { id: 'plant', kind: 'plant', x: 35, y: 18, w: 8, h: 12 },
    { id: 'sofa', kind: 'sofa', x: 8, y: 62, w: 26, h: 18 },
    { id: 'desk', kind: 'desk', x: 39, y: 58, w: 26, h: 17 },
    { id: 'monitor', kind: 'monitor', x: 49, y: 42, w: 11, h: 10 },
    { id: 'server', kind: 'server', x: 72, y: 56, w: 18, h: 22 },
    { id: 'bug', kind: 'bug', x: 78, y: 20, w: 9, h: 9 },
    { id: 'lamp', kind: 'lamp', x: 62, y: 18, w: 8, h: 16 },
  ],
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

function normalizeLabels(labels = {}) {
  return {
    ...DEFAULT_LABELS,
    ...(labels && typeof labels === 'object' ? labels : {}),
  };
}

function cloneFurniture(items = []) {
  return items.map((item) => ({ ...item }));
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
  const config = {
    areas: sceneConfig?.areas || DEFAULT_OFFICE_SCENE_CONFIG.areas,
    furniture: cloneFurniture(sceneConfig?.furniture || DEFAULT_OFFICE_SCENE_CONFIG.furniture),
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
