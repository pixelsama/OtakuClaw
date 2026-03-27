const fs = require('node:fs/promises');
const path = require('node:path');

const {
  AI_MODEL_ACCOUNT_NAME,
  KeytarSecretStore,
  DASHSCOPE_ACCOUNT_NAME,
  FAST_PERSONA_ACCOUNT_NAME,
  OPENCLAW_ACCOUNT_NAME,
  NANOBOT_ACCOUNT_NAME,
} = require('./secretStore');
const {
  DEFAULT_AI_MODEL_SETTINGS,
  DEFAULT_FAST_PERSONA_SETTINGS,
  normalizeAiModelSettings,
  normalizeFastPersonaSettings,
} = require('./persona/quickPersonaConfig');

const SETTINGS_FILE = 'openclaw-settings.json';

const DEFAULT_OPENCLAW_SETTINGS = {
  baseUrl: 'http://127.0.0.1:18789',
  agentId: 'main',
};

const DEFAULT_NANOBOT_SETTINGS = {
  enabled: false,
  workspace: '',
  allowHighRiskTools: false,
  provider: 'openrouter',
  model: 'anthropic/claude-opus-4-5',
  apiBase: '',
  maxTokens: 4096,
  temperature: 0.2,
  reasoningEffort: '',
};

const DEFAULT_ACP_RUNNER_SETTINGS = {
  protocol: 'acp',
  transport: 'stdio',
  command: '',
  args: [],
  cwd: '',
  endpoint: '',
  url: '',
  permissionEndpoint: '',
  headers: {},
  env: {},
};

const DEFAULT_CLAUDE_CODE_SETTINGS = {
  enabled: false,
  timeoutMs: 120000,
  askTimeoutMs: 8000,
  permissionMode: 'deny',
  runner: {
    ...DEFAULT_ACP_RUNNER_SETTINGS,
    command: 'claude-agent-acp',
  },
};

const DEFAULT_CODEX_SETTINGS = {
  enabled: false,
  timeoutMs: 120000,
  askTimeoutMs: 8000,
  permissionMode: 'deny',
  runner: {
    ...DEFAULT_ACP_RUNNER_SETTINGS,
    command: 'codex-acp',
  },
};

const DEFAULT_UI_SETTINGS = {
  onboarding: {
    completed: false,
    completedAt: '',
  },
  avatar: {
    renderMode: 'live2d',
    live2d: {
      selectedModelPath: '',
    },
    static: {
      selectedPackId: '',
      scale: 1,
      hitTest: {
        mode: 'alpha',
        alphaThreshold: 10,
      },
    },
  },
  officeSceneLayout: {
    themeId: 'star-office-classic',
    furnitureOverrides: {},
  },
  pixelPack: {
    activePackId: '',
    activeVersion: '',
    overrides: {},
  },
};

const DEFAULT_SETTINGS = {
  chatBackend: 'nanobot',
  openclaw: { ...DEFAULT_OPENCLAW_SETTINGS },
  nanobot: { ...DEFAULT_NANOBOT_SETTINGS },
  aiModel: { ...DEFAULT_AI_MODEL_SETTINGS },
  claudeCode: { ...DEFAULT_CLAUDE_CODE_SETTINGS },
  codex: { ...DEFAULT_CODEX_SETTINGS },
  fastPersona: { ...DEFAULT_FAST_PERSONA_SETTINGS },
  voice: {
    asrProvider: 'inherit',
    ttsProvider: 'inherit',
    dashscope: {
      workspace: '',
      baseUrl: '',
      asrModel: 'qwen3-asr-flash-realtime',
      asrLanguage: 'zh',
      ttsModel: 'qwen-tts-realtime-latest',
      ttsVoice: 'Cherry',
      ttsLanguage: 'Chinese',
      ttsSampleRate: 24000,
      ttsSpeechRate: 1,
    },
  },
  ui: {
    ...DEFAULT_UI_SETTINGS,
    onboarding: {
      ...DEFAULT_UI_SETTINGS.onboarding,
    },
    pixelPack: {
      ...DEFAULT_UI_SETTINGS.pixelPack,
      overrides: cloneJsonValue(DEFAULT_UI_SETTINGS.pixelPack.overrides),
    },
  },
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value, fallback = '') {
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

function normalizeChatBackend(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'nanobot') {
    return 'nanobot';
  }
  if (normalized === 'codex') {
    return 'codex';
  }
  if (normalized === 'claude-code' || normalized === 'claude code' || normalized === 'claudecode' || normalized === 'claude_code') {
    return 'claude-code';
  }
  // Legacy compatibility: OpenClaw has been removed from user-visible backend choices.
  if (normalized === 'openclaw') {
    return 'nanobot';
  }
  return 'nanobot';
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function normalizePermissionMode(value, fallback = 'deny') {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'allow' || normalized === 'ask' || normalized === 'deny') {
    return normalized;
  }
  return fallback;
}

function normalizeAcpTransport(value, fallback = 'stdio') {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'stdio') {
    return normalized;
  }
  if (normalized === 'http') {
    return normalized;
  }
  if (normalized === 'websocket' || normalized === 'ws') {
    return 'websocket';
  }
  return fallback;
}

function normalizeRunnerArgs(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeString(item))
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

function normalizeRunnerEnv(value) {
  if (!isObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [normalizeString(key), normalizeString(item)])
      .filter(([key]) => Boolean(key)),
  );
}

function normalizeRunnerHeaders(value) {
  if (!isObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [normalizeString(key), normalizeString(item)])
      .filter(([key]) => Boolean(key)),
  );
}

function normalizeAcpRunnerSettings(settings = {}, fallback = DEFAULT_ACP_RUNNER_SETTINGS) {
  const source = isObject(settings) ? settings : {};
  const defaults = isObject(fallback) ? fallback : DEFAULT_ACP_RUNNER_SETTINGS;
  return {
    protocol: 'acp',
    transport: normalizeAcpTransport(source.transport, normalizeAcpTransport(defaults.transport, 'stdio')),
    command: normalizeString(source.command, normalizeString(defaults.command)),
    args: normalizeRunnerArgs(
      Object.prototype.hasOwnProperty.call(source, 'args') ? source.args : defaults.args,
    ),
    cwd: normalizeString(source.cwd, normalizeString(defaults.cwd)),
    endpoint: normalizeString(source.endpoint, normalizeString(defaults.endpoint)),
    url: normalizeString(source.url, normalizeString(defaults.url)),
    permissionEndpoint: normalizeString(
      source.permissionEndpoint,
      normalizeString(defaults.permissionEndpoint),
    ),
    headers: normalizeRunnerHeaders(source.headers),
    env: normalizeRunnerEnv(source.env),
  };
}

function normalizeAcpBackendSettings(settings = {}, fallback = DEFAULT_CLAUDE_CODE_SETTINGS) {
  const source = isObject(settings) ? settings : {};
  const defaults = isObject(fallback) ? fallback : DEFAULT_CLAUDE_CODE_SETTINGS;
  return {
    enabled: Object.prototype.hasOwnProperty.call(source, 'enabled')
      ? Boolean(source.enabled)
      : Boolean(defaults.enabled),
    timeoutMs: toPositiveInteger(source.timeoutMs, toPositiveInteger(defaults.timeoutMs, 120000)),
    askTimeoutMs: toPositiveInteger(source.askTimeoutMs, toPositiveInteger(defaults.askTimeoutMs, 8000)),
    permissionMode: normalizePermissionMode(source.permissionMode, normalizePermissionMode(defaults.permissionMode, 'deny')),
    runner: normalizeAcpRunnerSettings(source.runner, defaults.runner),
  };
}

function cloneAcpBackendSettings(settings = {}) {
  const source = isObject(settings) ? settings : {};
  const runner = isObject(source.runner) ? source.runner : {};
  return {
    ...source,
    runner: {
      ...runner,
      args: [...(Array.isArray(runner.args) ? runner.args : [])],
      headers: { ...(isObject(runner.headers) ? runner.headers : {}) },
      env: { ...(isObject(runner.env) ? runner.env : {}) },
    },
  };
}

function normalizeOpenClawSettings(settings = {}) {
  return {
    baseUrl: normalizeString(settings.baseUrl, DEFAULT_OPENCLAW_SETTINGS.baseUrl),
    agentId: normalizeString(settings.agentId, DEFAULT_OPENCLAW_SETTINGS.agentId),
  };
}

function normalizeNanobotSettings(settings = {}) {
  return {
    enabled: Boolean(settings.enabled),
    workspace: normalizeString(settings.workspace, DEFAULT_NANOBOT_SETTINGS.workspace),
    allowHighRiskTools: Boolean(settings.allowHighRiskTools),
    provider: normalizeString(settings.provider, DEFAULT_NANOBOT_SETTINGS.provider),
    model: normalizeString(settings.model, DEFAULT_NANOBOT_SETTINGS.model),
    apiBase: normalizeString(settings.apiBase, DEFAULT_NANOBOT_SETTINGS.apiBase),
    maxTokens: toPositiveInteger(settings.maxTokens, DEFAULT_NANOBOT_SETTINGS.maxTokens),
    temperature: toFiniteNumber(settings.temperature, DEFAULT_NANOBOT_SETTINGS.temperature),
    reasoningEffort: normalizeString(settings.reasoningEffort, DEFAULT_NANOBOT_SETTINGS.reasoningEffort),
  };
}

function resolveLegacyAiModelSource(source = {}) {
  const nanobot = isObject(source.nanobot) ? source.nanobot : {};
  const fastPersona = isObject(source.fastPersona) ? source.fastPersona : {};
  return {
    provider: normalizeString(
      nanobot.provider || fastPersona.provider,
      DEFAULT_AI_MODEL_SETTINGS.provider,
    ),
    model: normalizeString(
      nanobot.model || fastPersona.model,
      DEFAULT_AI_MODEL_SETTINGS.model,
    ),
    apiBase: normalizeString(
      nanobot.apiBase || fastPersona.apiBase,
      DEFAULT_AI_MODEL_SETTINGS.apiBase,
    ),
  };
}

function normalizeClaudeCodeSettings(settings = {}) {
  return normalizeAcpBackendSettings(settings, DEFAULT_CLAUDE_CODE_SETTINGS);
}

function normalizeCodexSettings(settings = {}) {
  return normalizeAcpBackendSettings(settings, DEFAULT_CODEX_SETTINGS);
}

function normalizeVoiceProvider(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'dashscope') {
    return 'dashscope';
  }
  return 'inherit';
}

function normalizeVoiceSettings(settings = {}) {
  const dashscope = isObject(settings.dashscope) ? settings.dashscope : {};
  return {
    asrProvider: normalizeVoiceProvider(settings.asrProvider),
    ttsProvider: normalizeVoiceProvider(settings.ttsProvider),
    dashscope: {
      workspace: normalizeString(dashscope.workspace),
      baseUrl: normalizeString(dashscope.baseUrl),
      asrModel: normalizeString(dashscope.asrModel, DEFAULT_SETTINGS.voice.dashscope.asrModel),
      asrLanguage: normalizeString(dashscope.asrLanguage, DEFAULT_SETTINGS.voice.dashscope.asrLanguage),
      ttsModel: normalizeString(dashscope.ttsModel, DEFAULT_SETTINGS.voice.dashscope.ttsModel),
      ttsVoice: normalizeString(dashscope.ttsVoice, DEFAULT_SETTINGS.voice.dashscope.ttsVoice),
      ttsLanguage: normalizeString(dashscope.ttsLanguage, DEFAULT_SETTINGS.voice.dashscope.ttsLanguage),
      ttsSampleRate: toPositiveInteger(dashscope.ttsSampleRate, DEFAULT_SETTINGS.voice.dashscope.ttsSampleRate),
      ttsSpeechRate: toFiniteNumber(dashscope.ttsSpeechRate, DEFAULT_SETTINGS.voice.dashscope.ttsSpeechRate),
    },
  };
}

function normalizeOnboardingSettings(settings = {}) {
  return {
    completed: Boolean(settings.completed),
    completedAt: normalizeString(settings.completedAt, ''),
  };
}

function normalizeOfficeSceneFurnitureOverride(settings = {}) {
  const source = isObject(settings) ? settings : {};
  const normalized = {};

  if (Object.prototype.hasOwnProperty.call(source, 'left')) {
    normalized.left = toFiniteNumber(source.left, 0);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'top')) {
    normalized.top = toFiniteNumber(source.top, 0);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'width')) {
    normalized.width = toFiniteNumber(source.width, 0);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'opacity')) {
    normalized.opacity = toFiniteNumber(source.opacity, 1);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'zIndex')) {
    normalized.zIndex = toPositiveInteger(source.zIndex, 1);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'aspectRatio')) {
    normalized.aspectRatio = normalizeString(source.aspectRatio);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'assetKey')) {
    normalized.assetKey = normalizeString(source.assetKey);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'hidden')) {
    normalized.hidden = Boolean(source.hidden);
  }

  return normalized;
}

function normalizeOfficeSceneLayoutSettings(settings = {}) {
  const source = isObject(settings) ? settings : {};
  const furnitureOverridesSource = isObject(source.furnitureOverrides) ? source.furnitureOverrides : {};
  const furnitureOverrides = Object.fromEntries(
    Object.entries(furnitureOverridesSource)
      .map(([key, value]) => [normalizeString(key), normalizeOfficeSceneFurnitureOverride(value)])
      .filter(([key, value]) => key && isObject(value) && Object.keys(value).length > 0),
  );

  return {
    themeId: normalizeString(source.themeId, DEFAULT_UI_SETTINGS.officeSceneLayout.themeId),
    furnitureOverrides,
  };
}

function normalizePixelPackOverrides(value) {
  if (!isObject(value)) {
    return {};
  }
  return cloneJsonValue(value);
}

function normalizePixelPackSettings(settings = {}) {
  const source = isObject(settings) ? settings : {};
  return {
    activePackId: normalizeString(source.activePackId, DEFAULT_UI_SETTINGS.pixelPack.activePackId),
    activeVersion: normalizeString(source.activeVersion, DEFAULT_UI_SETTINGS.pixelPack.activeVersion),
    overrides: normalizePixelPackOverrides(source.overrides),
  };
}

function normalizeAvatarRenderMode(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'static' ? 'static' : 'live2d';
}

function normalizeAvatarLive2dSettings(settings = {}) {
  const source = isObject(settings) ? settings : {};
  return {
    selectedModelPath: normalizeString(
      source.selectedModelPath,
      DEFAULT_UI_SETTINGS.avatar.live2d.selectedModelPath,
    ),
  };
}

function normalizeAvatarHitTestSettings(settings = {}) {
  const source = isObject(settings) ? settings : {};
  const mode = normalizeString(source.mode, DEFAULT_UI_SETTINGS.avatar.static.hitTest.mode).toLowerCase();
  return {
    mode: mode === 'rect' ? 'rect' : 'alpha',
    alphaThreshold: Math.max(
      0,
      Math.min(
        255,
        toPositiveInteger(
          source.alphaThreshold,
          DEFAULT_UI_SETTINGS.avatar.static.hitTest.alphaThreshold,
        ),
      ),
    ),
  };
}

function normalizeAvatarStaticSettings(settings = {}) {
  const source = isObject(settings) ? settings : {};
  return {
    selectedPackId: normalizeString(
      source.selectedPackId,
      DEFAULT_UI_SETTINGS.avatar.static.selectedPackId,
    ),
    scale: Math.max(0.1, Math.min(3, toFiniteNumber(source.scale, DEFAULT_UI_SETTINGS.avatar.static.scale))),
    hitTest: normalizeAvatarHitTestSettings(source.hitTest),
  };
}

function normalizeAvatarSettings(settings = {}) {
  const source = isObject(settings) ? settings : {};
  return {
    renderMode: normalizeAvatarRenderMode(source.renderMode),
    live2d: normalizeAvatarLive2dSettings(source.live2d),
    static: normalizeAvatarStaticSettings(source.static),
  };
}

function normalizeUiSettings(settings = {}) {
  const onboarding = isObject(settings.onboarding) ? settings.onboarding : {};
  const avatar = isObject(settings.avatar) ? settings.avatar : {};
  const officeSceneLayout = isObject(settings.officeSceneLayout) ? settings.officeSceneLayout : {};
  const pixelPack = isObject(settings.pixelPack) ? settings.pixelPack : {};
  return {
    onboarding: normalizeOnboardingSettings(onboarding),
    avatar: normalizeAvatarSettings(avatar),
    officeSceneLayout: normalizeOfficeSceneLayoutSettings(officeSceneLayout),
    pixelPack: normalizePixelPackSettings(pixelPack),
  };
}

function cloneSettings(settings) {
  return {
    chatBackend: settings.chatBackend,
    openclaw: { ...settings.openclaw },
    nanobot: { ...settings.nanobot },
    aiModel: { ...settings.aiModel },
    claudeCode: cloneAcpBackendSettings(settings.claudeCode),
    codex: cloneAcpBackendSettings(settings.codex),
    fastPersona: { ...settings.fastPersona },
    voice: {
      ...settings.voice,
      dashscope: {
        ...(settings.voice?.dashscope || {}),
      },
    },
    ui: {
      ...(settings.ui || DEFAULT_UI_SETTINGS),
      onboarding: {
        ...(settings.ui?.onboarding || DEFAULT_UI_SETTINGS.onboarding),
      },
      avatar: {
        ...(settings.ui?.avatar || DEFAULT_UI_SETTINGS.avatar),
        live2d: {
          ...(settings.ui?.avatar?.live2d || DEFAULT_UI_SETTINGS.avatar.live2d),
        },
        static: {
          ...(settings.ui?.avatar?.static || DEFAULT_UI_SETTINGS.avatar.static),
          hitTest: {
            ...(settings.ui?.avatar?.static?.hitTest || DEFAULT_UI_SETTINGS.avatar.static.hitTest),
          },
        },
      },
      officeSceneLayout: {
        ...(settings.ui?.officeSceneLayout || DEFAULT_UI_SETTINGS.officeSceneLayout),
        furnitureOverrides: {
          ...(settings.ui?.officeSceneLayout?.furnitureOverrides || DEFAULT_UI_SETTINGS.officeSceneLayout.furnitureOverrides),
        },
      },
      pixelPack: {
        ...(settings.ui?.pixelPack || DEFAULT_UI_SETTINGS.pixelPack),
        overrides: cloneJsonValue(
          settings.ui?.pixelPack?.overrides || DEFAULT_UI_SETTINGS.pixelPack.overrides,
        ),
      },
    },
  };
}

function isNextGenSettingsShape(settings = {}) {
  return (
    Object.prototype.hasOwnProperty.call(settings, 'chatBackend')
    || Object.prototype.hasOwnProperty.call(settings, 'openclaw')
    || Object.prototype.hasOwnProperty.call(settings, 'nanobot')
    || Object.prototype.hasOwnProperty.call(settings, 'aiModel')
    || Object.prototype.hasOwnProperty.call(settings, 'claudeCode')
    || Object.prototype.hasOwnProperty.call(settings, 'codex')
    || Object.prototype.hasOwnProperty.call(settings, 'fastPersona')
    || Object.prototype.hasOwnProperty.call(settings, 'voice')
    || Object.prototype.hasOwnProperty.call(settings, 'ui')
  );
}

function normalizeFileSettings(settings = {}) {
  const source = isObject(settings) ? settings : {};

  if (isNextGenSettingsShape(source)) {
    const aiModelSource = isObject(source.aiModel)
      ? source.aiModel
      : resolveLegacyAiModelSource(source);
    return {
      chatBackend: normalizeChatBackend(source.chatBackend),
      openclaw: normalizeOpenClawSettings(isObject(source.openclaw) ? source.openclaw : source),
      nanobot: normalizeNanobotSettings(isObject(source.nanobot) ? source.nanobot : {}),
      aiModel: normalizeAiModelSettings(aiModelSource),
      claudeCode: normalizeClaudeCodeSettings(isObject(source.claudeCode) ? source.claudeCode : {}),
      codex: normalizeCodexSettings(isObject(source.codex) ? source.codex : {}),
      fastPersona: normalizeFastPersonaSettings(isObject(source.fastPersona) ? source.fastPersona : {}),
      voice: normalizeVoiceSettings(isObject(source.voice) ? source.voice : {}),
      ui: normalizeUiSettings(isObject(source.ui) ? source.ui : {}),
    };
  }

  return {
    chatBackend: 'nanobot',
    openclaw: normalizeOpenClawSettings(source),
    nanobot: { ...DEFAULT_NANOBOT_SETTINGS },
    aiModel: { ...DEFAULT_AI_MODEL_SETTINGS },
    claudeCode: { ...DEFAULT_CLAUDE_CODE_SETTINGS },
    codex: { ...DEFAULT_CODEX_SETTINGS },
    fastPersona: { ...DEFAULT_FAST_PERSONA_SETTINGS },
    voice: normalizeVoiceSettings({}),
    ui: normalizeUiSettings({}),
  };
}

function normalizeSecretValue(value) {
  return normalizeString(value, '');
}

function extractLegacySecrets(settings = {}) {
  const source = isObject(settings) ? settings : {};
  const openclaw = isObject(source.openclaw) ? source.openclaw : {};
  const nanobot = isObject(source.nanobot) ? source.nanobot : {};
  const aiModel = isObject(source.aiModel) ? source.aiModel : {};
  const fastPersona = isObject(source.fastPersona) ? source.fastPersona : {};
  const voice = isObject(source.voice) ? source.voice : {};
  const dashscope = isObject(voice.dashscope) ? voice.dashscope : {};

  return {
    openclawToken: normalizeSecretValue(openclaw.token || source.token),
    nanobotApiKey: normalizeSecretValue(nanobot.apiKey || source.nanobotApiKey),
    aiModelApiKey: normalizeSecretValue(
      aiModel.apiKey
      || source.aiModelApiKey
      || fastPersona.apiKey
      || source.fastPersonaApiKey,
    ),
    fastPersonaApiKey: normalizeSecretValue(fastPersona.apiKey || source.fastPersonaApiKey),
    dashscopeApiKey: normalizeSecretValue(dashscope.apiKey || source.dashscopeApiKey),
  };
}

function normalizePatch(partialSettings = {}) {
  const source = isObject(partialSettings) ? partialSettings : {};
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(source, 'chatBackend')) {
    patch.chatBackend = normalizeChatBackend(source.chatBackend);
  }

  const openclawPatch = {};
  const openclawSource = isObject(source.openclaw) ? source.openclaw : {};
  if (Object.prototype.hasOwnProperty.call(source, 'baseUrl')) {
    openclawPatch.baseUrl = normalizeString(source.baseUrl);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'agentId')) {
    openclawPatch.agentId = normalizeString(source.agentId);
  }
  if (Object.prototype.hasOwnProperty.call(openclawSource, 'baseUrl')) {
    openclawPatch.baseUrl = normalizeString(openclawSource.baseUrl);
  }
  if (Object.prototype.hasOwnProperty.call(openclawSource, 'agentId')) {
    openclawPatch.agentId = normalizeString(openclawSource.agentId);
  }
  if (Object.keys(openclawPatch).length > 0) {
    patch.openclaw = openclawPatch;
  }

  const nanobotPatch = {};
  const nanobotSource = isObject(source.nanobot) ? source.nanobot : {};
  if (Object.prototype.hasOwnProperty.call(nanobotSource, 'enabled')) {
    nanobotPatch.enabled = Boolean(nanobotSource.enabled);
  }
  if (Object.prototype.hasOwnProperty.call(nanobotSource, 'workspace')) {
    nanobotPatch.workspace = normalizeString(nanobotSource.workspace);
  }
  if (Object.prototype.hasOwnProperty.call(nanobotSource, 'allowHighRiskTools')) {
    nanobotPatch.allowHighRiskTools = Boolean(nanobotSource.allowHighRiskTools);
  }
  if (Object.prototype.hasOwnProperty.call(nanobotSource, 'provider')) {
    nanobotPatch.provider = normalizeString(nanobotSource.provider);
  }
  if (Object.prototype.hasOwnProperty.call(nanobotSource, 'model')) {
    nanobotPatch.model = normalizeString(nanobotSource.model);
  }
  if (Object.prototype.hasOwnProperty.call(nanobotSource, 'apiBase')) {
    nanobotPatch.apiBase = normalizeString(nanobotSource.apiBase);
  }
  if (Object.prototype.hasOwnProperty.call(nanobotSource, 'maxTokens')) {
    nanobotPatch.maxTokens = toPositiveInteger(nanobotSource.maxTokens, DEFAULT_NANOBOT_SETTINGS.maxTokens);
  }
  if (Object.prototype.hasOwnProperty.call(nanobotSource, 'temperature')) {
    nanobotPatch.temperature = toFiniteNumber(nanobotSource.temperature, DEFAULT_NANOBOT_SETTINGS.temperature);
  }
  if (Object.prototype.hasOwnProperty.call(nanobotSource, 'reasoningEffort')) {
    nanobotPatch.reasoningEffort = normalizeString(nanobotSource.reasoningEffort);
  }
  if (Object.keys(nanobotPatch).length > 0) {
    patch.nanobot = nanobotPatch;
  }

  const aiModelPatch = {};
  const aiModelSource = isObject(source.aiModel) ? source.aiModel : {};
  if (Object.prototype.hasOwnProperty.call(aiModelSource, 'provider')) {
    aiModelPatch.provider = normalizeString(aiModelSource.provider);
  }
  if (Object.prototype.hasOwnProperty.call(aiModelSource, 'model')) {
    aiModelPatch.model = normalizeString(aiModelSource.model);
  }
  if (Object.prototype.hasOwnProperty.call(aiModelSource, 'apiBase')) {
    aiModelPatch.apiBase = normalizeString(aiModelSource.apiBase);
  }
  if (Object.keys(aiModelPatch).length > 0) {
    patch.aiModel = aiModelPatch;
  }

  const claudeCodePatch = {};
  const claudeCodeSource = isObject(source.claudeCode) ? source.claudeCode : {};
  const claudeCodeRunnerSource = isObject(claudeCodeSource.runner) ? claudeCodeSource.runner : {};
  if (Object.prototype.hasOwnProperty.call(claudeCodeSource, 'enabled')) {
    claudeCodePatch.enabled = Boolean(claudeCodeSource.enabled);
  }
  if (Object.prototype.hasOwnProperty.call(claudeCodeSource, 'timeoutMs')) {
    claudeCodePatch.timeoutMs = toPositiveInteger(claudeCodeSource.timeoutMs, DEFAULT_CLAUDE_CODE_SETTINGS.timeoutMs);
  }
  if (Object.prototype.hasOwnProperty.call(claudeCodeSource, 'askTimeoutMs')) {
    claudeCodePatch.askTimeoutMs = toPositiveInteger(
      claudeCodeSource.askTimeoutMs,
      DEFAULT_CLAUDE_CODE_SETTINGS.askTimeoutMs,
    );
  }
  if (Object.prototype.hasOwnProperty.call(claudeCodeSource, 'permissionMode')) {
    claudeCodePatch.permissionMode = normalizePermissionMode(claudeCodeSource.permissionMode);
  }
  const claudeCodeRunnerPatch = {};
  if (Object.prototype.hasOwnProperty.call(claudeCodeRunnerSource, 'command')) {
    claudeCodeRunnerPatch.command = normalizeString(claudeCodeRunnerSource.command);
  }
  if (Object.prototype.hasOwnProperty.call(claudeCodeRunnerSource, 'transport')) {
    claudeCodeRunnerPatch.transport = normalizeAcpTransport(
      claudeCodeRunnerSource.transport,
      DEFAULT_CLAUDE_CODE_SETTINGS.runner.transport,
    );
  }
  if (Object.prototype.hasOwnProperty.call(claudeCodeRunnerSource, 'args')) {
    claudeCodeRunnerPatch.args = normalizeRunnerArgs(claudeCodeRunnerSource.args);
  }
  if (Object.prototype.hasOwnProperty.call(claudeCodeRunnerSource, 'cwd')) {
    claudeCodeRunnerPatch.cwd = normalizeString(claudeCodeRunnerSource.cwd);
  }
  if (Object.prototype.hasOwnProperty.call(claudeCodeRunnerSource, 'endpoint')) {
    claudeCodeRunnerPatch.endpoint = normalizeString(claudeCodeRunnerSource.endpoint);
  }
  if (Object.prototype.hasOwnProperty.call(claudeCodeRunnerSource, 'url')) {
    claudeCodeRunnerPatch.url = normalizeString(claudeCodeRunnerSource.url);
  }
  if (Object.prototype.hasOwnProperty.call(claudeCodeRunnerSource, 'permissionEndpoint')) {
    claudeCodeRunnerPatch.permissionEndpoint = normalizeString(
      claudeCodeRunnerSource.permissionEndpoint,
    );
  }
  if (Object.prototype.hasOwnProperty.call(claudeCodeRunnerSource, 'headers')) {
    claudeCodeRunnerPatch.headers = normalizeRunnerHeaders(claudeCodeRunnerSource.headers);
  }
  if (Object.prototype.hasOwnProperty.call(claudeCodeRunnerSource, 'env')) {
    claudeCodeRunnerPatch.env = normalizeRunnerEnv(claudeCodeRunnerSource.env);
  }
  if (Object.keys(claudeCodeRunnerPatch).length > 0) {
    claudeCodePatch.runner = claudeCodeRunnerPatch;
  }
  if (Object.keys(claudeCodePatch).length > 0) {
    patch.claudeCode = claudeCodePatch;
  }

  const codexPatch = {};
  const codexSource = isObject(source.codex) ? source.codex : {};
  const codexRunnerSource = isObject(codexSource.runner) ? codexSource.runner : {};
  if (Object.prototype.hasOwnProperty.call(codexSource, 'enabled')) {
    codexPatch.enabled = Boolean(codexSource.enabled);
  }
  if (Object.prototype.hasOwnProperty.call(codexSource, 'timeoutMs')) {
    codexPatch.timeoutMs = toPositiveInteger(codexSource.timeoutMs, DEFAULT_CODEX_SETTINGS.timeoutMs);
  }
  if (Object.prototype.hasOwnProperty.call(codexSource, 'askTimeoutMs')) {
    codexPatch.askTimeoutMs = toPositiveInteger(codexSource.askTimeoutMs, DEFAULT_CODEX_SETTINGS.askTimeoutMs);
  }
  if (Object.prototype.hasOwnProperty.call(codexSource, 'permissionMode')) {
    codexPatch.permissionMode = normalizePermissionMode(codexSource.permissionMode);
  }
  const codexRunnerPatch = {};
  if (Object.prototype.hasOwnProperty.call(codexRunnerSource, 'command')) {
    codexRunnerPatch.command = normalizeString(codexRunnerSource.command);
  }
  if (Object.prototype.hasOwnProperty.call(codexRunnerSource, 'transport')) {
    codexRunnerPatch.transport = normalizeAcpTransport(
      codexRunnerSource.transport,
      DEFAULT_CODEX_SETTINGS.runner.transport,
    );
  }
  if (Object.prototype.hasOwnProperty.call(codexRunnerSource, 'args')) {
    codexRunnerPatch.args = normalizeRunnerArgs(codexRunnerSource.args);
  }
  if (Object.prototype.hasOwnProperty.call(codexRunnerSource, 'cwd')) {
    codexRunnerPatch.cwd = normalizeString(codexRunnerSource.cwd);
  }
  if (Object.prototype.hasOwnProperty.call(codexRunnerSource, 'endpoint')) {
    codexRunnerPatch.endpoint = normalizeString(codexRunnerSource.endpoint);
  }
  if (Object.prototype.hasOwnProperty.call(codexRunnerSource, 'url')) {
    codexRunnerPatch.url = normalizeString(codexRunnerSource.url);
  }
  if (Object.prototype.hasOwnProperty.call(codexRunnerSource, 'permissionEndpoint')) {
    codexRunnerPatch.permissionEndpoint = normalizeString(codexRunnerSource.permissionEndpoint);
  }
  if (Object.prototype.hasOwnProperty.call(codexRunnerSource, 'headers')) {
    codexRunnerPatch.headers = normalizeRunnerHeaders(codexRunnerSource.headers);
  }
  if (Object.prototype.hasOwnProperty.call(codexRunnerSource, 'env')) {
    codexRunnerPatch.env = normalizeRunnerEnv(codexRunnerSource.env);
  }
  if (Object.keys(codexRunnerPatch).length > 0) {
    codexPatch.runner = codexRunnerPatch;
  }
  if (Object.keys(codexPatch).length > 0) {
    patch.codex = codexPatch;
  }

  const fastPersonaPatch = {};
  const fastPersonaSource = isObject(source.fastPersona) ? source.fastPersona : {};
  if (Object.prototype.hasOwnProperty.call(fastPersonaSource, 'enabled')) {
    fastPersonaPatch.enabled = Boolean(fastPersonaSource.enabled);
  }
  if (Object.prototype.hasOwnProperty.call(fastPersonaSource, 'maxTokens')) {
    fastPersonaPatch.maxTokens = toPositiveInteger(fastPersonaSource.maxTokens, DEFAULT_FAST_PERSONA_SETTINGS.maxTokens);
  }
  if (Object.prototype.hasOwnProperty.call(fastPersonaSource, 'temperature')) {
    fastPersonaPatch.temperature = toFiniteNumber(
      fastPersonaSource.temperature,
      DEFAULT_FAST_PERSONA_SETTINGS.temperature,
    );
  }
  if (Object.prototype.hasOwnProperty.call(fastPersonaSource, 'timeoutMs')) {
    fastPersonaPatch.timeoutMs = toPositiveInteger(
      fastPersonaSource.timeoutMs,
      DEFAULT_FAST_PERSONA_SETTINGS.timeoutMs,
    );
  }
  if (Object.keys(fastPersonaPatch).length > 0) {
    patch.fastPersona = fastPersonaPatch;
  }

  const voicePatch = {};
  const voiceSource = isObject(source.voice) ? source.voice : {};
  const dashscopeSource = isObject(voiceSource.dashscope) ? voiceSource.dashscope : {};

  if (Object.prototype.hasOwnProperty.call(voiceSource, 'asrProvider')) {
    voicePatch.asrProvider = normalizeVoiceProvider(voiceSource.asrProvider);
  }
  if (Object.prototype.hasOwnProperty.call(voiceSource, 'ttsProvider')) {
    voicePatch.ttsProvider = normalizeVoiceProvider(voiceSource.ttsProvider);
  }

  const dashscopePatch = {};
  if (Object.prototype.hasOwnProperty.call(dashscopeSource, 'workspace')) {
    dashscopePatch.workspace = normalizeString(dashscopeSource.workspace);
  }
  if (Object.prototype.hasOwnProperty.call(dashscopeSource, 'baseUrl')) {
    dashscopePatch.baseUrl = normalizeString(dashscopeSource.baseUrl);
  }
  if (Object.prototype.hasOwnProperty.call(dashscopeSource, 'asrModel')) {
    dashscopePatch.asrModel = normalizeString(dashscopeSource.asrModel);
  }
  if (Object.prototype.hasOwnProperty.call(dashscopeSource, 'asrLanguage')) {
    dashscopePatch.asrLanguage = normalizeString(dashscopeSource.asrLanguage);
  }
  if (Object.prototype.hasOwnProperty.call(dashscopeSource, 'ttsModel')) {
    dashscopePatch.ttsModel = normalizeString(dashscopeSource.ttsModel);
  }
  if (Object.prototype.hasOwnProperty.call(dashscopeSource, 'ttsVoice')) {
    dashscopePatch.ttsVoice = normalizeString(dashscopeSource.ttsVoice);
  }
  if (Object.prototype.hasOwnProperty.call(dashscopeSource, 'ttsLanguage')) {
    dashscopePatch.ttsLanguage = normalizeString(dashscopeSource.ttsLanguage);
  }
  if (Object.prototype.hasOwnProperty.call(dashscopeSource, 'ttsSampleRate')) {
    dashscopePatch.ttsSampleRate = toPositiveInteger(
      dashscopeSource.ttsSampleRate,
      DEFAULT_SETTINGS.voice.dashscope.ttsSampleRate,
    );
  }
  if (Object.prototype.hasOwnProperty.call(dashscopeSource, 'ttsSpeechRate')) {
    dashscopePatch.ttsSpeechRate = toFiniteNumber(
      dashscopeSource.ttsSpeechRate,
      DEFAULT_SETTINGS.voice.dashscope.ttsSpeechRate,
    );
  }
  if (Object.keys(dashscopePatch).length > 0) {
    voicePatch.dashscope = dashscopePatch;
  }
  if (Object.keys(voicePatch).length > 0) {
    patch.voice = voicePatch;
  }

  const uiPatch = {};
  const uiSource = isObject(source.ui) ? source.ui : {};
  const onboardingSource = isObject(uiSource.onboarding) ? uiSource.onboarding : {};
  const avatarSource = isObject(uiSource.avatar) ? uiSource.avatar : {};
  const avatarLive2dSource = isObject(avatarSource.live2d) ? avatarSource.live2d : {};
  const avatarStaticSource = isObject(avatarSource.static) ? avatarSource.static : {};
  const avatarHitTestSource = isObject(avatarStaticSource.hitTest) ? avatarStaticSource.hitTest : {};
  const officeSceneLayoutSource = isObject(uiSource.officeSceneLayout) ? uiSource.officeSceneLayout : {};
  const pixelPackSource = isObject(uiSource.pixelPack) ? uiSource.pixelPack : {};
  const onboardingPatch = {};
  const avatarPatch = {};
  const avatarLive2dPatch = {};
  const avatarStaticPatch = {};
  const avatarHitTestPatch = {};
  const officeSceneLayoutPatch = {};
  const pixelPackPatch = {};
  if (Object.prototype.hasOwnProperty.call(onboardingSource, 'completed')) {
    onboardingPatch.completed = Boolean(onboardingSource.completed);
  }
  if (Object.prototype.hasOwnProperty.call(onboardingSource, 'completedAt')) {
    onboardingPatch.completedAt = normalizeString(onboardingSource.completedAt);
  }
  if (Object.keys(onboardingPatch).length > 0) {
    uiPatch.onboarding = onboardingPatch;
  }
  if (Object.prototype.hasOwnProperty.call(avatarSource, 'renderMode')) {
    avatarPatch.renderMode = normalizeAvatarRenderMode(avatarSource.renderMode);
  }
  if (Object.prototype.hasOwnProperty.call(avatarLive2dSource, 'selectedModelPath')) {
    avatarLive2dPatch.selectedModelPath = normalizeString(avatarLive2dSource.selectedModelPath);
  }
  if (Object.keys(avatarLive2dPatch).length > 0) {
    avatarPatch.live2d = avatarLive2dPatch;
  }
  if (Object.prototype.hasOwnProperty.call(avatarStaticSource, 'selectedPackId')) {
    avatarStaticPatch.selectedPackId = normalizeString(avatarStaticSource.selectedPackId);
  }
  if (Object.prototype.hasOwnProperty.call(avatarStaticSource, 'scale')) {
    avatarStaticPatch.scale = Math.max(
      0.1,
      Math.min(3, toFiniteNumber(avatarStaticSource.scale, DEFAULT_UI_SETTINGS.avatar.static.scale)),
    );
  }
  if (Object.prototype.hasOwnProperty.call(avatarHitTestSource, 'mode')) {
    const mode = normalizeString(avatarHitTestSource.mode).toLowerCase();
    avatarHitTestPatch.mode = mode === 'rect' ? 'rect' : 'alpha';
  }
  if (Object.prototype.hasOwnProperty.call(avatarHitTestSource, 'alphaThreshold')) {
    avatarHitTestPatch.alphaThreshold = Math.max(
      0,
      Math.min(
        255,
        toPositiveInteger(
          avatarHitTestSource.alphaThreshold,
          DEFAULT_UI_SETTINGS.avatar.static.hitTest.alphaThreshold,
        ),
      ),
    );
  }
  if (Object.keys(avatarHitTestPatch).length > 0) {
    avatarStaticPatch.hitTest = avatarHitTestPatch;
  }
  if (Object.keys(avatarStaticPatch).length > 0) {
    avatarPatch.static = avatarStaticPatch;
  }
  if (Object.keys(avatarPatch).length > 0) {
    uiPatch.avatar = avatarPatch;
  }
  if (Object.prototype.hasOwnProperty.call(officeSceneLayoutSource, 'themeId')) {
    officeSceneLayoutPatch.themeId = normalizeString(
      officeSceneLayoutSource.themeId,
      DEFAULT_UI_SETTINGS.officeSceneLayout.themeId,
    );
  }
  if (Object.prototype.hasOwnProperty.call(officeSceneLayoutSource, 'furnitureOverrides')) {
    officeSceneLayoutPatch.furnitureOverrides = normalizeOfficeSceneLayoutSettings({
      furnitureOverrides: officeSceneLayoutSource.furnitureOverrides,
    }).furnitureOverrides;
  }
  if (Object.keys(officeSceneLayoutPatch).length > 0) {
    uiPatch.officeSceneLayout = officeSceneLayoutPatch;
  }
  if (Object.prototype.hasOwnProperty.call(pixelPackSource, 'activePackId')) {
    pixelPackPatch.activePackId = normalizeString(pixelPackSource.activePackId);
  }
  if (Object.prototype.hasOwnProperty.call(pixelPackSource, 'activeVersion')) {
    pixelPackPatch.activeVersion = normalizeString(pixelPackSource.activeVersion);
  }
  if (Object.prototype.hasOwnProperty.call(pixelPackSource, 'overrides')) {
    pixelPackPatch.overrides = normalizePixelPackOverrides(pixelPackSource.overrides);
  }
  if (Object.keys(pixelPackPatch).length > 0) {
    uiPatch.pixelPack = pixelPackPatch;
  }
  if (Object.keys(uiPatch).length > 0) {
    patch.ui = uiPatch;
  }

  const openclawTokenFromFlat = Object.prototype.hasOwnProperty.call(source, 'token')
    ? normalizeSecretValue(source.token)
    : null;
  const openclawTokenFromNested = Object.prototype.hasOwnProperty.call(openclawSource, 'token')
    ? normalizeSecretValue(openclawSource.token)
    : null;
  if (typeof openclawTokenFromNested === 'string') {
    patch.openclawToken = openclawTokenFromNested;
  } else if (typeof openclawTokenFromFlat === 'string') {
    patch.openclawToken = openclawTokenFromFlat;
  }

  patch.clearOpenclawToken = Boolean(source.clearToken || openclawSource.clearToken);

  const nanobotApiKeyFromFlat = Object.prototype.hasOwnProperty.call(source, 'nanobotApiKey')
    ? normalizeSecretValue(source.nanobotApiKey)
    : null;
  const nanobotApiKeyFromNested = Object.prototype.hasOwnProperty.call(nanobotSource, 'apiKey')
    ? normalizeSecretValue(nanobotSource.apiKey)
    : null;
  if (typeof nanobotApiKeyFromNested === 'string') {
    patch.nanobotApiKey = nanobotApiKeyFromNested;
  } else if (typeof nanobotApiKeyFromFlat === 'string') {
    patch.nanobotApiKey = nanobotApiKeyFromFlat;
  }

  patch.clearNanobotApiKey = Boolean(source.clearNanobotApiKey || nanobotSource.clearApiKey);

  const aiModelApiKeyFromFlat = Object.prototype.hasOwnProperty.call(source, 'aiModelApiKey')
    ? normalizeSecretValue(source.aiModelApiKey)
    : null;
  const aiModelApiKeyFromNested = Object.prototype.hasOwnProperty.call(aiModelSource, 'apiKey')
    ? normalizeSecretValue(aiModelSource.apiKey)
    : null;
  if (typeof aiModelApiKeyFromNested === 'string') {
    patch.aiModelApiKey = aiModelApiKeyFromNested;
  } else if (typeof aiModelApiKeyFromFlat === 'string') {
    patch.aiModelApiKey = aiModelApiKeyFromFlat;
  }
  patch.clearAiModelApiKey = Boolean(source.clearAiModelApiKey || aiModelSource.clearApiKey);

  const dashscopeApiKeyFromFlat = Object.prototype.hasOwnProperty.call(source, 'dashscopeApiKey')
    ? normalizeSecretValue(source.dashscopeApiKey)
    : null;
  const dashscopeApiKeyFromNested = Object.prototype.hasOwnProperty.call(dashscopeSource, 'apiKey')
    ? normalizeSecretValue(dashscopeSource.apiKey)
    : null;
  if (typeof dashscopeApiKeyFromNested === 'string') {
    patch.dashscopeApiKey = dashscopeApiKeyFromNested;
  } else if (typeof dashscopeApiKeyFromFlat === 'string') {
    patch.dashscopeApiKey = dashscopeApiKeyFromFlat;
  }

  patch.clearDashscopeApiKey = Boolean(source.clearDashscopeApiKey || dashscopeSource.clearApiKey);

  const fastPersonaApiKeyFromNested = Object.prototype.hasOwnProperty.call(fastPersonaSource, 'apiKey')
    ? normalizeSecretValue(fastPersonaSource.apiKey)
    : null;
  if (
    typeof fastPersonaApiKeyFromNested === 'string'
    && !Object.prototype.hasOwnProperty.call(patch, 'aiModelApiKey')
  ) {
    patch.aiModelApiKey = fastPersonaApiKeyFromNested;
  }
  if (fastPersonaSource.clearApiKey) {
    patch.clearAiModelApiKey = true;
  }

  return patch;
}

class SettingsStore {
  constructor(app, secretStore = new KeytarSecretStore()) {
    this.app = app;
    this.secretStore = secretStore;
    this.filePath = path.join(this.app.getPath('userData'), SETTINGS_FILE);

    this.settings = cloneSettings(DEFAULT_SETTINGS);
    this.secrets = {
      openclawToken: '',
      nanobotApiKey: '',
      aiModelApiKey: '',
      dashscopeApiKey: '',
    };
    this.hasSecureStorage = this.secretStore.isAvailable();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    let parsed = null;
    let shouldPersist = false;

    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      parsed = JSON.parse(raw);
      this.settings = normalizeFileSettings(parsed);
      shouldPersist = !isNextGenSettingsShape(parsed);
      if (isNextGenSettingsShape(parsed) && !Object.prototype.hasOwnProperty.call(parsed, 'aiModel')) {
        shouldPersist = true;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to load settings file:', error);
      }
      this.settings = cloneSettings(DEFAULT_SETTINGS);
      shouldPersist = true;
    }

    const defaultWorkspace = path.join(this.app.getPath('userData'), 'nanobot-workspace');
    if (!this.settings.nanobot.workspace) {
      this.settings.nanobot.workspace = defaultWorkspace;
      shouldPersist = true;
    }

    this.hasSecureStorage = this.secretStore.isAvailable();

    const legacySecrets = extractLegacySecrets(parsed);
    const secureSecrets = this.hasSecureStorage
      ? await this.safeGetSecrets([
        OPENCLAW_ACCOUNT_NAME,
        NANOBOT_ACCOUNT_NAME,
        AI_MODEL_ACCOUNT_NAME,
        DASHSCOPE_ACCOUNT_NAME,
        FAST_PERSONA_ACCOUNT_NAME,
      ])
      : {};
    const secureOpenclawToken = secureSecrets[OPENCLAW_ACCOUNT_NAME] || '';
    const secureNanobotApiKey = secureSecrets[NANOBOT_ACCOUNT_NAME] || '';
    const secureAiModelApiKey = secureSecrets[AI_MODEL_ACCOUNT_NAME] || '';
    const secureDashscopeApiKey = secureSecrets[DASHSCOPE_ACCOUNT_NAME] || '';
    const secureFastPersonaApiKey = secureSecrets[FAST_PERSONA_ACCOUNT_NAME] || '';
    const legacyAiModelApiKey = legacySecrets.aiModelApiKey;
    const fallbackAiModelApiKey = legacyAiModelApiKey
      || secureFastPersonaApiKey
      || legacySecrets.fastPersonaApiKey
      || secureNanobotApiKey
      || legacySecrets.nanobotApiKey
      || '';

    this.secrets.openclawToken = secureOpenclawToken || legacySecrets.openclawToken || '';
    this.secrets.nanobotApiKey = secureNanobotApiKey || legacySecrets.nanobotApiKey || '';
    this.secrets.aiModelApiKey = secureAiModelApiKey || fallbackAiModelApiKey;
    this.secrets.dashscopeApiKey = secureDashscopeApiKey || legacySecrets.dashscopeApiKey || '';

    const migrationSecrets = {};
    if (!secureOpenclawToken && legacySecrets.openclawToken) {
      migrationSecrets[OPENCLAW_ACCOUNT_NAME] = legacySecrets.openclawToken;
    }
    if (!secureNanobotApiKey && legacySecrets.nanobotApiKey) {
      migrationSecrets[NANOBOT_ACCOUNT_NAME] = legacySecrets.nanobotApiKey;
    }
    if (!secureDashscopeApiKey && legacySecrets.dashscopeApiKey) {
      migrationSecrets[DASHSCOPE_ACCOUNT_NAME] = legacySecrets.dashscopeApiKey;
    }
    if (!secureAiModelApiKey && fallbackAiModelApiKey) {
      migrationSecrets[AI_MODEL_ACCOUNT_NAME] = fallbackAiModelApiKey;
    }
    if (this.hasSecureStorage && Object.keys(migrationSecrets).length > 0) {
      await this.safeSetSecrets(migrationSecrets);
      shouldPersist = true;
    }

    if (
      legacySecrets.openclawToken
      || legacySecrets.nanobotApiKey
      || legacySecrets.aiModelApiKey
      || legacySecrets.dashscopeApiKey
      || legacySecrets.fastPersonaApiKey
    ) {
      shouldPersist = true;
    }

    if (shouldPersist) {
      await this.persist();
    }
  }

  getPublic() {
    const hasOpenclawToken = Boolean(this.secrets.openclawToken);
    const hasNanobotApiKey = Boolean(this.secrets.nanobotApiKey);
    const hasAiModelApiKey = Boolean(this.secrets.aiModelApiKey);
    const hasDashscopeApiKey = Boolean(this.secrets.dashscopeApiKey);

    return {
      chatBackend: this.settings.chatBackend,
      openclaw: {
        ...this.settings.openclaw,
        hasToken: hasOpenclawToken,
      },
      nanobot: {
        ...this.settings.nanobot,
        hasApiKey: hasNanobotApiKey,
      },
      aiModel: {
        ...this.settings.aiModel,
        hasApiKey: hasAiModelApiKey,
      },
      claudeCode: cloneAcpBackendSettings(this.settings.claudeCode),
      codex: cloneAcpBackendSettings(this.settings.codex),
      fastPersona: { ...this.settings.fastPersona },
      voice: {
        ...this.settings.voice,
        dashscope: {
          ...this.settings.voice.dashscope,
          hasApiKey: hasDashscopeApiKey,
        },
      },
      ui: {
        ...this.settings.ui,
        onboarding: {
          ...(this.settings.ui?.onboarding || {}),
        },
        avatar: {
          ...(this.settings.ui?.avatar || {}),
          live2d: {
            ...(this.settings.ui?.avatar?.live2d || {}),
          },
          static: {
            ...(this.settings.ui?.avatar?.static || {}),
            hitTest: {
              ...(this.settings.ui?.avatar?.static?.hitTest || {}),
            },
          },
        },
        officeSceneLayout: {
          ...(this.settings.ui?.officeSceneLayout || {}),
          furnitureOverrides: {
            ...(this.settings.ui?.officeSceneLayout?.furnitureOverrides || {}),
          },
        },
        pixelPack: {
          ...(this.settings.ui?.pixelPack || {}),
          overrides: cloneJsonValue(this.settings.ui?.pixelPack?.overrides || {}),
        },
      },
      hasSecureStorage: this.hasSecureStorage,

      // Legacy flat fields for backward compatibility.
      baseUrl: this.settings.openclaw.baseUrl,
      agentId: this.settings.openclaw.agentId,
      hasToken: hasOpenclawToken,
      hasNanobotApiKey,
    };
  }

  getForMain() {
    return {
      chatBackend: this.settings.chatBackend,
      openclaw: {
        ...this.settings.openclaw,
        token: this.secrets.openclawToken,
      },
      nanobot: {
        ...this.settings.nanobot,
        apiKey: this.secrets.nanobotApiKey,
      },
      aiModel: {
        ...this.settings.aiModel,
        apiKey: this.secrets.aiModelApiKey,
      },
      claudeCode: cloneAcpBackendSettings(this.settings.claudeCode),
      codex: cloneAcpBackendSettings(this.settings.codex),
      fastPersona: { ...this.settings.fastPersona },
      voice: {
        ...this.settings.voice,
        dashscope: {
          ...this.settings.voice.dashscope,
          apiKey: this.secrets.dashscopeApiKey,
        },
      },
      ui: {
        ...this.settings.ui,
        onboarding: {
          ...(this.settings.ui?.onboarding || {}),
        },
        avatar: {
          ...(this.settings.ui?.avatar || {}),
          live2d: {
            ...(this.settings.ui?.avatar?.live2d || {}),
          },
          static: {
            ...(this.settings.ui?.avatar?.static || {}),
            hitTest: {
              ...(this.settings.ui?.avatar?.static?.hitTest || {}),
            },
          },
        },
        officeSceneLayout: {
          ...(this.settings.ui?.officeSceneLayout || {}),
          furnitureOverrides: {
            ...(this.settings.ui?.officeSceneLayout?.furnitureOverrides || {}),
          },
        },
        pixelPack: {
          ...(this.settings.ui?.pixelPack || {}),
          overrides: cloneJsonValue(this.settings.ui?.pixelPack?.overrides || {}),
        },
      },

      // Legacy flat fields for backward compatibility.
      baseUrl: this.settings.openclaw.baseUrl,
      agentId: this.settings.openclaw.agentId,
      token: this.secrets.openclawToken,
    };
  }

  async save(partialSettings = {}) {
    const patch = normalizePatch(partialSettings);

    if (Object.prototype.hasOwnProperty.call(patch, 'chatBackend')) {
      this.settings.chatBackend = patch.chatBackend;
    }

    if (isObject(patch.openclaw)) {
      this.settings.openclaw = normalizeOpenClawSettings({
        ...this.settings.openclaw,
        ...patch.openclaw,
      });
    }

    if (isObject(patch.nanobot)) {
      this.settings.nanobot = normalizeNanobotSettings({
        ...this.settings.nanobot,
        ...patch.nanobot,
      });
    }

    if (isObject(patch.aiModel)) {
      this.settings.aiModel = normalizeAiModelSettings({
        ...this.settings.aiModel,
        ...patch.aiModel,
      });
    }

    if (isObject(patch.claudeCode)) {
      this.settings.claudeCode = normalizeClaudeCodeSettings({
        ...this.settings.claudeCode,
        ...patch.claudeCode,
        runner: {
          ...(this.settings.claudeCode?.runner || {}),
          ...(patch.claudeCode?.runner || {}),
        },
      });
    }

    if (isObject(patch.codex)) {
      this.settings.codex = normalizeCodexSettings({
        ...this.settings.codex,
        ...patch.codex,
        runner: {
          ...(this.settings.codex?.runner || {}),
          ...(patch.codex?.runner || {}),
        },
      });
    }

    if (isObject(patch.fastPersona)) {
      this.settings.fastPersona = normalizeFastPersonaSettings({
        ...this.settings.fastPersona,
        ...patch.fastPersona,
      });
    }

    if (isObject(patch.voice)) {
      this.settings.voice = normalizeVoiceSettings({
        ...this.settings.voice,
        ...patch.voice,
        dashscope: {
          ...this.settings.voice.dashscope,
          ...(patch.voice.dashscope || {}),
        },
      });
    }

    if (isObject(patch.ui)) {
      this.settings.ui = normalizeUiSettings({
        ...this.settings.ui,
        ...patch.ui,
        onboarding: {
          ...(this.settings.ui?.onboarding || {}),
          ...(patch.ui.onboarding || {}),
        },
        avatar: {
          ...(this.settings.ui?.avatar || {}),
          ...(patch.ui.avatar || {}),
          live2d: {
            ...(this.settings.ui?.avatar?.live2d || {}),
            ...(patch.ui.avatar?.live2d || {}),
          },
          static: {
            ...(this.settings.ui?.avatar?.static || {}),
            ...(patch.ui.avatar?.static || {}),
            hitTest: {
              ...(this.settings.ui?.avatar?.static?.hitTest || {}),
              ...(patch.ui.avatar?.static?.hitTest || {}),
            },
          },
        },
        officeSceneLayout: {
          ...(this.settings.ui?.officeSceneLayout || {}),
          ...(patch.ui.officeSceneLayout || {}),
          furnitureOverrides: {
            ...(this.settings.ui?.officeSceneLayout?.furnitureOverrides || {}),
            ...(patch.ui.officeSceneLayout?.furnitureOverrides || {}),
          },
        },
        pixelPack: {
          ...(this.settings.ui?.pixelPack || {}),
          ...(patch.ui.pixelPack || {}),
          overrides: cloneJsonValue(
            patch.ui.pixelPack?.overrides || this.settings.ui?.pixelPack?.overrides || {},
          ),
        },
      });
    }

    if (patch.clearOpenclawToken) {
      this.secrets.openclawToken = '';
    } else if (Object.prototype.hasOwnProperty.call(patch, 'openclawToken') && patch.openclawToken) {
      this.secrets.openclawToken = patch.openclawToken;
    }

    if (patch.clearNanobotApiKey) {
      this.secrets.nanobotApiKey = '';
    } else if (Object.prototype.hasOwnProperty.call(patch, 'nanobotApiKey') && patch.nanobotApiKey) {
      this.secrets.nanobotApiKey = patch.nanobotApiKey;
    }

    if (patch.clearAiModelApiKey) {
      this.secrets.aiModelApiKey = '';
    } else if (Object.prototype.hasOwnProperty.call(patch, 'aiModelApiKey') && patch.aiModelApiKey) {
      this.secrets.aiModelApiKey = patch.aiModelApiKey;
    }

    if (patch.clearDashscopeApiKey) {
      this.secrets.dashscopeApiKey = '';
    } else if (Object.prototype.hasOwnProperty.call(patch, 'dashscopeApiKey') && patch.dashscopeApiKey) {
      this.secrets.dashscopeApiKey = patch.dashscopeApiKey;
    }

    if (this.hasSecureStorage) {
      const clearAccounts = [];
      const setSecrets = {};

      if (patch.clearOpenclawToken) {
        clearAccounts.push(OPENCLAW_ACCOUNT_NAME);
      } else if (Object.prototype.hasOwnProperty.call(patch, 'openclawToken') && patch.openclawToken) {
        setSecrets[OPENCLAW_ACCOUNT_NAME] = patch.openclawToken;
      }

      if (patch.clearNanobotApiKey) {
        clearAccounts.push(NANOBOT_ACCOUNT_NAME);
      } else if (Object.prototype.hasOwnProperty.call(patch, 'nanobotApiKey') && patch.nanobotApiKey) {
        setSecrets[NANOBOT_ACCOUNT_NAME] = patch.nanobotApiKey;
      }

      if (patch.clearAiModelApiKey) {
        clearAccounts.push(AI_MODEL_ACCOUNT_NAME);
      } else if (Object.prototype.hasOwnProperty.call(patch, 'aiModelApiKey') && patch.aiModelApiKey) {
        setSecrets[AI_MODEL_ACCOUNT_NAME] = patch.aiModelApiKey;
      }

      if (patch.clearDashscopeApiKey) {
        clearAccounts.push(DASHSCOPE_ACCOUNT_NAME);
      } else if (Object.prototype.hasOwnProperty.call(patch, 'dashscopeApiKey') && patch.dashscopeApiKey) {
        setSecrets[DASHSCOPE_ACCOUNT_NAME] = patch.dashscopeApiKey;
      }

      if (clearAccounts.length || Object.keys(setSecrets).length) {
        await this.safeUpdateSecrets({
          clear: clearAccounts,
          set: setSecrets,
        });
      }
    }

    await this.persist();
    return this.getPublic();
  }

  merge(overrideSettings = {}) {
    const patch = normalizePatch(overrideSettings);
    const merged = this.getForMain();

    if (Object.prototype.hasOwnProperty.call(patch, 'chatBackend')) {
      merged.chatBackend = patch.chatBackend;
    }

    if (isObject(patch.openclaw)) {
      merged.openclaw = normalizeOpenClawSettings({
        ...merged.openclaw,
        ...patch.openclaw,
      });
      merged.baseUrl = merged.openclaw.baseUrl;
      merged.agentId = merged.openclaw.agentId;
    }

    if (isObject(patch.nanobot)) {
      const existingNanobotApiKey =
        typeof merged.nanobot?.apiKey === 'string' ? merged.nanobot.apiKey : '';
      merged.nanobot = normalizeNanobotSettings({
        ...merged.nanobot,
        ...patch.nanobot,
      });
      merged.nanobot.apiKey = existingNanobotApiKey;
    }

    if (isObject(patch.aiModel)) {
      const existingAiModelApiKey =
        typeof merged.aiModel?.apiKey === 'string' ? merged.aiModel.apiKey : '';
      merged.aiModel = normalizeAiModelSettings({
        ...merged.aiModel,
        ...patch.aiModel,
      });
      merged.aiModel.apiKey = existingAiModelApiKey;
    }

    if (isObject(patch.claudeCode)) {
      merged.claudeCode = normalizeClaudeCodeSettings({
        ...merged.claudeCode,
        ...patch.claudeCode,
        runner: {
          ...(merged.claudeCode?.runner || {}),
          ...(patch.claudeCode?.runner || {}),
        },
      });
    }

    if (isObject(patch.codex)) {
      merged.codex = normalizeCodexSettings({
        ...merged.codex,
        ...patch.codex,
        runner: {
          ...(merged.codex?.runner || {}),
          ...(patch.codex?.runner || {}),
        },
      });
    }

    if (isObject(patch.fastPersona)) {
      const existingFastPersonaApiKey =
        typeof merged.fastPersona?.apiKey === 'string' ? merged.fastPersona.apiKey : '';
      merged.fastPersona = normalizeFastPersonaSettings({
        ...merged.fastPersona,
        ...patch.fastPersona,
      });
      merged.fastPersona.apiKey = existingFastPersonaApiKey;
    }

    if (isObject(patch.voice)) {
      const existingDashscopeApiKey =
        typeof merged.voice?.dashscope?.apiKey === 'string' ? merged.voice.dashscope.apiKey : '';
      merged.voice = normalizeVoiceSettings({
        ...merged.voice,
        ...patch.voice,
        dashscope: {
          ...(merged.voice?.dashscope || {}),
          ...(patch.voice.dashscope || {}),
        },
      });
      merged.voice.dashscope.apiKey = existingDashscopeApiKey;
    }

    if (isObject(patch.ui)) {
      merged.ui = normalizeUiSettings({
        ...merged.ui,
        ...patch.ui,
        onboarding: {
          ...(merged.ui?.onboarding || {}),
          ...(patch.ui.onboarding || {}),
        },
        avatar: {
          ...(merged.ui?.avatar || {}),
          ...(patch.ui.avatar || {}),
          live2d: {
            ...(merged.ui?.avatar?.live2d || {}),
            ...(patch.ui.avatar?.live2d || {}),
          },
          static: {
            ...(merged.ui?.avatar?.static || {}),
            ...(patch.ui.avatar?.static || {}),
            hitTest: {
              ...(merged.ui?.avatar?.static?.hitTest || {}),
              ...(patch.ui.avatar?.static?.hitTest || {}),
            },
          },
        },
        officeSceneLayout: {
          ...(merged.ui?.officeSceneLayout || {}),
          ...(patch.ui.officeSceneLayout || {}),
          furnitureOverrides: {
            ...(merged.ui?.officeSceneLayout?.furnitureOverrides || {}),
            ...(patch.ui.officeSceneLayout?.furnitureOverrides || {}),
          },
        },
        pixelPack: {
          ...(merged.ui?.pixelPack || {}),
          ...(patch.ui.pixelPack || {}),
          overrides: cloneJsonValue(
            patch.ui.pixelPack?.overrides || merged.ui?.pixelPack?.overrides || {},
          ),
        },
      });
    }

    if (patch.clearOpenclawToken) {
      merged.openclaw.token = '';
      merged.token = '';
    } else if (Object.prototype.hasOwnProperty.call(patch, 'openclawToken') && patch.openclawToken) {
      merged.openclaw.token = patch.openclawToken;
      merged.token = patch.openclawToken;
    }

    if (patch.clearNanobotApiKey) {
      merged.nanobot.apiKey = '';
    } else if (Object.prototype.hasOwnProperty.call(patch, 'nanobotApiKey') && patch.nanobotApiKey) {
      merged.nanobot.apiKey = patch.nanobotApiKey;
    }

    if (patch.clearAiModelApiKey) {
      merged.aiModel.apiKey = '';
    } else if (Object.prototype.hasOwnProperty.call(patch, 'aiModelApiKey') && patch.aiModelApiKey) {
      merged.aiModel.apiKey = patch.aiModelApiKey;
    }

    if (patch.clearDashscopeApiKey) {
      merged.voice.dashscope.apiKey = '';
    } else if (Object.prototype.hasOwnProperty.call(patch, 'dashscopeApiKey') && patch.dashscopeApiKey) {
      merged.voice.dashscope.apiKey = patch.dashscopeApiKey;
    }

    return merged;
  }

  getVoiceRuntimeEnv(baseEnv = process.env) {
    const env = {
      ...(baseEnv || {}),
    };
    const voiceSettings = this.getForMain().voice || {};
    const dashscope = voiceSettings.dashscope || {};

    if (voiceSettings.asrProvider === 'dashscope') {
      env.VOICE_ASR_PROVIDER = 'dashscope';
      env.VOICE_DASHSCOPE_API_KEY = dashscope.apiKey || '';
      env.VOICE_ASR_DASHSCOPE_API_KEY = dashscope.apiKey || '';
      env.VOICE_DASHSCOPE_WORKSPACE = dashscope.workspace || '';
      env.VOICE_ASR_DASHSCOPE_WORKSPACE = dashscope.workspace || '';
      env.VOICE_DASHSCOPE_BASE_URL = dashscope.baseUrl || '';
      env.VOICE_ASR_DASHSCOPE_BASE_URL = dashscope.baseUrl || '';
      env.VOICE_ASR_DASHSCOPE_MODEL = dashscope.asrModel || '';
      env.VOICE_ASR_DASHSCOPE_LANGUAGE = dashscope.asrLanguage || '';
    }

    if (voiceSettings.ttsProvider === 'dashscope') {
      env.VOICE_TTS_PROVIDER = 'dashscope';
      env.VOICE_DASHSCOPE_API_KEY = dashscope.apiKey || '';
      env.VOICE_TTS_DASHSCOPE_API_KEY = dashscope.apiKey || '';
      env.VOICE_DASHSCOPE_WORKSPACE = dashscope.workspace || '';
      env.VOICE_TTS_DASHSCOPE_WORKSPACE = dashscope.workspace || '';
      env.VOICE_DASHSCOPE_BASE_URL = dashscope.baseUrl || '';
      env.VOICE_TTS_DASHSCOPE_BASE_URL = dashscope.baseUrl || '';
      env.VOICE_TTS_DASHSCOPE_MODEL = dashscope.ttsModel || '';
      env.VOICE_TTS_DASHSCOPE_VOICE = dashscope.ttsVoice || '';
      env.VOICE_TTS_DASHSCOPE_LANGUAGE = dashscope.ttsLanguage || '';
      env.VOICE_TTS_DASHSCOPE_RESPONSE_FORMAT = 'pcm';
      env.VOICE_TTS_DASHSCOPE_SAMPLE_RATE = String(dashscope.ttsSampleRate || '');
      env.VOICE_TTS_DASHSCOPE_SPEECH_RATE = String(dashscope.ttsSpeechRate || '');
    }

    return env;
  }

  async persist() {
    const filePayload = cloneSettings(this.settings);

    if (!this.hasSecureStorage) {
      if (this.secrets.openclawToken) {
        filePayload.openclaw.token = this.secrets.openclawToken;
      }
      if (this.secrets.nanobotApiKey) {
        filePayload.nanobot.apiKey = this.secrets.nanobotApiKey;
      }
      if (this.secrets.aiModelApiKey) {
        filePayload.aiModel.apiKey = this.secrets.aiModelApiKey;
      }
      if (this.secrets.dashscopeApiKey) {
        filePayload.voice.dashscope.apiKey = this.secrets.dashscopeApiKey;
      }
    }

    await fs.writeFile(this.filePath, JSON.stringify(filePayload, null, 2), 'utf-8');
  }

  async safeGetSecret(accountName) {
    try {
      if (typeof this.secretStore.getSecret === 'function') {
        return normalizeSecretValue(await this.secretStore.getSecret(accountName));
      }
      if (accountName === OPENCLAW_ACCOUNT_NAME && typeof this.secretStore.getToken === 'function') {
        return normalizeSecretValue(await this.secretStore.getToken());
      }
      return '';
    } catch (error) {
      console.warn('Failed to read token from secure storage, falling back to local file:', error);
      this.hasSecureStorage = false;
      return '';
    }
  }

  async safeGetSecrets(accountNames) {
    try {
      if (typeof this.secretStore.getSecrets === 'function') {
        const secrets = await this.secretStore.getSecrets(accountNames);
        return Object.fromEntries(
          (Array.isArray(accountNames) ? accountNames : [])
            .map((accountName) => [accountName, normalizeSecretValue(secrets?.[accountName])]),
        );
      }

      const result = {};
      for (const accountName of Array.isArray(accountNames) ? accountNames : []) {
        result[accountName] = await this.safeGetSecret(accountName);
      }
      return result;
    } catch (error) {
      console.warn('Failed to read tokens from secure storage, falling back to local file:', error);
      this.hasSecureStorage = false;
      return {};
    }
  }

  async safeSetSecret(accountName, value) {
    try {
      if (typeof this.secretStore.setSecret === 'function') {
        const stored = await this.secretStore.setSecret(accountName, value);
        if (!stored) {
          this.hasSecureStorage = false;
        }
        return stored;
      }
      if (accountName === OPENCLAW_ACCOUNT_NAME && typeof this.secretStore.setToken === 'function') {
        const stored = await this.secretStore.setToken(value);
        if (!stored) {
          this.hasSecureStorage = false;
        }
        return stored;
      }
      this.hasSecureStorage = false;
      return false;
    } catch (error) {
      console.warn('Failed to write token into secure storage, falling back to local file:', error);
      this.hasSecureStorage = false;
      return false;
    }
  }

  async safeSetSecrets(secretMap = {}) {
    const entries = Object.entries(isObject(secretMap) ? secretMap : {}).filter(([accountName, value]) => {
      return Boolean(normalizeString(accountName)) && Boolean(normalizeSecretValue(value));
    });
    if (!entries.length) {
      return true;
    }

    try {
      if (typeof this.secretStore.setSecrets === 'function') {
        const stored = await this.secretStore.setSecrets(Object.fromEntries(entries));
        if (!stored) {
          this.hasSecureStorage = false;
        }
        return stored;
      }

      for (const [accountName, value] of entries) {
        const stored = await this.safeSetSecret(accountName, value);
        if (!stored) {
          this.hasSecureStorage = false;
          return false;
        }
      }
      return true;
    } catch (error) {
      console.warn('Failed to write tokens into secure storage, falling back to local file:', error);
      this.hasSecureStorage = false;
      return false;
    }
  }

  async safeUpdateSecrets({ set = {}, clear = [] } = {}) {
    const setEntries = Object.entries(isObject(set) ? set : {}).filter(([accountName, value]) => {
      return Boolean(normalizeString(accountName)) && Boolean(normalizeSecretValue(value));
    });
    const clearAccounts = (Array.isArray(clear) ? clear : [])
      .map((accountName) => normalizeString(accountName))
      .filter(Boolean);

    if (!setEntries.length && !clearAccounts.length) {
      return true;
    }

    try {
      if (typeof this.secretStore.updateSecrets === 'function') {
        const updated = await this.secretStore.updateSecrets({
          set: Object.fromEntries(setEntries),
          clear: clearAccounts,
        });
        if (!updated) {
          this.hasSecureStorage = false;
        }
        return updated;
      }

      for (const accountName of clearAccounts) {
        const deleted = await this.safeDeleteSecret(accountName);
        if (!deleted) {
          this.hasSecureStorage = false;
          return false;
        }
      }

      for (const [accountName, value] of setEntries) {
        const stored = await this.safeSetSecret(accountName, value);
        if (!stored) {
          this.hasSecureStorage = false;
          return false;
        }
      }

      return true;
    } catch (error) {
      console.warn('Failed to update tokens in secure storage, falling back to local file:', error);
      this.hasSecureStorage = false;
      return false;
    }
  }

  async safeDeleteSecret(accountName) {
    try {
      if (typeof this.secretStore.deleteSecret === 'function') {
        const deleted = await this.secretStore.deleteSecret(accountName);
        if (!deleted) {
          this.hasSecureStorage = false;
        }
        return deleted;
      }
      if (accountName === OPENCLAW_ACCOUNT_NAME && typeof this.secretStore.deleteToken === 'function') {
        const deleted = await this.secretStore.deleteToken();
        if (!deleted) {
          this.hasSecureStorage = false;
        }
        return deleted;
      }
      this.hasSecureStorage = false;
      return false;
    } catch (error) {
      console.warn('Failed to delete token from secure storage:', error);
      this.hasSecureStorage = false;
      return false;
    }
  }
}

module.exports = {
  SettingsStore,
};
