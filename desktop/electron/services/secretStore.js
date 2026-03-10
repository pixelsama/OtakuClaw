const SERVICE_NAME = 'free-agent-vtuber-openclaw';
const OPENCLAW_ACCOUNT_NAME = 'openclaw-token';
const NANOBOT_ACCOUNT_NAME = 'nanobot-api-key';
const DASHSCOPE_ACCOUNT_NAME = 'dashscope-api-key';
const BUNDLED_ACCOUNT_NAME = 'secrets-bundle-v1';

function normalizeAccountName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAccountNames(accountNames = []) {
  const normalized = Array.isArray(accountNames)
    ? accountNames
      .map((value) => normalizeAccountName(value))
      .filter(Boolean)
    : [];
  return [...new Set(normalized)];
}

function normalizeSecretValue(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value;
}

function parseSecretBundle(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed).reduce((result, [key, value]) => {
      const accountName = normalizeAccountName(key);
      const secretValue = normalizeSecretValue(value);
      if (!accountName || !secretValue) {
        return result;
      }
      result[accountName] = secretValue;
      return result;
    }, {});
  } catch (error) {
    console.warn('Failed to parse keychain secret bundle, ignoring bundle:', error?.message || error);
    return {};
  }
}

class KeytarSecretStore {
  constructor() {
    this.keytar = null;
    this.keytarLoadAttempted = false;
    this.bundleLoaded = false;
    this.bundleExists = false;
    this.bundleSecrets = {};
  }

  isAvailable() {
    return Boolean(this.loadKeytar());
  }

  loadKeytar() {
    if (this.keytarLoadAttempted) {
      return this.keytar;
    }

    this.keytarLoadAttempted = true;
    try {
      // keytar is optional at runtime. If unavailable, we gracefully fall back.
      // eslint-disable-next-line global-require
      this.keytar = require('keytar');
    } catch (error) {
      console.warn('keytar is unavailable, falling back to insecure token storage:', error?.message || error);
      this.keytar = null;
    }

    return this.keytar;
  }

  async getSecret(accountName) {
    const account = normalizeAccountName(accountName);
    if (!account) {
      return null;
    }

    const secrets = await this.getSecrets([account]);
    return secrets[account] || null;
  }

  async getSecrets(accountNames = []) {
    const keytar = this.loadKeytar();
    if (!keytar) {
      return {};
    }

    const requestedAccounts = normalizeAccountNames(accountNames);
    if (!requestedAccounts.length) {
      return {};
    }

    const bundle = await this.loadBundle({ keytar });

    return requestedAccounts.reduce((result, account) => {
      result[account] = normalizeSecretValue(bundle[account]) || null;
      return result;
    }, {});
  }

  async setSecret(accountName, value) {
    const account = normalizeAccountName(accountName);
    if (!account) {
      return false;
    }

    return this.updateSecrets({
      set: {
        [account]: value,
      },
    });
  }

  async setSecrets(secretMap = {}) {
    return this.updateSecrets({
      set: secretMap,
    });
  }

  async deleteSecret(accountName) {
    const account = normalizeAccountName(accountName);
    if (!account) {
      return false;
    }

    return this.updateSecrets({
      clear: [account],
    });
  }

  async deleteSecrets(accountNames = []) {
    const accounts = normalizeAccountNames(accountNames);
    if (!accounts.length) {
      return false;
    }

    return this.updateSecrets({
      clear: accounts,
    });
  }

  async updateSecrets({ set = {}, clear = [] } = {}) {
    const keytar = this.loadKeytar();
    if (!keytar) {
      return false;
    }

    const setEntries = Object.entries(set || {}).reduce((result, [key, value]) => {
      const account = normalizeAccountName(key);
      if (!account) {
        return result;
      }

      const secretValue = normalizeSecretValue(value);
      if (!secretValue) {
        return result;
      }

      result[account] = secretValue;
      return result;
    }, {});
    const clearAccounts = normalizeAccountNames(clear);

    if (!Object.keys(setEntries).length && !clearAccounts.length) {
      return true;
    }

    const bundle = await this.loadBundle({ keytar });
    const nextBundle = {
      ...bundle,
      ...setEntries,
    };

    for (const account of clearAccounts) {
      delete nextBundle[account];
    }

    await keytar.setPassword(SERVICE_NAME, BUNDLED_ACCOUNT_NAME, JSON.stringify(nextBundle));
    this.bundleLoaded = true;
    this.bundleExists = true;
    this.bundleSecrets = nextBundle;
    return true;
  }

  async getToken() {
    return this.getSecret(OPENCLAW_ACCOUNT_NAME);
  }

  async setToken(token) {
    return this.setSecret(OPENCLAW_ACCOUNT_NAME, token);
  }

  async deleteToken() {
    return this.deleteSecret(OPENCLAW_ACCOUNT_NAME);
  }

  async loadBundle({ keytar } = {}) {
    if (!this.bundleLoaded) {
      const rawBundle = await keytar.getPassword(SERVICE_NAME, BUNDLED_ACCOUNT_NAME);
      this.bundleLoaded = true;
      this.bundleExists = Boolean(typeof rawBundle === 'string' && rawBundle.trim());
      this.bundleSecrets = parseSecretBundle(rawBundle);
    }

    return this.bundleSecrets;
  }
}

module.exports = {
  DASHSCOPE_ACCOUNT_NAME,
  OPENCLAW_ACCOUNT_NAME,
  NANOBOT_ACCOUNT_NAME,
  BUNDLED_ACCOUNT_NAME,
  KeytarSecretStore,
};
