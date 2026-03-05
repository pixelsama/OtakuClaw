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

function detectPlatformFallback() {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

  const source = `${navigator.userAgent || ''} ${navigator.platform || ''}`.toLowerCase();
  if (source.includes('mac')) {
    return 'darwin';
  }
  if (source.includes('win')) {
    return 'win32';
  }
  if (source.includes('linux')) {
    return 'linux';
  }

  return 'unknown';
}

function resolvePlatformSyncFromApi(api) {
  if (typeof api?.platform === 'string' && api.platform) {
    return api.platform;
  }

  return detectPlatformFallback();
}

function normalizeSettingsResponse(settings = {}) {
  const chatBackend = settings?.chatBackend === 'nanobot' ? 'nanobot' : 'openclaw';
  const openclaw = settings?.openclaw || {};
  const nanobot = settings?.nanobot || {};
  const hasToken = Boolean(settings?.hasToken || openclaw?.hasToken || (typeof settings?.token === 'string' && settings.token.trim()));
  const hasNanobotApiKey = Boolean(
    settings?.hasNanobotApiKey
      || nanobot?.hasApiKey
      || (typeof settings?.nanobotApiKey === 'string' && settings.nanobotApiKey.trim()),
  );

  const normalized = {
    chatBackend,
    openclaw: {
      baseUrl:
        typeof openclaw.baseUrl === 'string'
          ? openclaw.baseUrl.trim()
          : typeof settings.baseUrl === 'string'
            ? settings.baseUrl.trim()
            : '',
      token: typeof openclaw.token === 'string' ? openclaw.token.trim() : '',
      agentId:
        typeof openclaw.agentId === 'string'
          ? openclaw.agentId.trim()
          : typeof settings.agentId === 'string'
            ? settings.agentId.trim()
            : 'main',
      hasToken,
    },
    nanobot: {
      enabled: Boolean(nanobot.enabled),
      workspace: typeof nanobot.workspace === 'string' ? nanobot.workspace.trim() : '',
      provider: typeof nanobot.provider === 'string' ? nanobot.provider.trim() : 'openrouter',
      model: typeof nanobot.model === 'string' ? nanobot.model.trim() : 'anthropic/claude-opus-4-5',
      apiBase: typeof nanobot.apiBase === 'string' ? nanobot.apiBase.trim() : '',
      apiKey: typeof nanobot.apiKey === 'string' ? nanobot.apiKey.trim() : '',
      maxTokens: Number.isFinite(nanobot.maxTokens) ? nanobot.maxTokens : 4096,
      temperature: Number.isFinite(nanobot.temperature) ? nanobot.temperature : 0.2,
      reasoningEffort: typeof nanobot.reasoningEffort === 'string' ? nanobot.reasoningEffort.trim() : '',
      hasApiKey: hasNanobotApiKey,
    },
    hasSecureStorage: settings.hasSecureStorage !== false,
  };

  return {
    ...normalized,
    // Legacy flat fields for backward compatibility.
    baseUrl: normalized.openclaw.baseUrl,
    token: normalized.openclaw.token,
    agentId: normalized.openclaw.agentId,
    hasToken: normalized.openclaw.hasToken,
    hasNanobotApiKey: normalized.nanobot.hasApiKey,
  };
}

function normalizeSettingsPatch(settings = {}) {
  return {
    ...(Object.prototype.hasOwnProperty.call(settings, 'chatBackend')
      ? { chatBackend: settings.chatBackend === 'nanobot' ? 'nanobot' : 'openclaw' }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(settings, 'baseUrl')
      || Object.prototype.hasOwnProperty.call(settings, 'agentId')
      || Object.prototype.hasOwnProperty.call(settings, 'token')
      || Object.prototype.hasOwnProperty.call(settings, 'clearToken')
      ? {
          openclaw: {
            ...(Object.prototype.hasOwnProperty.call(settings, 'baseUrl')
              ? { baseUrl: typeof settings.baseUrl === 'string' ? settings.baseUrl.trim() : '' }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(settings, 'agentId')
              ? { agentId: typeof settings.agentId === 'string' ? settings.agentId.trim() : '' }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(settings, 'token')
              ? { token: typeof settings.token === 'string' ? settings.token.trim() : '' }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(settings, 'clearToken')
              ? { clearToken: Boolean(settings.clearToken) }
              : {}),
          },
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(settings, 'openclaw')
      ? {
          openclaw: {
            ...(typeof settings.openclaw === 'object' && settings.openclaw
              ? {
                  ...(Object.prototype.hasOwnProperty.call(settings.openclaw, 'baseUrl')
                    ? {
                        baseUrl:
                          typeof settings.openclaw.baseUrl === 'string'
                            ? settings.openclaw.baseUrl.trim()
                            : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.openclaw, 'agentId')
                    ? {
                        agentId:
                          typeof settings.openclaw.agentId === 'string'
                            ? settings.openclaw.agentId.trim()
                            : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.openclaw, 'token')
                    ? {
                        token:
                          typeof settings.openclaw.token === 'string' ? settings.openclaw.token.trim() : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.openclaw, 'clearToken')
                    ? {
                        clearToken: Boolean(settings.openclaw.clearToken),
                      }
                    : {}),
                }
              : {}),
          },
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(settings, 'nanobot')
      ? {
          nanobot: {
            ...(typeof settings.nanobot === 'object' && settings.nanobot
              ? {
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'enabled')
                    ? {
                        enabled: Boolean(settings.nanobot.enabled),
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'workspace')
                    ? {
                        workspace:
                          typeof settings.nanobot.workspace === 'string'
                            ? settings.nanobot.workspace.trim()
                            : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'provider')
                    ? {
                        provider:
                          typeof settings.nanobot.provider === 'string'
                            ? settings.nanobot.provider.trim()
                            : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'model')
                    ? {
                        model: typeof settings.nanobot.model === 'string' ? settings.nanobot.model.trim() : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'apiBase')
                    ? {
                        apiBase:
                          typeof settings.nanobot.apiBase === 'string'
                            ? settings.nanobot.apiBase.trim()
                            : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'maxTokens')
                    ? {
                        maxTokens: Number.isFinite(settings.nanobot.maxTokens)
                          ? settings.nanobot.maxTokens
                          : 4096,
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'temperature')
                    ? {
                        temperature: Number.isFinite(settings.nanobot.temperature)
                          ? settings.nanobot.temperature
                          : 0.2,
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'reasoningEffort')
                    ? {
                        reasoningEffort:
                          typeof settings.nanobot.reasoningEffort === 'string'
                            ? settings.nanobot.reasoningEffort.trim()
                            : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'apiKey')
                    ? {
                        apiKey:
                          typeof settings.nanobot.apiKey === 'string'
                            ? settings.nanobot.apiKey.trim()
                            : '',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'clearApiKey')
                    ? {
                        clearApiKey: Boolean(settings.nanobot.clearApiKey),
                      }
                    : {}),
                }
              : {}),
          },
        }
      : {}),
  };
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
    ...(Object.prototype.hasOwnProperty.call(patch, 'chatBackend')
      ? { chatBackend: patch.chatBackend }
      : {}),
    openclaw: {
      ...current.openclaw,
      ...(patch.openclaw || {}),
    },
    nanobot: {
      ...current.nanobot,
      ...(patch.nanobot || {}),
    },
    hasSecureStorage: false,
  };

  if (patch.openclaw?.clearToken === true) {
    merged.openclaw.token = '';
  }

  if (patch.nanobot?.clearApiKey === true) {
    merged.nanobot.apiKey = '';
  }

  merged.openclaw.hasToken = Boolean(merged.openclaw.token);
  merged.nanobot.hasApiKey = Boolean(merged.nanobot.apiKey);
  merged.baseUrl = merged.openclaw.baseUrl;
  merged.token = merged.openclaw.token;
  merged.agentId = merged.openclaw.agentId;
  merged.hasToken = merged.openclaw.hasToken;
  merged.hasNanobotApiKey = merged.nanobot.hasApiKey;

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        chatBackend: merged.chatBackend,
        openclaw: {
          baseUrl: merged.openclaw.baseUrl,
          token: merged.openclaw.token,
          agentId: merged.openclaw.agentId,
        },
        nanobot: {
          enabled: merged.nanobot.enabled,
          workspace: merged.nanobot.workspace,
          provider: merged.nanobot.provider,
          model: merged.nanobot.model,
          apiBase: merged.nanobot.apiBase,
          apiKey: merged.nanobot.apiKey,
          maxTokens: merged.nanobot.maxTokens,
          temperature: merged.nanobot.temperature,
          reasoningEffort: merged.nanobot.reasoningEffort,
        },
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
    ...(Object.prototype.hasOwnProperty.call(patch, 'chatBackend')
      ? { chatBackend: patch.chatBackend }
      : {}),
    openclaw: {
      ...current.openclaw,
      ...(patch.openclaw || {}),
    },
    nanobot: {
      ...current.nanobot,
      ...(patch.nanobot || {}),
    },
  };

  const chatBackend = settings.chatBackend === 'nanobot' ? 'nanobot' : 'openclaw';

  if (settings.openclaw?.clearToken === true) {
    settings.openclaw.token = '';
  }

  if (settings.nanobot?.clearApiKey === true) {
    settings.nanobot.apiKey = '';
  }

  if (chatBackend === 'nanobot') {
    return {
      ok: false,
      error: {
        code: 'nanobot_runtime_not_ready',
        message: 'Web 模式暂不支持 Nanobot 后端。',
      },
    };
  }

  if (!settings.openclaw?.baseUrl || !settings.openclaw?.token || !settings.openclaw?.agentId) {
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
    const response = await fetch(`${settings.openclaw.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.openclaw.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model: `openclaw:${settings.openclaw.agentId}`,
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
  nanobotRuntime: {
    async status() {
      const api = getDesktopApi();
      if (api?.nanobotRuntime?.status) {
        return api.nanobotRuntime.status();
      }
      return {
        ok: false,
        installed: false,
        source: '',
        repoPath: '',
        pythonExecutable: '',
      };
    },
    async install(payload = {}) {
      const api = getDesktopApi();
      if (api?.nanobotRuntime?.install) {
        return api.nanobotRuntime.install(payload);
      }
      return {
        ok: false,
        error: {
          code: 'nanobot_runtime_not_ready',
          message: 'Web 模式暂不支持下载 Nanobot 运行时。',
        },
      };
    },
    onProgress(handler) {
      const api = getDesktopApi();
      if (!api?.nanobotRuntime?.onProgress || typeof handler !== 'function') {
        return () => {};
      }
      return api.nanobotRuntime.onProgress(handler);
    },
  },
  mode: {
    async getCurrent() {
      const api = getDesktopApi();
      if (!api?.windowMode?.getMode) {
        return { mode: 'window' };
      }

      const result = await api.windowMode.getMode();
      if (result?.mode === 'pet' || result?.mode === 'window') {
        return result;
      }

      return { mode: 'window' };
    },
    async set(mode) {
      const api = getDesktopApi();
      if (!api?.windowMode?.setMode) {
        return { ok: false, mode: 'window' };
      }

      return api.windowMode.setMode(mode);
    },
    notifyRendererReady(mode) {
      const api = getDesktopApi();
      api?.windowMode?.notifyRendererReady?.(mode);
    },
    notifyModeRendered(mode) {
      const api = getDesktopApi();
      api?.windowMode?.notifyModeRendered?.(mode);
    },
    updateHover(componentId, isHovering) {
      const api = getDesktopApi();
      api?.windowMode?.updateComponentHover?.(componentId, isHovering);
    },
    toggleForceIgnoreMouse() {
      const api = getDesktopApi();
      api?.windowMode?.toggleForceIgnoreMouse?.();
    },
    onPreChanged(handler) {
      const api = getDesktopApi();
      if (!api?.windowMode?.onPreModeChanged || typeof handler !== 'function') {
        return () => {};
      }

      return api.windowMode.onPreModeChanged((payload = {}) => {
        handler(payload.mode || 'window');
      });
    },
    onChanged(handler) {
      const api = getDesktopApi();
      if (!api?.windowMode?.onModeChanged || typeof handler !== 'function') {
        return () => {};
      }

      return api.windowMode.onModeChanged((payload = {}) => {
        handler(payload.mode || 'window');
      });
    },
    onForceIgnoreMouseChanged(handler) {
      const api = getDesktopApi();
      if (!api?.windowMode?.onForceIgnoreMouseChanged || typeof handler !== 'function') {
        return () => {};
      }

      return api.windowMode.onForceIgnoreMouseChanged((payload = {}) => {
        handler(Boolean(payload.forceIgnoreMouse));
      });
    },
  },
  voice: {
    async start({ sessionId, mode = 'vad' } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.startSession) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.startSession({ sessionId, mode });
    },
    async sendAudioChunk({
      sessionId,
      seq,
      chunkId,
      pcmChunk,
      sampleRate = 16000,
      channels = 1,
      sampleFormat = 'pcm_s16le',
      isSpeech = false,
    } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.sendAudioChunk) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.sendAudioChunk({
        sessionId,
        seq,
        chunkId,
        pcmChunk,
        sampleRate,
        channels,
        sampleFormat,
        isSpeech,
      });
    },
    async commit({ sessionId, finalSeq } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.commitInput) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.commitInput({ sessionId, finalSeq });
    },
    async stop({ sessionId, reason = 'manual' } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.stopSession) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.stopSession({ sessionId, reason });
    },
    async stopTts({ sessionId, reason = 'manual' } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.stopTts) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.stopTts({ sessionId, reason });
    },
    async sendPlaybackAck({ sessionId, ackSeq, bufferedMs } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.sendPlaybackAck) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.sendPlaybackAck({ sessionId, ackSeq, bufferedMs });
    },
    async listSegmentTrace({ sessionId = '', limit = 20 } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.listSegmentTrace) {
        return { ok: false, reason: 'desktop_voice_unavailable', items: [] };
      }
      return api.voice.listSegmentTrace({ sessionId, limit });
    },
    onEvent(handler) {
      const api = getDesktopApi();
      if (!api?.voice?.onEvent || typeof handler !== 'function') {
        return () => {};
      }
      return api.voice.onEvent(handler);
    },
    onFlowControl(handler) {
      const api = getDesktopApi();
      if (!api?.voice?.onFlowControl || typeof handler !== 'function') {
        return () => {};
      }
      return api.voice.onFlowControl(handler);
    },
  },
  voiceModels: {
    async catalog() {
      const api = getDesktopApi();
      if (!api?.voiceModels?.catalog) {
        return {
          ok: false,
          items: [],
        };
      }
      return api.voiceModels.catalog();
    },
    async list() {
      const api = getDesktopApi();
      if (!api?.voiceModels?.list) {
        return {
          ok: false,
          bundles: [],
          selectedBundleId: '',
          rootDir: '',
        };
      }
      return api.voiceModels.list();
    },
    async installCatalog(catalogId) {
      const api = getDesktopApi();
      if (!api?.voiceModels?.installCatalog) {
        return {
          ok: false,
          error: {
            code: 'desktop_voice_models_unavailable',
            message: '当前环境不支持内置语音模型安装。',
          },
        };
      }
      return api.voiceModels.installCatalog({ catalogId });
    },
    async select(bundleId) {
      const api = getDesktopApi();
      if (!api?.voiceModels?.select) {
        return {
          ok: false,
          error: {
            code: 'desktop_voice_models_unavailable',
            message: '当前环境不支持语音模型管理。',
          },
        };
      }
      return api.voiceModels.select({ bundleId });
    },
    async download(payload = {}) {
      const api = getDesktopApi();
      if (!api?.voiceModels?.download) {
        return {
          ok: false,
          error: {
            code: 'desktop_voice_models_unavailable',
            message: '当前环境不支持语音模型下载。',
          },
        };
      }
      return api.voiceModels.download(payload);
    },
    onDownloadProgress(handler) {
      const api = getDesktopApi();
      if (!api?.voiceModels?.onDownloadProgress || typeof handler !== 'function') {
        return () => {};
      }
      return api.voiceModels.onDownloadProgress(handler);
    },
  },
  window: {
    getPlatformSync() {
      const api = getDesktopApi();
      return resolvePlatformSyncFromApi(api);
    },
    async getPlatform() {
      const api = getDesktopApi();
      const fallbackPlatform = resolvePlatformSyncFromApi(api);
      if (!api?.windowControls?.getPlatform) {
        return { platform: fallbackPlatform };
      }

      try {
        const result = await api.windowControls.getPlatform();
        return {
          platform: result?.platform || fallbackPlatform,
        };
      } catch {
        return { platform: fallbackPlatform };
      }
    },
    async control(action) {
      const api = getDesktopApi();
      if (!api?.windowControls?.control) {
        return { ok: false, reason: 'desktop_window_control_unavailable' };
      }

      return api.windowControls.control(action);
    },
    async getCursorContext() {
      const api = getDesktopApi();
      if (!api?.windowControls?.getCursorContext) {
        return { ok: false, reason: 'desktop_cursor_context_unavailable' };
      }

      return api.windowControls.getCursorContext();
    },
  },
  models: {
    async list() {
      const api = getDesktopApi();
      if (!api?.live2dModels?.list) {
        return { models: [] };
      }
      return api.live2dModels.list();
    },
    async importZip() {
      const api = getDesktopApi();
      if (!api?.live2dModels?.importZip) {
        return {
          ok: false,
          error: {
            code: 'desktop_model_library_unavailable',
            message: '当前环境不支持导入模型。',
          },
        };
      }
      return api.live2dModels.importZip();
    },
  },
};
