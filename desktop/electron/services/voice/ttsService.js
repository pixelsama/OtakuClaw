const { createTtsProvider } = require('./providerFactory');

function createTtsService({ provider = null, env = process.env } = {}) {
  let resolvedProvider = provider;

  const getTtsProvider = () => {
    if (resolvedProvider) {
      return resolvedProvider;
    }

    resolvedProvider = createTtsProvider({
      provider: null,
      env,
    });

    return resolvedProvider;
  };

  return {
    async synthesize({ text = '', signal, onChunk }) {
      const ttsProvider = getTtsProvider();
      return ttsProvider.synthesize({
        text,
        signal,
        onChunk,
      });
    },
  };
}

module.exports = {
  createTtsService,
};
