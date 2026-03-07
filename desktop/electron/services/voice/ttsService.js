const { createTtsProvider } = require('./providerFactory');
const { createTtsWorkerClient } = require('./ttsWorkerClient');

function normalizeProviderName(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase();
}

function createTtsService({ provider = null, env = process.env } = {}) {
  let resolvedProvider = provider;

  const getTtsProvider = () => {
    if (resolvedProvider) {
      return resolvedProvider;
    }

    const providerName = normalizeProviderName(provider) || normalizeProviderName(env?.VOICE_TTS_PROVIDER);

    const workerProvider = createTtsWorkerClient({
      provider: providerName || null,
      env,
    });
    if (workerProvider) {
      resolvedProvider = workerProvider;
      return resolvedProvider;
    }

    resolvedProvider = createTtsProvider({
      provider: providerName || null,
      env,
    });

    return resolvedProvider;
  };

  return {
    async warmup() {
      const ttsProvider = getTtsProvider();
      if (typeof ttsProvider.warmup !== 'function') {
        return;
      }

      await ttsProvider.warmup();
    },
    async synthesize({ text = '', signal, onChunk }) {
      const ttsProvider = getTtsProvider();
      return ttsProvider.synthesize({
        text,
        signal,
        onChunk,
      });
    },
    async dispose() {
      const ttsProvider = resolvedProvider;
      if (!ttsProvider || typeof ttsProvider.dispose !== 'function') {
        return;
      }

      await ttsProvider.dispose();
      resolvedProvider = null;
    },
  };
}

module.exports = {
  createTtsService,
};
