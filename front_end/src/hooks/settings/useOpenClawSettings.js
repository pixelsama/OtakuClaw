import { useCallback, useEffect, useMemo, useState } from 'react';
import { desktopBridge } from '../../services/desktopBridge.js';

const defaultChatBackendSettings = {
  chatBackend: 'openclaw',
  openclaw: {
    baseUrl: '',
    token: '',
    agentId: 'main',
    hasToken: false,
  },
  nanobot: {
    enabled: false,
    workspace: '',
    allowHighRiskTools: false,
    provider: 'openrouter',
    model: 'anthropic/claude-opus-4-5',
    apiBase: '',
    apiKey: '',
    maxTokens: 4096,
    temperature: 0.2,
    reasoningEffort: '',
    hasApiKey: false,
  },
  hasSecureStorage: true,
};

const defaultNanobotRuntimeStatus = {
  ok: false,
  installed: false,
  source: '',
  repoPath: '',
  pythonExecutable: '',
  managedByApp: false,
  installing: false,
};
const defaultNanobotSkillsState = {
  libraryPath: '',
  customSkills: [],
  builtinSkills: [],
};
const SETTINGS_AUTOSAVE_DEBOUNCE_MS = 500;

function normalizeSkillItem(item = {}) {
  const skillName = typeof item.skillName === 'string' ? item.skillName.trim() : '';
  return {
    source: item?.source === 'builtin' ? 'builtin' : 'custom',
    removable: Boolean(item?.removable),
    skillName,
    name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : skillName,
    description: typeof item.description === 'string' ? item.description.trim() : '',
    always: Boolean(item?.always),
  };
}

function normalizeNanobotSkillsState(payload = {}) {
  return {
    libraryPath: typeof payload?.libraryPath === 'string' ? payload.libraryPath.trim() : '',
    customSkills: Array.isArray(payload?.customSkills) ? payload.customSkills.map(normalizeSkillItem) : [],
    builtinSkills: Array.isArray(payload?.builtinSkills) ? payload.builtinSkills.map(normalizeSkillItem) : [],
  };
}

function buildComparableSettingsSnapshot(settings = {}) {
  const normalized = normalizeSettingsForState(settings);
  return {
    chatBackend: normalized.chatBackend === 'nanobot' ? 'nanobot' : 'openclaw',
    openclaw: {
      baseUrl: normalized.openclaw?.baseUrl || '',
      agentId: normalized.openclaw?.agentId || '',
    },
    nanobot: {
      enabled: Boolean(normalized.nanobot?.enabled),
      workspace: normalized.nanobot?.workspace || '',
      allowHighRiskTools: Boolean(normalized.nanobot?.allowHighRiskTools),
      provider: normalized.nanobot?.provider || '',
      model: normalized.nanobot?.model || '',
      apiBase: normalized.nanobot?.apiBase || '',
      maxTokens: Number.isFinite(normalized.nanobot?.maxTokens) ? normalized.nanobot.maxTokens : 4096,
      temperature: Number.isFinite(normalized.nanobot?.temperature) ? normalized.nanobot.temperature : 0.2,
      reasoningEffort: normalized.nanobot?.reasoningEffort || '',
    },
  };
}

function hasPendingSecretChanges(settings = {}) {
  const openclawToken = typeof settings?.openclaw?.token === 'string' ? settings.openclaw.token.trim() : '';
  const nanobotApiKey = typeof settings?.nanobot?.apiKey === 'string' ? settings.nanobot.apiKey.trim() : '';
  return Boolean(openclawToken || nanobotApiKey);
}

function normalizeSettingsForState(settings = {}) {
  const openclaw = settings?.openclaw || {};
  const nanobot = settings?.nanobot || {};
  const chatBackend = settings?.chatBackend === 'nanobot' ? 'nanobot' : 'openclaw';

  return {
    ...defaultChatBackendSettings,
    ...settings,
    chatBackend,
    openclaw: {
      ...defaultChatBackendSettings.openclaw,
      ...openclaw,
      token: '',
      hasToken: Boolean(openclaw.hasToken || settings?.hasToken),
    },
    nanobot: {
      ...defaultChatBackendSettings.nanobot,
      ...nanobot,
      apiKey: '',
      hasApiKey: Boolean(nanobot.hasApiKey || settings?.hasNanobotApiKey),
    },
    hasSecureStorage: settings?.hasSecureStorage !== false,
  };
}

export function buildChatBackendSettingsPayload(settings) {
  const source = settings || {};
  const openclawSource = source?.openclaw || source;
  const nanobotSource = source?.nanobot || {};
  const chatBackend = source?.chatBackend === 'nanobot' ? 'nanobot' : 'openclaw';

  const payload = {
    chatBackend,
    openclaw: {
      baseUrl: openclawSource?.baseUrl || '',
      agentId: openclawSource?.agentId || '',
    },
    nanobot: {
      enabled: Boolean(nanobotSource?.enabled),
      workspace: nanobotSource?.workspace || '',
      allowHighRiskTools: Boolean(nanobotSource?.allowHighRiskTools),
      provider: nanobotSource?.provider || '',
      model: nanobotSource?.model || '',
      apiBase: nanobotSource?.apiBase || '',
      maxTokens: Number.isFinite(nanobotSource?.maxTokens) ? nanobotSource.maxTokens : 4096,
      temperature: Number.isFinite(nanobotSource?.temperature) ? nanobotSource.temperature : 0.2,
      reasoningEffort: nanobotSource?.reasoningEffort || '',
    },
  };

  const openclawToken = (openclawSource?.token || source?.token || '').trim?.() || '';
  if (openclawToken) {
    payload.openclaw.token = openclawToken;
  }

  const nanobotApiKey = (nanobotSource?.apiKey || source?.nanobotApiKey || '').trim?.() || '';
  if (nanobotApiKey) {
    payload.nanobot.apiKey = nanobotApiKey;
  }

  return payload;
}

export function buildOpenClawSettingsPayload(settings) {
  const payload = buildChatBackendSettingsPayload({
    ...defaultChatBackendSettings,
    openclaw: {
      ...defaultChatBackendSettings.openclaw,
      ...(settings || {}),
    },
  });
  return payload.openclaw;
}

export function formatChatBackendSettingsError({ error, normalizeError, t }) {
  if (typeof normalizeError === 'function') {
    return normalizeError(error);
  }

  if (typeof error === 'string' && error) {
    return error;
  }

  if (typeof error?.message === 'string' && error.message) {
    return error.message;
  }

  return t('common.requestFailed');
}

export function formatOpenClawSettingsError({ error, normalizeError, t }) {
  return formatChatBackendSettingsError({ error, normalizeError, t });
}

export function useChatBackendSettings({ t, normalizeError }) {
  const [chatBackendSettings, setChatBackendSettings] = useState(defaultChatBackendSettings);
  const [savedSettingsSnapshot, setSavedSettingsSnapshot] = useState(
    buildComparableSettingsSnapshot(defaultChatBackendSettings),
  );
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsTesting, setSettingsTesting] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [nanobotRuntimeStatus, setNanobotRuntimeStatus] = useState(defaultNanobotRuntimeStatus);
  const [nanobotRuntimeInstalling, setNanobotRuntimeInstalling] = useState(false);
  const [nanobotSkillsState, setNanobotSkillsState] = useState(defaultNanobotSkillsState);
  const [nanobotSkillsLoading, setNanobotSkillsLoading] = useState(true);
  const [nanobotSkillsImporting, setNanobotSkillsImporting] = useState(false);
  const [nanobotSkillsDeletingName, setNanobotSkillsDeletingName] = useState('');

  const formatError = useCallback(
    (error) => formatChatBackendSettingsError({ error, normalizeError, t }),
    [normalizeError, t],
  );

  const refreshNanobotRuntimeStatus = useCallback(async () => {
    try {
      const status = await desktopBridge.nanobotRuntime.status();
      setNanobotRuntimeStatus({
        ...defaultNanobotRuntimeStatus,
        ...(status || {}),
        installed: Boolean(status?.installed),
      });
    } catch {
      setNanobotRuntimeStatus(defaultNanobotRuntimeStatus);
    }
  }, []);

  const refreshNanobotSkills = useCallback(async () => {
    setNanobotSkillsLoading(true);
    try {
      const result = await desktopBridge.nanobotSkills.list();
      if (!result?.ok) {
        setNanobotSkillsState(defaultNanobotSkillsState);
        return;
      }
      setNanobotSkillsState(normalizeNanobotSkillsState(result));
    } catch {
      setNanobotSkillsState(defaultNanobotSkillsState);
    } finally {
      setNanobotSkillsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      try {
        const settings = await desktopBridge.settings.get();
        if (!mounted) {
          return;
        }
        const normalized = normalizeSettingsForState(settings);
        setChatBackendSettings(normalized);
        setSavedSettingsSnapshot(buildComparableSettingsSnapshot(normalized));
        setSettingsLoaded(true);
      } catch (error) {
        console.error('Failed to load chat backend settings:', error);
        setSettingsLoaded(true);
      }
    };

    void loadSettings();
    void refreshNanobotRuntimeStatus();
    void refreshNanobotSkills();

    return () => {
      mounted = false;
    };
  }, [refreshNanobotRuntimeStatus, refreshNanobotSkills]);

  useEffect(() => {
    if (!settingsLoaded) {
      return () => {};
    }

    const currentSnapshot = buildComparableSettingsSnapshot(chatBackendSettings);
    const snapshotChanged = JSON.stringify(currentSnapshot) !== JSON.stringify(savedSettingsSnapshot);
    const pendingSecrets = hasPendingSecretChanges(chatBackendSettings);
    if (!snapshotChanged && !pendingSecrets) {
      return () => {};
    }

    const timer = setTimeout(() => {
      void (async () => {
        setSettingsSaving(true);
        setSettingsError('');
        try {
          const payload = buildChatBackendSettingsPayload(chatBackendSettings);
          const saved = await desktopBridge.settings.save(payload);
          const normalizedSaved = normalizeSettingsForState(saved);
          setChatBackendSettings(normalizedSaved);
          setSavedSettingsSnapshot(buildComparableSettingsSnapshot(normalizedSaved));
        } catch (error) {
          console.error('Auto-save chat backend settings failed:', error);
          setSettingsError(formatError(error));
        } finally {
          setSettingsSaving(false);
        }
      })();
    }, SETTINGS_AUTOSAVE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [chatBackendSettings, formatError, savedSettingsSnapshot, settingsLoaded]);

  const onChatBackendChange = useCallback((backend) => {
    setChatBackendSettings((prev) => ({
      ...prev,
      chatBackend: backend === 'nanobot' ? 'nanobot' : 'openclaw',
    }));
    setSettingsFeedback('');
    setSettingsError('');
  }, []);

  const onOpenClawSettingChange = useCallback((field, value) => {
    setChatBackendSettings((prev) => ({
      ...prev,
      openclaw: {
        ...prev.openclaw,
        [field]: value,
      },
    }));
    setSettingsFeedback('');
    setSettingsError('');
  }, []);

  const onNanobotSettingChange = useCallback((field, value) => {
    setChatBackendSettings((prev) => ({
      ...prev,
      nanobot: {
        ...prev.nanobot,
        [field]: value,
      },
    }));
    setSettingsFeedback('');
    setSettingsError('');
  }, []);

  const onPickNanobotWorkspace = useCallback(async () => {
    setSettingsError('');
    setSettingsFeedback('');

    try {
      const result = await desktopBridge.settings.pickNanobotWorkspace();
      if (!result?.ok || result?.canceled || !result?.path) {
        return result || { ok: false, canceled: true, path: '' };
      }

      setChatBackendSettings((prev) => ({
        ...prev,
        nanobot: {
          ...prev.nanobot,
          workspace: result.path,
        },
      }));

      return result;
    } catch (error) {
      console.error('Pick Nanobot workspace failed:', error);
      setSettingsError(formatError(error));
      return {
        ok: false,
        canceled: false,
        error,
      };
    }
  }, [formatError]);

  const onTestChatBackendSettings = useCallback(async () => {
    setSettingsTesting(true);
    setSettingsError('');
    setSettingsFeedback('');

    try {
      const payload = buildChatBackendSettingsPayload(chatBackendSettings);
      const result = await desktopBridge.settings.testConnection(payload);
      if (!result?.ok) {
        setSettingsError(formatError(result?.error));
      } else {
        const saved = await desktopBridge.settings.save(payload);
        const normalizedSaved = normalizeSettingsForState(saved);
        setChatBackendSettings(normalizedSaved);
        setSavedSettingsSnapshot(buildComparableSettingsSnapshot(normalizedSaved));
        const latency = typeof result.latencyMs === 'number' ? t('app.latency', { latency: result.latencyMs }) : '';
        setSettingsFeedback(t('app.settingsConnectedAutoSaved', { latency }));
      }
    } catch (error) {
      console.error('Test chat backend settings failed:', error);
      setSettingsError(formatError(error));
    } finally {
      setSettingsTesting(false);
    }
  }, [chatBackendSettings, formatError, t]);

  const onClearSavedToken = useCallback(async () => {
    setSettingsSaving(true);
    setSettingsError('');
    setSettingsFeedback('');

    try {
      const clearPayload =
        chatBackendSettings.chatBackend === 'nanobot'
          ? {
              nanobot: {
                clearApiKey: true,
              },
            }
          : {
              openclaw: {
                clearToken: true,
              },
            };

      const saved = await desktopBridge.settings.save(clearPayload);
      const normalizedSaved = normalizeSettingsForState(saved);
      setChatBackendSettings({
        ...normalizedSaved,
        openclaw: {
          ...normalizedSaved.openclaw,
          token: '',
        },
        nanobot: {
          ...normalizedSaved.nanobot,
          apiKey: '',
        },
      });
      setSavedSettingsSnapshot(buildComparableSettingsSnapshot(normalizedSaved));
      setSettingsFeedback(t('app.tokenCleared'));
    } catch (error) {
      console.error('Clear token failed:', error);
      setSettingsError(formatError(error));
    } finally {
      setSettingsSaving(false);
    }
  }, [chatBackendSettings.chatBackend, formatError, t]);

  const onInstallNanobotRuntime = useCallback(async () => {
    setNanobotRuntimeInstalling(true);
    setSettingsError('');
    setSettingsFeedback('');

    try {
      const result = await desktopBridge.nanobotRuntime.install({});
      if (!result?.ok) {
        setSettingsError(formatError(result?.error));
      } else {
        setSettingsFeedback(t('app.nanobotRuntimeInstalled'));
      }
      await refreshNanobotRuntimeStatus();
      await refreshNanobotSkills();
    } catch (error) {
      setSettingsError(formatError(error));
    } finally {
      setNanobotRuntimeInstalling(false);
    }
  }, [formatError, refreshNanobotRuntimeStatus, refreshNanobotSkills, t]);

  const onImportNanobotSkillsZip = useCallback(async () => {
    setNanobotSkillsImporting(true);
    setSettingsError('');
    setSettingsFeedback('');

    try {
      const result = await desktopBridge.nanobotSkills.importZip();
      if (!result?.ok) {
        if (!result?.canceled) {
          setSettingsError(formatError(result?.error));
        }
        return result || { ok: false, canceled: true };
      }

      setNanobotSkillsState(normalizeNanobotSkillsState(result));
      const importedCount = Number.isFinite(result?.imported?.count)
        ? result.imported.count
        : Array.isArray(result?.imported?.skills)
          ? result.imported.skills.length
          : 0;
      setSettingsFeedback(t('app.nanobotSkillsImportSuccess', { count: importedCount }));
      return result;
    } catch (error) {
      setSettingsError(formatError(error));
      return {
        ok: false,
        canceled: false,
        error,
      };
    } finally {
      setNanobotSkillsImporting(false);
    }
  }, [formatError, t]);

  const onDeleteNanobotSkill = useCallback(async (skillName) => {
    const normalizedSkillName = typeof skillName === 'string' ? skillName.trim() : '';
    if (!normalizedSkillName) {
      return {
        ok: false,
        error: {
          code: 'nanobot_skills_invalid_name',
          message: 'Invalid skill name.',
        },
      };
    }

    setNanobotSkillsDeletingName(normalizedSkillName);
    setSettingsError('');
    setSettingsFeedback('');

    try {
      const result = await desktopBridge.nanobotSkills.delete({
        skillName: normalizedSkillName,
      });
      if (!result?.ok) {
        setSettingsError(formatError(result?.error));
        return result;
      }
      setNanobotSkillsState(normalizeNanobotSkillsState(result));
      setSettingsFeedback(t('app.nanobotSkillsDeleteSuccess', { name: normalizedSkillName }));
      return result;
    } catch (error) {
      setSettingsError(formatError(error));
      return {
        ok: false,
        error,
      };
    } finally {
      setNanobotSkillsDeletingName('');
    }
  }, [formatError, t]);

  const onOpenNanobotSkillsLibrary = useCallback(async () => {
    setSettingsError('');
    try {
      const result = await desktopBridge.nanobotSkills.openLibrary();
      if (!result?.ok) {
        setSettingsError(formatError(result?.error));
      }
      return result;
    } catch (error) {
      setSettingsError(formatError(error));
      return {
        ok: false,
        error,
      };
    }
  }, [formatError]);

  const openClawSettings = useMemo(
    () => ({
      ...chatBackendSettings.openclaw,
      hasSecureStorage: chatBackendSettings.hasSecureStorage,
    }),
    [chatBackendSettings],
  );

  return {
    chatBackendSettings,
    openClawSettings,
    settingsSaving,
    settingsTesting,
    settingsFeedback,
    settingsError,
    onChatBackendChange,
    onOpenClawSettingChange,
    onNanobotSettingChange,
    onPickNanobotWorkspace,
    onTestChatBackendSettings,
    onTestOpenClawSettings: onTestChatBackendSettings,
    onClearSavedToken,
    nanobotRuntimeStatus,
    nanobotRuntimeInstalling,
    onInstallNanobotRuntime,
    refreshNanobotRuntimeStatus,
    nanobotSkills: nanobotSkillsState,
    nanobotSkillsLoading,
    nanobotSkillsImporting,
    nanobotSkillsDeletingName,
    onImportNanobotSkillsZip,
    onDeleteNanobotSkill,
    onOpenNanobotSkillsLibrary,
    refreshNanobotSkills,
  };
}

export function useOpenClawSettings(options) {
  return useChatBackendSettings(options);
}
