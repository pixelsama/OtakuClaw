import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ConfigDrawer from './components/config/ConfigDrawer.jsx';
import ChatSidebar from './components/chat/ChatSidebar.jsx';
import PermissionRequestDialog from './components/chat/PermissionRequestDialog.jsx';
import UnifiedDownloadDialog from './components/download/UnifiedDownloadDialog.jsx';
import FirstRunOnboardingDialog from './components/onboarding/FirstRunOnboardingDialog.jsx';
import { useScreenCaptureController } from './hooks/chat/useScreenCaptureController.js';
import { useStreamingSubtitleBridge } from './hooks/chat/useStreamingSubtitleBridge.js';
import { useTextComposerController } from './hooks/chat/useTextComposerController.js';
import { useChatHistory } from './hooks/chat/useChatHistory.js';
import { useConfigPanelController } from './hooks/config/useConfigPanelController.js';
import { useUnifiedDownloader } from './hooks/download/useUnifiedDownloader.js';
import { useStreamingChat } from './hooks/useStreamingChat.js';
import { useSubtitleFeed } from './hooks/useSubtitleFeed.js';
import { usePetHoverPassthrough } from './hooks/pet/usePetHoverPassthrough.js';
import { usePetCursorTracking } from './hooks/pet/usePetCursorTracking.js';
import { useChatBackendSettings } from './hooks/settings/useOpenClawSettings.js';
import { usePlatformInfo } from './hooks/window/usePlatformInfo.js';
import { useVoiceMicToggle } from './hooks/voice/useVoiceMicToggle.js';
import { subscribeTtsPlaybackLifecycle } from './hooks/voice/ttsPlaybackLifecycle.js';
import { buildVoiceStreamRequest } from './hooks/voice/voiceStreamRequest.js';
import {
  buildOfficeDisplayState,
  derivePrimaryOfficeAgent,
  normalizeOfficeAgent,
  normalizeOfficeSceneLayout,
  normalizeOfficeState,
  OFFICE_PRIMARY_AGENT_ID,
  reduceOfficeActivityHint,
  resolveOfficeRoomTheme,
  resolveOfficeSceneEditorState,
  resolveOfficeSceneState,
} from './components/office/officeSceneConfig.js';
import { OFFICE_SCENE_ASSET_REGISTRY } from './components/office/officeSceneAssets.js';
import {
  buildOfficeSceneAssetRegistry,
  normalizePixelPackState,
} from './components/office/pixelPack.js';
import { ModeProvider, MODE_PET, MODE_WINDOW, useModeContext } from './mode/ModeContext.jsx';
import MainShell from './shells/MainShell.jsx';
import PetShell from './shells/PetShell.jsx';
import { desktopBridge } from './services/desktopBridge.js';
import { I18nProvider, useI18n } from './i18n/I18nContext.jsx';
import { normalizeErrorMessage } from './utils/normalizeErrorMessage.js';

const DEFAULT_MODEL = '';
const CONFIG_DRAWER_WIDTH = 420;
const AGENT_ROLE_CONFIG_STORAGE_KEY = 'openclaw.agentRoleConfig.v1';
const SUPPORTED_AGENT_BACKENDS = new Set(['nanobot', 'claude-code', 'codex']);
const SUPPORTED_AGENT_ROLE_STATES = new Set([
  'idle',
  'writing',
  'researching',
  'executing',
  'syncing',
  'error',
]);

function normalizeAgentBackend(value, fallback = 'nanobot') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_AGENT_BACKENDS.has(normalized) ? normalized : fallback;
}

function normalizeStoredAgentRole(entry = {}, fallbackId = '') {
  const source = entry && typeof entry === 'object' ? entry : {};
  const normalized = normalizeOfficeAgent(entry, fallbackId);
  const agentId = typeof normalized?.agentId === 'string' ? normalized.agentId.trim() : '';
  if (!agentId || agentId === OFFICE_PRIMARY_AGENT_ID) {
    return null;
  }
  const businessState = SUPPORTED_AGENT_ROLE_STATES.has(normalized.businessState)
    ? normalized.businessState
    : 'idle';
  return {
    agentId,
    id: agentId,
    displayName: normalized.displayName,
    role: normalized.role || 'support',
    businessState,
    detail: normalized.detail || '',
    backend: normalizeAgentBackend(source.backend, 'nanobot'),
    live2dModelPath: typeof source.live2dModelPath === 'string' ? source.live2dModelPath.trim() : '',
  };
}

function loadStoredAgentRoleConfig() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { agents: [], activeAgentId: '' };
  }
  try {
    const raw = window.localStorage.getItem(AGENT_ROLE_CONFIG_STORAGE_KEY);
    if (!raw) {
      return { agents: [], activeAgentId: '' };
    }
    const parsed = JSON.parse(raw);
    const sourceAgents = Array.isArray(parsed?.agents) ? parsed.agents : [];
    const agents = sourceAgents
      .map((item, index) => normalizeStoredAgentRole(item, `agent-${index + 1}`))
      .filter(Boolean);
    const activeAgentId = typeof parsed?.activeAgentId === 'string' ? parsed.activeAgentId.trim() : '';
    return {
      agents,
      activeAgentId: activeAgentId === OFFICE_PRIMARY_AGENT_ID ? '' : activeAgentId,
    };
  } catch (error) {
    console.warn('Failed to parse stored agent role config:', error);
    return { agents: [], activeAgentId: '' };
  }
}

function saveStoredAgentRoleConfig(config = {}) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(
      AGENT_ROLE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        agents: Array.isArray(config.agents) ? config.agents : [],
        activeAgentId: typeof config.activeAgentId === 'string' ? config.activeAgentId : '',
      }),
    );
  } catch (error) {
    console.warn('Failed to persist agent role config:', error);
  }
}

const DEFAULT_AVATAR_SETTINGS = {
  renderMode: 'live2d',
  live2d: {
    selectedModelPath: '',
  },
  static: {
    selectedPackId: '',
    scale: 1,
    hitTest: {
      mode: 'alpha',
      alphaThreshold: 10,
    },
  },
};

function normalizeAvatarRenderMode(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'static' ? 'static' : 'live2d';
}

function normalizeAvatarSettings(source = {}) {
  const avatar = source && typeof source === 'object' ? source : {};
  const live2d = avatar.live2d && typeof avatar.live2d === 'object' ? avatar.live2d : {};
  const staticAvatar = avatar.static && typeof avatar.static === 'object' ? avatar.static : {};
  const hitTest = staticAvatar.hitTest && typeof staticAvatar.hitTest === 'object' ? staticAvatar.hitTest : {};

  return {
    renderMode: normalizeAvatarRenderMode(avatar.renderMode),
    live2d: {
      selectedModelPath:
        typeof live2d.selectedModelPath === 'string'
          ? live2d.selectedModelPath.trim()
          : DEFAULT_AVATAR_SETTINGS.live2d.selectedModelPath,
    },
    static: {
      selectedPackId:
        typeof staticAvatar.selectedPackId === 'string'
          ? staticAvatar.selectedPackId.trim()
          : DEFAULT_AVATAR_SETTINGS.static.selectedPackId,
      scale: Number.isFinite(staticAvatar.scale)
        ? Math.max(0.1, Math.min(3, staticAvatar.scale))
        : DEFAULT_AVATAR_SETTINGS.static.scale,
      hitTest: {
        mode: hitTest.mode === 'rect' ? 'rect' : 'alpha',
        alphaThreshold: Number.isFinite(hitTest.alphaThreshold)
          ? Math.max(0, Math.min(255, hitTest.alphaThreshold))
          : DEFAULT_AVATAR_SETTINGS.static.hitTest.alphaThreshold,
      },
    },
  };
}

function AppContent({ desktopMode }) {
  const live2dViewerRef = useRef(null);
  const { isPetMode, setMode } = useModeContext();
  const muiTheme = useTheme();
  const isNarrowViewport = useMediaQuery('(max-width:900px)');
  const { t } = useI18n();

  const [modelLoaded, setModelLoaded] = useState(false);
  const [avatarRenderMode, setAvatarRenderMode] = useState(DEFAULT_AVATAR_SETTINGS.renderMode);
  const [staticAvatarPacks, setStaticAvatarPacks] = useState([]);
  const [selectedStaticAvatarId, setSelectedStaticAvatarId] = useState('');
  const [staticAvatarScale, setStaticAvatarScale] = useState(DEFAULT_AVATAR_SETTINGS.static.scale);
  const [staticAvatarHitTest, setStaticAvatarHitTest] = useState(DEFAULT_AVATAR_SETTINGS.static.hitTest);
  const [motions, setMotions] = useState([]);
  const [expressions, setExpressions] = useState([]);
  const [officeStateSnapshot, setOfficeStateSnapshot] = useState(() => normalizeOfficeState());
  const [officeSceneLayout, setOfficeSceneLayout] = useState(() => normalizeOfficeSceneLayout());
  const [officeActivityHint, setOfficeActivityHint] = useState(null);
  const [officePreviewMode, setOfficePreviewMode] = useState('live');
  const [agentRoleConfig, setAgentRoleConfig] = useState(() => loadStoredAgentRoleConfig());
  const [mainWindowViewMode, setMainWindowViewMode] = useState('office');
  const [immersiveContext, setImmersiveContext] = useState(null);
  const [valueStateSnapshot, setValueStateSnapshot] = useState(null);
  const [pixelPackState, setPixelPackState] = useState(() => normalizePixelPackState());
  const [pixelPackBusyAction, setPixelPackBusyAction] = useState('');
  const [pixelPackFeedback, setPixelPackFeedback] = useState('');
  const [pixelPackError, setPixelPackError] = useState('');
  const [builtinTtsEnabled, setBuiltinTtsEnabled] = useState(false);
  const [firstRunOnboardingOpen, setFirstRunOnboardingOpen] = useState(false);
  const [officeLayoutLoaded, setOfficeLayoutLoaded] = useState(!desktopMode);
  const initialAgentRoleConfigRef = useRef(agentRoleConfig);
  const savedOfficeLayoutSnapshotRef = useRef(JSON.stringify(normalizeOfficeSceneLayout()));
  const savedAvatarSettingsSnapshotRef = useRef(JSON.stringify(normalizeAvatarSettings(DEFAULT_AVATAR_SETTINGS)));
  const platform = usePlatformInfo({ desktopMode });

  // Chat history — persists to localStorage
  const {
    messages: chatMessages,
    addUserMessage,
    startAiMessage,
    appendAiDelta,
    finalizeAiMessage,
    cancelAiMessage,
    clearHistory,
  } = useChatHistory();
  const activeAiMsgIdRef = useRef(null);
  const [pendingCaptureDraft, setPendingCaptureDraft] = useState(null);
  const pendingCaptureDraftRef = useRef(null);
  const [permissionRequestQueue, setPermissionRequestQueue] = useState([]);
  const [permissionDecisionSubmitting, setPermissionDecisionSubmitting] = useState(false);

  const resolveAcpRunnerTaskMeta = useCallback((backend) => {
    const normalized = typeof backend === 'string' ? backend.trim().toLowerCase() : '';
    if (normalized === 'codex') {
      return {
        taskId: 'acp-runner:codex',
        title: t('download.codexRunnerTitle'),
      };
    }
    return {
      taskId: 'acp-runner:claude-code',
      title: t('download.claudeRunnerTitle'),
    };
  }, [t]);

  const { subtitleText, appendDelta, setSegmentText, finishStream, clearSubtitle, beginStream } = useSubtitleFeed();
  const { startStreaming: _startStreaming, cancelStreaming, onDelta, onSegmentReady, onDone, onError, isStreaming } =
    useStreamingChat();
  const onConversationEvent = useCallback(
    (handler) => {
      if (!desktopMode || typeof handler !== 'function') {
        return () => {};
      }
      return desktopBridge.conversation.onEvent(handler);
    },
    [desktopMode],
  );
  const normalizeError = useCallback((error) => normalizeErrorMessage(error, t), [t]);
  const {
    chatBackendSettings,
    settingsSaving,
    settingsTesting,
    settingsFeedback,
    settingsError,
    onOpenClawSettingChange,
    onNanobotSettingChange,
    onAcpBackendSettingChange,
    onPickNanobotWorkspace,
    onOpenNanobotWorkspace,
    onTestChatBackendSettings,
    onClearSavedToken,
    nanobotRuntimeStatus,
    nanobotRuntimeInstalling,
    onInstallNanobotRuntime,
    acpRunnerStatus,
    acpRunnerInstallingBackend,
    onInstallAcpRunner,
    nanobotSkills,
    nanobotSkillsLoading,
    nanobotSkillsImporting,
    nanobotSkillsDeletingName,
    onImportNanobotSkillsZip,
    onDeleteNanobotSkill,
    onOpenNanobotSkillsLibrary,
  } = useChatBackendSettings({
    t,
    normalizeError,
  });

  const configuredAgentMap = useMemo(() => {
    const byId = new Map();
    const sourceAgents = Array.isArray(agentRoleConfig?.agents) ? agentRoleConfig.agents : [];
    for (const agent of sourceAgents) {
      const normalized = normalizeStoredAgentRole(agent, '');
      if (normalized?.agentId) {
        byId.set(normalized.agentId, normalized);
      }
    }
    return byId;
  }, [agentRoleConfig?.agents]);

  const resolvedConversationAgentId = useMemo(() => {
    const immersiveAgentId =
      typeof immersiveContext?.agentId === 'string' && immersiveContext.agentId.trim()
        ? immersiveContext.agentId.trim()
        : '';
    if (immersiveAgentId) {
      return immersiveAgentId;
    }
    const officeActiveAgentId =
      typeof officeStateSnapshot?.activeAgentId === 'string' && officeStateSnapshot.activeAgentId.trim()
        ? officeStateSnapshot.activeAgentId.trim()
        : '';
    if (officeActiveAgentId) {
      return officeActiveAgentId;
    }
    const storedActiveAgentId =
      typeof agentRoleConfig?.activeAgentId === 'string' && agentRoleConfig.activeAgentId.trim()
        ? agentRoleConfig.activeAgentId.trim()
        : '';
    return storedActiveAgentId || OFFICE_PRIMARY_AGENT_ID;
  }, [agentRoleConfig?.activeAgentId, immersiveContext?.agentId, officeStateSnapshot?.activeAgentId]);

  const activeConfiguredAgent = useMemo(
    () => configuredAgentMap.get(resolvedConversationAgentId) || null,
    [configuredAgentMap, resolvedConversationAgentId],
  );

  const activeConversationBackend = useMemo(
    () =>
      normalizeAgentBackend(
        activeConfiguredAgent?.backend,
        normalizeAgentBackend(chatBackendSettings?.chatBackend, 'nanobot'),
      ),
    [activeConfiguredAgent?.backend, chatBackendSettings?.chatBackend],
  );

  const currentModelPath = activeConfiguredAgent?.live2dModelPath || DEFAULT_MODEL;

  // Wrapped startStreaming that also tracks chat history
  const startStreaming = useCallback(
    async (sessionId, content, extras) => {
      const text = typeof content === 'string' ? content.trim() : '';
      const attachments =
        Array.isArray(extras?.attachments) ? extras.attachments : [];
      if (text) {
        addUserMessage(text, attachments);
        activeAiMsgIdRef.current = startAiMessage();
      }

      const pendingCapture = pendingCaptureDraftRef.current;
      const hasSubmittedPendingCapture = Boolean(
        pendingCapture?.captureId
          && attachments.some(
            (attachment) =>
              attachment?.kind === 'capture-image'
              && attachment.captureId === pendingCapture.captureId,
          ),
      );
      if (hasSubmittedPendingCapture) {
        pendingCaptureDraftRef.current = null;
        setPendingCaptureDraft(null);
      }

      const safeExtras = extras && typeof extras === 'object' ? extras : {};
      const options = safeExtras.options && typeof safeExtras.options === 'object' ? safeExtras.options : {};
      const explicitAgentId =
        (typeof safeExtras.agentId === 'string' && safeExtras.agentId.trim())
        || (typeof options.agentId === 'string' && options.agentId.trim())
        || '';
      const explicitBackend =
        typeof safeExtras.backend === 'string' && safeExtras.backend.trim()
          ? normalizeAgentBackend(safeExtras.backend, '')
          : '';
      const mergedOptions = {
        ...options,
        ...(explicitAgentId ? { agentId: explicitAgentId } : { agentId: resolvedConversationAgentId }),
      };
      const mergedExtras = {
        ...safeExtras,
        backend: explicitBackend || activeConversationBackend,
        options: mergedOptions,
      };
      await _startStreaming(sessionId, content, mergedExtras);
    },
    [_startStreaming, activeConversationBackend, addUserMessage, resolvedConversationAgentId, startAiMessage],
  );

  // Track AI streaming response into chat history
  useEffect(() => {
    const handleDelta = (delta) => {
      if (activeAiMsgIdRef.current) {
        appendAiDelta(activeAiMsgIdRef.current, delta);
      }
    };
    const handleDone = () => {
      if (activeAiMsgIdRef.current) {
        finalizeAiMessage(activeAiMsgIdRef.current);
        activeAiMsgIdRef.current = null;
      }
    };
    const handleError = () => {
      if (activeAiMsgIdRef.current) {
        cancelAiMessage(activeAiMsgIdRef.current);
        activeAiMsgIdRef.current = null;
      }
    };

    const detachDelta = onDelta(handleDelta);
    const detachDone = onDone(handleDone);
    const detachError = onError(handleError);
    return () => {
      detachDelta();
      detachDone();
      detachError();
    };
  }, [appendAiDelta, cancelAiMessage, finalizeAiMessage, onDelta, onDone, onError]);
  const {
    taskMap,
    activeTask,
    dialogOpen: downloadDialogOpen,
    detailsOpen: downloadDetailsOpen,
    setDetailsOpen: setDownloadDetailsOpen,
    closeDialog: closeDownloadDialog,
    openTask: openDownloadTask,
    ensureTask: ensureDownloadTask,
    handleProgress: handleDownloadProgress,
  } = useUnifiedDownloader();

  const activeDownloadTasks = useMemo(
    () =>
      Object.values(taskMap).filter((task) => {
        const phase = typeof task?.phase === 'string' ? task.phase.trim().toLowerCase() : 'idle';
        return phase && !['idle', 'completed', 'failed'].includes(phase);
      }),
    [taskMap],
  );
  const {
    releaseCapture,
    startScreenCapture,
  } = useScreenCaptureController({
    desktopMode,
  });

  const clearPendingCaptureDraft = useCallback(
    ({ release = true } = {}) => {
      const current = pendingCaptureDraftRef.current;
      if (!current) {
        return;
      }

      pendingCaptureDraftRef.current = null;
      setPendingCaptureDraft(null);

      if (release && current.captureId) {
        void releaseCapture(current.captureId);
      }
    },
    [releaseCapture],
  );

  const replacePendingCaptureDraft = useCallback(
    (nextDraft) => {
      const normalizedDraft =
        nextDraft && typeof nextDraft.captureId === 'string' && nextDraft.captureId.trim()
          ? {
              captureId: nextDraft.captureId.trim(),
              previewUrl:
                typeof nextDraft.previewUrl === 'string' && nextDraft.previewUrl.trim()
                  ? nextDraft.previewUrl
                  : null,
              name: typeof nextDraft.name === 'string' ? nextDraft.name : '',
            }
          : null;

      const current = pendingCaptureDraftRef.current;
      if (
        current?.captureId
        && current.captureId !== normalizedDraft?.captureId
      ) {
        void releaseCapture(current.captureId);
      }

      pendingCaptureDraftRef.current = normalizedDraft;
      setPendingCaptureDraft(normalizedDraft);
      return normalizedDraft;
    },
    [releaseCapture],
  );

  const captureScreenToPendingDraft = useCallback(async () => {
    const result = await startScreenCapture();
    if (!result?.captureId) {
      return result || null;
    }

    return replacePendingCaptureDraft({
      captureId: result.captureId,
      previewUrl: result.previewUrl || null,
      name: result.name || '',
    });
  }, [replacePendingCaptureDraft, startScreenCapture]);

  useEffect(
    () => () => {
      const current = pendingCaptureDraftRef.current;
      if (!current?.captureId) {
        return;
      }
      void releaseCapture(current.captureId);
    },
    [releaseCapture],
  );

  useEffect(() => {
    if (!desktopMode) {
      return () => {};
    }

    const offVoiceModelProgress = desktopBridge.voiceModels.onDownloadProgress((payload = {}) => {
      const taskId =
        typeof payload.taskId === 'string' && payload.taskId.trim()
          ? payload.taskId.trim()
          : 'voice-models';
      const taskTitle =
        typeof payload.taskTitle === 'string' && payload.taskTitle.trim()
          ? payload.taskTitle.trim()
          : t('download.voiceModelsTitle');
      handleDownloadProgress({
        taskId,
        title: taskTitle,
        payload,
        suppressAutoOpen: firstRunOnboardingOpen,
      });
    });

    const offNanobotRuntimeProgress = desktopBridge.nanobotRuntime.onProgress((payload = {}) => {
      handleDownloadProgress({
        taskId: 'nanobot-runtime',
        title: t('download.nanobotRuntimeTitle'),
        payload,
        suppressAutoOpen: firstRunOnboardingOpen,
      });
    });

    const offAcpRunnerProgress = desktopBridge.acpRunnerRuntime.onProgress((payload = {}) => {
      const backend = typeof payload?.backend === 'string' ? payload.backend.trim().toLowerCase() : '';
      const { taskId, title } = resolveAcpRunnerTaskMeta(backend);
      handleDownloadProgress({
        taskId,
        title,
        payload: {
          ...payload,
          backend,
        },
        suppressAutoOpen: firstRunOnboardingOpen,
      });
    });

    return () => {
      offVoiceModelProgress?.();
      offNanobotRuntimeProgress?.();
      offAcpRunnerProgress?.();
    };
  }, [desktopMode, firstRunOnboardingOpen, handleDownloadProgress, resolveAcpRunnerTaskMeta, t]);

  const syncBuiltinTtsEnabled = useCallback((result = {}) => {
    const selectedTtsBundleId =
      typeof result?.selectedTtsBundleId === 'string' ? result.selectedTtsBundleId.trim() : '';
    setBuiltinTtsEnabled(Boolean(result?.ok && selectedTtsBundleId));
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!desktopMode) {
      setBuiltinTtsEnabled(false);
      return () => {
        cancelled = true;
      };
    }

    const loadVoiceModelSelection = async () => {
      try {
        const result = await desktopBridge.voiceModels.list();
        if (!cancelled) {
          syncBuiltinTtsEnabled(result);
        }
      } catch {
        if (!cancelled) {
          setBuiltinTtsEnabled(false);
        }
      }
    };

    void loadVoiceModelSelection();

    return () => {
      cancelled = true;
    };
  }, [desktopMode, syncBuiltinTtsEnabled]);

  useEffect(() => {
    let cancelled = false;

    if (!desktopMode) {
      setPixelPackState(normalizePixelPackState());
      setPixelPackBusyAction('');
      setPixelPackFeedback('');
      setPixelPackError('');
      return () => {
        cancelled = true;
      };
    }

    const loadPixelPackState = async () => {
      try {
        const result = await desktopBridge.pixelPack.getState();
        if (!cancelled) {
          setPixelPackState(normalizePixelPackState(result?.state || result || {}));
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to load pixel pack state:', error);
        }
      }
    };

    void loadPixelPackState();

    const unsubscribe = desktopBridge.pixelPack.onState((payload = {}) => {
      if (cancelled) {
        return;
      }
      setPixelPackState(normalizePixelPackState(payload?.state || payload || {}));
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [desktopMode]);

  useEffect(() => {
    let cancelled = false;

    if (!desktopMode) {
      setOfficeSceneLayout(normalizeOfficeSceneLayout());
      setOfficeLayoutLoaded(true);
      savedOfficeLayoutSnapshotRef.current = JSON.stringify(normalizeOfficeSceneLayout());
      return () => {
        cancelled = true;
      };
    }

    const loadOfficeSceneLayout = async () => {
      try {
        const settings = await desktopBridge.settings.get();
        if (cancelled) {
          return;
        }
        const normalizedLayout = normalizeOfficeSceneLayout(settings?.ui?.officeSceneLayout || {});
        setOfficeSceneLayout(normalizedLayout);
        savedOfficeLayoutSnapshotRef.current = JSON.stringify(normalizedLayout);
      } catch (error) {
        console.warn('Failed to load office scene layout settings:', error);
      } finally {
        if (!cancelled) {
          setOfficeLayoutLoaded(true);
        }
      }
    };

    void loadOfficeSceneLayout();

    return () => {
      cancelled = true;
    };
  }, [desktopMode]);

  useEffect(() => {
    if (!desktopMode || !officeLayoutLoaded) {
      return () => {};
    }

    const normalizedLayout = normalizeOfficeSceneLayout(officeSceneLayout);
    const nextSnapshot = JSON.stringify(normalizedLayout);
    if (nextSnapshot === savedOfficeLayoutSnapshotRef.current) {
      return () => {};
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const saved = await desktopBridge.settings.save({
            ui: {
              officeSceneLayout: normalizedLayout,
            },
          });
          const savedLayout = normalizeOfficeSceneLayout(saved?.ui?.officeSceneLayout || normalizedLayout);
          setOfficeSceneLayout(savedLayout);
          savedOfficeLayoutSnapshotRef.current = JSON.stringify(savedLayout);
        } catch (error) {
          console.warn('Failed to persist office scene layout settings:', error);
        }
      })();
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [desktopMode, officeLayoutLoaded, officeSceneLayout]);

  useEffect(() => {
    let cancelled = false;

    if (!desktopMode) {
      const normalizedDefaults = normalizeAvatarSettings(DEFAULT_AVATAR_SETTINGS);
      setAvatarRenderMode(normalizedDefaults.renderMode);
      setStaticAvatarPacks([]);
      setSelectedStaticAvatarId(normalizedDefaults.static.selectedPackId);
      setStaticAvatarScale(normalizedDefaults.static.scale);
      setStaticAvatarHitTest(normalizedDefaults.static.hitTest);
      savedAvatarSettingsSnapshotRef.current = JSON.stringify(normalizedDefaults);
      return () => {
        cancelled = true;
      };
    }

    const loadAvatarSettings = async () => {
      try {
        const [settings, packResult] = await Promise.all([
          desktopBridge.settings.get(),
          desktopBridge.staticAvatars.list().catch(() => ({ ok: false, packs: [] })),
        ]);
        if (cancelled) {
          return;
        }

        const normalizedAvatar = normalizeAvatarSettings(settings?.ui?.avatar || {});
        const packs = Array.isArray(packResult?.packs) ? packResult.packs : [];
        const selectedPackId = packs.some((item) => item.packId === normalizedAvatar.static.selectedPackId)
          ? normalizedAvatar.static.selectedPackId
          : packs[0]?.packId || '';

        setAvatarRenderMode(normalizedAvatar.renderMode);
        setStaticAvatarPacks(packs);
        setSelectedStaticAvatarId(selectedPackId);
        setStaticAvatarScale(normalizedAvatar.static.scale);
        setStaticAvatarHitTest(normalizedAvatar.static.hitTest);

        savedAvatarSettingsSnapshotRef.current = JSON.stringify({
          ...normalizedAvatar,
          static: {
            ...normalizedAvatar.static,
            selectedPackId,
          },
        });
      } catch (error) {
        console.warn('Failed to load avatar settings:', error);
      }
    };

    void loadAvatarSettings();

    return () => {
      cancelled = true;
    };
  }, [desktopMode]);

  useEffect(() => {
    if (!desktopMode) {
      return () => {};
    }

    const snapshot = JSON.stringify(normalizeAvatarSettings({
      renderMode: avatarRenderMode,
      live2d: {
        selectedModelPath: DEFAULT_AVATAR_SETTINGS.live2d.selectedModelPath,
      },
      static: {
        selectedPackId: selectedStaticAvatarId,
        scale: staticAvatarScale,
        hitTest: staticAvatarHitTest,
      },
    }));
    if (snapshot === savedAvatarSettingsSnapshotRef.current) {
      return () => {};
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const saved = await desktopBridge.settings.save({
            ui: {
              avatar: {
                renderMode: avatarRenderMode,
                live2d: {
                  selectedModelPath: DEFAULT_AVATAR_SETTINGS.live2d.selectedModelPath,
                },
                static: {
                  selectedPackId: selectedStaticAvatarId,
                  scale: staticAvatarScale,
                  hitTest: staticAvatarHitTest,
                },
              },
            },
          });
          const normalizedSaved = normalizeAvatarSettings(saved?.ui?.avatar || {});
          setAvatarRenderMode(normalizedSaved.renderMode);
          setStaticAvatarScale(normalizedSaved.static.scale);
          setStaticAvatarHitTest(normalizedSaved.static.hitTest);
          setSelectedStaticAvatarId((current) => {
            const nextId = normalizedSaved.static.selectedPackId;
            return nextId || current;
          });
          savedAvatarSettingsSnapshotRef.current = JSON.stringify(normalizedSaved);
        } catch (error) {
          console.warn('Failed to persist avatar settings:', error);
        }
      })();
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    avatarRenderMode,
    desktopMode,
    selectedStaticAvatarId,
    staticAvatarHitTest,
    staticAvatarScale,
  ]);

  useEffect(() => {
    let cancelled = false;

    if (!desktopMode) {
      setFirstRunOnboardingOpen(false);
      return () => {
        cancelled = true;
      };
    }

    const loadOnboardingState = async () => {
      try {
        const settings = await desktopBridge.settings.get();
        if (cancelled) {
          return;
        }
        const completed = Boolean(settings?.ui?.onboarding?.completed);
        setFirstRunOnboardingOpen(!completed);
      } catch {
        if (!cancelled) {
          setFirstRunOnboardingOpen(true);
        }
      }
    };

    void loadOnboardingState();

    return () => {
      cancelled = true;
    };
  }, [desktopMode]);

  const handleInstallNanobotRuntime = useCallback(async () => {
    ensureDownloadTask({
      taskId: 'nanobot-runtime',
      title: t('download.nanobotRuntimeTitle'),
    });
    openDownloadTask('nanobot-runtime');
    await onInstallNanobotRuntime();
  }, [ensureDownloadTask, onInstallNanobotRuntime, openDownloadTask, t]);

  const handleInstallNanobotRuntimeFromOnboarding = useCallback(async () => {
    ensureDownloadTask({
      taskId: 'nanobot-runtime',
      title: t('download.nanobotRuntimeTitle'),
    });
    await onInstallNanobotRuntime();
  }, [ensureDownloadTask, onInstallNanobotRuntime, t]);

  const handleInstallAcpRunner = useCallback(async (backend, options = {}) => {
    const { taskId, title } = resolveAcpRunnerTaskMeta(backend);
    ensureDownloadTask({
      taskId,
      title,
    });
    openDownloadTask(taskId);
    await onInstallAcpRunner(backend, options);
  }, [ensureDownloadTask, onInstallAcpRunner, openDownloadTask, resolveAcpRunnerTaskMeta]);

  const handleFinishFirstRunOnboarding = useCallback(async () => {
    try {
      await desktopBridge.settings.save({
        ui: {
          onboarding: {
            completed: true,
            completedAt: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      console.warn('Failed to persist onboarding completion state:', error);
    } finally {
      setFirstRunOnboardingOpen(false);
    }
  }, []);

  const { showConfigPanel, openConfigPanel: _openConfigPanel, closeConfigPanel } = useConfigPanelController({
    isPetMode,
    live2dViewerRef,
  });

  // Chat panel state — mutually exclusive with settings panel
  const [showChatPanel, setShowChatPanel] = useState(false);
  const closeChatSyncTimeoutRef = useRef(null);

  const openChatPanel = useCallback(() => {
    _openConfigPanel && closeConfigPanel();
    setShowChatPanel(true);
  }, [closeConfigPanel, _openConfigPanel]);

  const closeChatPanel = useCallback(() => {
    setShowChatPanel(false);
    // Give drawer slide-out animation time to finish, then sync canvas
    if (closeChatSyncTimeoutRef.current) {
      window.clearTimeout(closeChatSyncTimeoutRef.current);
    }
    closeChatSyncTimeoutRef.current = window.setTimeout(() => {
      closeChatSyncTimeoutRef.current = null;
      live2dViewerRef.current?.syncCanvasSize?.();
    }, 260);
  }, [live2dViewerRef]);

  // When settings opens, close chat panel (and vice versa is handled in openChatPanel)
  const openConfigPanel = useCallback(() => {
    setShowChatPanel(false);
    _openConfigPanel();
  }, [_openConfigPanel]);

  useEffect(
    () => () => {
      if (closeChatSyncTimeoutRef.current) {
        window.clearTimeout(closeChatSyncTimeoutRef.current);
      }
    },
    [],
  );

  // Close chat panel in pet mode (like config panel)
  useEffect(() => {
    if (isPetMode) {
      setShowChatPanel(false);
    }
  }, [isPetMode]);

  const { setComposerExternalError, textComposerProps } = useTextComposerController({
    beginStream,
    startStreaming,
    cancelStreaming,
    isStreaming,
  });
  const triggerPetQuickCapture = useCallback(() => {
    void captureScreenToPendingDraft().catch((error) => {
      setComposerExternalError(typeof error?.message === 'string' ? error.message : '');
    });
  }, [captureScreenToPendingDraft, setComposerExternalError]);
  const submitVoiceText = useCallback(
    async (content, request = {}) => {
      const streamRequest = buildVoiceStreamRequest({
        content,
        defaultSessionId: 'text-composer',
        request,
      });
      if (!streamRequest.content) {
        console.warn('[voice-submit] Skipped voice submission because content was empty.', {
          sessionId: streamRequest.sessionId,
          source: streamRequest.extras?.options?.source || 'voice-asr',
        });
        return;
      }

      console.info('[voice-submit] Forwarding voice text to streaming chat.', {
        sessionId: streamRequest.sessionId,
        source: streamRequest.extras?.options?.source || 'voice-asr',
        textLength: streamRequest.content.length,
      });

      const pendingCapture = pendingCaptureDraftRef.current;
      const baseAttachments = Array.isArray(streamRequest.extras?.attachments)
        ? streamRequest.extras.attachments
        : [];
      const hasPendingCaptureAttachment = Boolean(
        pendingCapture?.captureId
        && baseAttachments.some(
          (attachment) =>
            attachment?.kind === 'capture-image'
            && attachment.captureId === pendingCapture.captureId,
        ),
      );
      const attachments =
        pendingCapture?.captureId && !hasPendingCaptureAttachment
          ? [
              ...baseAttachments,
              {
                kind: 'capture-image',
                captureId: pendingCapture.captureId,
              },
            ]
          : baseAttachments;
      const extras =
        attachments === baseAttachments
          ? streamRequest.extras
          : {
              ...streamRequest.extras,
              attachments,
            };

      beginStream();
      await startStreaming(streamRequest.sessionId, streamRequest.content, extras);
      console.info('[voice-submit] Streaming chat request started for voice text.', {
        sessionId: streamRequest.sessionId,
        source: streamRequest.extras?.options?.source || 'voice-asr',
      });
    },
    [beginStream, startStreaming],
  );
  const voiceMicToggle = useVoiceMicToggle({
    desktopMode,
    chatSessionId: 'text-composer',
    onSubmitVoiceText: submitVoiceText,
    onInterruptAssistant: async () => {
      await cancelStreaming();
    },
  });
  const voicePermissionWarningText = t('voice.permissionDeniedBanner');
  const showVoicePermissionWarning = Boolean(voiceMicToggle.microphonePermissionDenied);
  const activePermissionRequest = permissionRequestQueue[0] || null;

  useEffect(() => {
    if (voiceMicToggle.microphonePermissionDenied) {
      setComposerExternalError(voicePermissionWarningText);
    }
  }, [setComposerExternalError, voiceMicToggle.microphonePermissionDenied, voicePermissionWarningText]);

  const textComposerWithVoiceProps = useMemo(
    () => ({
      ...textComposerProps,
      canCaptureScreen: desktopMode && activeConversationBackend === 'nanobot',
      onCaptureScreen: captureScreenToPendingDraft,
      captureDraft: pendingCaptureDraft,
      onClearCaptureDraft: clearPendingCaptureDraft,
      voiceEnabled: voiceMicToggle.isEnabled,
      voiceToggleDisabled: !voiceMicToggle.isAvailable || voiceMicToggle.isBusy,
      onToggleVoice: voiceMicToggle.toggleVoice,
    }),
    [
      activeConversationBackend,
      clearPendingCaptureDraft,
      captureScreenToPendingDraft,
      desktopMode,
      pendingCaptureDraft,
      textComposerProps,
      voiceMicToggle.isAvailable,
      voiceMicToggle.isBusy,
      voiceMicToggle.isEnabled,
      voiceMicToggle.toggleVoice,
    ],
  );

  const handleModelLoaded = useCallback(() => {
    setModelLoaded(true);
    if (avatarRenderMode === 'live2d') {
      live2dViewerRef.current?.initAudioContext?.();
    }
  }, [avatarRenderMode]);

  const handleModelError = useCallback((error) => {
    setModelLoaded(false);
    console.error('Model error in App:', error);
  }, []);

  const handlePixelPackAction = useCallback(
    async (action, payload = {}) => {
      if (!desktopMode) {
        const message = 'Pixel packs are available in desktop mode only.';
        setPixelPackError(message);
        return { ok: false, reason: 'desktop_pixel_pack_unavailable', error: { message } };
      }

      setPixelPackBusyAction(action);
      setPixelPackFeedback('');
      setPixelPackError('');

      try {
        const handler = desktopBridge.pixelPack[action];
        if (typeof handler !== 'function') {
          const message = 'Pixel pack management is unavailable in this build.';
          setPixelPackError(message);
          return { ok: false, reason: 'desktop_pixel_pack_unavailable', error: { message } };
        }

        const result = await handler(payload);
        const nextStateResult = result?.state
          ? { state: result.state }
          : await desktopBridge.pixelPack.getState().catch(() => null);
        if (nextStateResult?.state) {
          setPixelPackState(normalizePixelPackState(nextStateResult.state));
        }

        if (!result?.ok) {
          const message = normalizeErrorMessage(result?.error || result?.reason || result, t);
          setPixelPackError(message);
          return result;
        }

        const message = typeof result?.message === 'string' && result.message.trim()
          ? result.message.trim()
          : '';
        if (message) {
          setPixelPackFeedback(message);
        }
        return result;
      } catch (error) {
        const message = normalizeErrorMessage(error, t);
        setPixelPackError(message);
        return { ok: false, error: { message } };
      } finally {
        setPixelPackBusyAction('');
      }
    },
    [desktopMode, t],
  );

  const normalizePixelPackActionPayload = useCallback((input = null) => {
    if (typeof input === 'string') {
      const packId = input.trim();
      return packId ? { packId } : {};
    }
    if (!input || typeof input !== 'object') {
      return {};
    }

    const packId = typeof input.packId === 'string' && input.packId.trim()
      ? input.packId.trim()
      : typeof input.id === 'string' && input.id.trim()
        ? input.id.trim().split('@')[0]
        : '';
    const version = typeof input.version === 'string' ? input.version.trim() : '';

    return {
      ...(packId ? { packId } : {}),
      ...(version ? { version } : {}),
    };
  }, []);

  const handlePixelPackImport = useCallback(() => handlePixelPackAction('importZip'), [handlePixelPackAction]);
  const handlePixelPackValidate = useCallback(
    (selection = null) => handlePixelPackAction('validate', normalizePixelPackActionPayload(selection)),
    [handlePixelPackAction, normalizePixelPackActionPayload],
  );
  const handlePixelPackActivate = useCallback(
    (selection = null) => handlePixelPackAction('activate', normalizePixelPackActionPayload(selection)),
    [handlePixelPackAction, normalizePixelPackActionPayload],
  );
  const handlePixelPackRemove = useCallback(
    (selection = null) => handlePixelPackAction('remove', normalizePixelPackActionPayload(selection)),
    [handlePixelPackAction, normalizePixelPackActionPayload],
  );
  const handlePixelPackExport = useCallback(
    (selection = null) => handlePixelPackAction('export', normalizePixelPackActionPayload(selection)),
    [handlePixelPackAction, normalizePixelPackActionPayload],
  );

  const latestFailedDownloadTask = useMemo(
    () =>
      Object.values(taskMap)
        .filter((task) => {
          const phase = typeof task?.phase === 'string' ? task.phase.trim().toLowerCase() : '';
          return phase === 'failed';
        })
        .sort((left, right) => (right?.updatedAt || 0) - (left?.updatedAt || 0))[0] || null,
    [taskMap],
  );

  const officeWorkspacePath = typeof chatBackendSettings?.nanobot?.workspace === 'string'
    ? chatBackendSettings.nanobot.workspace.trim()
    : '';
  const officeAssetRegistry = useMemo(
    () => buildOfficeSceneAssetRegistry(OFFICE_SCENE_ASSET_REGISTRY, pixelPackState),
    [pixelPackState],
  );
  const officeErrorMessage = textComposerWithVoiceProps.externalError
    || settingsError
    || latestFailedDownloadTask?.logs?.[latestFailedDownloadTask.logs.length - 1]
    || '';
  const primaryOfficeAgent = useMemo(
    () =>
      derivePrimaryOfficeAgent({
        agentId: OFFICE_PRIMARY_AGENT_ID,
        displayName: 'OtakuClaw',
        isStreaming,
        activeDownloadTasks,
        errorMessage: officeErrorMessage,
        activityState: officeActivityHint?.businessState || '',
        activityDetail: officeActivityHint?.detail || '',
        updatedAt: officeActivityHint?.updatedAt || '',
        detail:
          subtitleText
          || activeTask?.currentFile
          || activeTask?.title
          || (showChatPanel ? 'Chat panel is open and waiting for the next prompt.' : ''),
      }),
    [
      activeDownloadTasks,
      activeTask?.currentFile,
      activeTask?.title,
      isStreaming,
      officeActivityHint?.businessState,
      officeActivityHint?.detail,
      officeActivityHint?.updatedAt,
      officeErrorMessage,
      showChatPanel,
      subtitleText,
    ],
  );

  const selectedStaticAvatar = useMemo(
    () => staticAvatarPacks.find((pack) => pack.packId === selectedStaticAvatarId) || null,
    [selectedStaticAvatarId, staticAvatarPacks],
  );

  const avatarBusinessState = useMemo(() => {
    if (typeof officeActivityHint?.businessState === 'string' && officeActivityHint.businessState.trim()) {
      return officeActivityHint.businessState.trim();
    }
    if (typeof primaryOfficeAgent?.businessState === 'string' && primaryOfficeAgent.businessState.trim()) {
      return primaryOfficeAgent.businessState.trim();
    }
    return 'idle';
  }, [officeActivityHint?.businessState, primaryOfficeAgent?.businessState]);

  useEffect(() => {
    let cancelled = false;
    const applyOfficeState = (nextState) => {
      if (!cancelled) {
        setOfficeStateSnapshot(normalizeOfficeState(nextState));
      }
    };

    void desktopBridge.office.getState().then(applyOfficeState).catch(() => {});
    const detach = desktopBridge.office.onEvent((event = {}) => {
      applyOfficeState(event?.payload || {});
    });

    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);

  useEffect(() => {
    saveStoredAgentRoleConfig(agentRoleConfig);
  }, [agentRoleConfig]);

  useEffect(() => {
    const nextActiveAgentId =
      typeof officeStateSnapshot?.activeAgentId === 'string' && officeStateSnapshot.activeAgentId.trim()
        ? officeStateSnapshot.activeAgentId.trim()
        : '';
    const normalizedActiveAgentId = nextActiveAgentId === OFFICE_PRIMARY_AGENT_ID ? '' : nextActiveAgentId;
    setAgentRoleConfig((current) => {
      if ((current?.activeAgentId || '') === normalizedActiveAgentId) {
        return current;
      }
      return {
        ...(current && typeof current === 'object' ? current : {}),
        activeAgentId: normalizedActiveAgentId,
      };
    });
  }, [officeStateSnapshot?.activeAgentId]);

  useEffect(() => {
    const storedConfig = initialAgentRoleConfigRef.current || {};
    const storedAgents = Array.isArray(storedConfig.agents) ? storedConfig.agents : [];
    const normalizedActiveAgentId =
      typeof storedConfig.activeAgentId === 'string' ? storedConfig.activeAgentId.trim() : '';
    if (storedAgents.length === 0 && !normalizedActiveAgentId) {
      return;
    }
    void desktopBridge.office.publishPresence({
      source: 'renderer-agent-role-config-bootstrap',
      agents: storedAgents.map((agent) => ({
        ...agent,
        updatedAt: new Date().toISOString(),
      })),
      ...(normalizedActiveAgentId ? { activeAgentId: normalizedActiveAgentId } : {}),
    }).catch((error) => {
      console.warn('Failed to bootstrap agent role config:', error);
    });
  }, []);

  useEffect(() => {
    if (!desktopMode) {
      setOfficeActivityHint(null);
      return () => {};
    }

    return desktopBridge.conversation.onEvent((event = {}) => {
      setOfficeActivityHint((current) => reduceOfficeActivityHint(current, event));
    });
  }, [desktopMode]);

  useEffect(() => {
    if (!desktopMode) {
      setPermissionRequestQueue([]);
      setPermissionDecisionSubmitting(false);
      return () => {};
    }

    return desktopBridge.conversation.onEvent((event = {}) => {
      if (event?.channel !== 'chat') {
        return;
      }

      if (event.type === 'permission-request') {
        const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
        const permissionRequestId =
          typeof payload.permissionRequestId === 'string' ? payload.permissionRequestId.trim() : '';
        if (!permissionRequestId) {
          return;
        }

        setPermissionRequestQueue((currentQueue) => {
          if (currentQueue.some((item) => item.permissionRequestId === permissionRequestId)) {
            return currentQueue;
          }

          return [
            ...currentQueue,
            {
              permissionRequestId,
              streamId: typeof event.streamId === 'string' ? event.streamId.trim() : '',
              backend:
                typeof payload.backend === 'string' && payload.backend.trim()
                  ? payload.backend.trim()
                  : typeof event.backend === 'string'
                    ? event.backend.trim()
                    : '',
              transport: typeof payload.transport === 'string' ? payload.transport.trim() : '',
              requestId: typeof payload.requestId === 'string' ? payload.requestId.trim() : '',
              permission: typeof payload.permission === 'string' ? payload.permission.trim() : '',
              toolName: typeof payload.toolName === 'string' ? payload.toolName.trim() : '',
              reason: typeof payload.reason === 'string' ? payload.reason.trim() : '',
              askTimeoutMs:
                Number.isFinite(payload.askTimeoutMs) && payload.askTimeoutMs > 0
                  ? Math.min(Math.floor(payload.askTimeoutMs), 60_000)
                  : 8_000,
            },
          ];
        });
        return;
      }

      if (event.type === 'done' || event.type === 'error') {
        const streamId = typeof event.streamId === 'string' ? event.streamId.trim() : '';
        if (!streamId) {
          return;
        }

        setPermissionRequestQueue((currentQueue) =>
          currentQueue.filter((item) => item.streamId !== streamId));
      }
    });
  }, [desktopMode]);

  const handleUpsertOfficeAgent = useCallback(async (inputAgent = {}) => {
    const fallbackId =
      typeof inputAgent?.agentId === 'string' && inputAgent.agentId.trim()
        ? inputAgent.agentId.trim()
        : (typeof inputAgent?.id === 'string' ? inputAgent.id.trim() : '');
    const normalized = normalizeStoredAgentRole(inputAgent, fallbackId || 'agent');
    if (!normalized) {
      throw new Error('Invalid agent configuration.');
    }

    await desktopBridge.office.upsertAgent({
      ...normalized,
      updatedAt: new Date().toISOString(),
    }, {
      source: 'renderer-agent-role-config',
      activateIfUnset: true,
    });

    setAgentRoleConfig((current) => {
      const currentAgents = Array.isArray(current.agents) ? current.agents : [];
      const currentIndex = currentAgents.findIndex((item) => item.agentId === normalized.agentId);
      if (currentIndex === -1) {
        return {
          ...current,
          agents: [...currentAgents, normalized],
        };
      }
      const nextAgents = [...currentAgents];
      nextAgents[currentIndex] = normalized;
      return {
        ...current,
        agents: nextAgents,
      };
    });
  }, []);

  const handleRemoveOfficeAgent = useCallback(async (agentId = '') => {
    const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
    if (!normalizedAgentId || normalizedAgentId === OFFICE_PRIMARY_AGENT_ID) {
      throw new Error('Primary agent cannot be removed.');
    }

    await desktopBridge.office.removeAgent(normalizedAgentId);
    setAgentRoleConfig((current) => {
      const currentAgents = Array.isArray(current.agents) ? current.agents : [];
      const nextAgents = currentAgents.filter((item) => item.agentId !== normalizedAgentId);
      const activeAgentId = current.activeAgentId === normalizedAgentId ? '' : current.activeAgentId;
      return {
        ...current,
        agents: nextAgents,
        activeAgentId,
      };
    });
  }, []);

  const handleSetActiveOfficeAgent = useCallback(async (agentId = '') => {
    const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
    if (!normalizedAgentId) {
      throw new Error('Agent id is required.');
    }
    await desktopBridge.office.setActiveAgent(normalizedAgentId);
    setAgentRoleConfig((current) => ({
      ...current,
      activeAgentId: normalizedAgentId === OFFICE_PRIMARY_AGENT_ID ? '' : normalizedAgentId,
    }));
  }, []);

  const handlePermissionDecision = useCallback(
    async (decision) => {
      if (!activePermissionRequest || permissionDecisionSubmitting) {
        return;
      }

      setPermissionDecisionSubmitting(true);
      try {
        await desktopBridge.conversation.resolvePermissionRequest({
          permissionRequestId: activePermissionRequest.permissionRequestId,
          decision,
          reason: decision === 'allow' ? 'user_allow' : 'user_deny',
        });
      } catch (error) {
        console.warn('Failed to resolve ACP permission request:', error);
      } finally {
        setPermissionRequestQueue((currentQueue) =>
          currentQueue.filter(
            (item) => item.permissionRequestId !== activePermissionRequest.permissionRequestId,
          ));
        setPermissionDecisionSubmitting(false);
      }
    },
    [activePermissionRequest, permissionDecisionSubmitting],
  );

  const handleAllowPermission = useCallback(() => {
    void handlePermissionDecision('allow');
  }, [handlePermissionDecision]);

  const handleDenyPermission = useCallback(() => {
    void handlePermissionDecision('deny');
  }, [handlePermissionDecision]);

  useEffect(() => {
    let cancelled = false;
    const trackedAgentId =
      typeof immersiveContext?.agentId === 'string' && immersiveContext.agentId.trim()
        ? immersiveContext.agentId.trim()
        : OFFICE_PRIMARY_AGENT_ID;

    const applyValueState = (nextState) => {
      if (!cancelled) {
        setValueStateSnapshot(nextState || null);
      }
    };

    void desktopBridge.valueState.getState({
      agentId: trackedAgentId,
    }).then((result = {}) => {
      applyValueState(result?.state || result || null);
    }).catch(() => {});

    const detach = desktopBridge.valueState.onEvent((event = {}) => {
      const nextState = event?.payload || event || null;
      const eventAgentId =
        typeof nextState?.agentId === 'string' && nextState.agentId.trim()
          ? nextState.agentId.trim()
          : OFFICE_PRIMARY_AGENT_ID;
      if (eventAgentId !== trackedAgentId) {
        return;
      }

      applyValueState(nextState);
    });

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [immersiveContext?.agentId]);

  useEffect(() => {
    void desktopBridge.office.publishPresence({
      source: 'renderer-primary',
      agents: [primaryOfficeAgent],
    }).catch((error) => {
      console.warn('Failed to sync office state:', error);
    });
  }, [primaryOfficeAgent]);

  const updateOfficeSceneLayout = useCallback((updater) => {
    setOfficeSceneLayout((currentLayout) => {
      const nextLayout = typeof updater === 'function' ? updater(currentLayout) : updater;
      return normalizeOfficeSceneLayout(nextLayout);
    });
  }, []);

  const normalizeBusinessStates = useCallback((states = []) => {
    if (!Array.isArray(states)) {
      return [];
    }

    return states
      .map((state) => (typeof state === 'string' ? state.trim().toLowerCase() : ''))
      .filter(Boolean)
      .filter((state, index, values) => values.indexOf(state) === index);
  }, []);

  const updateOfficeFurnitureOverride = useCallback((furnitureId, updater) => {
    const normalizedFurnitureId = typeof furnitureId === 'string' ? furnitureId.trim() : '';
    if (!normalizedFurnitureId) {
      return;
    }

    updateOfficeSceneLayout((currentLayout) => {
      const currentOverride = currentLayout.furnitureOverrides?.[normalizedFurnitureId] || {};
      const nextOverrideRaw = typeof updater === 'function' ? updater(currentOverride, currentLayout) : updater;
      const nextFurnitureOverrides = {
        ...(currentLayout.furnitureOverrides || {}),
      };

      if (!nextOverrideRaw || typeof nextOverrideRaw !== 'object' || Array.isArray(nextOverrideRaw)) {
        delete nextFurnitureOverrides[normalizedFurnitureId];
      } else if (Object.keys(nextOverrideRaw).length === 0) {
        delete nextFurnitureOverrides[normalizedFurnitureId];
      } else {
        nextFurnitureOverrides[normalizedFurnitureId] = nextOverrideRaw;
      }

      return {
        ...currentLayout,
        furnitureOverrides: nextFurnitureOverrides,
      };
    });
  }, [updateOfficeSceneLayout]);

  const handleOfficeThemeChange = useCallback((themeId) => {
    updateOfficeSceneLayout((currentLayout) => ({
      ...currentLayout,
      themeId,
    }));
  }, [updateOfficeSceneLayout]);

  const handleOfficeFurniturePatchChange = useCallback((furnitureId, patch = {}) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return;
    }

    updateOfficeFurnitureOverride(furnitureId, (currentOverride) => {
      const nextOverride = {
        ...currentOverride,
      };

      for (const [field, value] of Object.entries(patch)) {
        if (value === null || typeof value === 'undefined') {
          delete nextOverride[field];
          continue;
        }
        nextOverride[field] = value;
      }

      return nextOverride;
    });
  }, [updateOfficeFurnitureOverride]);

  const handleOfficeFurnitureHiddenChange = useCallback((furnitureId, hidden) => {
    handleOfficeFurniturePatchChange(furnitureId, {
      hidden: Boolean(hidden),
    });
  }, [handleOfficeFurniturePatchChange]);

  const handleOfficeFurniturePositionChange = useCallback((furnitureId, patch = {}) => {
    handleOfficeFurniturePatchChange(furnitureId, {
      ...(Number.isFinite(patch.left) ? { left: patch.left } : {}),
      ...(Number.isFinite(patch.top) ? { top: patch.top } : {}),
    });
  }, [handleOfficeFurniturePatchChange]);

  const handleOfficeFurnitureStateRulesChange = useCallback((furnitureId, payload = {}) => {
    handleOfficeFurniturePatchChange(furnitureId, {
      ...(Array.isArray(payload.visibleWhenStates)
        ? {
            visibleWhenStates: (() => {
              const states = normalizeBusinessStates(payload.visibleWhenStates);
              return states.length > 0 ? states : null;
            })(),
          }
        : {}),
      ...(Array.isArray(payload.hiddenWhenStates)
        ? {
            hiddenWhenStates: (() => {
              const states = normalizeBusinessStates(payload.hiddenWhenStates);
              return states.length > 0 ? states : null;
            })(),
          }
        : {}),
    });
  }, [handleOfficeFurniturePatchChange, normalizeBusinessStates]);

  const handleOfficeFurnitureLayersChange = useCallback((furnitureId, layers = []) => {
    if (!Array.isArray(layers)) {
      return;
    }

    const normalizedLayers = layers
      .map((layer, index) => {
        if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
          return null;
        }

        const layerId = typeof layer.id === 'string' && layer.id.trim()
          ? layer.id.trim()
          : `${furnitureId}-layer-${index + 1}`;
        const normalizedLayer = {
          ...layer,
          id: layerId,
        };
        if (!normalizedLayer.assetKey || typeof normalizedLayer.assetKey !== 'string') {
          delete normalizedLayer.assetKey;
        } else {
          normalizedLayer.assetKey = normalizedLayer.assetKey.trim();
          if (!normalizedLayer.assetKey) {
            delete normalizedLayer.assetKey;
          }
        }
        return normalizedLayer;
      })
      .filter(Boolean);

    handleOfficeFurniturePatchChange(furnitureId, {
      layers: normalizedLayers.length > 0 ? normalizedLayers : null,
    });
  }, [handleOfficeFurniturePatchChange]);

  const handleOfficeFurnitureReset = useCallback((furnitureId) => {
    updateOfficeFurnitureOverride(furnitureId, null);
  }, [updateOfficeFurnitureOverride]);

  const handleOfficeFurnitureEnabledChange = useCallback((furnitureId, enabled) => {
    updateOfficeSceneLayout((currentLayout) => {
      const theme = resolveOfficeRoomTheme(currentLayout.themeId);
      const defaultFurnitureIds = new Set(theme.furnitureIds || []);
      const nextEnabledFurnitureIds = new Set(currentLayout.enabledFurnitureIds || []);
      const nextDisabledFurnitureIds = new Set(currentLayout.disabledFurnitureIds || []);

      if (defaultFurnitureIds.has(furnitureId)) {
        if (enabled) {
          nextDisabledFurnitureIds.delete(furnitureId);
        } else {
          nextDisabledFurnitureIds.add(furnitureId);
        }
        nextEnabledFurnitureIds.delete(furnitureId);
      } else if (enabled) {
        nextEnabledFurnitureIds.add(furnitureId);
      } else {
        nextEnabledFurnitureIds.delete(furnitureId);
      }

      return {
        ...currentLayout,
        enabledFurnitureIds: [...nextEnabledFurnitureIds],
        disabledFurnitureIds: [...nextDisabledFurnitureIds],
      };
    });
  }, [updateOfficeSceneLayout]);

  const officeDisplayState = useMemo(() => buildOfficeDisplayState({
    officeState: officeStateSnapshot,
    primaryAgent: primaryOfficeAgent,
    previewMode: officePreviewMode,
  }), [officePreviewMode, officeStateSnapshot, primaryOfficeAgent]);

  const officeScene = useMemo(() => {
    return resolveOfficeSceneState({
      officeState: officeDisplayState,
      sceneConfig: officeSceneLayout,
      assetRegistry: officeAssetRegistry,
      subtitle: desktopMode ? 'Live local office' : 'Browser preview',
      caption:
        officeWorkspacePath
          ? `Workspace: ${officeWorkspacePath}`
          : 'Single-agent today, multi-agent ready for later.',
    });
  }, [desktopMode, officeAssetRegistry, officeDisplayState, officeSceneLayout, officeWorkspacePath]);

  const officeEditor = useMemo(() => {
    const editorState = resolveOfficeSceneEditorState({
      sceneConfig: officeSceneLayout,
      officeState: officeDisplayState,
      assetRegistry: officeAssetRegistry,
    });

    return {
      ...editorState,
      previewMode: officePreviewMode,
      onPreviewModeChange: setOfficePreviewMode,
      onThemeChange: handleOfficeThemeChange,
      onFurniturePatchChange: handleOfficeFurniturePatchChange,
      onFurnitureHiddenChange: handleOfficeFurnitureHiddenChange,
      onFurnitureStateRulesChange: handleOfficeFurnitureStateRulesChange,
      onFurniturePositionChange: handleOfficeFurniturePositionChange,
      onFurnitureLayersChange: handleOfficeFurnitureLayersChange,
      onFurnitureReset: handleOfficeFurnitureReset,
      onFurnitureEnabledChange: handleOfficeFurnitureEnabledChange,
    };
  }, [
    handleOfficeFurnitureEnabledChange,
    handleOfficeFurnitureLayersChange,
    handleOfficeFurnitureHiddenChange,
    handleOfficeFurniturePatchChange,
    handleOfficeFurniturePositionChange,
    handleOfficeFurnitureReset,
    handleOfficeFurnitureStateRulesChange,
    handleOfficeThemeChange,
    officeAssetRegistry,
    officeDisplayState,
    officeSceneLayout,
    officePreviewMode,
  ]);

  useStreamingSubtitleBridge({
    appendDelta,
    setSegmentText,
    finishStream,
    clearSubtitle,
    onDelta,
    onSegmentReady,
    onDone,
    onError,
    onConversationEvent,
    onPlaybackEvent: builtinTtsEnabled ? subscribeTtsPlaybackLifecycle : null,
    syncToPlayback: builtinTtsEnabled,
    normalizeError,
    onComposerError: setComposerExternalError,
  });

  const setDesktopWindowMode = useCallback(
    async (nextMode) => {
      if (nextMode !== MODE_WINDOW && nextMode !== MODE_PET) {
        return;
      }

      if (!desktopMode) {
        return;
      }

      if (nextMode === MODE_PET) {
        setMainWindowViewMode('office');
        setImmersiveContext(null);
      }

      await setMode(nextMode);
    },
    [desktopMode, setMode],
  );

  const handleWindowViewModeChange = useCallback((nextMode) => {
    setMainWindowViewMode(nextMode);
    if (nextMode === 'avatar') {
      setImmersiveContext(null);
    }
  }, []);

  const handleOpenImmersiveMode = useCallback((payload = {}) => {
    const agent = payload.agent && typeof payload.agent === 'object' ? payload.agent : null;
    const sourceAreaId = typeof payload.areaId === 'string' ? payload.areaId.trim() : '';
    const scene = payload.scene && typeof payload.scene === 'object' ? payload.scene : null;
    const sourceArea = sourceAreaId && scene?.config?.areas?.[sourceAreaId]
      ? scene.config.areas[sourceAreaId]
      : null;
    const sourceAreaPoint =
      Number.isFinite(sourceArea?.x) && Number.isFinite(sourceArea?.y)
        ? {
            x: sourceArea.x,
            y: sourceArea.y,
          }
        : null;
    const sourceAreaBackdrop =
      sourceArea?.immersiveBackdrop && typeof sourceArea.immersiveBackdrop === 'object'
        ? sourceArea.immersiveBackdrop
        : null;
    const routeKey =
      typeof payload.routeKey === 'string' && payload.routeKey.trim()
        ? payload.routeKey.trim()
        : typeof agent?.routeKey === 'string' && agent.routeKey.trim()
          ? agent.routeKey.trim()
          : '';
    const sessionId =
      typeof payload.sessionId === 'string' && payload.sessionId.trim()
        ? payload.sessionId.trim()
        : typeof agent?.sessionId === 'string' && agent.sessionId.trim()
          ? agent.sessionId.trim()
          : '';

    setImmersiveContext({
      agentId: typeof payload.agentId === 'string' && payload.agentId.trim()
        ? payload.agentId.trim()
        : agent?.agentId || OFFICE_PRIMARY_AGENT_ID,
      agent,
      routeKey,
      sessionId,
      sourceAreaId,
      sourceAreaLabel:
        typeof sourceArea?.label === 'string' && sourceArea.label.trim()
          ? sourceArea.label.trim()
          : sourceAreaId,
      sourceAreaDetail:
        typeof agent?.detail === 'string' && agent.detail.trim()
          ? agent.detail.trim()
          : typeof scene?.caption === 'string'
            ? scene.caption.trim()
            : '',
      sourceAreaPoint,
      sourceAreaBackdrop,
      sceneTitle: typeof scene?.title === 'string' ? scene.title.trim() : '',
    });
    setMainWindowViewMode('immersive');
    void desktopBridge.office.setActiveAgent(agent?.agentId || payload.agentId || OFFICE_PRIMARY_AGENT_ID).catch(() => {});
  }, []);

  const handleExitImmersiveMode = useCallback(() => {
    setMainWindowViewMode('office');
  }, []);

  const handleImmersiveAction = useCallback((actionType, context) => {
    if (actionType === 'conversation') {
      openChatPanel();
      return;
    }

    if (actionType === 'feed' || actionType === 'interaction') {
      const agentId =
        typeof context?.agent?.agentId === 'string' && context.agent.agentId.trim()
          ? context.agent.agentId.trim()
          : immersiveContext?.agentId || OFFICE_PRIMARY_AGENT_ID;
      const routeKey =
        typeof context?.immersiveContext?.routeKey === 'string' && context.immersiveContext.routeKey.trim()
          ? context.immersiveContext.routeKey.trim()
          : typeof context?.agent?.routeKey === 'string' && context.agent.routeKey.trim()
            ? context.agent.routeKey.trim()
            : typeof immersiveContext?.routeKey === 'string' && immersiveContext.routeKey.trim()
              ? immersiveContext.routeKey.trim()
              : '';
      const sessionId =
        typeof context?.immersiveContext?.sessionId === 'string' && context.immersiveContext.sessionId.trim()
          ? context.immersiveContext.sessionId.trim()
          : typeof context?.agent?.sessionId === 'string' && context.agent.sessionId.trim()
            ? context.agent.sessionId.trim()
            : typeof immersiveContext?.sessionId === 'string' && immersiveContext.sessionId.trim()
              ? immersiveContext.sessionId.trim()
              : '';
      void desktopBridge.valueState.applyInteraction({
        actionType,
        agentId,
        characterId: agentId,
        routeKey,
        sessionId,
      }).then((nextState) => {
        setValueStateSnapshot(nextState || null);
      }).catch((error) => {
        console.warn('Immersive value interaction failed:', error);
      });
    }
  }, [immersiveContext?.agentId, immersiveContext?.routeKey, immersiveContext?.sessionId, openChatPanel]);

  const updatePetHover = useCallback(
    (componentId, isHovering) => {
      if (!desktopMode) {
        return;
      }

      desktopBridge.mode.updateHover(componentId, isHovering);
    },
    [desktopMode],
  );

  const { bindHover: bindPetHover, setHover: setPetHover } = usePetHoverPassthrough({
    desktopMode,
    isPetMode,
    updateHover: updatePetHover,
  });
  const chatPanelHoverBindings = useMemo(
    () => (isPetMode ? bindPetHover?.('pet-chat-panel') ?? {} : {}),
    [bindPetHover, isPetMode],
  );

  useEffect(() => {
    if (!isPetMode || !showChatPanel) {
      setPetHover?.('pet-chat-panel', false);
    }
  }, [isPetMode, setPetHover, showChatPanel]);

  useEffect(
    () => () => {
      setPetHover?.('pet-chat-panel', false);
    },
    [setPetHover],
  );

  const controlWindow = useCallback(
    async (action) => {
      if (!desktopMode || isPetMode) {
        return;
      }

      try {
        await desktopBridge.window.control(action);
      } catch (error) {
        console.error(`Window control failed: ${action}`, error);
      }
    },
    [desktopMode, isPetMode],
  );

  const stageStyle = useMemo(
    () => ({
      height: '100dvh',
      minHeight: '100dvh',
      transition: 'padding-right 220ms ease',
      paddingRight:
        (showConfigPanel || showChatPanel) && !isPetMode && !isNarrowViewport
          ? `${CONFIG_DRAWER_WIDTH}px`
          : 0,
      background: isPetMode
        ? 'transparent'
        : muiTheme.palette.mode === 'dark'
          ? 'radial-gradient(circle at top, rgba(39, 57, 92, 0.45), rgba(12, 16, 24, 0.15)), linear-gradient(180deg, #131c2d 0%, #0b111c 100%)'
          : 'radial-gradient(circle at top, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.06)), linear-gradient(180deg, #e5eeff 0%, #f9fbff 100%)',
    }),
    [isNarrowViewport, isPetMode, muiTheme.palette.mode, showConfigPanel, showChatPanel],
  );

  const handleAvatarRenderModeChange = useCallback((nextMode) => {
    setAvatarRenderMode(normalizeAvatarRenderMode(nextMode));
    setModelLoaded(false);
  }, []);

  const handleSelectedStaticAvatarChange = useCallback((nextPackId) => {
    setSelectedStaticAvatarId(typeof nextPackId === 'string' ? nextPackId : '');
    setModelLoaded(false);
  }, []);

  const handleStaticAvatarScaleChange = useCallback((nextScale) => {
    setStaticAvatarScale(Math.max(0.1, Math.min(3, Number(nextScale) || 1)));
  }, []);

  const handleStaticAvatarHitTestChange = useCallback((patch = {}) => {
    setStaticAvatarHitTest((current) => ({
      mode: patch.mode === 'rect' ? 'rect' : (current?.mode === 'rect' ? 'rect' : 'alpha'),
      alphaThreshold: Number.isFinite(patch.alphaThreshold)
        ? Math.max(0, Math.min(255, Number(patch.alphaThreshold)))
        : Number.isFinite(current?.alphaThreshold)
          ? Math.max(0, Math.min(255, Number(current.alphaThreshold)))
          : 10,
    }));
  }, []);

  const handleStaticAvatarPacksChange = useCallback((nextPacks = []) => {
    const normalizedPacks = Array.isArray(nextPacks) ? nextPacks : [];
    setStaticAvatarPacks(normalizedPacks);
  }, []);

  useEffect(() => {
    if (!selectedStaticAvatarId && staticAvatarPacks.length === 0) {
      return;
    }

    if (staticAvatarPacks.some((item) => item.packId === selectedStaticAvatarId)) {
      return;
    }

    setSelectedStaticAvatarId(staticAvatarPacks[0]?.packId || '');
  }, [selectedStaticAvatarId, staticAvatarPacks]);
  useEffect(() => {
    setModelLoaded(false);
  }, [isPetMode]);

  usePetCursorTracking({
    desktopMode,
    isPetMode,
    live2dViewerRef,
  });

  return (
    <Box sx={stageStyle}>
      {isPetMode ? (
        <PetShell
          desktopMode={desktopMode}
          platform={platform}
          live2dViewerRef={live2dViewerRef}
          avatarRenderMode={avatarRenderMode}
          selectedStaticAvatar={selectedStaticAvatar}
          staticAvatarScale={staticAvatarScale}
          staticAvatarHitTest={staticAvatarHitTest}
          avatarBusinessState={avatarBusinessState}
          currentModelPath={currentModelPath}
          motions={motions}
          expressions={expressions}
          onModelLoaded={handleModelLoaded}
          onModelError={handleModelError}
          subtitleText={subtitleText}
          onSwitchToWindowMode={() => setDesktopWindowMode(MODE_WINDOW)}
          bindPetHover={bindPetHover}
          setPetHover={setPetHover}
          textComposerProps={textComposerWithVoiceProps}
          showChatPanel={showChatPanel}
          onOpenChatPanel={openChatPanel}
          onCloseChatPanel={closeChatPanel}
          onQuickCapture={triggerPetQuickCapture}
          captureDraft={pendingCaptureDraft}
          onClearCaptureDraft={clearPendingCaptureDraft}
          nanobotWorkspace={chatBackendSettings?.nanobot?.workspace || ''}
          onOpenNanobotWorkspace={onOpenNanobotWorkspace}
          showVoicePermissionWarning={showVoicePermissionWarning}
          voicePermissionWarningText={voicePermissionWarningText}
        />
      ) : (
        <MainShell
          desktopMode={desktopMode}
          platform={platform}
          isNarrowViewport={isNarrowViewport}
          live2dViewerRef={live2dViewerRef}
          avatarRenderMode={avatarRenderMode}
          selectedStaticAvatar={selectedStaticAvatar}
          staticAvatarScale={staticAvatarScale}
          staticAvatarHitTest={staticAvatarHitTest}
          avatarBusinessState={avatarBusinessState}
          currentModelPath={currentModelPath}
          motions={motions}
          expressions={expressions}
          onModelLoaded={handleModelLoaded}
          onModelError={handleModelError}
          subtitleText={subtitleText}
          onOpenConfigPanel={openConfigPanel}
          onSwitchToPetMode={() => setDesktopWindowMode(MODE_PET)}
          onWindowControl={controlWindow}
          textComposerProps={textComposerWithVoiceProps}
          showChatPanel={showChatPanel}
          onOpenChatPanel={openChatPanel}
          showVoicePermissionWarning={showVoicePermissionWarning}
          voicePermissionWarningText={voicePermissionWarningText}
          officeScene={officeScene}
          officeEditor={officeEditor}
          windowViewMode={mainWindowViewMode}
          onWindowViewModeChange={handleWindowViewModeChange}
          immersiveContext={immersiveContext}
          valueSnapshot={valueStateSnapshot}
          onOpenImmersiveMode={handleOpenImmersiveMode}
          onExitImmersiveMode={handleExitImmersiveMode}
          onImmersiveAction={handleImmersiveAction}
        />
      )}

      <ConfigDrawer
        open={showConfigPanel}
        isPetMode={isPetMode}
        isNarrowViewport={isNarrowViewport}
        onClose={closeConfigPanel}
        desktopMode={desktopMode}
        officeState={officeStateSnapshot}
        agentRoleConfig={agentRoleConfig}
        defaultChatBackend={activeConversationBackend}
        onUpsertOfficeAgent={handleUpsertOfficeAgent}
        onRemoveOfficeAgent={handleRemoveOfficeAgent}
        onSetActiveOfficeAgent={handleSetActiveOfficeAgent}
        modelLoaded={modelLoaded}
        live2dViewerRef={live2dViewerRef}
        avatarRenderMode={avatarRenderMode}
        selectedStaticAvatarId={selectedStaticAvatarId}
        staticAvatarScale={staticAvatarScale}
        staticAvatarHitTest={staticAvatarHitTest}
        onAvatarRenderModeChange={handleAvatarRenderModeChange}
        onSelectedStaticAvatarChange={handleSelectedStaticAvatarChange}
        onStaticAvatarScaleChange={handleStaticAvatarScaleChange}
        onStaticAvatarHitTestChange={handleStaticAvatarHitTestChange}
        onStaticAvatarPacksChange={handleStaticAvatarPacksChange}
        onModelChange={() => {}}
        onMotionsUpdate={setMotions}
        onExpressionsUpdate={setExpressions}
        chatBackendSettings={chatBackendSettings}
        settingsSaving={settingsSaving}
        settingsTesting={settingsTesting}
        settingsFeedback={settingsFeedback}
        settingsError={settingsError}
        onOpenClawSettingChange={onOpenClawSettingChange}
        onNanobotSettingChange={onNanobotSettingChange}
        onAcpBackendSettingChange={onAcpBackendSettingChange}
        onPickNanobotWorkspace={onPickNanobotWorkspace}
        onTestChatBackendSettings={onTestChatBackendSettings}
        onClearSavedToken={onClearSavedToken}
        nanobotRuntimeStatus={nanobotRuntimeStatus}
        nanobotRuntimeInstalling={nanobotRuntimeInstalling}
        onInstallNanobotRuntime={handleInstallNanobotRuntime}
        acpRunnerStatus={acpRunnerStatus}
        acpRunnerInstallingBackend={acpRunnerInstallingBackend}
        onInstallAcpRunner={handleInstallAcpRunner}
        nanobotSkills={nanobotSkills}
        nanobotSkillsLoading={nanobotSkillsLoading}
        nanobotSkillsImporting={nanobotSkillsImporting}
        nanobotSkillsDeletingName={nanobotSkillsDeletingName}
        onImportNanobotSkillsZip={onImportNanobotSkillsZip}
        onDeleteNanobotSkill={onDeleteNanobotSkill}
        onOpenNanobotSkillsLibrary={onOpenNanobotSkillsLibrary}
        pixelPackState={pixelPackState}
        pixelPackBusyAction={pixelPackBusyAction}
        pixelPackFeedback={pixelPackFeedback}
        pixelPackError={pixelPackError}
        onPixelPackImport={handlePixelPackImport}
        onPixelPackValidate={handlePixelPackValidate}
        onPixelPackActivate={handlePixelPackActivate}
        onPixelPackRemove={handlePixelPackRemove}
        onPixelPackExport={handlePixelPackExport}
        onOpenDownloadCenter={openDownloadTask}
        onBuiltinTtsEnabledChange={syncBuiltinTtsEnabled}
      />
      <ChatSidebar
        open={showChatPanel}
        onClose={closeChatPanel}
        variant={isPetMode ? 'pet' : 'main'}
        isPetMode={isPetMode}
        isNarrowViewport={isNarrowViewport}
        petHoverBindings={chatPanelHoverBindings}
        messages={chatMessages}
        onClearHistory={clearHistory}
        isStreaming={isStreaming}
        {...textComposerWithVoiceProps}
      />
      <FirstRunOnboardingDialog
        open={firstRunOnboardingOpen}
        desktopMode={desktopMode}
        chatBackendSettings={chatBackendSettings}
        settingsSaving={settingsSaving}
        settingsTesting={settingsTesting}
        settingsFeedback={settingsFeedback}
        settingsError={settingsError}
        onOpenClawSettingChange={onOpenClawSettingChange}
        onNanobotSettingChange={onNanobotSettingChange}
        onAcpBackendSettingChange={onAcpBackendSettingChange}
        onPickNanobotWorkspace={onPickNanobotWorkspace}
        onTestChatBackendSettings={onTestChatBackendSettings}
        voiceDownloadTasks={taskMap}
        nanobotRuntimeStatus={nanobotRuntimeStatus}
        nanobotRuntimeInstalling={nanobotRuntimeInstalling}
        nanobotRuntimeDownloadTask={taskMap['nanobot-runtime'] || null}
        onInstallNanobotRuntime={handleInstallNanobotRuntimeFromOnboarding}
        onFinish={handleFinishFirstRunOnboarding}
      />
      <UnifiedDownloadDialog
        open={!firstRunOnboardingOpen && downloadDialogOpen}
        task={activeTask}
        detailsOpen={downloadDetailsOpen}
        onToggleDetails={() => setDownloadDetailsOpen((prev) => !prev)}
        onClose={closeDownloadDialog}
      />
      <PermissionRequestDialog
        open={Boolean(activePermissionRequest)}
        request={activePermissionRequest}
        pendingCount={permissionRequestQueue.length}
        submitting={permissionDecisionSubmitting}
        onAllow={handleAllowPermission}
        onDeny={handleDenyPermission}
      />
    </Box>
  );
}

export default function App() {
  const desktopMode = desktopBridge.isDesktop();

  return (
    <I18nProvider>
      <ModeProvider desktopMode={desktopMode}>
        <AppContent desktopMode={desktopMode} />
      </ModeProvider>
    </I18nProvider>
  );
}
