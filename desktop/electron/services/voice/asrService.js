const { createAsrProvider } = require('./providerFactory');

function createAsrService({ provider = null, env = process.env } = {}) {
  let resolvedProvider = provider;

  const getAsrProvider = () => {
    if (resolvedProvider) {
      return resolvedProvider;
    }

    resolvedProvider = createAsrProvider({
      provider: null,
      env,
    });

    return resolvedProvider;
  };

  return {
    async transcribe({ audioChunks = [], signal, onPartial }) {
      const asrProvider = getAsrProvider();
      return asrProvider.transcribe({
        audioChunks,
        signal,
        onPartial,
      });
    },
  };
}

module.exports = {
  createAsrService,
};
