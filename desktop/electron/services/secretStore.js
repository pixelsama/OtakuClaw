const SERVICE_NAME = 'free-agent-vtuber-openclaw';
const OPENCLAW_ACCOUNT_NAME = 'openclaw-token';
const NANOBOT_ACCOUNT_NAME = 'nanobot-api-key';
const DASHSCOPE_ACCOUNT_NAME = 'dashscope-api-key';

class KeytarSecretStore {
  constructor() {
    this.keytar = null;
    this.keytarLoadAttempted = false;
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
    const account = typeof accountName === 'string' ? accountName.trim() : '';
    if (!account) {
      return null;
    }

    const keytar = this.loadKeytar();
    if (!keytar) {
      return null;
    }

    const token = await keytar.getPassword(SERVICE_NAME, account);
    return token || null;
  }

  async getSecrets(accountNames = []) {
    const keytar = this.loadKeytar();
    if (!keytar) {
      return {};
    }

    const requestedAccounts = Array.isArray(accountNames)
      ? accountNames
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
      : [];

    if (!requestedAccounts.length) {
      return {};
    }

    if (typeof keytar.findCredentials === 'function') {
      const credentials = await keytar.findCredentials(SERVICE_NAME);
      const accountSet = new Set(requestedAccounts);
      return credentials.reduce((result, entry = {}) => {
        const account = typeof entry.account === 'string' ? entry.account.trim() : '';
        if (!account || !accountSet.has(account)) {
          return result;
        }

        result[account] = entry.password || null;
        return result;
      }, {});
    }

    const result = {};
    for (const account of requestedAccounts) {
      result[account] = await keytar.getPassword(SERVICE_NAME, account);
    }
    return result;
  }

  async setSecret(accountName, value) {
    const account = typeof accountName === 'string' ? accountName.trim() : '';
    if (!account) {
      return false;
    }

    const keytar = this.loadKeytar();
    if (!keytar) {
      return false;
    }

    await keytar.setPassword(SERVICE_NAME, account, value);
    return true;
  }

  async deleteSecret(accountName) {
    const account = typeof accountName === 'string' ? accountName.trim() : '';
    if (!account) {
      return false;
    }

    const keytar = this.loadKeytar();
    if (!keytar) {
      return false;
    }

    await keytar.deletePassword(SERVICE_NAME, account);
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
}

module.exports = {
  DASHSCOPE_ACCOUNT_NAME,
  OPENCLAW_ACCOUNT_NAME,
  NANOBOT_ACCOUNT_NAME,
  KeytarSecretStore,
};
