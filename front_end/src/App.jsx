import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ConfigDrawer from './components/config/ConfigDrawer.jsx';
import ChatSidebar from './components/chat/ChatSidebar.jsx';
import UnifiedDownloadDialog from './components/download/UnifiedDownloadDialog.jsx';
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
  const [nanobotDebugLogs, setNanobotDebugLogs] = useState([]);
  const [builtinTtsEnabled, setBuiltinTtsEnabled] = useState(false);
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
      if (text) {
        const attachments =
          Array.isArray(extras?.attachments) ? extras.attachments : [];
        addUserMessage(text, attachments);
        activeAiMsgIdRef.current = startAiMessage();
      }
      return _startStreaming(sessionId, content, extras);
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
    activeTask,
    dialogOpen: downloadDialogOpen,
    detailsOpen: downloadDetailsOpen,
    setDetailsOpen: setDownloadDetailsOpen,
    closeDialog: closeDownloadDialog,
    openTask: openDownloadTask,
    ensureTask: ensureDownloadTask,
    handleProgress: handleDownloadProgress,
  } = useUnifiedDownloader();

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
      });
    });

    const offNanobotRuntimeProgress = desktopBridge.nanobotRuntime.onProgress((payload = {}) => {
      handleDownloadProgress({
        taskId: 'nanobot-runtime',
        title: t('download.nanobotRuntimeTitle'),
        payload,
      });
    });
    const offNanobotDebugLog = desktopBridge.nanobotDebug.onLog((payload = {}) => {
      setNanobotDebugLogs((current) => {
        const next = [
          ...current,
          {
            id: `${payload.timestamp || Date.now()}-${current.length}`,
            timestamp: payload.timestamp || new Date().toISOString(),
            source: payload.source || '',
            stage: payload.stage || '',
            message: payload.message || '',
            details: payload.details,
          },
        ];
        return next.slice(-200);
      });
    });

    return () => {
      offVoiceModelProgress?.();
      offNanobotRuntimeProgress?.();
      offNanobotDebugLog?.();
    };
  }, [desktopMode, handleDownloadProgress, t]);

  useEffect(() => {
    if (!desktopMode) {
      return () => {};
    }

    return desktopBridge.conversation.onEvent((event = {}) => {
      if (event?.channel !== 'chat') {
        return;
      }

      const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
      if (payload.source !== 'nanobot') {
        return;
      }

      setNanobotDebugLogs((current) => {
        const next = [
          ...current,
          {
            id: `renderer-${Date.now()}-${current.length}`,
            timestamp: new Date().toISOString(),
            source: 'renderer',
            stage: `chat-event:${event.type || 'unknown'}`,
            message: 'Renderer received chat stream event.',
            details: {
              streamId: event.streamId || '',
              payload: event.payload || {},
            },
          },
        ];
        return next.slice(-200);
      });
    });
  }, [desktopMode]);

  const clearNanobotDebugLogs = useCallback(() => {
    setNanobotDebugLogs([]);
  }, []);

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

  const handleInstallNanobotRuntime = useCallback(async () => {
    ensureDownloadTask({
      taskId: 'nanobot-runtime',
      title: t('download.nanobotRuntimeTitle'),
    });
    openDownloadTask('nanobot-runtime');
    await onInstallNanobotRuntime();
  }, [ensureDownloadTask, onInstallNanobotRuntime, openDownloadTask, t]);

  const { showConfigPanel, openConfigPanel: _openConfigPanel, closeConfigPanel } = useConfigPanelController({
    isPetMode,
    live2dViewerRef,
  });

  // Chat panel state — mutually exclusive with settings panel
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [petCaptureShortcutToken, setPetCaptureShortcutToken] = useState(0);
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

  const triggerPetQuickCapture = useCallback(() => {
    openChatPanel();
    setPetCaptureShortcutToken((current) => current + 1);
  }, [openChatPanel]);

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
      beginStream();
      await startStreaming(streamRequest.sessionId, streamRequest.content, streamRequest.extras);
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
  const textComposerWithVoiceProps = useMemo(
    () => ({
      ...textComposerProps,
      canCaptureScreen: desktopMode && chatBackendSettings.chatBackend === 'nanobot',
      onCaptureScreen: startScreenCapture,
      onReleaseCapture: releaseCapture,
      voiceEnabled: voiceMicToggle.isEnabled,
      voiceToggleDisabled: !voiceMicToggle.isAvailable || voiceMicToggle.isBusy,
      onToggleVoice: voiceMicToggle.toggleVoice,
    }),
    [
      chatBackendSettings.chatBackend,
      desktopMode,
      releaseCapture,
      startScreenCapture,
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

      await setMode(nextMode);
    },
    [desktopMode, setMode],
  );

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
        />
      ) : (
        <MainShell
          desktopMode={desktopMode}
          platform={platform}
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
        nanobotDebugLogs={nanobotDebugLogs}
        onClearNanobotDebugLogs={clearNanobotDebugLogs}
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
        captureShortcutToken={isPetMode ? petCaptureShortcutToken : 0}
        messages={chatMessages}
        onClearHistory={clearHistory}
        isStreaming={isStreaming}
        {...textComposerWithVoiceProps}
      />
      <UnifiedDownloadDialog
        open={downloadDialogOpen}
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
