const fs = require('node:fs/promises');
const path = require('node:path');

const { KeytarSecretStore } = require('./secretStore');

const SETTINGS_FILE = 'openclaw-settings.json';
const DEFAULT_SETTINGS = {
  baseUrl: 'http://127.0.0.1:18789',
  agentId: 'main',
};

function normalizeFileSettings(settings = {}) {
  const next = {};

  if (Object.prototype.hasOwnProperty.call(settings, 'baseUrl')) {
    next.baseUrl = typeof settings.baseUrl === 'string' ? settings.baseUrl.trim() : '';
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'agentId')) {
    next.agentId = typeof settings.agentId === 'string' ? settings.agentId.trim() : '';
  }

  return next;
}

function normalizePatch(partialSettings = {}) {
  const next = {};

  if (Object.prototype.hasOwnProperty.call(partialSettings, 'baseUrl')) {
    next.baseUrl = typeof partialSettings.baseUrl === 'string' ? partialSettings.baseUrl.trim() : '';
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, 'agentId')) {
    next.agentId = typeof partialSettings.agentId === 'string' ? partialSettings.agentId.trim() : '';
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, 'token')) {
    next.token = typeof partialSettings.token === 'string' ? partialSettings.token.trim() : '';
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, 'clearToken')) {
    next.clearToken = Boolean(partialSettings.clearToken);
  }

  return next;
}

function sanitizeTokenValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

class SettingsStore {
  constructor(app, secretStore = new KeytarSecretStore()) {
    this.app = app;
    this.secretStore = secretStore;
    this.filePath = path.join(this.app.getPath('userData'), SETTINGS_FILE);

    this.settings = { ...DEFAULT_SETTINGS };
    this.token = '';
    this.hasSecureStorage = this.secretStore.isAvailable();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    let parsed = null;
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      parsed = JSON.parse(raw);
      this.settings = {
        ...DEFAULT_SETTINGS,
        ...normalizeFileSettings(parsed),
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to load settings file:', error);
      }
      await this.persist();
    }

    this.hasSecureStorage = this.secretStore.isAvailable();

    const keychainToken = sanitizeTokenValue(await this.secretStore.getToken());
    const legacyToken = sanitizeTokenValue(parsed?.token);

    if (keychainToken) {
      this.token = keychainToken;
    } else if (legacyToken) {
      const stored = await this.secretStore.setToken(legacyToken);
      this.hasSecureStorage = this.hasSecureStorage && stored;
      this.token = legacyToken;
    } else {
      this.token = '';
    }

    if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'token') && this.hasSecureStorage) {
      await this.persist();
    }
  }

  getPublic() {
    return {
      ...this.settings,
      hasToken: Boolean(this.token),
      hasSecureStorage: this.hasSecureStorage,
    };
  }

  getForMain() {
    return {
      ...this.settings,
      token: this.token,
    };
  }

  async save(partialSettings = {}) {
    const patch = normalizePatch(partialSettings);

    if (Object.prototype.hasOwnProperty.call(patch, 'baseUrl')) {
      this.settings.baseUrl = patch.baseUrl;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'agentId')) {
      this.settings.agentId = patch.agentId;
    }

    if (patch.clearToken === true) {
      this.token = '';
      if (this.hasSecureStorage) {
        await this.secretStore.deleteToken();
      }
    } else if (Object.prototype.hasOwnProperty.call(patch, 'token') && patch.token) {
      this.token = patch.token;
      if (this.hasSecureStorage) {
        const stored = await this.secretStore.setToken(patch.token);
        this.hasSecureStorage = this.hasSecureStorage && stored;
      }
    }

    await this.persist();
    return this.getPublic();
  }

  merge(overrideSettings = {}) {
    const patch = normalizePatch(overrideSettings);
    const merged = {
      ...this.getForMain(),
    };

    if (Object.prototype.hasOwnProperty.call(patch, 'baseUrl')) {
      merged.baseUrl = patch.baseUrl;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'agentId')) {
      merged.agentId = patch.agentId;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'token') && patch.token) {
      merged.token = patch.token;
    }

    if (patch.clearToken === true) {
      merged.token = '';
    }

    return merged;
  }

  async persist() {
    const filePayload = {
      ...this.settings,
    };

    if (!this.hasSecureStorage && this.token) {
      filePayload.token = this.token;
    }

    await fs.writeFile(this.filePath, JSON.stringify(filePayload, null, 2), 'utf-8');
  }
}

module.exports = {
  SettingsStore,
};
