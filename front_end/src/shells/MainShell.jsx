import { useEffect, useState } from 'react';
import { Box, Button, IconButton } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import ChatIcon from '@mui/icons-material/Chat';
import HomeRepairServiceRoundedIcon from '@mui/icons-material/HomeRepairServiceRounded';
import AvatarRenderer from '../components/avatar/AvatarRenderer.jsx';
import SubtitleBar from '../components/subtitle/SubtitleBar.jsx';
import WindowTitleBar from '../components/window/WindowTitleBar.jsx';
import OfficeScene from '../components/office/OfficeScene.jsx';
import ImmersiveLive2DShell from './ImmersiveLive2DShell.jsx';
import RoomStudioShell from './RoomStudioShell.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';

const WINDOW_VIEW_MODES = new Set(['avatar', 'office', 'office-edit', 'immersive']);

function normalizeWindowViewMode(value, fallback = 'avatar') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return WINDOW_VIEW_MODES.has(normalized) ? normalized : fallback;
}

export default function MainShell({
  desktopMode,
  platform,
  live2dViewerRef,
  avatarRenderMode = 'live2d',
  selectedStaticAvatar = null,
  staticAvatarScale = 1,
  staticAvatarHitTest = null,
  avatarBusinessState = 'idle',
  currentModelPath,
  motions,
  expressions,
  onModelLoaded,
  onModelError,
  subtitleText,
  onOpenConfigPanel,
  onSwitchToPetMode,
  onWindowControl,
  showChatPanel = false,
  onOpenChatPanel,
  showVoicePermissionWarning = false,
  voicePermissionWarningText = '',
  officeScene = null,
  officeEditor = null,
  immersiveContext = null,
  valueSnapshot = null,
  windowViewMode = '',
  onWindowViewModeChange,
  onOpenImmersiveMode,
  onExitImmersiveMode,
  onImmersiveAction,
  isNarrowViewport = false,
  initialWindowViewMode = 'office',
}) {
  const { t } = useI18n();
  const hasOfficeScene = Boolean(officeScene);
  const resolvedInitialViewMode = hasOfficeScene
    ? normalizeWindowViewMode(initialWindowViewMode, 'office')
    : 'avatar';
  const isControlled = WINDOW_VIEW_MODES.has(normalizeWindowViewMode(windowViewMode, ''));
  const [internalWindowViewMode, setInternalWindowViewMode] = useState(resolvedInitialViewMode);
  const resolvedWindowViewMode = isControlled
    ? normalizeWindowViewMode(windowViewMode, resolvedInitialViewMode)
    : internalWindowViewMode;
  const effectiveWindowViewMode = hasOfficeScene ? resolvedWindowViewMode : 'avatar';
  const showOfficeView = hasOfficeScene && effectiveWindowViewMode === 'office';
  const showOfficeEditView = hasOfficeScene && effectiveWindowViewMode === 'office-edit';
  const showImmersiveView = hasOfficeScene && effectiveWindowViewMode === 'immersive';
  const currentWindowViewClass = showImmersiveView
    ? 'immersive'
    : showOfficeEditView
      ? 'office-edit'
      : showOfficeView
        ? 'office'
        : 'avatar';
  const stageClassName = ['live2d-stage', 'window-mode', `window-view-${currentWindowViewClass}`, desktopMode ? `platform-${platform}` : '']
    .filter(Boolean)
    .join(' ');

  useEffect(() => {
    if (isControlled) {
      return;
    }

    setInternalWindowViewMode((current) => {
      if (current === resolvedInitialViewMode) {
        return current;
      }

      return resolvedInitialViewMode;
    });
  }, [isControlled, resolvedInitialViewMode]);

  const setWindowViewMode = (nextMode) => {
    const normalized = normalizeWindowViewMode(nextMode, resolvedWindowViewMode);
    if (!isControlled) {
      setInternalWindowViewMode(normalized);
    }
    onWindowViewModeChange?.(normalized);
  };

  const handleOpenImmersiveMode = (payload) => {
    onOpenImmersiveMode?.(payload);
    setWindowViewMode('immersive');
  };

  const handleExitImmersiveMode = () => {
    onExitImmersiveMode?.();
    setWindowViewMode('office');
  };

  const handleOpenRoomStudio = () => {
    setWindowViewMode('office-edit');
  };

  const handleExitRoomStudio = () => {
    setWindowViewMode('office');
  };

  return (
    <Box className={stageClassName}>
      {desktopMode && (
        <WindowTitleBar
          platform={platform}
          onMinimize={() => {
            void onWindowControl?.('minimize');
          }}
          onToggleMaximize={() => {
            void onWindowControl?.('toggle-maximize');
          }}
          onClose={() => {
            void onWindowControl?.('close');
          }}
        />
      )}

      {!showOfficeView && !showOfficeEditView && !showImmersiveView ? (
        <Box className="live2d-hitbox">
          <AvatarRenderer
            ref={live2dViewerRef}
            renderMode={avatarRenderMode}
            modelPath={currentModelPath}
            motions={motions}
            expressions={expressions}
            staticPack={selectedStaticAvatar}
            staticBusinessState={avatarBusinessState}
            staticScale={staticAvatarScale}
            staticHitTest={staticAvatarHitTest}
            width={400}
            height={600}
            onModelLoaded={onModelLoaded}
            onModelError={onModelError}
            className="live2d-viewer"
          />
        </Box>
      ) : null}

      {showOfficeView ? (
        <OfficeScene
          scene={officeScene}
          compact={isNarrowViewport}
          presentationMode="browse"
          onAgentClick={handleOpenImmersiveMode}
        />
      ) : null}

      {showOfficeEditView ? (
        <RoomStudioShell
          scene={officeScene}
          editor={officeEditor}
          compact={isNarrowViewport}
          desktopMode={desktopMode}
          onBackToRoom={handleExitRoomStudio}
        />
      ) : null}

      {showImmersiveView ? (
        <ImmersiveLive2DShell
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
          onModelLoaded={onModelLoaded}
          onModelError={onModelError}
          immersiveContext={immersiveContext}
          valueSnapshot={valueSnapshot}
          onOpenChatPanel={onOpenChatPanel}
          onBackToRoom={handleExitImmersiveMode}
          onActionRequested={onImmersiveAction}
        />
      ) : null}

      {!showOfficeEditView && !showImmersiveView ? (
        <>
          <IconButton
            className="config-toggle"
            color="primary"
            onClick={onOpenConfigPanel}
            title={t('main.openSettings')}
          >
            <TuneIcon />
          </IconButton>

          {showOfficeView && officeEditor ? (
            <Button
              className="office-edit-toggle"
              color="primary"
              variant="contained"
              startIcon={<HomeRepairServiceRoundedIcon />}
              onClick={handleOpenRoomStudio}
            >
              Decorate
            </Button>
          ) : null}
        </>
      ) : null}

      {!showOfficeEditView && !showImmersiveView ? (
        <Box className="window-bottom-controls">
          {desktopMode && (
            <IconButton
              className="mode-toggle"
              color="primary"
              onClick={() => {
                void onSwitchToPetMode?.();
              }}
              title={t('main.switchToPetMode')}
            >
              <SwapHorizIcon />
            </IconButton>
          )}
          <IconButton
            className="mode-toggle"
            color={showChatPanel ? 'secondary' : 'primary'}
            onClick={onOpenChatPanel}
            title={t('chat.openChat')}
            aria-label={t('chat.openChat')}
          >
            <ChatIcon />
          </IconButton>
        </Box>
      ) : null}

      {showVoicePermissionWarning && voicePermissionWarningText ? (
        <Box className="window-voice-warning">{voicePermissionWarningText}</Box>
      ) : null}

      <SubtitleBar text={subtitleText} />
    </Box>
  );
}
