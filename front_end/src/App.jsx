import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ConfigDrawer from './components/config/ConfigDrawer.jsx';
import UnifiedDownloadDialog from './components/download/UnifiedDownloadDialog.jsx';
import { useStreamingSubtitleBridge } from './hooks/chat/useStreamingSubtitleBridge.js';
import { useTextComposerController } from './hooks/chat/useTextComposerController.js';
import { useConfigPanelController } from './hooks/config/useConfigPanelController.js';
import { useUnifiedDownloader } from './hooks/download/useUnifiedDownloader.js';
import { useStreamingChat } from './hooks/useStreamingChat.js';
import { useSubtitleFeed } from './hooks/useSubtitleFeed.js';
import { usePetHoverPassthrough } from './hooks/pet/usePetHoverPassthrough.js';
import { usePetCursorTracking } from './hooks/pet/usePetCursorTracking.js';
import { useChatBackendSettings } from './hooks/settings/useOpenClawSettings.js';
import { usePlatformInfo } from './hooks/window/usePlatformInfo.js';
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
  const platform = usePlatformInfo({ desktopMode });

  const { subtitleText, appendDelta, setSegmentText, finishStream, clearSubtitle, beginStream } = useSubtitleFeed();
  const { startStreaming, cancelStreaming, onDelta, onSegmentReady, onDone, onError, isStreaming } =
    useStreamingChat();

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
    onTestChatBackendSettings,
    onClearSavedToken,
    nanobotRuntimeStatus,
    nanobotRuntimeInstalling,
    onInstallNanobotRuntime,
  } = useChatBackendSettings({
    t,
    normalizeError,
  });

  useEffect(() => {
    if (!desktopMode) {
      return () => {};
    }

    const offVoiceModelProgress = desktopBridge.voiceModels.onDownloadProgress((payload = {}) => {
      handleDownloadProgress({
        taskId: 'voice-models',
        title: t('download.voiceModelsTitle'),
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

    return () => {
      offVoiceModelProgress?.();
      offNanobotRuntimeProgress?.();
    };
  }, [desktopMode, handleDownloadProgress, t]);

  const handleInstallNanobotRuntime = useCallback(async () => {
    ensureDownloadTask({
      taskId: 'nanobot-runtime',
      title: t('download.nanobotRuntimeTitle'),
    });
    openDownloadTask('nanobot-runtime');
    await onInstallNanobotRuntime();
  }, [ensureDownloadTask, onInstallNanobotRuntime, openDownloadTask, t]);

  const { showConfigPanel, openConfigPanel, closeConfigPanel } = useConfigPanelController({
    isPetMode,
    live2dViewerRef,
  });

  const { setComposerExternalError, textComposerProps } = useTextComposerController({
    beginStream,
    startStreaming,
    cancelStreaming,
    isStreaming,
  });

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
      paddingRight: showConfigPanel && !isPetMode && !isNarrowViewport ? `${CONFIG_DRAWER_WIDTH}px` : 0,
      background: isPetMode
        ? 'transparent'
        : muiTheme.palette.mode === 'dark'
          ? 'radial-gradient(circle at top, rgba(39, 57, 92, 0.45), rgba(12, 16, 24, 0.15)), linear-gradient(180deg, #131c2d 0%, #0b111c 100%)'
          : 'radial-gradient(circle at top, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.06)), linear-gradient(180deg, #e5eeff 0%, #f9fbff 100%)',
    }),
    [isNarrowViewport, isPetMode, muiTheme.palette.mode, showConfigPanel],
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
          textComposerProps={textComposerProps}
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
          textComposerProps={textComposerProps}
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
        onTestChatBackendSettings={onTestChatBackendSettings}
        onClearSavedToken={onClearSavedToken}
        nanobotRuntimeStatus={nanobotRuntimeStatus}
        nanobotRuntimeInstalling={nanobotRuntimeInstalling}
        onInstallNanobotRuntime={handleInstallNanobotRuntime}
        onOpenDownloadCenter={openDownloadTask}
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
