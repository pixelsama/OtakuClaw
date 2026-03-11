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

function subscribeConversationChannel(api, channel, handler) {
  if (typeof handler !== 'function') {
    return () => {};
  }
  if (!api?.conversation?.onEvent) {
    return () => {};
  }

  return api.conversation.onEvent((event = {}) => {
    if (event?.channel !== channel) {
      return;
    }
    handler(event);
  });
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
  const voice = settings?.voice || {};
  const dashscope = voice?.dashscope || {};
  const hasToken = Boolean(settings?.hasToken || openclaw?.hasToken || (typeof settings?.token === 'string' && settings.token.trim()));
  const hasNanobotApiKey = Boolean(
    settings?.hasNanobotApiKey
      || nanobot?.hasApiKey
      || (typeof settings?.nanobotApiKey === 'string' && settings.nanobotApiKey.trim()),
  );
  const hasDashscopeApiKey = Boolean(
    dashscope?.hasApiKey
      || (typeof settings?.dashscopeApiKey === 'string' && settings.dashscopeApiKey.trim())
      || (typeof dashscope?.apiKey === 'string' && dashscope.apiKey.trim()),
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
      allowHighRiskTools: Boolean(nanobot.allowHighRiskTools),
      provider: typeof nanobot.provider === 'string' ? nanobot.provider.trim() : 'openrouter',
      model: typeof nanobot.model === 'string' ? nanobot.model.trim() : 'anthropic/claude-opus-4-5',
      apiBase: typeof nanobot.apiBase === 'string' ? nanobot.apiBase.trim() : '',
      apiKey: typeof nanobot.apiKey === 'string' ? nanobot.apiKey.trim() : '',
      maxTokens: Number.isFinite(nanobot.maxTokens) ? nanobot.maxTokens : 4096,
      temperature: Number.isFinite(nanobot.temperature) ? nanobot.temperature : 0.2,
      reasoningEffort: typeof nanobot.reasoningEffort === 'string' ? nanobot.reasoningEffort.trim() : '',
      hasApiKey: hasNanobotApiKey,
    },
    voice: {
      asrProvider: voice?.asrProvider === 'dashscope' ? 'dashscope' : 'inherit',
      ttsProvider: voice?.ttsProvider === 'dashscope' ? 'dashscope' : 'inherit',
      dashscope: {
        workspace: typeof dashscope.workspace === 'string' ? dashscope.workspace.trim() : '',
        baseUrl: typeof dashscope.baseUrl === 'string' ? dashscope.baseUrl.trim() : '',
        apiKey: typeof dashscope.apiKey === 'string' ? dashscope.apiKey.trim() : '',
        hasApiKey: hasDashscopeApiKey,
        asrModel: typeof dashscope.asrModel === 'string' ? dashscope.asrModel.trim() : 'qwen3-asr-flash-realtime',
        asrLanguage: typeof dashscope.asrLanguage === 'string' ? dashscope.asrLanguage.trim() : 'zh',
        ttsModel: typeof dashscope.ttsModel === 'string' ? dashscope.ttsModel.trim() : 'qwen-tts-realtime-latest',
        ttsVoice: typeof dashscope.ttsVoice === 'string' ? dashscope.ttsVoice.trim() : 'Cherry',
        ttsLanguage: typeof dashscope.ttsLanguage === 'string' ? dashscope.ttsLanguage.trim() : 'Chinese',
        ttsSampleRate: Number.isFinite(dashscope.ttsSampleRate) ? dashscope.ttsSampleRate : 24000,
        ttsSpeechRate: Number.isFinite(dashscope.ttsSpeechRate) ? dashscope.ttsSpeechRate : 1,
      },
    },
    ui: {
      onboarding: {
        completed: Boolean(settings?.ui?.onboarding?.completed),
        completedAt:
          typeof settings?.ui?.onboarding?.completedAt === 'string'
            ? settings.ui.onboarding.completedAt.trim()
            : '',
      },
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
    dashscopeApiKey: normalized.voice.dashscope.apiKey,
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
                  ...(Object.prototype.hasOwnProperty.call(settings.nanobot, 'allowHighRiskTools')
                    ? {
                        allowHighRiskTools: Boolean(settings.nanobot.allowHighRiskTools),
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
    ...(Object.prototype.hasOwnProperty.call(settings, 'voice')
      ? {
          voice: {
            ...(typeof settings.voice === 'object' && settings.voice
              ? {
                  ...(Object.prototype.hasOwnProperty.call(settings.voice, 'asrProvider')
                    ? {
                        asrProvider: settings.voice.asrProvider === 'dashscope' ? 'dashscope' : 'inherit',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.voice, 'ttsProvider')
                    ? {
                        ttsProvider: settings.voice.ttsProvider === 'dashscope' ? 'dashscope' : 'inherit',
                      }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(settings.voice, 'dashscope')
                    ? {
                        dashscope:
                          typeof settings.voice.dashscope === 'object' && settings.voice.dashscope
                            ? {
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'workspace')
                                  ? {
                                      workspace:
                                        typeof settings.voice.dashscope.workspace === 'string'
                                          ? settings.voice.dashscope.workspace.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'baseUrl')
                                  ? {
                                      baseUrl:
                                        typeof settings.voice.dashscope.baseUrl === 'string'
                                          ? settings.voice.dashscope.baseUrl.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'asrModel')
                                  ? {
                                      asrModel:
                                        typeof settings.voice.dashscope.asrModel === 'string'
                                          ? settings.voice.dashscope.asrModel.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'asrLanguage')
                                  ? {
                                      asrLanguage:
                                        typeof settings.voice.dashscope.asrLanguage === 'string'
                                          ? settings.voice.dashscope.asrLanguage.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'ttsModel')
                                  ? {
                                      ttsModel:
                                        typeof settings.voice.dashscope.ttsModel === 'string'
                                          ? settings.voice.dashscope.ttsModel.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'ttsVoice')
                                  ? {
                                      ttsVoice:
                                        typeof settings.voice.dashscope.ttsVoice === 'string'
                                          ? settings.voice.dashscope.ttsVoice.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'ttsLanguage')
                                  ? {
                                      ttsLanguage:
                                        typeof settings.voice.dashscope.ttsLanguage === 'string'
                                          ? settings.voice.dashscope.ttsLanguage.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'ttsSampleRate')
                                  ? {
                                      ttsSampleRate: Number.isFinite(settings.voice.dashscope.ttsSampleRate)
                                        ? settings.voice.dashscope.ttsSampleRate
                                        : 24000,
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'ttsSpeechRate')
                                  ? {
                                      ttsSpeechRate: Number.isFinite(settings.voice.dashscope.ttsSpeechRate)
                                        ? settings.voice.dashscope.ttsSpeechRate
                                        : 1,
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'apiKey')
                                  ? {
                                      apiKey:
                                        typeof settings.voice.dashscope.apiKey === 'string'
                                          ? settings.voice.dashscope.apiKey.trim()
                                          : '',
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.voice.dashscope, 'clearApiKey')
                                  ? {
                                      clearApiKey: Boolean(settings.voice.dashscope.clearApiKey),
                                    }
                                  : {}),
                              }
                            : {},
                      }
                    : {}),
                }
              : {}),
          },
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(settings, 'ui')
      ? {
          ui: {
            ...(typeof settings.ui === 'object' && settings.ui
              ? {
                  ...(Object.prototype.hasOwnProperty.call(settings.ui, 'onboarding')
                    ? {
                        onboarding:
                          typeof settings.ui.onboarding === 'object' && settings.ui.onboarding
                            ? {
                                ...(Object.prototype.hasOwnProperty.call(settings.ui.onboarding, 'completed')
                                  ? {
                                      completed: Boolean(settings.ui.onboarding.completed),
                                    }
                                  : {}),
                                ...(Object.prototype.hasOwnProperty.call(settings.ui.onboarding, 'completedAt')
                                  ? {
                                      completedAt:
                                        typeof settings.ui.onboarding.completedAt === 'string'
                                          ? settings.ui.onboarding.completedAt.trim()
                                          : '',
                                    }
                                  : {}),
                              }
                            : {},
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
    voice: {
      ...current.voice,
      ...(patch.voice || {}),
      dashscope: {
        ...current.voice.dashscope,
        ...(patch.voice?.dashscope || {}),
      },
    },
    ui: {
      ...(current.ui || {}),
      ...(patch.ui || {}),
      onboarding: {
        ...(current.ui?.onboarding || {}),
        ...(patch.ui?.onboarding || {}),
      },
    },
    hasSecureStorage: false,
  };

  if (patch.openclaw?.clearToken === true) {
    merged.openclaw.token = '';
  }

  if (patch.nanobot?.clearApiKey === true) {
    merged.nanobot.apiKey = '';
  }

  if (patch.voice?.dashscope?.clearApiKey === true) {
    merged.voice.dashscope.apiKey = '';
  }

  merged.openclaw.hasToken = Boolean(merged.openclaw.token);
  merged.nanobot.hasApiKey = Boolean(merged.nanobot.apiKey);
  merged.baseUrl = merged.openclaw.baseUrl;
  merged.token = merged.openclaw.token;
  merged.agentId = merged.openclaw.agentId;
  merged.hasToken = merged.openclaw.hasToken;
  merged.hasNanobotApiKey = merged.nanobot.hasApiKey;
  merged.voice.dashscope.hasApiKey = Boolean(merged.voice.dashscope.apiKey);
  merged.dashscopeApiKey = merged.voice.dashscope.apiKey;

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
          allowHighRiskTools: merged.nanobot.allowHighRiskTools,
          provider: merged.nanobot.provider,
          model: merged.nanobot.model,
          apiBase: merged.nanobot.apiBase,
          apiKey: merged.nanobot.apiKey,
          maxTokens: merged.nanobot.maxTokens,
          temperature: merged.nanobot.temperature,
          reasoningEffort: merged.nanobot.reasoningEffort,
        },
        voice: {
          asrProvider: merged.voice.asrProvider,
          ttsProvider: merged.voice.ttsProvider,
          dashscope: {
            workspace: merged.voice.dashscope.workspace,
            baseUrl: merged.voice.dashscope.baseUrl,
            apiKey: merged.voice.dashscope.apiKey,
            asrModel: merged.voice.dashscope.asrModel,
            asrLanguage: merged.voice.dashscope.asrLanguage,
            ttsModel: merged.voice.dashscope.ttsModel,
            ttsVoice: merged.voice.dashscope.ttsVoice,
            ttsLanguage: merged.voice.dashscope.ttsLanguage,
            ttsSampleRate: merged.voice.dashscope.ttsSampleRate,
            ttsSpeechRate: merged.voice.dashscope.ttsSpeechRate,
          },
        },
        ui: {
          onboarding: {
            completed: Boolean(merged.ui?.onboarding?.completed),
            completedAt: merged.ui?.onboarding?.completedAt || '',
          },
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
  conversation: {
    submitUserText(request = {}) {
      const api = getDesktopApi();
      if (api?.conversation?.submitUserText) {
        return api.conversation.submitUserText(request);
      }
      return Promise.resolve({
        ok: false,
        reason: 'desktop_conversation_unavailable',
      });
    },
    abortActive(request = {}) {
      const api = getDesktopApi();
      if (api?.conversation?.abortActive) {
        return api.conversation.abortActive(request);
      }
      return Promise.resolve({ ok: false, reason: 'desktop_conversation_unavailable' });
    },
    onEvent(handler) {
      const api = getDesktopApi();
      if (!api?.conversation?.onEvent || typeof handler !== 'function') {
        return () => {};
      }
      return api.conversation.onEvent(handler);
    },
  },
  chat: {
    start(request) {
      const api = getDesktopApi();
      if (api?.conversation?.submitUserText) {
        return api.conversation.submitUserText(request).then((result = {}) => {
          if (result.ok && result.streamId) {
            return { streamId: result.streamId };
          }

          throw new Error(result.reason || 'desktop_chat_unavailable');
        });
      }
      throw new Error('desktop_conversation_unavailable');
    },
    abort(request) {
      const api = getDesktopApi();
      if (!api?.conversation?.abortActive) {
        return Promise.resolve({ ok: false, reason: 'desktop_conversation_unavailable' });
      }
      return api.conversation.abortActive({
        streamId: request?.streamId || '',
        reason: request?.reason || 'manual',
      });
    },
    onEvent(handler) {
      const api = getDesktopApi();
      if (typeof handler !== 'function') {
        return () => {};
      }
      return subscribeConversationChannel(api, 'chat', (event = {}) => {
        handler({
          streamId: event.streamId || '',
          type: event.type || '',
          payload: event.payload && typeof event.payload === 'object' ? event.payload : {},
        });
      });
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
    async pickNanobotWorkspace() {
      const api = getDesktopApi();
      if (api?.settings?.pickNanobotWorkspace) {
        return api.settings.pickNanobotWorkspace();
      }
      return {
        ok: false,
        canceled: true,
        path: '',
      };
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
  nanobotDebug: {
    onLog(handler) {
      const api = getDesktopApi();
      if (!api?.nanobotDebug?.onLog || typeof handler !== 'function') {
        return () => {};
      }
      return api.nanobotDebug.onLog(handler);
    },
  },
  nanobotSkills: {
    async list() {
      const api = getDesktopApi();
      if (api?.nanobotSkills?.list) {
        return api.nanobotSkills.list();
      }
      return {
        ok: false,
        error: {
          code: 'nanobot_runtime_not_ready',
          message: 'Web 模式暂不支持 Nanobot Skills。',
        },
        libraryPath: '',
        customSkills: [],
        builtinSkills: [],
      };
    },
    async importZip() {
      const api = getDesktopApi();
      if (api?.nanobotSkills?.importZip) {
        return api.nanobotSkills.importZip();
      }
      return {
        ok: false,
        error: {
          code: 'nanobot_runtime_not_ready',
          message: 'Web 模式暂不支持导入 Nanobot Skills。',
        },
      };
    },
    async delete(payload = {}) {
      const api = getDesktopApi();
      if (api?.nanobotSkills?.delete) {
        return api.nanobotSkills.delete(payload);
      }
      return {
        ok: false,
        error: {
          code: 'nanobot_runtime_not_ready',
          message: 'Web 模式暂不支持删除 Nanobot Skills。',
        },
      };
    },
    async openLibrary() {
      const api = getDesktopApi();
      if (api?.nanobotSkills?.openLibrary) {
        return api.nanobotSkills.openLibrary();
      }
      return {
        ok: false,
        error: {
          code: 'nanobot_runtime_not_ready',
          message: 'Web 模式暂不支持打开 Nanobot Skills 目录。',
        },
      };
    },
  },
  capture: {
    beginWindowCapture() {
      const api = getDesktopApi();
      if (!api?.capture?.beginWindowCapture) {
        return Promise.resolve({ ok: false, reason: 'desktop_capture_unavailable' });
      }
      return api.capture.beginWindowCapture();
    },
    finishWindowCapture() {
      const api = getDesktopApi();
      if (!api?.capture?.finishWindowCapture) {
        return Promise.resolve({ ok: false, reason: 'desktop_capture_unavailable' });
      }
      return api.capture.finishWindowCapture();
    },
    save(request = {}) {
      const api = getDesktopApi();
      if (!api?.capture?.save) {
        return Promise.resolve({ ok: false, reason: 'desktop_capture_unavailable' });
      }
      return api.capture.save(request);
    },
    release(request = {}) {
      const api = getDesktopApi();
      if (!api?.capture?.release) {
        return Promise.resolve({ ok: false, reason: 'desktop_capture_unavailable' });
      }
      return api.capture.release(request);
    },
    selectRegion() {
      const api = getDesktopApi();
      if (!api?.capture?.selectRegion) {
        return Promise.resolve({ ok: false, canceled: false, reason: 'desktop_capture_unavailable' });
      }
      return api.capture.selectRegion();
    },
  },
  captureOverlay: {
    getSession() {
      const api = getDesktopApi();
      if (!api?.captureOverlay?.getSession) {
        return Promise.resolve({ ok: false, reason: 'capture_session_unavailable' });
      }
      return api.captureOverlay.getSession();
    },
    confirm(request = {}) {
      const api = getDesktopApi();
      if (!api?.captureOverlay?.confirm) {
        return Promise.resolve({ ok: false, reason: 'capture_session_unavailable' });
      }
      return api.captureOverlay.confirm(request);
    },
    cancel(request = {}) {
      const api = getDesktopApi();
      if (!api?.captureOverlay?.cancel) {
        return Promise.resolve({ ok: false, reason: 'capture_session_unavailable' });
      }
      return api.captureOverlay.cancel(request);
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
    async commit({ sessionId, finalSeq, autoStartChat = true } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.commitInput) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.commitInput({ sessionId, finalSeq, autoStartChat });
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
    async warmup({
      warmAsr = true,
      warmTts = false,
      reload = false,
    } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.warmup) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.warmup({
        warmAsr,
        warmTts,
        reload,
      });
    },
    async listSegmentTrace({ sessionId = '', limit = 20 } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.listSegmentTrace) {
        return { ok: false, reason: 'desktop_voice_unavailable', items: [] };
      }
      return api.voice.listSegmentTrace({ sessionId, limit });
    },
    async runAsrDiagnostics({
      pcmChunk,
      sampleRate = 16000,
      channels = 1,
      sampleFormat = 'pcm_s16le',
      timeoutMs = 120000,
    } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.runAsrDiagnostics) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.runAsrDiagnostics({
        pcmChunk,
        sampleRate,
        channels,
        sampleFormat,
        timeoutMs,
      });
    },
    async runTtsDiagnostics({
      text,
      timeoutMs = 180000,
      includeAudio = false,
    } = {}) {
      const api = getDesktopApi();
      if (!api?.voice?.runTtsDiagnostics) {
        return { ok: false, reason: 'desktop_voice_unavailable' };
      }
      return api.voice.runTtsDiagnostics({
        text,
        timeoutMs,
        includeAudio,
      });
    },
    onEvent(handler) {
      const api = getDesktopApi();
      if (typeof handler !== 'function') {
        return () => {};
      }
      return subscribeConversationChannel(api, 'voice', (event = {}) => {
        const voicePayload = { ...(event || {}) };
        delete voicePayload.channel;
        handler(voicePayload);
      });
    },
    onFlowControl(handler) {
      const api = getDesktopApi();
      if (!api?.voice?.onFlowControl || typeof handler !== 'function') {
        return () => {};
      }
      return api.voice.onFlowControl(handler);
    },
    onToggleRequest(handler) {
      const api = getDesktopApi();
      if (!api?.voice?.onToggleRequest || typeof handler !== 'function') {
        return () => {};
      }
      return api.voice.onToggleRequest(handler);
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
          selectedAsrBundleId: '',
          selectedTtsBundleId: '',
          selectedBundleId: '',
          rootDir: '',
        };
      }
      return api.voiceModels.list();
    },
    async installCatalog(catalogId, options = {}) {
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
      return api.voiceModels.installCatalog({
        catalogId,
        installAsr: options.installAsr,
        installTts: options.installTts,
      });
    },
    async select({ bundleId, asrBundleId, ttsBundleId } = {}) {
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
      const payload = {};
      if (typeof bundleId !== 'undefined') {
        payload.bundleId = bundleId;
      }
      if (typeof asrBundleId !== 'undefined') {
        payload.asrBundleId = asrBundleId;
      }
      if (typeof ttsBundleId !== 'undefined') {
        payload.ttsBundleId = ttsBundleId;
      }
      return api.voiceModels.select(payload);
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
    async remove({ bundleId } = {}) {
      const api = getDesktopApi();
      if (!api?.voiceModels?.remove) {
        return {
          ok: false,
          error: {
            code: 'desktop_voice_models_unavailable',
            message: '当前环境不支持语音模型删除。',
          },
        };
      }
      return api.voiceModels.remove({ bundleId });
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
