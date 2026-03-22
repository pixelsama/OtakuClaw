class ResourceLockManager {
  constructor() {
    this.tails = new Map();
  }

  async withLocks(resourceKeys = [], runner) {
    if (typeof runner !== 'function') {
      throw new Error('runner is required');
    }

    const keys = [...new Set((Array.isArray(resourceKeys) ? resourceKeys : []).filter(Boolean))].sort();
    const releases = [];
    try {
      for (const key of keys) {
        // eslint-disable-next-line no-await-in-loop
        const release = await this.acquire(key);
        releases.push(release);
      }
      return await runner();
    } finally {
      while (releases.length) {
        releases.pop()();
      }
    }
  }

  async acquire(resourceKey) {
    const key = String(resourceKey);
    const previousTail = this.tails.get(key) || Promise.resolve();
    let releaseLock;
    const lockPromise = new Promise((resolve) => {
      releaseLock = resolve;
    });
    const currentTail = previousTail.then(() => lockPromise);
    this.tails.set(key, currentTail);
    await previousTail;

    return () => {
      releaseLock();
      if (this.tails.get(key) === currentTail) {
        this.tails.delete(key);
      }
    };
  }
}

module.exports = {
  ResourceLockManager,
};
