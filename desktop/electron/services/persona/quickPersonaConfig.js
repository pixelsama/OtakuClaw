const DEFAULT_FAST_PERSONA_SETTINGS = Object.freeze({
  enabled: true,
  configMode: 'inherit',
  provider: 'openrouter',
  model: '',
  apiBase: '',
  maxTokens: 768,
  temperature: 0.3,
  timeoutMs: 20000,
});

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
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

function normalizeConfigMode(value) {
  return normalizeText(value).toLowerCase() === 'custom' ? 'custom' : 'inherit';
}

function normalizeProvider(value, fallback = DEFAULT_FAST_PERSONA_SETTINGS.provider) {
  const normalized = normalizeText(value, fallback).toLowerCase();
  if ([
    'openrouter',
    'openai',
    'anthropic',
    'dashscope',
    'deepseek',
    'ollama',
    'custom',
  ].includes(normalized)) {
    return normalized;
  }

  return fallback;
}

function normalizeFastPersonaSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};

  return {
    enabled:
      Object.prototype.hasOwnProperty.call(source, 'enabled')
        ? Boolean(source.enabled)
        : DEFAULT_FAST_PERSONA_SETTINGS.enabled,
    configMode: normalizeConfigMode(source.configMode),
    provider: normalizeProvider(source.provider),
    model: normalizeText(source.model),
    apiBase: normalizeText(source.apiBase),
    maxTokens: toPositiveInteger(source.maxTokens, DEFAULT_FAST_PERSONA_SETTINGS.maxTokens),
    temperature: toFiniteNumber(source.temperature, DEFAULT_FAST_PERSONA_SETTINGS.temperature),
    timeoutMs: toPositiveInteger(source.timeoutMs, DEFAULT_FAST_PERSONA_SETTINGS.timeoutMs),
  };
}

function buildConfigError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveFastPersonaRuntimeConfig(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const fastPersona = normalizeFastPersonaSettings(source.fastPersona);

  if (!fastPersona.enabled) {
    return {
      ok: false,
      disabled: true,
      reason: 'fast_persona_disabled',
      fastPersona,
    };
  }

  if (fastPersona.configMode === 'inherit') {
    const nanobot = source.nanobot && typeof source.nanobot === 'object' ? source.nanobot : {};
    const provider = normalizeProvider(nanobot.provider, fastPersona.provider);
    const model = normalizeText(nanobot.model, fastPersona.model);
    const apiBase = normalizeText(nanobot.apiBase, fastPersona.apiBase);
    const apiKey = normalizeText(nanobot.apiKey);

    if (!model) {
      return {
        ok: false,
        disabled: false,
        reason: 'fast_persona_missing_model',
        fastPersona,
      };
    }

    if (!apiKey) {
      return {
        ok: false,
        disabled: false,
        reason: 'fast_persona_missing_api_key',
        fastPersona,
      };
    }

    return {
      ok: true,
      config: {
        provider,
        model,
        apiBase,
        apiKey,
        maxTokens: fastPersona.maxTokens,
        temperature: fastPersona.temperature,
        timeoutMs: fastPersona.timeoutMs,
        configMode: 'inherit',
        inheritedFrom: 'nanobot',
      },
      fastPersona,
    };
  }

  const provider = normalizeProvider(fastPersona.provider);
  const model = normalizeText(fastPersona.model);
  const apiBase = normalizeText(fastPersona.apiBase);
  const apiKey = normalizeText(source.fastPersona?.apiKey);

  if (!model) {
    return {
      ok: false,
      disabled: false,
      reason: 'fast_persona_missing_model',
      fastPersona,
    };
  }

  if (!apiKey) {
    return {
      ok: false,
      disabled: false,
      reason: 'fast_persona_missing_api_key',
      fastPersona,
    };
  }

  return {
    ok: true,
    config: {
      provider,
      model,
      apiBase,
      apiKey,
      maxTokens: fastPersona.maxTokens,
      temperature: fastPersona.temperature,
      timeoutMs: fastPersona.timeoutMs,
      configMode: 'custom',
      inheritedFrom: '',
    },
    fastPersona,
  };
}

function requireFastPersonaRuntimeConfig(settings = {}) {
  const resolved = resolveFastPersonaRuntimeConfig(settings);
  if (resolved.ok) {
    return resolved.config;
  }

  const messageMap = {
    fast_persona_disabled: 'Fast persona direct model is disabled.',
    fast_persona_missing_model: 'Fast persona model is missing.',
    fast_persona_missing_api_key: 'Fast persona API key is missing.',
  };

  throw buildConfigError(
    resolved.reason || 'fast_persona_config_invalid',
    messageMap[resolved.reason] || 'Fast persona configuration is invalid.',
  );
}

module.exports = {
  DEFAULT_FAST_PERSONA_SETTINGS,
  normalizeFastPersonaSettings,
  normalizeProvider,
  resolveFastPersonaRuntimeConfig,
  requireFastPersonaRuntimeConfig,
};
