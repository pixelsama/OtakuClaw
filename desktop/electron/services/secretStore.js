const SERVICE_NAME = 'free-agent-vtuber-openclaw';
const ACCOUNT_NAME = 'openclaw-token';

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

  async getToken() {
    const keytar = this.loadKeytar();
    if (!keytar) {
      return null;
    }

    const token = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
    return token || null;
  }

  async setToken(token) {
    const keytar = this.loadKeytar();
    if (!keytar) {
      return false;
    }

    await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, token);
    return true;
  }

  async deleteToken() {
    const keytar = this.loadKeytar();
    if (!keytar) {
      return false;
    }

    await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
    return true;
  }
}

module.exports = {
  KeytarSecretStore,
};
