const SETTINGS_STORAGE_KEY = 'openclaw.settings';

function getDesktopApi() {
  if (typeof window === 'undefined') {
    return null;
  }

  const api = window.desktop;
  if (!api || !api.isElectron) {
    return null;
  }

  return api;
}

function normalizeSettingsResponse(settings = {}) {
  return {
    baseUrl: typeof settings.baseUrl === 'string' ? settings.baseUrl.trim() : '',
    token: typeof settings.token === 'string' ? settings.token.trim() : '',
    agentId: typeof settings.agentId === 'string' ? settings.agentId.trim() : 'main',
    hasToken: Boolean(settings.hasToken || (typeof settings.token === 'string' && settings.token.trim())),
    hasSecureStorage: settings.hasSecureStorage !== false,
  };
}

function normalizeSettingsPatch(settings = {}) {
  const next = {};

  if (Object.prototype.hasOwnProperty.call(settings, 'baseUrl')) {
    next.baseUrl = typeof settings.baseUrl === 'string' ? settings.baseUrl.trim() : '';
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'agentId')) {
    next.agentId = typeof settings.agentId === 'string' ? settings.agentId.trim() : '';
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'token')) {
    next.token = typeof settings.token === 'string' ? settings.token.trim() : '';
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'clearToken')) {
    next.clearToken = Boolean(settings.clearToken);
  }

  return next;
}

function loadWebSettings() {
  if (typeof window === 'undefined') {
    return normalizeSettingsResponse({});
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return normalizeSettingsResponse({ hasSecureStorage: false });
    }

    return normalizeSettingsResponse({
      hasSecureStorage: false,
      ...JSON.parse(raw),
    });
  } catch {
    return normalizeSettingsResponse({ hasSecureStorage: false });
  }
}

function saveWebSettings(partialSettings = {}) {
  const current = loadWebSettings();
  const patch = normalizeSettingsPatch(partialSettings);

  const merged = {
    ...current,
    ...patch,
    hasSecureStorage: false,
  };

  if (patch.clearToken === true) {
    merged.token = '';
  }

  merged.hasToken = Boolean(merged.token);

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        baseUrl: merged.baseUrl,
        token: merged.token,
        agentId: merged.agentId,
      }),
    );
  }

  return merged;
}

async function testWebConnection(inputSettings = {}) {
  const patch = normalizeSettingsPatch(inputSettings);
  const current = loadWebSettings();
  const settings = {
    ...current,
    ...patch,
  };

  if (settings.clearToken === true) {
    settings.token = '';
  }

  if (!settings.baseUrl || !settings.token || !settings.agentId) {
    return {
      ok: false,
      error: {
        code: 'openclaw_missing_config',
        message: '请先填写 OpenClaw Base URL / Token / Agent ID。',
      },
    };
  }

  try {
    const startAt = Date.now();
    const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model: `openclaw:${settings.agentId}`,
        stream: false,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return {
        ok: false,
        error: {
          code: 'openclaw_upstream_error',
          message: detail || `连接失败 (${response.status})`,
        },
      };
    }

    await response.text();

    return {
      ok: true,
      latencyMs: Date.now() - startAt,
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'openclaw_unreachable',
        message: error?.message || '无法访问 OpenClaw。',
      },
    };
  }
}

export const desktopBridge = {
  isDesktop() {
    return Boolean(getDesktopApi());
  },
  chat: {
    start(request) {
      const api = getDesktopApi();
      if (!api?.chatStream?.start) {
        throw new Error('desktop_chat_unavailable');
      }
      return api.chatStream.start(request);
    },
    abort(request) {
      const api = getDesktopApi();
      if (!api?.chatStream?.abort) {
        return Promise.resolve({ ok: false, reason: 'desktop_chat_unavailable' });
      }
      return api.chatStream.abort(request);
    },
    onEvent(handler) {
      const api = getDesktopApi();
      if (!api?.chatStream?.onEvent) {
        return () => {};
      }
      return api.chatStream.onEvent(handler);
    },
  },
  settings: {
    async get() {
      const api = getDesktopApi();
      if (api?.settings?.get) {
        return normalizeSettingsResponse(await api.settings.get());
      }
      return loadWebSettings();
    },
    async save(partialSettings = {}) {
      const patch = normalizeSettingsPatch(partialSettings);
      const api = getDesktopApi();
      if (api?.settings?.save) {
        const saved = await api.settings.save(patch);
        return normalizeSettingsResponse(saved);
      }
      return saveWebSettings(patch);
    },
    async testConnection(overrideSettings = {}) {
      const patch = normalizeSettingsPatch(overrideSettings);
      const api = getDesktopApi();
      if (api?.settings?.testConnection) {
        return api.settings.testConnection(patch);
      }
      return testWebConnection(patch);
    },
  },
};
