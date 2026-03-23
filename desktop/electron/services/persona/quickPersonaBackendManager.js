const {
  requireFastPersonaRuntimeConfig,
  resolveFastPersonaRuntimeConfig,
} = require('./quickPersonaConfig');

const DEFAULT_OPENAI_COMPATIBLE_BASE_URLS = Object.freeze({
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  custom: '',
});

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function joinUrl(baseUrl, suffix) {
  const base = normalizeText(baseUrl);
  if (!base) {
    return suffix;
  }

  return `${base.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
}

function buildHeaders(config = {}) {
  const provider = normalizeText(config.provider).toLowerCase();
  const apiKey = normalizeText(config.apiKey);

  if (provider === 'anthropic') {
    return {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
}

function createRequestAbortSignal({ signal, timeoutMs }) {
  const controller = new AbortController();
  let timeoutId = null;

  const abortFromParent = () => {
    controller.abort(signal?.reason || new Error('aborted'));
  };

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason || new Error('aborted'));
    } else {
      signal.addEventListener('abort', abortFromParent, { once: true });
    }
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      controller.abort(new Error('timeout'));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    dispose() {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (signal) {
        signal.removeEventListener('abort', abortFromParent);
      }
    },
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      rawText: text,
    };
  }
}

function buildProviderError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function extractOpenAiLikeText(payload = {}) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const content = choice?.message?.content;

  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item?.text === 'string') {
          return item.text;
        }
        if (typeof item?.content === 'string') {
          return item.content;
        }
        return '';
      })
      .join('')
      .trim();
  }

  return '';
}

function extractAnthropicText(payload = {}) {
  const content = Array.isArray(payload?.content) ? payload.content : [];
  return content
    .map((item) => (typeof item?.text === 'string' ? item.text : ''))
    .join('')
    .trim();
}

class QuickPersonaBackendManager {
  constructor({ fetchImpl } = {}) {
    if (typeof fetchImpl !== 'function' && typeof fetch !== 'function') {
      throw new Error('fetch is required for quick persona backend manager');
    }

    this.fetchImpl = fetchImpl || fetch;
  }

  resolveConfig(settings = {}) {
    return resolveFastPersonaRuntimeConfig(settings);
  }

  createRunner({ settings } = {}) {
    return async ({ promptBundle, signal }) => {
      return this.runDirect({
        settings,
        promptBundle,
        signal,
      });
    };
  }

  async runDirect({ settings = {}, promptBundle = {}, signal } = {}) {
    const config = requireFastPersonaRuntimeConfig(settings);
    if (config.provider === 'anthropic') {
      return this.runAnthropic({
        config,
        promptBundle,
        signal,
      });
    }

    return this.runOpenAiCompatible({
      config,
      promptBundle,
      signal,
    });
  }

  async runOpenAiCompatible({ config, promptBundle = {}, signal } = {}) {
    const baseUrl = normalizeText(
      config.apiBase,
      DEFAULT_OPENAI_COMPATIBLE_BASE_URLS[config.provider] || DEFAULT_OPENAI_COMPATIBLE_BASE_URLS.custom,
    );
    const url = /\/chat\/completions\/?$/.test(baseUrl)
      ? baseUrl
      : joinUrl(baseUrl, '/chat/completions');
    const requestBody = {
      model: config.model,
      messages: Array.isArray(promptBundle.messages) && promptBundle.messages.length > 0
        ? promptBundle.messages
        : [
            {
              role: 'user',
              content: normalizeText(promptBundle.prompt),
            },
          ],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    };

    const request = createRequestAbortSignal({
      signal,
      timeoutMs: config.timeoutMs,
    });

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: buildHeaders(config),
        body: JSON.stringify(requestBody),
        signal: request.signal,
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw buildProviderError(
          'fast_persona_model_call_failed',
          normalizeText(
            payload?.error?.message,
            `Fast persona request failed with status ${response.status}.`,
          ),
          {
            status: response.status,
            payload,
          },
        );
      }

      return extractOpenAiLikeText(payload);
    } finally {
      request.dispose();
    }
  }

  async runAnthropic({ config, promptBundle = {}, signal } = {}) {
    const baseUrl = normalizeText(config.apiBase, DEFAULT_ANTHROPIC_BASE_URL);
    const url = /\/messages\/?$/.test(baseUrl)
      ? baseUrl
      : joinUrl(baseUrl, '/messages');
    const requestBody = {
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: normalizeText(promptBundle.systemPrompt),
      messages: [
        {
          role: 'user',
          content: normalizeText(promptBundle.userPrompt || promptBundle.prompt),
        },
      ],
    };

    const request = createRequestAbortSignal({
      signal,
      timeoutMs: config.timeoutMs,
    });

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: buildHeaders(config),
        body: JSON.stringify(requestBody),
        signal: request.signal,
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw buildProviderError(
          'fast_persona_model_call_failed',
          normalizeText(
            payload?.error?.message,
            `Fast persona request failed with status ${response.status}.`,
          ),
          {
            status: response.status,
            payload,
          },
        );
      }

      return extractAnthropicText(payload);
    } finally {
      request.dispose();
    }
  }
}

function createQuickPersonaBackendManager(options = {}) {
  return new QuickPersonaBackendManager(options);
}

module.exports = {
  QuickPersonaBackendManager,
  createQuickPersonaBackendManager,
};
