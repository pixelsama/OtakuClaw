import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ConfigDrawer from './components/config/ConfigDrawer.jsx';
import ChatSidebar from './components/chat/ChatSidebar.jsx';
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
  getOfficeFurnitureCatalogItem,
  normalizeOfficeSceneLayout,
  normalizeOfficeState,
  OFFICE_PRIMARY_AGENT_ID,
  reduceOfficeActivityHint,
  resolveOfficeRoomTheme,
  resolveOfficeSceneEditorState,
  resolveOfficeSceneState,
} from './components/office/officeSceneConfig.js';
import { ModeProvider, MODE_PET, MODE_WINDOW, useModeContext } from './mode/ModeContext.jsx';
import MainShell from './shells/MainShell.jsx';
import PetShell from './shells/PetShell.jsx';
import { desktopBridge } from './services/desktopBridge.js';
import { I18nProvider, useI18n } from './i18n/I18nContext.jsx';
import { normalizeErrorMessage } from './utils/normalizeErrorMessage.js';

const DEFAULT_MODEL = '';
const CONFIG_DRAWER_WIDTH = 420;

function AppContent({ desktopMode }) {
  const live2dViewerRef = useRef(null);
  const { isPetMode, setMode } = useModeContext();
  const muiTheme = useTheme();
  const isNarrowViewport = useMediaQuery('(max-width:900px)');
  const { t } = useI18n();

  const [modelLoaded, setModelLoaded] = useState(false);
  const [currentModelPath, setCurrentModelPath] = useState(DEFAULT_MODEL);
  const [motions, setMotions] = useState([]);
  const [expressions, setExpressions] = useState([]);
  const [officeStateSnapshot, setOfficeStateSnapshot] = useState(() => normalizeOfficeState());
  const [officeSceneLayout, setOfficeSceneLayout] = useState(() => normalizeOfficeSceneLayout());
  const [officeActivityHint, setOfficeActivityHint] = useState(null);
  const [officePreviewMode, setOfficePreviewMode] = useState('live');
  const [mainWindowViewMode, setMainWindowViewMode] = useState('office');
  const [immersiveContext, setImmersiveContext] = useState(null);
  const [valueStateSnapshot, setValueStateSnapshot] = useState(null);
  const [builtinTtsEnabled, setBuiltinTtsEnabled] = useState(false);
  const [firstRunOnboardingOpen, setFirstRunOnboardingOpen] = useState(false);
  const [officeLayoutLoaded, setOfficeLayoutLoaded] = useState(!desktopMode);
  const savedOfficeLayoutSnapshotRef = useRef(JSON.stringify(normalizeOfficeSceneLayout()));
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

      await _startStreaming(sessionId, content, extras);
    },
    [_startStreaming, addUserMessage, startAiMessage],
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

  const normalizeError = useCallback((error) => normalizeErrorMessage(error, t), [t]);
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
    chatBackendSettings,
    settingsSaving,
    settingsTesting,
    settingsFeedback,
    settingsError,
    onChatBackendChange,
    onOpenClawSettingChange,
    onNanobotSettingChange,
    onPickNanobotWorkspace,
    onOpenNanobotWorkspace,
    onTestChatBackendSettings,
    onClearSavedToken,
    nanobotRuntimeStatus,
    nanobotRuntimeInstalling,
    onInstallNanobotRuntime,
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

    return () => {
      offVoiceModelProgress?.();
      offNanobotRuntimeProgress?.();
    };
  }, [desktopMode, firstRunOnboardingOpen, handleDownloadProgress, t]);

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

  useEffect(() => {
    if (voiceMicToggle.microphonePermissionDenied) {
      setComposerExternalError(voicePermissionWarningText);
    }
  }, [setComposerExternalError, voiceMicToggle.microphonePermissionDenied, voicePermissionWarningText]);

  const textComposerWithVoiceProps = useMemo(
    () => ({
      ...textComposerProps,
      canCaptureScreen: desktopMode && chatBackendSettings.chatBackend === 'nanobot',
      onCaptureScreen: captureScreenToPendingDraft,
      captureDraft: pendingCaptureDraft,
      onClearCaptureDraft: clearPendingCaptureDraft,
      voiceEnabled: voiceMicToggle.isEnabled,
      voiceToggleDisabled: !voiceMicToggle.isAvailable || voiceMicToggle.isBusy,
      onToggleVoice: voiceMicToggle.toggleVoice,
    }),
    [
      chatBackendSettings.chatBackend,
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
    live2dViewerRef.current?.initAudioContext?.();
  }, []);

  const handleModelError = useCallback((error) => {
    setModelLoaded(false);
    console.error('Model error in App:', error);
  }, []);

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
    if (!desktopMode) {
      setOfficeActivityHint(null);
      return () => {};
    }

    return desktopBridge.conversation.onEvent((event = {}) => {
      setOfficeActivityHint((current) => reduceOfficeActivityHint(current, event));
    });
  }, [desktopMode]);

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
      activeAgentId: OFFICE_PRIMARY_AGENT_ID,
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

  const handleOfficeThemeChange = useCallback((themeId) => {
    updateOfficeSceneLayout((currentLayout) => ({
      ...currentLayout,
      themeId,
    }));
  }, [updateOfficeSceneLayout]);

  const handleOfficeFurnitureHiddenChange = useCallback((furnitureId, hidden) => {
    updateOfficeSceneLayout((currentLayout) => {
      const currentOverride = currentLayout.furnitureOverrides?.[furnitureId] || {};
      return {
        ...currentLayout,
        furnitureOverrides: {
          ...(currentLayout.furnitureOverrides || {}),
          [furnitureId]: {
            ...currentOverride,
            hidden: Boolean(hidden),
          },
        },
      };
    });
  }, [updateOfficeSceneLayout]);

  const handleOfficeFurniturePositionChange = useCallback((furnitureId, patch = {}) => {
    updateOfficeSceneLayout((currentLayout) => {
      const currentOverride = currentLayout.furnitureOverrides?.[furnitureId] || {};
      return {
        ...currentLayout,
        furnitureOverrides: {
          ...(currentLayout.furnitureOverrides || {}),
          [furnitureId]: {
            ...currentOverride,
            ...(Number.isFinite(patch.left) ? { left: patch.left } : {}),
            ...(Number.isFinite(patch.top) ? { top: patch.top } : {}),
          },
        },
      };
    });
  }, [updateOfficeSceneLayout]);

  const handleOfficeFurnitureReset = useCallback((furnitureId) => {
    updateOfficeSceneLayout((currentLayout) => {
      const catalogItem = getOfficeFurnitureCatalogItem(furnitureId);
      const currentOverride = currentLayout.furnitureOverrides?.[furnitureId] || {};
      const nextOverride = {
        ...currentOverride,
      };

      delete nextOverride.hidden;
      delete nextOverride.left;
      delete nextOverride.top;

      const nextFurnitureOverrides = {
        ...(currentLayout.furnitureOverrides || {}),
      };

      if (catalogItem && Object.keys(nextOverride).length === 0) {
        delete nextFurnitureOverrides[furnitureId];
      } else {
        nextFurnitureOverrides[furnitureId] = nextOverride;
      }

      return {
        ...currentLayout,
        furnitureOverrides: nextFurnitureOverrides,
      };
    });
  }, [updateOfficeSceneLayout]);

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
      subtitle: desktopMode ? 'Live local office' : 'Browser preview',
      caption:
        officeWorkspacePath
          ? `Workspace: ${officeWorkspacePath}`
          : 'Single-agent today, multi-agent ready for later.',
    });
  }, [desktopMode, officeDisplayState, officeSceneLayout, officeWorkspacePath]);

  const officeEditor = useMemo(() => {
    const editorState = resolveOfficeSceneEditorState({
      sceneConfig: officeSceneLayout,
      officeState: officeDisplayState,
    });

    return {
      ...editorState,
      previewMode: officePreviewMode,
      onPreviewModeChange: setOfficePreviewMode,
      onThemeChange: handleOfficeThemeChange,
      onFurnitureHiddenChange: handleOfficeFurnitureHiddenChange,
      onFurniturePositionChange: handleOfficeFurniturePositionChange,
      onFurnitureReset: handleOfficeFurnitureReset,
      onFurnitureEnabledChange: handleOfficeFurnitureEnabledChange,
    };
  }, [
    handleOfficeFurnitureEnabledChange,
    handleOfficeFurnitureHiddenChange,
    handleOfficeFurniturePositionChange,
    handleOfficeFurnitureReset,
    handleOfficeThemeChange,
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

  const handleControlModelChange = useCallback((modelPath) => {
    setCurrentModelPath(modelPath || '');
    setModelLoaded(false);
  }, []);

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
        modelLoaded={modelLoaded}
        desktopMode={desktopMode}
        live2dViewerRef={live2dViewerRef}
        onModelChange={handleControlModelChange}
        onMotionsUpdate={setMotions}
        onExpressionsUpdate={setExpressions}
        chatBackendSettings={chatBackendSettings}
        settingsSaving={settingsSaving}
        settingsTesting={settingsTesting}
        settingsFeedback={settingsFeedback}
        settingsError={settingsError}
        onChatBackendChange={onChatBackendChange}
        onOpenClawSettingChange={onOpenClawSettingChange}
        onNanobotSettingChange={onNanobotSettingChange}
        onPickNanobotWorkspace={onPickNanobotWorkspace}
        onTestChatBackendSettings={onTestChatBackendSettings}
        onClearSavedToken={onClearSavedToken}
        nanobotRuntimeStatus={nanobotRuntimeStatus}
        nanobotRuntimeInstalling={nanobotRuntimeInstalling}
        onInstallNanobotRuntime={handleInstallNanobotRuntime}
        nanobotSkills={nanobotSkills}
        nanobotSkillsLoading={nanobotSkillsLoading}
        nanobotSkillsImporting={nanobotSkillsImporting}
        nanobotSkillsDeletingName={nanobotSkillsDeletingName}
        onImportNanobotSkillsZip={onImportNanobotSkillsZip}
        onDeleteNanobotSkill={onDeleteNanobotSkill}
        onOpenNanobotSkillsLibrary={onOpenNanobotSkillsLibrary}
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
        onChatBackendChange={onChatBackendChange}
        onOpenClawSettingChange={onOpenClawSettingChange}
        onNanobotSettingChange={onNanobotSettingChange}
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
