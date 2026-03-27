const DEFAULT_FAST_PERSONA_SETTINGS = Object.freeze({
  enabled: true,
  maxTokens: 768,
  temperature: 0.3,
  timeoutMs: 20000,
});

const DEFAULT_AI_MODEL_SETTINGS = Object.freeze({
  provider: 'openrouter',
  model: 'anthropic/claude-opus-4-5',
  apiBase: '',
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

function normalizeProvider(value, fallback = DEFAULT_AI_MODEL_SETTINGS.provider) {
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
    maxTokens: toPositiveInteger(source.maxTokens, DEFAULT_FAST_PERSONA_SETTINGS.maxTokens),
    temperature: toFiniteNumber(source.temperature, DEFAULT_FAST_PERSONA_SETTINGS.temperature),
    timeoutMs: toPositiveInteger(source.timeoutMs, DEFAULT_FAST_PERSONA_SETTINGS.timeoutMs),
  };
}

function normalizeAiModelSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return {
    provider: normalizeProvider(source.provider, DEFAULT_AI_MODEL_SETTINGS.provider),
    model: normalizeText(source.model, DEFAULT_AI_MODEL_SETTINGS.model),
    apiBase: normalizeText(source.apiBase, DEFAULT_AI_MODEL_SETTINGS.apiBase),
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
  const aiModel = normalizeAiModelSettings(source.aiModel);

  if (!fastPersona.enabled) {
    return {
      ok: false,
      disabled: true,
      reason: 'fast_persona_disabled',
      fastPersona,
    };
  }

  const provider = normalizeProvider(aiModel.provider);
  const model = normalizeText(aiModel.model);
  const apiBase = normalizeText(aiModel.apiBase);
  const apiKey = normalizeText(source.aiModel?.apiKey);

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
      configMode: 'ai-model',
      inheritedFrom: 'ai-model',
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
  DEFAULT_AI_MODEL_SETTINGS,
  DEFAULT_FAST_PERSONA_SETTINGS,
  normalizeAiModelSettings,
  normalizeFastPersonaSettings,
  normalizeProvider,
  resolveFastPersonaRuntimeConfig,
  requireFastPersonaRuntimeConfig,
};
