const fs = require('node:fs/promises');
const path = require('node:path');

const {
  KeytarSecretStore,
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
  provider: 'openrouter',
  model: 'anthropic/claude-opus-4-5',
  apiBase: '',
  maxTokens: 4096,
  temperature: 0.2,
  reasoningEffort: '',
};

const DEFAULT_VOICE_SETTINGS = {
  pttHotkey: 'F8',
};

const DEFAULT_SETTINGS = {
  chatBackend: 'openclaw',
  openclaw: { ...DEFAULT_OPENCLAW_SETTINGS },
  nanobot: { ...DEFAULT_NANOBOT_SETTINGS },
  voice: { ...DEFAULT_VOICE_SETTINGS },
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
    provider: normalizeString(settings.provider, DEFAULT_NANOBOT_SETTINGS.provider),
    model: normalizeString(settings.model, DEFAULT_NANOBOT_SETTINGS.model),
    apiBase: normalizeString(settings.apiBase, DEFAULT_NANOBOT_SETTINGS.apiBase),
    maxTokens: toPositiveInteger(settings.maxTokens, DEFAULT_NANOBOT_SETTINGS.maxTokens),
    temperature: toFiniteNumber(settings.temperature, DEFAULT_NANOBOT_SETTINGS.temperature),
    reasoningEffort: normalizeString(settings.reasoningEffort, DEFAULT_NANOBOT_SETTINGS.reasoningEffort),
  };
}

function normalizeVoicePttHotkey(value) {
  const normalized = normalizeString(value).toUpperCase();
  if (normalized === ' ' || normalized === 'SPACE') {
    return 'SPACE';
  }
  if (/^F([1-9]|1[0-2])$/.test(normalized)) {
    return normalized;
  }
  return DEFAULT_VOICE_SETTINGS.pttHotkey;
}

function normalizeVoiceSettings(settings = {}) {
  return {
    pttHotkey: normalizeVoicePttHotkey(settings.pttHotkey),
  };
}

function cloneSettings(settings) {
  return {
    chatBackend: settings.chatBackend,
    openclaw: { ...settings.openclaw },
    nanobot: { ...settings.nanobot },
    voice: { ...settings.voice },
  };
}

function isNextGenSettingsShape(settings = {}) {
  return (
    Object.prototype.hasOwnProperty.call(settings, 'chatBackend')
    || Object.prototype.hasOwnProperty.call(settings, 'openclaw')
    || Object.prototype.hasOwnProperty.call(settings, 'nanobot')
    || Object.prototype.hasOwnProperty.call(settings, 'voice')
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
    };
  }

  return {
    chatBackend: 'openclaw',
    openclaw: normalizeOpenClawSettings(source),
    nanobot: { ...DEFAULT_NANOBOT_SETTINGS },
    voice: { ...DEFAULT_VOICE_SETTINGS },
  };
}

function normalizeSecretValue(value) {
  return normalizeString(value, '');
}

function extractLegacySecrets(settings = {}) {
  const source = isObject(settings) ? settings : {};
  const openclaw = isObject(source.openclaw) ? source.openclaw : {};
  const nanobot = isObject(source.nanobot) ? source.nanobot : {};

  return {
    openclawToken: normalizeSecretValue(openclaw.token || source.token),
    nanobotApiKey: normalizeSecretValue(nanobot.apiKey || source.nanobotApiKey),
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
  if (Object.prototype.hasOwnProperty.call(voiceSource, 'pttHotkey')) {
    voicePatch.pttHotkey = normalizeVoicePttHotkey(voiceSource.pttHotkey);
  }
  if (Object.keys(voicePatch).length > 0) {
    patch.voice = voicePatch;
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
    const secureOpenclawToken = this.hasSecureStorage ? await this.safeGetSecret(OPENCLAW_ACCOUNT_NAME) : '';
    const secureNanobotApiKey = this.hasSecureStorage ? await this.safeGetSecret(NANOBOT_ACCOUNT_NAME) : '';

    this.secrets.openclawToken = secureOpenclawToken || legacySecrets.openclawToken || '';
    this.secrets.nanobotApiKey = secureNanobotApiKey || legacySecrets.nanobotApiKey || '';

    if (this.hasSecureStorage && !secureOpenclawToken && legacySecrets.openclawToken) {
      await this.safeSetSecret(OPENCLAW_ACCOUNT_NAME, legacySecrets.openclawToken);
      shouldPersist = true;
    }

    if (this.hasSecureStorage && !secureNanobotApiKey && legacySecrets.nanobotApiKey) {
      await this.safeSetSecret(NANOBOT_ACCOUNT_NAME, legacySecrets.nanobotApiKey);
      shouldPersist = true;
    }

    if (legacySecrets.openclawToken || legacySecrets.nanobotApiKey) {
      shouldPersist = true;
    }

    if (shouldPersist) {
      await this.persist();
    }
  }

  getPublic() {
    const hasOpenclawToken = Boolean(this.secrets.openclawToken);
    const hasNanobotApiKey = Boolean(this.secrets.nanobotApiKey);

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
      });
    }

    if (patch.clearOpenclawToken) {
      this.secrets.openclawToken = '';
      if (this.hasSecureStorage) {
        await this.safeDeleteSecret(OPENCLAW_ACCOUNT_NAME);
      }
    } else if (Object.prototype.hasOwnProperty.call(patch, 'openclawToken') && patch.openclawToken) {
      this.secrets.openclawToken = patch.openclawToken;
      if (this.hasSecureStorage) {
        await this.safeSetSecret(OPENCLAW_ACCOUNT_NAME, patch.openclawToken);
      }
    }

    if (patch.clearNanobotApiKey) {
      this.secrets.nanobotApiKey = '';
      if (this.hasSecureStorage) {
        await this.safeDeleteSecret(NANOBOT_ACCOUNT_NAME);
      }
    } else if (Object.prototype.hasOwnProperty.call(patch, 'nanobotApiKey') && patch.nanobotApiKey) {
      this.secrets.nanobotApiKey = patch.nanobotApiKey;
      if (this.hasSecureStorage) {
        await this.safeSetSecret(NANOBOT_ACCOUNT_NAME, patch.nanobotApiKey);
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
      merged.voice = normalizeVoiceSettings({
        ...merged.voice,
        ...patch.voice,
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

    return merged;
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
