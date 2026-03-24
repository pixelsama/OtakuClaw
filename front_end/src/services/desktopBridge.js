import {
  normalizeOfficeAgent,
  normalizeOfficeState,
  OFFICE_PRIMARY_AGENT_ID,
} from '../components/office/officeSceneConfig.js';

const SETTINGS_STORAGE_KEY = 'openclaw.settings';
let webOfficeState = normalizeOfficeState();
const webOfficeListeners = new Set();
let webValueState = {
  revision: 0,
  updatedAt: '',
  agentId: '',
  routeKey: '',
  sessionId: '',
  stats: {},
  lastEvent: null,
};
const webValueListeners = new Set();

function normalizeText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function normalizeConversationEnvelopeEvent(event = {}) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const channel = normalizeText(event.channel, '');
  const type = normalizeText(event.type, '');
  if (!channel || !type) {
    return null;
  }

  const payload = event.payload && typeof event.payload === 'object'
    ? { ...event.payload }
    : normalizePlainObject(event.data);
  return {
    ...event,
    channel,
    type,
    streamId: normalizeText(event.streamId, ''),
    agentId: normalizeText(event.agentId, ''),
    backend: normalizeText(event.backend, ''),
    routeKey: normalizeText(event.routeKey, ''),
    sessionId: normalizeText(event.sessionId, ''),
    turnId: normalizeText(event.turnId, ''),
    timestamp: normalizeText(event.timestamp, ''),
    payload,
  };
}

function normalizeValueEventEnvelope(event = {}) {
  const normalizedSource = normalizeConversationEnvelopeEvent({
    ...normalizePlainObject(event),
    channel: 'value',
    type: normalizeText(event?.type, 'state-changed'),
    payload: normalizePlainObject(event?.payload || event?.data || event),
  });

  const payload = normalizePlainObject(normalizedSource?.payload);
  const stats = normalizePlainObject(payload.stats || event?.stats);

  return {
    ...normalizedSource,
    channel: 'value',
    type: normalizedSource?.type || 'state-changed',
    payload: {
      ...payload,
      stats,
    },
  };
}

function normalizeValueState(state = {}) {
  const source = normalizePlainObject(state);
  return {
    revision: Number.isFinite(source.revision) ? source.revision : 0,
    updatedAt: normalizeText(source.updatedAt, ''),
    agentId: normalizeText(source.agentId, ''),
    routeKey: normalizeText(source.routeKey, ''),
    sessionId: normalizeText(source.sessionId, ''),
    stats: normalizePlainObject(source.stats),
    lastEvent: source.lastEvent ? normalizeValueEventEnvelope(source.lastEvent) : null,
  };
}

function emitWebOfficeStateChange(type = 'state-changed') {
  const snapshot = normalizeOfficeState(webOfficeState);
  for (const listener of [...webOfficeListeners]) {
    try {
      listener({
        channel: 'office',
        type,
        payload: snapshot,
      });
    } catch (error) {
      console.error('Office state listener failed:', error);
    }
  }
}

function updateWebOfficeState(updater) {
  const nextState = normalizeOfficeState(
    typeof updater === 'function' ? updater(webOfficeState) : updater,
  );
  const changed = JSON.stringify(nextState) !== JSON.stringify(webOfficeState);
  webOfficeState = {
    ...nextState,
    revision: changed ? (nextState.revision || webOfficeState.revision || 0) + 1 : nextState.revision || 0,
  };
  if (changed) {
    emitWebOfficeStateChange();
  }
  return normalizeOfficeState(webOfficeState);
}

function emitWebValueStateChange(type = 'state-changed') {
  const snapshot = normalizeValueState(webValueState);
  for (const listener of [...webValueListeners]) {
    try {
      listener({
        channel: 'value',
        type,
        payload: snapshot,
      });
    } catch (error) {
      console.error('Value state listener failed:', error);
    }
  }
}

function updateWebValueState(nextEvent = {}) {
  const normalizedEvent = normalizeValueEventEnvelope(nextEvent);
  if (!normalizedEvent) {
    return normalizeValueState(webValueState);
  }

  const nextState = {
    revision: (webValueState.revision || 0) + 1,
    updatedAt: normalizedEvent.timestamp || new Date().toISOString(),
    agentId: normalizedEvent.agentId || normalizeText(normalizedEvent.payload?.agentId, ''),
    routeKey: normalizedEvent.routeKey || normalizeText(normalizedEvent.payload?.routeKey, ''),
    sessionId: normalizedEvent.sessionId || normalizeText(normalizedEvent.payload?.sessionId, ''),
    stats: normalizePlainObject(normalizedEvent.payload?.stats),
    lastEvent: normalizedEvent,
  };

  const changed = JSON.stringify(nextState) !== JSON.stringify(webValueState);
  webValueState = nextState;
  if (changed) {
    emitWebValueStateChange('state-changed');
  }
  return normalizeValueState(webValueState);
}

function normalizeOfficeAgentId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function mergeWebOfficeAgents(currentState, incomingAgents, options = {}) {
  const normalizedState = normalizeOfficeState(currentState);
  const currentAgents = Array.isArray(normalizedState.agents) ? [...normalizedState.agents] : [];
  let agents = currentAgents;
  let changed = false;

  for (const item of Array.isArray(incomingAgents) ? incomingAgents : []) {
    const normalizedAgent = normalizeOfficeAgent(item, normalizedState.activeAgentId || OFFICE_PRIMARY_AGENT_ID);
    if (!normalizedAgent?.agentId) {
      continue;
    }

    const index = agents.findIndex((candidate) => candidate?.agentId === normalizedAgent.agentId || candidate?.id === normalizedAgent.agentId);
    if (index === -1) {
      agents = [...agents, normalizedAgent];
      changed = true;
      continue;
    }

    const nextAgent = {
      ...agents[index],
      ...normalizedAgent,
      agentId: normalizedAgent.agentId,
      id: normalizedAgent.agentId,
    };
    if (JSON.stringify(agents[index]) === JSON.stringify(nextAgent)) {
      continue;
    }

    agents = [...agents];
    agents[index] = nextAgent;
    changed = true;
  }

  const hasExplicitActiveAgentId =
    Object.prototype.hasOwnProperty.call(options, 'activeAgentId')
    || Object.prototype.hasOwnProperty.call(options, 'preserveActive') && options.preserveActive === false;
  const explicitActiveAgentId = Object.prototype.hasOwnProperty.call(options, 'activeAgentId')
    ? normalizeOfficeAgentId(options.activeAgentId)
    : '';
  const nextActiveAgentId = hasExplicitActiveAgentId
    ? explicitActiveAgentId
    : normalizeOfficeAgentId(normalizedState.activeAgentId) || (
        options.activateIfUnset === false
          ? ''
          : normalizeOfficeAgentId(agents[0]?.agentId || agents[0]?.id)
      );

  if (nextActiveAgentId !== normalizeOfficeAgentId(normalizedState.activeAgentId)) {
    changed = true;
  }

  if (!changed) {
    return normalizedState;
  }

  return normalizeOfficeState({
    ...normalizedState,
    activeAgentId: nextActiveAgentId,
    agents,
  });
}

function removeWebOfficeAgent(currentState, agentId, options = {}) {
  const normalizedState = normalizeOfficeState(currentState);
  const removalId = normalizeOfficeAgentId(agentId);
  if (!removalId) {
    return normalizedState;
  }

  const remainingAgents = (Array.isArray(normalizedState.agents) ? normalizedState.agents : []).filter(
    (agent) => normalizeOfficeAgentId(agent?.agentId || agent?.id) !== removalId,
  );
  if (remainingAgents.length === (normalizedState.agents || []).length) {
    return normalizedState;
  }

  const nextActiveAgentId = Object.prototype.hasOwnProperty.call(options, 'activeAgentId')
    ? normalizeOfficeAgentId(options.activeAgentId)
    : normalizeOfficeAgentId(normalizedState.activeAgentId) === removalId
      ? normalizeOfficeAgentId(remainingAgents[0]?.agentId || remainingAgents[0]?.id)
      : normalizeOfficeAgentId(normalizedState.activeAgentId);

  return normalizeOfficeState({
    ...normalizedState,
    activeAgentId: nextActiveAgentId,
    agents: remainingAgents,
  });
}

function normalizeOfficePresenceRequest(request = {}, fallbackId = OFFICE_PRIMARY_AGENT_ID) {
  if (Array.isArray(request)) {
    return {
      agents: request.map((item, index) => normalizeOfficeAgent(item, index === 0 ? fallbackId : `agent-${index + 1}`)),
    };
  }

  if (!request || typeof request !== 'object') {
    return {
      agents: [],
    };
  }

  const agents = Array.isArray(request.agents)
    ? request.agents.map((item, index) => normalizeOfficeAgent(item, index === 0 ? fallbackId : `agent-${index + 1}`))
    : request.agent
      ? [normalizeOfficeAgent(request.agent, fallbackId)]
      : [];

  return {
    ...request,
    agents,
  };
}

function getDesktopApi() {
  if (typeof window === 'undefined') {
    return null;
  }

  const api = window.desktop;
  if (!api || !api.isElectron) {
    return null;
  }

  return api;
}

function subscribeConversationChannel(api, channel, handler) {
  if (typeof handler !== 'function') {
    return () => {};
  }
  if (!api?.conversation?.onEvent) {
    return () => {};
  }

  return api.conversation.onEvent((event = {}) => {
    if (event?.channel !== channel) {
      return;
    }
    handler(event);
  });
}

function detectPlatformFallback() {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

  const source = `${navigator.userAgent || ''} ${navigator.platform || ''}`.toLowerCase();
  if (source.includes('mac')) {
    return 'darwin';
  }
  if (source.includes('win')) {
    return 'win32';
  }
  if (source.includes('linux')) {
    return 'linux';
  }

  return 'unknown';
}

function resolvePlatformSyncFromApi(api) {
  if (typeof api?.platform === 'string' && api.platform) {
    return api.platform;
  }

  return detectPlatformFallback();
}

function normalizeChatBackend(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'nanobot') {
    return 'nanobot';
  }
  if (normalized === 'codex') {
    return 'codex';
  }
  if (normalized === 'claude-code' || normalized === 'claude code' || normalized === 'claudecode' || normalized === 'claude_code') {
    return 'claude-code';
  }
  if (normalized === 'openclaw') {
    return 'nanobot';
  }
  return 'nanobot';
}

function normalizeRunnerArgs(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizePermissionMode(value, fallback = 'deny') {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'allow' || normalized === 'ask' || normalized === 'deny') {
    return normalized;
  }
  return fallback;
}

function normalizeRunnerEnv(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [normalizeText(key), normalizeText(item)])
      .filter(([key]) => Boolean(key)),
  );
}

function normalizeAcpBackendResponse(settings = {}, fallbackCommand = '') {
  const source = settings && typeof settings === 'object' ? settings : {};
  const runner = source.runner && typeof source.runner === 'object' ? source.runner : {};
  return {
    enabled: Boolean(source.enabled),
    timeoutMs: Number.isFinite(source.timeoutMs) ? source.timeoutMs : 120000,
    askTimeoutMs: Number.isFinite(source.askTimeoutMs) ? source.askTimeoutMs : 8000,
    permissionMode: normalizePermissionMode(source.permissionMode, 'deny'),
    runner: {
      protocol: 'acp',
      transport: 'stdio',
      command: normalizeText(runner.command, fallbackCommand),
      args: normalizeRunnerArgs(runner.args),
      cwd: normalizeText(runner.cwd),
      env: normalizeRunnerEnv(runner.env),
    },
  };
}

function normalizeSettingsResponse(settings = {}) {
  const chatBackend = normalizeChatBackend(settings?.chatBackend);
  const openclaw = settings?.openclaw || {};
  const nanobot = settings?.nanobot || {};
  const claudeCode = settings?.claudeCode || {};
  const codex = settings?.codex || {};
  const voice = settings?.voice || {};
  const dashscope = voice?.dashscope || {};
  const hasToken = Boolean(settings?.hasToken || openclaw?.hasToken || (typeof settings?.token === 'string' && settings.token.trim()));
  const hasNanobotApiKey = Boolean(
    settings?.hasNanobotApiKey
      || nanobot?.hasApiKey
      || (typeof settings?.nanobotApiKey === 'string' && settings.nanobotApiKey.trim()),
  );
  const hasDashscopeApiKey = Boolean(
    dashscope?.hasApiKey
      || (typeof settings?.dashscopeApiKey === 'string' && settings.dashscopeApiKey.trim())
      || (typeof dashscope?.apiKey === 'string' && dashscope.apiKey.trim()),
  );

  const normalized = {
    chatBackend,
    openclaw: {
      baseUrl:
        typeof openclaw.baseUrl === 'string'
          ? openclaw.baseUrl.trim()
          : typeof settings.baseUrl === 'string'
            ? settings.baseUrl.trim()
            : '',
      token: typeof openclaw.token === 'string' ? openclaw.token.trim() : '',
      agentId:
        typeof openclaw.agentId === 'string'
          ? openclaw.agentId.trim()
          : typeof settings.agentId === 'string'
            ? settings.agentId.trim()
            : 'main',
      hasToken,
    },
    nanobot: {
      enabled: Boolean(nanobot.enabled),
      workspace: typeof nanobot.workspace === 'string' ? nanobot.workspace.trim() : '',
      allowHighRiskTools: Boolean(nanobot.allowHighRiskTools),
      provider: typeof nanobot.provider === 'string' ? nanobot.provider.trim() : 'openrouter',
      model: typeof nanobot.model === 'string' ? nanobot.model.trim() : 'anthropic/claude-opus-4-5',
      apiBase: typeof nanobot.apiBase === 'string' ? nanobot.apiBase.trim() : '',
      apiKey: typeof nanobot.apiKey === 'string' ? nanobot.apiKey.trim() : '',
      maxTokens: Number.isFinite(nanobot.maxTokens) ? nanobot.maxTokens : 4096,
      temperature: Number.isFinite(nanobot.temperature) ? nanobot.temperature : 0.2,
      reasoningEffort: typeof nanobot.reasoningEffort === 'string' ? nanobot.reasoningEffort.trim() : '',
      hasApiKey: hasNanobotApiKey,
    },
    claudeCode: normalizeAcpBackendResponse(claudeCode, 'claude-agent-acp'),
    codex: normalizeAcpBackendResponse(codex, 'codex-acp'),
    voice: {
      asrProvider: voice?.asrProvider === 'dashscope' ? 'dashscope' : 'inherit',
      ttsProvider: voice?.ttsProvider === 'dashscope' ? 'dashscope' : 'inherit',
      dashscope: {
        workspace: typeof dashscope.workspace === 'string' ? dashscope.workspace.trim() : '',
        baseUrl: typeof dashscope.baseUrl === 'string' ? dashscope.baseUrl.trim() : '',
        apiKey: typeof dashscope.apiKey === 'string' ? dashscope.apiKey.trim() : '',
        hasApiKey: hasDashscopeApiKey,
        asrModel: typeof dashscope.asrModel === 'string' ? dashscope.asrModel.trim() : 'qwen3-asr-flash-realtime',
        asrLanguage: typeof dashscope.asrLanguage === 'string' ? dashscope.asrLanguage.trim() : 'zh',
        ttsModel: typeof dashscope.ttsModel === 'string' ? dashscope.ttsModel.trim() : 'qwen-tts-realtime-latest',
        ttsVoice: typeof dashscope.ttsVoice === 'string' ? dashscope.ttsVoice.trim() : 'Cherry',
        ttsLanguage: typeof dashscope.ttsLanguage === 'string' ? dashscope.ttsLanguage.trim() : 'Chinese',
        ttsSampleRate: Number.isFinite(dashscope.ttsSampleRate) ? dashscope.ttsSampleRate : 24000,
        ttsSpeechRate: Number.isFinite(dashscope.ttsSpeechRate) ? dashscope.ttsSpeechRate : 1,
      },
    },
    ui: {
      onboarding: {
        completed: Boolean(settings?.ui?.onboarding?.completed),
        completedAt:
          typeof settings?.ui?.onboarding?.completedAt === 'string'
            ? settings.ui.onboarding.completedAt.trim()
            : '',
      },
      officeSceneLayout: {
        themeId:
          typeof settings?.ui?.officeSceneLayout?.themeId === 'string'
            ? settings.ui.officeSceneLayout.themeId.trim() || 'star-office-classic'
            : 'star-office-classic',
        furnitureOverrides:
          settings?.ui?.officeSceneLayout?.furnitureOverrides
          && typeof settings.ui.officeSceneLayout.furnitureOverrides === 'object'
          && !Array.isArray(settings.ui.officeSceneLayout.furnitureOverrides)
            ? settings.ui.officeSceneLayout.furnitureOverrides
            : {},
      },
    },
    hasSecureStorage: settings.hasSecureStorage !== false,
  };

  return {
    ...normalized,
    // Legacy flat fields for backward compatibility.
    baseUrl: normalized.openclaw.baseUrl,
    token: normalized.openclaw.token,
    agentId: normalized.openclaw.agentId,
    hasToken: normalized.openclaw.hasToken,
    hasNanobotApiKey: normalized.nanobot.hasApiKey,
    dashscopeApiKey: normalized.voice.dashscope.apiKey,
  };
}

function normalizeSettingsPatch(settings = {}) {
  return {
    ...(Object.prototype.hasOwnProperty.call(settings, 'chatBackend')
      ? { chatBackend: normalizeChatBackend(settings.chatBackend) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(settings, 'baseUrl')
      || Object.prototype.hasOwnProperty.call(settings, 'agentId')
      || Object.prototype.hasOwnProperty.call(settings, 'token')
      || Object.prototype.hasOwnProperty.call(settings, 'clearToken')
      ? {
          openclaw: {
            ...(Object.prototype.hasOwnProperty.call(settings, 'baseUrl')
              ? { baseUrl: typeof settings.baseUrl === 'string' ? settings.baseUrl.trim() : '' }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(settings, 'agentId')
              ? { agentId: typeof settings.agentId === 'string' ? settings.agentId.trim() : '' }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(settings, 'token')
              ? { token: typeof settings.token === 'string' ? settings.token.trim() : '' }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(settings, 'clearToken')
              ? { clearToken: Boolean(settings.clearToken) }
              : {}),
          },
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(settings, 'openclaw')
      ? {
          openclaw: {
            ...(typeof settings.openclaw === 'object' && settings.openclaw
              ? {
                  ...(Object.prototype.hasOwnProperty.call(settings.openclaw, 'baseUrl')
                    ? {
                        baseUrl:
                          typeof settings.openclaw.baseUrl === 'string'
                            ? settings.openclaw.baseUrl.trim()
                            : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.openclaw, 'agentId')
                    ? {
                        agentId:
                          typeof settings.openclaw.agentId === 'string'
                            ? settings.openclaw.agentId.trim()
                            : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.openclaw, 'token')
                    ? {
                        token:
                          typeof settings.openclaw.token === 'string' ? settings.openclaw.token.trim() : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.openclaw, 'clearToken')
                    ? {
                        clearToken: Boolean(settings.openclaw.clearToken),
                      }
                    : {}),
                }
              : {}),
          },
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(settings, 'nanobot')
      ? {
          nanobot: {
            ...(typeof settings.nanobot === 'object' && settings.nanobot
              ? {
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'enabled')
                    ? {
                        enabled: Boolean(settings.nanobot.enabled),
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'workspace')
                    ? {
                        workspace:
                          typeof settings.nanobot.workspace === 'string'
                            ? settings.nanobot.workspace.trim()
                            : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'allowHighRiskTools')
                    ? {
                        allowHighRiskTools: Boolean(settings.nanobot.allowHighRiskTools),
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'provider')
                    ? {
                        provider:
                          typeof settings.nanobot.provider === 'string'
                            ? settings.nanobot.provider.trim()
                            : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'model')
                    ? {
                        model: typeof settings.nanobot.model === 'string' ? settings.nanobot.model.trim() : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'apiBase')
                    ? {
                        apiBase:
                          typeof settings.nanobot.apiBase === 'string'
                            ? settings.nanobot.apiBase.trim()
                            : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'maxTokens')
                    ? {
                        maxTokens: Number.isFinite(settings.nanobot.maxTokens)
                          ? settings.nanobot.maxTokens
                          : 4096,
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'temperature')
                    ? {
                        temperature: Number.isFinite(settings.nanobot.temperature)
                          ? settings.nanobot.temperature
                          : 0.2,
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'reasoningEffort')
                    ? {
                        reasoningEffort:
                          typeof settings.nanobot.reasoningEffort === 'string'
                            ? settings.nanobot.reasoningEffort.trim()
                            : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'apiKey')
                    ? {
                        apiKey:
                          typeof settings.nanobot.apiKey === 'string'
                            ? settings.nanobot.apiKey.trim()
                            : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'clearApiKey')
                    ? {
                        clearApiKey: Boolean(settings.nanobot.clearApiKey),
                      }
                    : {}),
                }
              : {}),
          },
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(settings, 'claudeCode')
      ? {
          claudeCode: {
            ...(typeof settings.claudeCode === 'object' && settings.claudeCode
              ? {
                  ...(Object.prototype.hasOwnProperty.call(settings.claudeCode, 'enabled')
                    ? { enabled: Boolean(settings.claudeCode.enabled) }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.claudeCode, 'timeoutMs')
                    ? { timeoutMs: Number.isFinite(settings.claudeCode.timeoutMs) ? settings.claudeCode.timeoutMs : 120000 }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.claudeCode, 'askTimeoutMs')
                    ? { askTimeoutMs: Number.isFinite(settings.claudeCode.askTimeoutMs) ? settings.claudeCode.askTimeoutMs : 8000 }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.claudeCode, 'permissionMode')
                    ? { permissionMode: normalizePermissionMode(settings.claudeCode.permissionMode, 'deny') }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.claudeCode, 'runner')
                    ? {
                        runner:
                          typeof settings.claudeCode.runner === 'object' && settings.claudeCode.runner
                            ? {
                                ...(Object.prototype.hasOwnProperty.call(settings.claudeCode.runner, 'command')
                                  ? { command: normalizeText(settings.claudeCode.runner.command) }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.claudeCode.runner, 'args')
                                  ? { args: normalizeRunnerArgs(settings.claudeCode.runner.args) }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.claudeCode.runner, 'cwd')
                                  ? { cwd: normalizeText(settings.claudeCode.runner.cwd) }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.claudeCode.runner, 'env')
                                  ? { env: normalizeRunnerEnv(settings.claudeCode.runner.env) }
                                  : {}),
                              }
                            : {},
                      }
                    : {}),
                }
              : {}),
          },
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(settings, 'codex')
      ? {
          codex: {
            ...(typeof settings.codex === 'object' && settings.codex
              ? {
                  ...(Object.prototype.hasOwnProperty.call(settings.codex, 'enabled')
                    ? { enabled: Boolean(settings.codex.enabled) }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.codex, 'timeoutMs')
                    ? { timeoutMs: Number.isFinite(settings.codex.timeoutMs) ? settings.codex.timeoutMs : 120000 }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.codex, 'askTimeoutMs')
                    ? { askTimeoutMs: Number.isFinite(settings.codex.askTimeoutMs) ? settings.codex.askTimeoutMs : 8000 }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.codex, 'permissionMode')
                    ? { permissionMode: normalizePermissionMode(settings.codex.permissionMode, 'deny') }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.codex, 'runner')
                    ? {
                        runner:
                          typeof settings.codex.runner === 'object' && settings.codex.runner
                            ? {
                                ...(Object.prototype.hasOwnProperty.call(settings.codex.runner, 'command')
                                  ? { command: normalizeText(settings.codex.runner.command) }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.codex.runner, 'args')
                                  ? { args: normalizeRunnerArgs(settings.codex.runner.args) }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.codex.runner, 'cwd')
                                  ? { cwd: normalizeText(settings.codex.runner.cwd) }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.codex.runner, 'env')
                                  ? { env: normalizeRunnerEnv(settings.codex.runner.env) }
                                  : {}),
                              }
                            : {},
                      }
                    : {}),
                }
              : {}),
          },
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(settings, 'voice')
      ? {
          voice: {
            ...(typeof settings.voice === 'object' && settings.voice
              ? {
                  ...(Object.prototype.hasOwnProperty.call(settings.voice, 'asrProvider')
                    ? {
                        asrProvider: settings.voice.asrProvider === 'dashscope' ? 'dashscope' : 'inherit',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.voice, 'ttsProvider')
                    ? {
                        ttsProvider: settings.voice.ttsProvider === 'dashscope' ? 'dashscope' : 'inherit',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.voice, 'dashscope')
                    ? {
                        dashscope:
                          typeof settings.voice.dashscope === 'object' && settings.voice.dashscope
                            ? {
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'workspace')
                                  ? {
                                      workspace:
                                        typeof settings.voice.dashscope.workspace === 'string'
                                          ? settings.voice.dashscope.workspace.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'baseUrl')
                                  ? {
                                      baseUrl:
                                        typeof settings.voice.dashscope.baseUrl === 'string'
                                          ? settings.voice.dashscope.baseUrl.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'asrModel')
                                  ? {
                                      asrModel:
                                        typeof settings.voice.dashscope.asrModel === 'string'
                                          ? settings.voice.dashscope.asrModel.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'asrLanguage')
                                  ? {
                                      asrLanguage:
                                        typeof settings.voice.dashscope.asrLanguage === 'string'
                                          ? settings.voice.dashscope.asrLanguage.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'ttsModel')
                                  ? {
                                      ttsModel:
                                        typeof settings.voice.dashscope.ttsModel === 'string'
                                          ? settings.voice.dashscope.ttsModel.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'ttsVoice')
                                  ? {
                                      ttsVoice:
                                        typeof settings.voice.dashscope.ttsVoice === 'string'
                                          ? settings.voice.dashscope.ttsVoice.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'ttsLanguage')
                                  ? {
                                      ttsLanguage:
                                        typeof settings.voice.dashscope.ttsLanguage === 'string'
                                          ? settings.voice.dashscope.ttsLanguage.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'ttsSampleRate')
                                  ? {
                                      ttsSampleRate: Number.isFinite(settings.voice.dashscope.ttsSampleRate)
                                        ? settings.voice.dashscope.ttsSampleRate
                                        : 24000,
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'ttsSpeechRate')
                                  ? {
                                      ttsSpeechRate: Number.isFinite(settings.voice.dashscope.ttsSpeechRate)
                                        ? settings.voice.dashscope.ttsSpeechRate
                                        : 1,
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'apiKey')
                                  ? {
                                      apiKey:
                                        typeof settings.voice.dashscope.apiKey === 'string'
                                          ? settings.voice.dashscope.apiKey.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'clearApiKey')
                                  ? {
                                      clearApiKey: Boolean(settings.voice.dashscope.clearApiKey),
                                    }
                                  : {}),
                              }
                            : {},
                      }
                    : {}),
                }
              : {}),
          },
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(settings, 'ui')
      ? {
          ui: {
            ...(typeof settings.ui === 'object' && settings.ui
              ? {
                  ...(Object.prototype.hasOwnProperty.call(settings.ui, 'onboarding')
                    ? {
                        onboarding:
                          typeof settings.ui.onboarding === 'object' && settings.ui.onboarding
                            ? {
                                ...(Object.prototype.hasOwnProperty.call(settings.ui.onboarding, 'completed')
                                  ? {
                                      completed: Boolean(settings.ui.onboarding.completed),
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.ui.onboarding, 'completedAt')
                                  ? {
                                      completedAt:
                                        typeof settings.ui.onboarding.completedAt === 'string'
                                          ? settings.ui.onboarding.completedAt.trim()
                                          : '',
                                    }
                                  : {}),
                              }
                            : {},
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.ui, 'officeSceneLayout')
                    ? {
                        officeSceneLayout:
                          typeof settings.ui.officeSceneLayout === 'object' && settings.ui.officeSceneLayout
                            ? {
                                ...(Object.prototype.hasOwnProperty.call(settings.ui.officeSceneLayout, 'themeId')
                                  ? {
                                      themeId:
                                        typeof settings.ui.officeSceneLayout.themeId === 'string'
                                          ? settings.ui.officeSceneLayout.themeId.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.ui.officeSceneLayout, 'furnitureOverrides')
                                  ? {
                                      furnitureOverrides:
                                        settings.ui.officeSceneLayout.furnitureOverrides
                                        && typeof settings.ui.officeSceneLayout.furnitureOverrides === 'object'
                                        && !Array.isArray(settings.ui.officeSceneLayout.furnitureOverrides)
                                          ? settings.ui.officeSceneLayout.furnitureOverrides
                                          : {},
                                    }
                                  : {}),
                              }
                            : {},
                      }
                    : {}),
                }
              : {}),
          },
        }
      : {}),
  };
}

function loadWebSettings() {
  if (typeof window === 'undefined') {
    return normalizeSettingsResponse({});
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return normalizeSettingsResponse({ hasSecureStorage: false });
    }

    return normalizeSettingsResponse({
      hasSecureStorage: false,
      ...JSON.parse(raw),
    });
  } catch {
    return normalizeSettingsResponse({ hasSecureStorage: false });
  }
}

function saveWebSettings(partialSettings = {}) {
  const current = loadWebSettings();
  const patch = normalizeSettingsPatch(partialSettings);

  const merged = {
    ...current,
    ...(Object.prototype.hasOwnProperty.call(patch, 'chatBackend')
      ? { chatBackend: patch.chatBackend }
      : {}),
    openclaw: {
      ...current.openclaw,
      ...(patch.openclaw || {}),
    },
    nanobot: {
      ...current.nanobot,
      ...(patch.nanobot || {}),
    },
    claudeCode: {
      ...(current.claudeCode || normalizeAcpBackendResponse({}, 'claude-agent-acp')),
      ...(patch.claudeCode || {}),
      runner: {
        ...((current.claudeCode?.runner) || {}),
        ...((patch.claudeCode?.runner) || {}),
      },
    },
    codex: {
      ...(current.codex || normalizeAcpBackendResponse({}, 'codex-acp')),
      ...(patch.codex || {}),
      runner: {
        ...((current.codex?.runner) || {}),
        ...((patch.codex?.runner) || {}),
      },
    },
    voice: {
      ...current.voice,
      ...(patch.voice || {}),
      dashscope: {
        ...current.voice.dashscope,
        ...(patch.voice?.dashscope || {}),
      },
    },
    ui: {
      ...(current.ui || {}),
      ...(patch.ui || {}),
      onboarding: {
        ...(current.ui?.onboarding || {}),
        ...(patch.ui?.onboarding || {}),
      },
      officeSceneLayout: {
        ...(current.ui?.officeSceneLayout || {}),
        ...(patch.ui?.officeSceneLayout || {}),
        furnitureOverrides: {
          ...(current.ui?.officeSceneLayout?.furnitureOverrides || {}),
          ...(patch.ui?.officeSceneLayout?.furnitureOverrides || {}),
        },
      },
    },
    hasSecureStorage: false,
  };

  if (patch.openclaw?.clearToken === true) {
    merged.openclaw.token = '';
  }

  if (patch.nanobot?.clearApiKey === true) {
    merged.nanobot.apiKey = '';
  }

  if (patch.voice?.dashscope?.clearApiKey === true) {
    merged.voice.dashscope.apiKey = '';
  }

  merged.openclaw.hasToken = Boolean(merged.openclaw.token);
  merged.nanobot.hasApiKey = Boolean(merged.nanobot.apiKey);
  merged.baseUrl = merged.openclaw.baseUrl;
  merged.token = merged.openclaw.token;
  merged.agentId = merged.openclaw.agentId;
  merged.hasToken = merged.openclaw.hasToken;
  merged.hasNanobotApiKey = merged.nanobot.hasApiKey;
  merged.voice.dashscope.hasApiKey = Boolean(merged.voice.dashscope.apiKey);
  merged.dashscopeApiKey = merged.voice.dashscope.apiKey;

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        chatBackend: merged.chatBackend,
        openclaw: {
          baseUrl: merged.openclaw.baseUrl,
          token: merged.openclaw.token,
          agentId: merged.openclaw.agentId,
        },
        nanobot: {
          enabled: merged.nanobot.enabled,
          workspace: merged.nanobot.workspace,
          allowHighRiskTools: merged.nanobot.allowHighRiskTools,
          provider: merged.nanobot.provider,
          model: merged.nanobot.model,
          apiBase: merged.nanobot.apiBase,
          apiKey: merged.nanobot.apiKey,
          maxTokens: merged.nanobot.maxTokens,
          temperature: merged.nanobot.temperature,
          reasoningEffort: merged.nanobot.reasoningEffort,
        },
        claudeCode: {
          enabled: Boolean(merged.claudeCode?.enabled),
          timeoutMs: Number.isFinite(merged.claudeCode?.timeoutMs) ? merged.claudeCode.timeoutMs : 120000,
          askTimeoutMs: Number.isFinite(merged.claudeCode?.askTimeoutMs) ? merged.claudeCode.askTimeoutMs : 8000,
          permissionMode: normalizePermissionMode(merged.claudeCode?.permissionMode, 'deny'),
          runner: {
            protocol: 'acp',
            transport: 'stdio',
            command: normalizeText(merged.claudeCode?.runner?.command, 'claude-agent-acp'),
            args: normalizeRunnerArgs(merged.claudeCode?.runner?.args),
            cwd: normalizeText(merged.claudeCode?.runner?.cwd),
            env: normalizeRunnerEnv(merged.claudeCode?.runner?.env),
          },
        },
        codex: {
          enabled: Boolean(merged.codex?.enabled),
          timeoutMs: Number.isFinite(merged.codex?.timeoutMs) ? merged.codex.timeoutMs : 120000,
          askTimeoutMs: Number.isFinite(merged.codex?.askTimeoutMs) ? merged.codex.askTimeoutMs : 8000,
          permissionMode: normalizePermissionMode(merged.codex?.permissionMode, 'deny'),
          runner: {
            protocol: 'acp',
            transport: 'stdio',
            command: normalizeText(merged.codex?.runner?.command, 'codex-acp'),
            args: normalizeRunnerArgs(merged.codex?.runner?.args),
            cwd: normalizeText(merged.codex?.runner?.cwd),
            env: normalizeRunnerEnv(merged.codex?.runner?.env),
          },
        },
        voice: {
          asrProvider: merged.voice.asrProvider,
          ttsProvider: merged.voice.ttsProvider,
          dashscope: {
            workspace: merged.voice.dashscope.workspace,
            baseUrl: merged.voice.dashscope.baseUrl,
            apiKey: merged.voice.dashscope.apiKey,
            asrModel: merged.voice.dashscope.asrModel,
            asrLanguage: merged.voice.dashscope.asrLanguage,
            ttsModel: merged.voice.dashscope.ttsModel,
            ttsVoice: merged.voice.dashscope.ttsVoice,
            ttsLanguage: merged.voice.dashscope.ttsLanguage,
            ttsSampleRate: merged.voice.dashscope.ttsSampleRate,
            ttsSpeechRate: merged.voice.dashscope.ttsSpeechRate,
          },
        },
        ui: {
          onboarding: {
            completed: Boolean(merged.ui?.onboarding?.completed),
            completedAt: merged.ui?.onboarding?.completedAt || '',
          },
          officeSceneLayout: {
            themeId: merged.ui?.officeSceneLayout?.themeId || 'star-office-classic',
            furnitureOverrides: merged.ui?.officeSceneLayout?.furnitureOverrides || {},
          },
        },
      }),
    );
  }

  return merged;
}

async function testWebConnection(inputSettings = {}) {
  const patch = normalizeSettingsPatch(inputSettings);
  const current = loadWebSettings();
  const settings = {
    ...current,
    ...(Object.prototype.hasOwnProperty.call(patch, 'chatBackend')
      ? { chatBackend: patch.chatBackend }
      : {}),
    openclaw: {
      ...current.openclaw,
      ...(patch.openclaw || {}),
    },
    nanobot: {
      ...current.nanobot,
      ...(patch.nanobot || {}),
    },
    claudeCode: {
      ...(current.claudeCode || {}),
      ...(patch.claudeCode || {}),
      runner: {
        ...((current.claudeCode?.runner) || {}),
        ...((patch.claudeCode?.runner) || {}),
      },
    },
    codex: {
      ...(current.codex || {}),
      ...(patch.codex || {}),
      runner: {
        ...((current.codex?.runner) || {}),
        ...((patch.codex?.runner) || {}),
      },
    },
  };

  const chatBackend = normalizeChatBackend(settings.chatBackend);

  if (settings.openclaw?.clearToken === true) {
    settings.openclaw.token = '';
  }

  if (settings.nanobot?.clearApiKey === true) {
    settings.nanobot.apiKey = '';
  }

  if (chatBackend === 'nanobot') {
    return {
      ok: false,
      error: {
        code: 'nanobot_runtime_not_ready',
        message: 'Web 模式暂不支持 Nanobot 后端。',
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'chat_backend_web_unsupported',
      message: 'Web 模式暂不支持该聊天后端。',
    },
  };
}

export const desktopBridge = {
  isDesktop() {
    return Boolean(getDesktopApi());
  },
  conversation: {
    submitUserText(request = {}) {
      const api = getDesktopApi();
      if (api?.conversation?.submitUserText) {
        return api.conversation.submitUserText(request);
      }
      return Promise.resolve({
        ok: false,
        reason: 'desktop_conversation_unavailable',
      });
    },
    abortActive(request = {}) {
      const api = getDesktopApi();
      if (api?.conversation?.abortActive) {
        return api.conversation.abortActive(request);
      }
      return Promise.resolve({ ok: false, reason: 'desktop_conversation_unavailable' });
    },
    onEvent(handler) {
      const api = getDesktopApi();
      if (!api?.conversation?.onEvent || typeof handler !== 'function') {
        return () => {};
      }
      return api.conversation.onEvent((event = {}) => {
        const normalized = normalizeConversationEnvelopeEvent(event);
        if (normalized && normalized.channel === 'system' && normalized.type === 'stat-updated') {
          updateWebValueState(normalized);
        }
        handler(normalized || event);
      });
    },
  },
  office: {
    async getState() {
      const api = getDesktopApi();
      if (api?.office?.getState) {
        const result = await api.office.getState();
        return normalizeOfficeState(result?.state || result);
      }
      return normalizeOfficeState(webOfficeState);
    },
    async publishPresence(request = {}) {
      const normalizedRequest = normalizeOfficePresenceRequest(request, OFFICE_PRIMARY_AGENT_ID);
      const api = getDesktopApi();
      if (api?.office?.publishPresence) {
        const result = await api.office.publishPresence(normalizedRequest);
        return normalizeOfficeState(result?.state || result);
      }
      if (api?.office?.upsert) {
        const fallbackRequest = {
          agents: normalizedRequest.agents,
        };
        if (Object.prototype.hasOwnProperty.call(normalizedRequest, 'activeAgentId')) {
          fallbackRequest.activeAgentId = normalizeOfficeAgentId(normalizedRequest.activeAgentId);
        }
        if (Object.prototype.hasOwnProperty.call(normalizedRequest, 'activateIfUnset')) {
          fallbackRequest.activateIfUnset = Boolean(normalizedRequest.activateIfUnset);
        }
        if (Object.prototype.hasOwnProperty.call(normalizedRequest, 'ttlMs')) {
          fallbackRequest.ttlMs = normalizedRequest.ttlMs;
        }
        if (Object.prototype.hasOwnProperty.call(normalizedRequest, 'source')) {
          fallbackRequest.source = normalizedRequest.source;
        }
        if (Object.prototype.hasOwnProperty.call(normalizedRequest, 'sourceId')) {
          fallbackRequest.sourceId = normalizedRequest.sourceId;
        }
        if (Object.prototype.hasOwnProperty.call(normalizedRequest, 'revision')) {
          fallbackRequest.revision = normalizedRequest.revision;
        }
        const result = await api.office.upsert(fallbackRequest);
        return normalizeOfficeState(result?.state || result);
      }
      return updateWebOfficeState((current) =>
        mergeWebOfficeAgents(current, normalizedRequest.agents, normalizedRequest));
    },
    async heartbeat(request = {}) {
      const normalizedRequest = normalizeOfficePresenceRequest(request, OFFICE_PRIMARY_AGENT_ID);
      const api = getDesktopApi();
      if (api?.office?.heartbeat) {
        const result = await api.office.heartbeat(normalizedRequest);
        return normalizeOfficeState(result?.state || result);
      }
      const heartbeatAgentIds = [
        normalizeOfficeAgentId(request?.agentId || request?.id),
        ...(Array.isArray(request?.agentIds) ? request.agentIds.map((item) => normalizeOfficeAgentId(item)) : []),
      ].filter(Boolean);
      const heartbeatAgents = normalizedRequest.agents.length > 0
        ? normalizedRequest.agents
        : heartbeatAgentIds.map((agentId) => ({
            agentId,
            id: agentId,
            updatedAt: new Date().toISOString(),
          }));
      return updateWebOfficeState((current) =>
        mergeWebOfficeAgents(current, heartbeatAgents, normalizedRequest));
    },
    async upsertAgent(agent = {}, options = {}) {
      return this.publishPresence({
        ...options,
        agent,
      });
    },
    async upsertAgents(agents = [], options = {}) {
      return this.publishPresence({
        ...options,
        agents,
      });
    },
    async setActiveAgent(agentId = '', options = {}) {
      const normalizedAgentId = normalizeOfficeAgentId(agentId);
      const api = getDesktopApi();
      if (api?.office?.setActive) {
        const result = await api.office.setActive({
          agentId: normalizedAgentId,
          ...(Object.prototype.hasOwnProperty.call(options, 'revision') ? { revision: options.revision } : {}),
        });
        return normalizeOfficeState(result?.state || result);
      }
      if (api?.office?.update) {
        const result = await api.office.update({
          activeAgentId: normalizedAgentId,
          ...(Object.prototype.hasOwnProperty.call(options, 'revision') ? { revision: options.revision } : {}),
        });
        return normalizeOfficeState(result?.state || result);
      }
      return updateWebOfficeState((current) => {
        const nextState = normalizeOfficeState(current);
        if (normalizeOfficeAgentId(nextState.activeAgentId) === normalizedAgentId) {
          return nextState;
        }
        return {
          ...nextState,
          activeAgentId: normalizedAgentId,
        };
      });
    },
    async updateState(patch = {}) {
      const api = getDesktopApi();
      if (api?.office?.update) {
        const result = await api.office.update(patch);
        return normalizeOfficeState(result?.state || result);
      }
      return updateWebOfficeState((current) => ({
        ...current,
        ...patch,
      }));
    },
    async removeAgent(agentId = '', options = {}) {
      const normalizedAgentId = normalizeOfficeAgentId(agentId);
      const api = getDesktopApi();
      if (api?.office?.remove) {
        const result = await api.office.remove({
          agentId: normalizedAgentId,
          ...(Object.prototype.hasOwnProperty.call(options, 'activeAgentId') ? { activeAgentId: normalizeOfficeAgentId(options.activeAgentId) } : {}),
          ...(Object.prototype.hasOwnProperty.call(options, 'revision') ? { revision: options.revision } : {}),
        });
        return normalizeOfficeState(result?.state || result);
      }
      if (api?.office?.update) {
        const result = await api.office.update({
          removeAgentId: normalizedAgentId,
          ...(Object.prototype.hasOwnProperty.call(options, 'activeAgentId') ? { activeAgentId: normalizeOfficeAgentId(options.activeAgentId) } : {}),
          ...(Object.prototype.hasOwnProperty.call(options, 'revision') ? { revision: options.revision } : {}),
        });
        return normalizeOfficeState(result?.state || result);
      }
      return updateWebOfficeState((current) => removeWebOfficeAgent(current, normalizedAgentId, options));
    },
    onEvent(handler) {
      const api = getDesktopApi();
      if (api?.office?.onChanged) {
        return api.office.onChanged((payload = {}) => {
          if (typeof handler !== 'function') {
            return;
          }
          handler({
            channel: 'office',
            type: payload?.mutation?.type || 'state-changed',
            payload: normalizeOfficeState(payload?.state || payload),
            mutation: payload?.mutation || null,
            timestamp: normalizeText(payload?.timestamp, ''),
            agentId: normalizeText(payload?.agentId, ''),
            backend: normalizeText(payload?.backend, ''),
            routeKey: normalizeText(payload?.routeKey, ''),
          });
        });
      }
      if (typeof handler !== 'function') {
        return () => {};
      }
      webOfficeListeners.add(handler);
      handler({
        channel: 'office',
        type: 'snapshot',
        payload: normalizeOfficeState(webOfficeState),
      });
      return () => {
        webOfficeListeners.delete(handler);
      };
    },
  },
  chat: {
    start(request) {
      const api = getDesktopApi();
      if (api?.conversation?.submitUserText) {
        return api.conversation.submitUserText(request).then((result = {}) => {
          if (result.ok && result.streamId) {
            return { streamId: result.streamId };
          }

          throw new Error(result.reason || 'desktop_chat_unavailable');
        });
      }
      throw new Error('desktop_conversation_unavailable');
    },
    abort(request) {
      const api = getDesktopApi();
      if (!api?.conversation?.abortActive) {
        return Promise.resolve({ ok: false, reason: 'desktop_conversation_unavailable' });
      }
      return api.conversation.abortActive({
        streamId: request?.streamId || '',
        reason: request?.reason || 'manual',
      });
    },
    onEvent(handler) {
      const api = getDesktopApi();
      if (typeof handler !== 'function') {
        return () => {};
      }
      return subscribeConversationChannel(api, 'chat', (event = {}) => {
        const normalized = normalizeConversationEnvelopeEvent(event) || {};
        handler({
          ...normalized,
          payload: normalized.payload && typeof normalized.payload === 'object' ? normalized.payload : {},
        });
      });
    },
  },
  valueState: {
    async getState(request = {}) {
      const api = getDesktopApi();
      if (api?.valueState?.getState) {
        const result = await api.valueState.getState(request);
        return normalizeValueState(result?.state || result);
      }
      return normalizeValueState(webValueState);
    },
    async setState(nextState = {}) {
      const api = getDesktopApi();
      if (api?.valueState?.setState) {
        const result = await api.valueState.setState(nextState);
        return normalizeValueState(result?.state || result);
      }
      if (api?.valueState?.update) {
        const result = await api.valueState.update(nextState);
        return normalizeValueState(result?.state || result);
      }

      webValueState = normalizeValueState({
        ...webValueState,
        ...nextState,
      });
      emitWebValueStateChange('state-changed');
      return normalizeValueState(webValueState);
    },
    onEvent(handler) {
      const api = getDesktopApi();
      if (api?.valueState?.onEvent) {
        return api.valueState.onEvent((event = {}) => {
          if (typeof handler !== 'function') {
            return;
          }
          handler(normalizeValueEventEnvelope(event) || event);
        });
      }
      if (typeof handler !== 'function') {
        return () => {};
      }
      webValueListeners.add(handler);
      handler({
        channel: 'value',
        type: 'snapshot',
        payload: normalizeValueState(webValueState),
      });
      return () => {
        webValueListeners.delete(handler);
      };
    },
    async applyInteraction(request = {}) {
      const api = getDesktopApi();
      if (api?.valueState?.applyInteraction) {
        const result = await api.valueState.applyInteraction(request);
        return normalizeValueState(result?.state || result);
      }

      return updateWebValueState({
        type: 'stat-updated',
        payload: {
          agentId: normalizeText(request.agentId, ''),
          routeKey: normalizeText(request.routeKey, ''),
          sessionId: normalizeText(request.sessionId, ''),
          stats: normalizePlainObject(request.stats),
        },
      });
    },
    recordEvent(event = {}) {
      return updateWebValueState(event);
    },
  },
  settings: {
    async get() {
      const api = getDesktopApi();
      if (api?.settings?.get) {
        return normalizeSettingsResponse(await api.settings.get());
      }
      return loadWebSettings();
    },
    async save(partialSettings = {}) {
      const patch = normalizeSettingsPatch(partialSettings);
      const api = getDesktopApi();
      if (api?.settings?.save) {
        const saved = await api.settings.save(patch);
        return normalizeSettingsResponse(saved);
      }
      return saveWebSettings(patch);
    },
    async testConnection(overrideSettings = {}) {
      const patch = normalizeSettingsPatch(overrideSettings);
      const api = getDesktopApi();
      if (api?.settings?.testConnection) {
        return api.settings.testConnection(patch);
      }
      return testWebConnection(patch);
    },
    async pickNanobotWorkspace() {
      const api = getDesktopApi();
      if (api?.settings?.pickNanobotWorkspace) {
        return api.settings.pickNanobotWorkspace();
      }
      return {
        ok: false,
        canceled: true,
        path: '',
      };
    },
    async openNanobotWorkspace() {
      const api = getDesktopApi();
      if (api?.settings?.openNanobotWorkspace) {
        return api.settings.openNanobotWorkspace();
      }

      return {
        ok: false,
        error: {
          code: 'desktop_nanobot_workspace_unavailable',
          message: '当前环境不支持打开 Nanobot 工作区。',
        },
      };
    },
  },
  appUpdater: {
    async getState() {
      const api = getDesktopApi();
      if (!api?.appUpdater?.getState) {
        return {
          ok: true,
          state: {
            status: 'idle',
            available: false,
            downloaded: false,
            supported: false,
            supportReason: 'desktop_app_updater_unavailable',
          },
        };
      }
      return api.appUpdater.getState();
    },
    async check() {
      const api = getDesktopApi();
      if (!api?.appUpdater?.check) {
        return {
          ok: false,
          reason: 'desktop_app_updater_unavailable',
        };
      }
      return api.appUpdater.check();
    },
    async download() {
      const api = getDesktopApi();
      if (!api?.appUpdater?.download) {
        return {
          ok: false,
          reason: 'desktop_app_updater_unavailable',
        };
      }
      return api.appUpdater.download();
    },
    async install() {
      const api = getDesktopApi();
      if (!api?.appUpdater?.install) {
        return {
          ok: false,
          reason: 'desktop_app_updater_unavailable',
        };
      }
      return api.appUpdater.install();
    },
    onState(handler) {
      const api = getDesktopApi();
      if (!api?.appUpdater?.onState || typeof handler !== 'function') {
        return () => {};
      }
      return api.appUpdater.onState(handler);
    },
  },
  nanobotRuntime: {
    async status() {
      const api = getDesktopApi();
      if (api?.nanobotRuntime?.status) {
        return api.nanobotRuntime.status();
      }
      return {
        ok: false,
        installed: false,
        source: '',
        repoPath: '',
        pythonExecutable: '',
      };
    },
    async install(payload = {}) {
      const api = getDesktopApi();
      if (api?.nanobotRuntime?.install) {
        return api.nanobotRuntime.install(payload);
      }
      return {
        ok: false,
        error: {
          code: 'nanobot_runtime_not_ready',
          message: 'Web 模式暂不支持下载 Nanobot 运行时。',
        },
      };
    },
    onProgress(handler) {
      const api = getDesktopApi();
      if (!api?.nanobotRuntime?.onProgress || typeof handler !== 'function') {
        return () => {};
      }
      return api.nanobotRuntime.onProgress(handler);
    },
  },
  nanobotSkills: {
    async list() {
      const api = getDesktopApi();
      if (api?.nanobotSkills?.list) {
        return api.nanobotSkills.list();
      }
      return {
        ok: false,
        error: {
          code: 'nanobot_runtime_not_ready',
          message: 'Web 模式暂不支持 Nanobot Skills。',
        },
        libraryPath: '',
        customSkills: [],
        builtinSkills: [],
      };
    },
    async importZip() {
      const api = getDesktopApi();
      if (api?.nanobotSkills?.importZip) {
        return api.nanobotSkills.importZip();
      }
      return {
        ok: false,
        error: {
          code: 'nanobot_runtime_not_ready',
          message: 'Web 模式暂不支持导入 Nanobot Skills。',
        },
      };
    },
    async delete(payload = {}) {
      const api = getDesktopApi();
      if (api?.nanobotSkills?.delete) {
        return api.nanobotSkills.delete(payload);
      }
      return {
        ok: false,
        error: {
          code: 'nanobot_runtime_not_ready',
          message: 'Web 模式暂不支持删除 Nanobot Skills。',
        },
      };
    },
    async openLibrary() {
      const api = getDesktopApi();
      if (api?.nanobotSkills?.openLibrary) {
        return api.nanobotSkills.openLibrary();
      }
      return {
        ok: false,
        error: {
          code: 'nanobot_runtime_not_ready',
          message: 'Web 模式暂不支持打开 Nanobot Skills 目录。',
        },
      };
    },
  },
  capture: {
    beginWindowCapture() {
      const api = getDesktopApi();
      if (!api?.capture?.beginWindowCapture) {
        return Promise.resolve({ ok: false, reason: 'desktop_capture_unavailable' });
      }
      return api.capture.beginWindowCapture();
    },
    finishWindowCapture() {
      const api = getDesktopApi();
      if (!api?.capture?.finishWindowCapture) {
        return Promise.resolve({ ok: false, reason: 'desktop_capture_unavailable' });
      }
      return api.capture.finishWindowCapture();
    },
    save(request = {}) {
      const api = getDesktopApi();
      if (!api?.capture?.save) {
        return Promise.resolve({ ok: false, reason: 'desktop_capture_unavailable' });
      }
      return api.capture.save(request);
    },
    release(request = {}) {
      const api = getDesktopApi();
      if (!api?.capture?.release) {
        return Promise.resolve({ ok: false, reason: 'desktop_capture_unavailable' });
      }
      return api.capture.release(request);
    },
    selectRegion() {
      const api = getDesktopApi();
      if (!api?.capture?.selectRegion) {
        return Promise.resolve({ ok: false, canceled: false, reason: 'desktop_capture_unavailable' });
      }
      return api.capture.selectRegion();
    },
  },
  captureOverlay: {
    getSession() {
      const api = getDesktopApi();
      if (!api?.captureOverlay?.getSession) {
        return Promise.resolve({ ok: false, reason: 'capture_session_unavailable' });
      }
      return api.captureOverlay.getSession();
    },
    confirm(request = {}) {
      const api = getDesktopApi();
      if (!api?.captureOverlay?.confirm) {
        return Promise.resolve({ ok: false, reason: 'capture_session_unavailable' });
      }
      return api.captureOverlay.confirm(request);
    },
    cancel(request = {}) {
      const api = getDesktopApi();
      if (!api?.captureOverlay?.cancel) {
        return Promise.resolve({ ok: false, reason: 'capture_session_unavailable' });
      }
      return api.captureOverlay.cancel(request);
    },
  },
  mode: {
    async getCurrent() {
      const api = getDesktopApi();
      if (!api?.windowMode?.getMode) {
        return { mode: 'window' };
      }

      const result = await api.windowMode.getMode();
      if (result?.mode === 'pet' || result?.mode === 'window') {
        return result;
      }

      return { mode: 'window' };
    },
    async set(mode) {
      const api = getDesktopApi();
      if (!api?.windowMode?.setMode) {
        return { ok: false, mode: 'window' };
      }

      return api.windowMode.setMode(mode);
    },
    notifyRendererReady(mode) {
      const api = getDesktopApi();
      api?.windowMode?.notifyRendererReady?.(mode);
    },
    notifyModeRendered(mode) {
      const api = getDesktopApi();
      api?.windowMode?.notifyModeRendered?.(mode);
    },
    updateHover(componentId, isHovering) {
      const api = getDesktopApi();
      api?.windowMode?.updateComponentHover?.(componentId, isHovering);
    },
    toggleForceIgnoreMouse() {
      const api = getDesktopApi();
      api?.windowMode?.toggleForceIgnoreMouse?.();
    },
    onPreChanged(handler) {
      const api = getDesktopApi();
      if (!api?.windowMode?.onPreModeChanged || typeof handler !== 'function') {
        return () => {};
      }

      return api.windowMode.onPreModeChanged((payload = {}) => {
        handler(payload.mode || 'window');
      });
    },
    onChanged(handler) {
      const api = getDesktopApi();
      if (!api?.windowMode?.onModeChanged || typeof handler !== 'function') {
        return () => {};
      }

      return api.windowMode.onModeChanged((payload = {}) => {
        handler(payload.mode || 'window');
      });
    },
    onForceIgnoreMouseChanged(handler) {
      const api = getDesktopApi();
      if (!api?.windowMode?.onForceIgnoreMouseChanged || typeof handler !== 'function') {
        return () => {};
      }

      return api.windowMode.onForceIgnoreMouseChanged((payload = {}) => {
        handler(Boolean(payload.forceIgnoreMouse));
      });
    },
  },
  voice: {
    async start({ sessionId, mode = 'vad' } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.startSession) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.startSession({ sessionId, mode });
    },
    async sendAudioChunk({
      sessionId,
      seq,
      chunkId,
      pcmChunk,
      sampleRate = 16000,
      channels = 1,
      sampleFormat = 'pcm_s16le',
      isSpeech = false,
    } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.sendAudioChunk) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.sendAudioChunk({
        sessionId,
        seq,
        chunkId,
        pcmChunk,
        sampleRate,
        channels,
        sampleFormat,
        isSpeech,
      });
    },
    async commit({ sessionId, finalSeq, autoStartChat = true } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.commitInput) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.commitInput({ sessionId, finalSeq, autoStartChat });
    },
    async stop({ sessionId, reason = 'manual' } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.stopSession) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.stopSession({ sessionId, reason });
    },
    async stopTts({ sessionId, reason = 'manual' } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.stopTts) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.stopTts({ sessionId, reason });
    },
    async sendPlaybackAck({ sessionId, ackSeq, bufferedMs } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.sendPlaybackAck) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.sendPlaybackAck({ sessionId, ackSeq, bufferedMs });
    },
    async warmup({
      warmAsr = true,
      warmTts = false,
      reload = false,
    } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.warmup) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.warmup({
        warmAsr,
        warmTts,
        reload,
      });
    },
    async listSegmentTrace({ sessionId = '', limit = 20 } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.listSegmentTrace) {
        return { ok: false, reason: 'desktop_voice_unavailable', items: [] };
      }
      return api.voice.listSegmentTrace({ sessionId, limit });
    },
    async runAsrDiagnostics({
      pcmChunk,
      sampleRate = 16000,
      channels = 1,
      sampleFormat = 'pcm_s16le',
      timeoutMs = 120000,
    } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.runAsrDiagnostics) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.runAsrDiagnostics({
        pcmChunk,
        sampleRate,
        channels,
        sampleFormat,
        timeoutMs,
      });
    },
    async runTtsDiagnostics({
      text,
      timeoutMs = 180000,
      includeAudio = false,
    } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.runTtsDiagnostics) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.runTtsDiagnostics({
        text,
        timeoutMs,
        includeAudio,
      });
    },
    onEvent(handler) {
      const api = getDesktopApi();
      if (typeof handler !== 'function') {
        return () => {};
      }
      return subscribeConversationChannel(api, 'voice', (event = {}) => {
        const voicePayload = { ...(event || {}) };
        delete voicePayload.channel;
        handler(voicePayload);
      });
    },
    onFlowControl(handler) {
      const api = getDesktopApi();
      if (!api?.voice?.onFlowControl || typeof handler !== 'function') {
        return () => {};
      }
      return api.voice.onFlowControl(handler);
    },
    onToggleRequest(handler) {
      const api = getDesktopApi();
      if (!api?.voice?.onToggleRequest || typeof handler !== 'function') {
        return () => {};
      }
      return api.voice.onToggleRequest(handler);
    },
  },
  voiceModels: {
    async catalog() {
      const api = getDesktopApi();
      if (!api?.voiceModels?.catalog) {
        return {
          ok: false,
          items: [],
        };
      }
      return api.voiceModels.catalog();
    },
    async list() {
      const api = getDesktopApi();
      if (!api?.voiceModels?.list) {
        return {
          ok: false,
          bundles: [],
          selectedAsrBundleId: '',
          selectedTtsBundleId: '',
          selectedBundleId: '',
          rootDir: '',
        };
      }
      return api.voiceModels.list();
    },
    async installCatalog(catalogId, options = {}) {
      const api = getDesktopApi();
      if (!api?.voiceModels?.installCatalog) {
        return {
          ok: false,
          error: {
            code: 'desktop_voice_models_unavailable',
            message: '当前环境不支持内置语音模型安装。',
          },
        };
      }
      return api.voiceModels.installCatalog({
        catalogId,
        installAsr: options.installAsr,
        installTts: options.installTts,
      });
    },
    async select({ bundleId, asrBundleId, ttsBundleId } = {}) {
      const api = getDesktopApi();
      if (!api?.voiceModels?.select) {
        return {
          ok: false,
          error: {
            code: 'desktop_voice_models_unavailable',
            message: '当前环境不支持语音模型管理。',
          },
        };
      }
      const payload = {};
      if (typeof bundleId !== 'undefined') {
        payload.bundleId = bundleId;
      }
      if (typeof asrBundleId !== 'undefined') {
        payload.asrBundleId = asrBundleId;
      }
      if (typeof ttsBundleId !== 'undefined') {
        payload.ttsBundleId = ttsBundleId;
      }
      return api.voiceModels.select(payload);
    },
    async download(payload = {}) {
      const api = getDesktopApi();
      if (!api?.voiceModels?.download) {
        return {
          ok: false,
          error: {
            code: 'desktop_voice_models_unavailable',
            message: '当前环境不支持语音模型下载。',
          },
        };
      }
      return api.voiceModels.download(payload);
    },
    async remove({ bundleId } = {}) {
      const api = getDesktopApi();
      if (!api?.voiceModels?.remove) {
        return {
          ok: false,
          error: {
            code: 'desktop_voice_models_unavailable',
            message: '当前环境不支持语音模型删除。',
          },
        };
      }
      return api.voiceModels.remove({ bundleId });
    },
    onDownloadProgress(handler) {
      const api = getDesktopApi();
      if (!api?.voiceModels?.onDownloadProgress || typeof handler !== 'function') {
        return () => {};
      }
      return api.voiceModels.onDownloadProgress(handler);
    },
  },
  window: {
    getPlatformSync() {
      const api = getDesktopApi();
      return resolvePlatformSyncFromApi(api);
    },
    async getPlatform() {
      const api = getDesktopApi();
      const fallbackPlatform = resolvePlatformSyncFromApi(api);
      if (!api?.windowControls?.getPlatform) {
        return { platform: fallbackPlatform };
      }

      try {
        const result = await api.windowControls.getPlatform();
        return {
          platform: result?.platform || fallbackPlatform,
        };
      } catch {
        return { platform: fallbackPlatform };
      }
    },
    async control(action) {
      const api = getDesktopApi();
      if (!api?.windowControls?.control) {
        return { ok: false, reason: 'desktop_window_control_unavailable' };
      }

      return api.windowControls.control(action);
    },
    async getCursorContext() {
      const api = getDesktopApi();
      if (!api?.windowControls?.getCursorContext) {
        return { ok: false, reason: 'desktop_cursor_context_unavailable' };
      }

      return api.windowControls.getCursorContext();
    },
  },
  models: {
    async list() {
      const api = getDesktopApi();
      if (!api?.live2dModels?.list) {
        return { models: [] };
      }
      return api.live2dModels.list();
    },
    async importZip() {
      const api = getDesktopApi();
      if (!api?.live2dModels?.importZip) {
        return {
          ok: false,
          error: {
            code: 'desktop_model_library_unavailable',
            message: '当前环境不支持导入模型。',
          },
        };
      }
      return api.live2dModels.importZip();
    },
  },
};
