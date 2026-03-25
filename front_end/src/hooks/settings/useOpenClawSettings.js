import { useCallback, useEffect, useMemo, useState } from 'react';
import { desktopBridge } from '../../services/desktopBridge.js';

function normalizeBackendName(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'nanobot') {
    return 'nanobot';
  }
  if (normalized === 'codex') {
    return 'codex';
  }
  if (normalized === 'claude-code' || normalized === 'claude code' || normalized === 'claudecode' || normalized === 'claude_code') {
    return 'claude-code';
  }
  if (normalized === 'openclaw') {
    return 'nanobot';
  }
  return 'nanobot';
}

function normalizePermissionMode(value, fallback = 'deny') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'allow' || normalized === 'ask' || normalized === 'deny') {
    return normalized;
  }
  return fallback;
}

function normalizeAcpTransport(value, fallback = 'stdio') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'stdio') {
    return normalized;
  }
  if (normalized === 'http') {
    return normalized;
  }
  if (normalized === 'websocket' || normalized === 'ws') {
    return 'websocket';
  }
  return fallback;
}

function normalizeRunnerArgs(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeRunnerEnv(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [String(key || '').trim(), typeof item === 'string' ? item.trim() : ''])
      .filter(([key]) => Boolean(key)),
  );
}

function normalizeRunnerHeaders(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [String(key || '').trim(), typeof item === 'string' ? item.trim() : ''])
      .filter(([key]) => Boolean(key)),
  );
}

function normalizeAcpBackendForState(settings = {}, fallbackCommand = '') {
  const source = settings && typeof settings === 'object' ? settings : {};
  const runner = source.runner && typeof source.runner === 'object' ? source.runner : {};
  return {
    enabled: Boolean(source.enabled),
    timeoutMs: Number.isFinite(source.timeoutMs) ? source.timeoutMs : 120000,
    askTimeoutMs: Number.isFinite(source.askTimeoutMs) ? source.askTimeoutMs : 8000,
    permissionMode: normalizePermissionMode(source.permissionMode, 'deny'),
    runner: {
      protocol: 'acp',
      transport: normalizeAcpTransport(runner.transport, 'stdio'),
      command: typeof runner.command === 'string' && runner.command.trim() ? runner.command.trim() : fallbackCommand,
      args: normalizeRunnerArgs(runner.args),
      cwd: typeof runner.cwd === 'string' ? runner.cwd.trim() : '',
      endpoint: typeof runner.endpoint === 'string' ? runner.endpoint.trim() : '',
      url: typeof runner.url === 'string' ? runner.url.trim() : '',
      permissionEndpoint: typeof runner.permissionEndpoint === 'string' ? runner.permissionEndpoint.trim() : '',
      headers: normalizeRunnerHeaders(runner.headers),
      env: normalizeRunnerEnv(runner.env),
    },
  };
}

const defaultChatBackendSettings = {
  chatBackend: 'nanobot',
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
  claudeCode: normalizeAcpBackendForState({}, 'claude-agent-acp'),
  codex: normalizeAcpBackendForState({}, 'codex-acp'),
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
const defaultAcpRunnerBackendStatus = {
  backend: '',
  displayName: '',
  installed: false,
  installing: false,
  managedByApp: false,
  commandPath: '',
  version: '',
  expectedVersion: '',
  archiveUrl: '',
  installedAt: '',
  rootDir: '',
};
const defaultAcpRunnerStatus = {
  codex: {
    ...defaultAcpRunnerBackendStatus,
    backend: 'codex',
    displayName: 'Codex',
  },
  'claude-code': {
    ...defaultAcpRunnerBackendStatus,
    backend: 'claude-code',
    displayName: 'Claude Code',
  },
};
const defaultNanobotSkillsState = {
  libraryPath: '',
  customSkills: [],
  builtinSkills: [],
};
const SETTINGS_AUTOSAVE_DEBOUNCE_MS = 500;
const CONNECTION_TEST_TIMEOUT_MS = 75_000;

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

function normalizeAcpRunnerBackendStatus(payload = {}, fallback = {}) {
  const resolvedBackend = (() => {
    const normalized = typeof payload?.backend === 'string' ? payload.backend.trim().toLowerCase() : '';
    if (normalized === 'codex') {
      return 'codex';
    }
    if (normalized === 'claude-code' || normalized === 'claude code' || normalized === 'claudecode' || normalized === 'claude_code') {
      return 'claude-code';
    }
    return fallback.backend || '';
  })();

  return {
    ...defaultAcpRunnerBackendStatus,
    ...fallback,
    ...(payload && typeof payload === 'object' ? payload : {}),
    backend: resolvedBackend,
    displayName: typeof payload?.displayName === 'string' && payload.displayName.trim()
      ? payload.displayName.trim()
      : (fallback.displayName || ''),
    installed: Boolean(payload?.installed),
    installing: Boolean(payload?.installing),
    managedByApp: Boolean(payload?.managedByApp),
    commandPath: typeof payload?.commandPath === 'string' ? payload.commandPath.trim() : '',
    version: typeof payload?.version === 'string' ? payload.version.trim() : '',
    expectedVersion: typeof payload?.expectedVersion === 'string' ? payload.expectedVersion.trim() : '',
    archiveUrl: typeof payload?.archiveUrl === 'string' ? payload.archiveUrl.trim() : '',
    installedAt: typeof payload?.installedAt === 'string' ? payload.installedAt.trim() : '',
    rootDir: typeof payload?.rootDir === 'string' ? payload.rootDir.trim() : '',
  };
}

function normalizeAcpRunnerStatusState(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const backends = source.backends && typeof source.backends === 'object' ? source.backends : {};
  return {
    codex: normalizeAcpRunnerBackendStatus(backends.codex, {
      backend: 'codex',
      displayName: 'Codex',
    }),
    'claude-code': normalizeAcpRunnerBackendStatus(backends['claude-code'], {
      backend: 'claude-code',
      displayName: 'Claude Code',
    }),
  };
}

function buildComparableSettingsSnapshot(settings = {}) {
  const normalized = normalizeSettingsForState(settings);
  return {
    chatBackend: normalizeBackendName(normalized.chatBackend),
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
    claudeCode: {
      enabled: Boolean(normalized.claudeCode?.enabled),
      timeoutMs: Number.isFinite(normalized.claudeCode?.timeoutMs) ? normalized.claudeCode.timeoutMs : 120000,
      askTimeoutMs: Number.isFinite(normalized.claudeCode?.askTimeoutMs) ? normalized.claudeCode.askTimeoutMs : 8000,
      permissionMode: normalizePermissionMode(normalized.claudeCode?.permissionMode, 'deny'),
      runner: {
        transport: normalizeAcpTransport(normalized.claudeCode?.runner?.transport, 'stdio'),
        command: normalized.claudeCode?.runner?.command || '',
        args: normalizeRunnerArgs(normalized.claudeCode?.runner?.args),
        cwd: normalized.claudeCode?.runner?.cwd || '',
        endpoint: normalized.claudeCode?.runner?.endpoint || '',
        url: normalized.claudeCode?.runner?.url || '',
        permissionEndpoint: normalized.claudeCode?.runner?.permissionEndpoint || '',
        headers: normalizeRunnerHeaders(normalized.claudeCode?.runner?.headers),
      },
    },
    codex: {
      enabled: Boolean(normalized.codex?.enabled),
      timeoutMs: Number.isFinite(normalized.codex?.timeoutMs) ? normalized.codex.timeoutMs : 120000,
      askTimeoutMs: Number.isFinite(normalized.codex?.askTimeoutMs) ? normalized.codex.askTimeoutMs : 8000,
      permissionMode: normalizePermissionMode(normalized.codex?.permissionMode, 'deny'),
      runner: {
        transport: normalizeAcpTransport(normalized.codex?.runner?.transport, 'stdio'),
        command: normalized.codex?.runner?.command || '',
        args: normalizeRunnerArgs(normalized.codex?.runner?.args),
        cwd: normalized.codex?.runner?.cwd || '',
        endpoint: normalized.codex?.runner?.endpoint || '',
        url: normalized.codex?.runner?.url || '',
        permissionEndpoint: normalized.codex?.runner?.permissionEndpoint || '',
        headers: normalizeRunnerHeaders(normalized.codex?.runner?.headers),
      },
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
  const chatBackend = normalizeBackendName(settings?.chatBackend);

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
    claudeCode: normalizeAcpBackendForState(settings?.claudeCode, 'claude-agent-acp'),
    codex: normalizeAcpBackendForState(settings?.codex, 'codex-acp'),
    hasSecureStorage: settings?.hasSecureStorage !== false,
  };
}

export function buildChatBackendSettingsPayload(settings) {
  const source = settings || {};
  const openclawSource = source?.openclaw || source;
  const nanobotSource = source?.nanobot || {};
  const claudeCodeSource = source?.claudeCode || {};
  const codexSource = source?.codex || {};
  const chatBackend = normalizeBackendName(source?.chatBackend);

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
    claudeCode: {
      enabled: Boolean(claudeCodeSource?.enabled),
      timeoutMs: Number.isFinite(claudeCodeSource?.timeoutMs) ? claudeCodeSource.timeoutMs : 120000,
      askTimeoutMs: Number.isFinite(claudeCodeSource?.askTimeoutMs) ? claudeCodeSource.askTimeoutMs : 8000,
      permissionMode: normalizePermissionMode(claudeCodeSource?.permissionMode, 'deny'),
      runner: {
        transport: normalizeAcpTransport(claudeCodeSource?.runner?.transport, 'stdio'),
        command:
          typeof claudeCodeSource?.runner?.command === 'string' && claudeCodeSource.runner.command.trim()
            ? claudeCodeSource.runner.command.trim()
            : 'claude-agent-acp',
        args: normalizeRunnerArgs(claudeCodeSource?.runner?.args),
        cwd: typeof claudeCodeSource?.runner?.cwd === 'string' ? claudeCodeSource.runner.cwd.trim() : '',
        endpoint: typeof claudeCodeSource?.runner?.endpoint === 'string' ? claudeCodeSource.runner.endpoint.trim() : '',
        url: typeof claudeCodeSource?.runner?.url === 'string' ? claudeCodeSource.runner.url.trim() : '',
        permissionEndpoint:
          typeof claudeCodeSource?.runner?.permissionEndpoint === 'string'
            ? claudeCodeSource.runner.permissionEndpoint.trim()
            : '',
        headers: normalizeRunnerHeaders(claudeCodeSource?.runner?.headers),
        env: normalizeRunnerEnv(claudeCodeSource?.runner?.env),
      },
    },
    codex: {
      enabled: Boolean(codexSource?.enabled),
      timeoutMs: Number.isFinite(codexSource?.timeoutMs) ? codexSource.timeoutMs : 120000,
      askTimeoutMs: Number.isFinite(codexSource?.askTimeoutMs) ? codexSource.askTimeoutMs : 8000,
      permissionMode: normalizePermissionMode(codexSource?.permissionMode, 'deny'),
      runner: {
        transport: normalizeAcpTransport(codexSource?.runner?.transport, 'stdio'),
        command:
          typeof codexSource?.runner?.command === 'string' && codexSource.runner.command.trim()
            ? codexSource.runner.command.trim()
            : 'codex-acp',
        args: normalizeRunnerArgs(codexSource?.runner?.args),
        cwd: typeof codexSource?.runner?.cwd === 'string' ? codexSource.runner.cwd.trim() : '',
        endpoint: typeof codexSource?.runner?.endpoint === 'string' ? codexSource.runner.endpoint.trim() : '',
        url: typeof codexSource?.runner?.url === 'string' ? codexSource.runner.url.trim() : '',
        permissionEndpoint:
          typeof codexSource?.runner?.permissionEndpoint === 'string'
            ? codexSource.runner.permissionEndpoint.trim()
            : '',
        headers: normalizeRunnerHeaders(codexSource?.runner?.headers),
        env: normalizeRunnerEnv(codexSource?.runner?.env),
      },
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
  const [acpRunnerStatus, setAcpRunnerStatus] = useState(defaultAcpRunnerStatus);
  const [acpRunnerInstallingBackend, setAcpRunnerInstallingBackend] = useState('');
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

  const refreshAcpRunnerStatus = useCallback(async () => {
    try {
      const status = await desktopBridge.acpRunnerRuntime.status();
      setAcpRunnerStatus(normalizeAcpRunnerStatusState(status));
    } catch {
      setAcpRunnerStatus(defaultAcpRunnerStatus);
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
    void refreshAcpRunnerStatus();
    void refreshNanobotSkills();

    return () => {
      mounted = false;
    };
  }, [refreshAcpRunnerStatus, refreshNanobotRuntimeStatus, refreshNanobotSkills]);

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
      chatBackend: normalizeBackendName(backend),
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

  const onAcpBackendSettingChange = useCallback((backend, field, value) => {
    const backendKey = normalizeBackendName(backend) === 'codex' ? 'codex' : 'claudeCode';
    setChatBackendSettings((prev) => {
      const currentBackendSettings = prev?.[backendKey] || defaultChatBackendSettings[backendKey];
      const nextBackendSettings = {
        ...currentBackendSettings,
        runner: {
          ...(currentBackendSettings?.runner || {}),
        },
      };

      if (field.startsWith('runner.')) {
        const runnerField = field.slice('runner.'.length);
        nextBackendSettings.runner = {
          ...nextBackendSettings.runner,
          [runnerField]: value,
        };
      } else {
        nextBackendSettings[field] = value;
      }

      return {
        ...prev,
        [backendKey]: nextBackendSettings,
      };
    });
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

  const onOpenNanobotWorkspace = useCallback(async () => {
    setSettingsError('');
    try {
      const result = await desktopBridge.settings.openNanobotWorkspace();
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

  const onTestChatBackendSettings = useCallback(async () => {
    setSettingsTesting(true);
    setSettingsError('');
    setSettingsFeedback('');

    try {
      const payload = buildChatBackendSettingsPayload(chatBackendSettings);
      let timeoutId = null;
      const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          resolve({
            ok: false,
            error: {
              code: 'chat_backend_test_timeout',
              message: `连接测试超时（>${Math.floor(CONNECTION_TEST_TIMEOUT_MS / 1000)}s），请重试。`,
            },
          });
        }, CONNECTION_TEST_TIMEOUT_MS);
      });
      const result = await Promise.race([
        desktopBridge.settings.testConnection(payload),
        timeoutPromise,
      ]);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
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

  const onInstallAcpRunner = useCallback(async (backend, options = {}) => {
    const normalizedBackend = normalizeBackendName(backend);
    if (normalizedBackend !== 'codex' && normalizedBackend !== 'claude-code') {
      return {
        ok: false,
        error: {
          code: 'acp_runner_backend_invalid',
          message: 'Unsupported ACP backend.',
        },
      };
    }
    const force = options?.force === true;

    setAcpRunnerInstallingBackend(normalizedBackend);
    setSettingsError('');
    setSettingsFeedback('');

    try {
      const result = await desktopBridge.acpRunnerRuntime.install({
        backend: normalizedBackend,
        force,
      });

      if (!result?.ok) {
        setSettingsError(formatError(result?.error));
        return result;
      }

      await refreshAcpRunnerStatus();

      try {
        const settings = await desktopBridge.settings.get();
        const normalized = normalizeSettingsForState(settings);
        setChatBackendSettings(normalized);
        setSavedSettingsSnapshot(buildComparableSettingsSnapshot(normalized));
      } catch (reloadError) {
        console.warn('Failed to refresh settings after ACP runner install:', reloadError);
      }

      const backendLabel = normalizedBackend === 'codex' ? t('app.backend.codex') : t('app.backend.claudeCode');
      setSettingsFeedback(t('app.acpRunnerInstalled', { backend: backendLabel }));
      return result;
    } catch (error) {
      setSettingsError(formatError(error));
      return {
        ok: false,
        error,
      };
    } finally {
      setAcpRunnerInstallingBackend('');
    }
  }, [formatError, refreshAcpRunnerStatus, t]);

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
    onAcpBackendSettingChange,
    onPickNanobotWorkspace,
    onOpenNanobotWorkspace,
    onTestChatBackendSettings,
    onTestOpenClawSettings: onTestChatBackendSettings,
    onClearSavedToken,
    nanobotRuntimeStatus,
    nanobotRuntimeInstalling,
    onInstallNanobotRuntime,
    refreshNanobotRuntimeStatus,
    acpRunnerStatus,
    acpRunnerInstallingBackend,
    onInstallAcpRunner,
    refreshAcpRunnerStatus,
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
