const fs = require('node:fs/promises');
const path = require('node:path');

const {
  KeytarSecretStore,
  DASHSCOPE_ACCOUNT_NAME,
  OPENCLAW_ACCOUNT_NAME,
  NANOBOT_ACCOUNT_NAME,
} = require('./secretStore');

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

const DEFAULT_UI_SETTINGS = {
  onboarding: {
    completed: false,
    completedAt: '',
  },
};

const DEFAULT_SETTINGS = {
  chatBackend: 'openclaw',
  openclaw: { ...DEFAULT_OPENCLAW_SETTINGS },
  nanobot: { ...DEFAULT_NANOBOT_SETTINGS },
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

function normalizeChatBackend(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'nanobot') {
    return 'nanobot';
  }
  return 'openclaw';
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

function normalizeUiSettings(settings = {}) {
  const onboarding = isObject(settings.onboarding) ? settings.onboarding : {};
  return {
    onboarding: normalizeOnboardingSettings(onboarding),
  };
}

function cloneSettings(settings) {
  return {
    chatBackend: settings.chatBackend,
    openclaw: { ...settings.openclaw },
    nanobot: { ...settings.nanobot },
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
    },
  };
}

function isNextGenSettingsShape(settings = {}) {
  return (
    Object.prototype.hasOwnProperty.call(settings, 'chatBackend')
    || Object.prototype.hasOwnProperty.call(settings, 'openclaw')
    || Object.prototype.hasOwnProperty.call(settings, 'nanobot')
    || Object.prototype.hasOwnProperty.call(settings, 'voice')
    || Object.prototype.hasOwnProperty.call(settings, 'ui')
  );
}

function normalizeFileSettings(settings = {}) {
  const source = isObject(settings) ? settings : {};

  if (isNextGenSettingsShape(source)) {
    return {
      chatBackend: normalizeChatBackend(source.chatBackend),
      openclaw: normalizeOpenClawSettings(isObject(source.openclaw) ? source.openclaw : source),
      nanobot: normalizeNanobotSettings(isObject(source.nanobot) ? source.nanobot : {}),
      voice: normalizeVoiceSettings(isObject(source.voice) ? source.voice : {}),
      ui: normalizeUiSettings(isObject(source.ui) ? source.ui : {}),
    };
  }

  return {
    chatBackend: 'openclaw',
    openclaw: normalizeOpenClawSettings(source),
    nanobot: { ...DEFAULT_NANOBOT_SETTINGS },
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
  const voice = isObject(source.voice) ? source.voice : {};
  const dashscope = isObject(voice.dashscope) ? voice.dashscope : {};

  return {
    openclawToken: normalizeSecretValue(openclaw.token || source.token),
    nanobotApiKey: normalizeSecretValue(nanobot.apiKey || source.nanobotApiKey),
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
  const onboardingPatch = {};
  if (Object.prototype.hasOwnProperty.call(onboardingSource, 'completed')) {
    onboardingPatch.completed = Boolean(onboardingSource.completed);
  }
  if (Object.prototype.hasOwnProperty.call(onboardingSource, 'completedAt')) {
    onboardingPatch.completedAt = normalizeString(onboardingSource.completedAt);
  }
  if (Object.keys(onboardingPatch).length > 0) {
    uiPatch.onboarding = onboardingPatch;
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
      ? await this.safeGetSecrets([OPENCLAW_ACCOUNT_NAME, NANOBOT_ACCOUNT_NAME, DASHSCOPE_ACCOUNT_NAME])
      : {};
    const secureOpenclawToken = secureSecrets[OPENCLAW_ACCOUNT_NAME] || '';
    const secureNanobotApiKey = secureSecrets[NANOBOT_ACCOUNT_NAME] || '';
    const secureDashscopeApiKey = secureSecrets[DASHSCOPE_ACCOUNT_NAME] || '';

    this.secrets.openclawToken = secureOpenclawToken || legacySecrets.openclawToken || '';
    this.secrets.nanobotApiKey = secureNanobotApiKey || legacySecrets.nanobotApiKey || '';
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
    if (this.hasSecureStorage && Object.keys(migrationSecrets).length > 0) {
      await this.safeSetSecrets(migrationSecrets);
      shouldPersist = true;
    }

    if (legacySecrets.openclawToken || legacySecrets.nanobotApiKey || legacySecrets.dashscopeApiKey) {
      shouldPersist = true;
    }

    if (shouldPersist) {
      await this.persist();
    }
  }

  getPublic() {
    const hasOpenclawToken = Boolean(this.secrets.openclawToken);
    const hasNanobotApiKey = Boolean(this.secrets.nanobotApiKey);
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
