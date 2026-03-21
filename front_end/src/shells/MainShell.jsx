import { useEffect, useState } from 'react';
import { Box, Button, IconButton } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import ChatIcon from '@mui/icons-material/Chat';
import GridViewIcon from '@mui/icons-material/GridView';
import ViewInArIcon from '@mui/icons-material/ViewInAr';
import Live2DViewer from '../components/live2d/Live2DViewer.jsx';
import SubtitleBar from '../components/subtitle/SubtitleBar.jsx';
import WindowTitleBar from '../components/window/WindowTitleBar.jsx';
import OfficeScene from '../components/office/OfficeScene.jsx';
import ImmersiveLive2DShell from './ImmersiveLive2DShell.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';

const WINDOW_VIEW_MODES = new Set(['avatar', 'office', 'immersive']);

function normalizeWindowViewMode(value, fallback = 'avatar') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return WINDOW_VIEW_MODES.has(normalized) ? normalized : fallback;
}

export default function MainShell({
  desktopMode,
  platform,
  live2dViewerRef,
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
  initialWindowViewMode = 'avatar',
}) {
  const { t } = useI18n();
  const hasOfficeScene = Boolean(officeScene);
  const resolvedInitialViewMode = hasOfficeScene
    ? normalizeWindowViewMode(
        initialWindowViewMode === 'office' ? 'office' : initialWindowViewMode,
        'avatar',
      )
    : 'avatar';
  const isControlled = WINDOW_VIEW_MODES.has(normalizeWindowViewMode(windowViewMode, ''));
  const [internalWindowViewMode, setInternalWindowViewMode] = useState(resolvedInitialViewMode);
  const resolvedWindowViewMode = isControlled
    ? normalizeWindowViewMode(windowViewMode, resolvedInitialViewMode)
    : internalWindowViewMode;
  const effectiveWindowViewMode = hasOfficeScene ? resolvedWindowViewMode : 'avatar';
  const showOfficeView = hasOfficeScene && effectiveWindowViewMode === 'office';
  const showImmersiveView = hasOfficeScene && effectiveWindowViewMode === 'immersive';
  const stageClassName = ['live2d-stage', 'window-mode', `window-view-${showImmersiveView ? 'immersive' : showOfficeView ? 'office' : 'avatar'}`, desktopMode ? `platform-${platform}` : '']
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

      {!showOfficeView && !showImmersiveView ? (
        <Box className="live2d-hitbox">
          <Live2DViewer
            ref={live2dViewerRef}
            modelPath={currentModelPath}
            motions={motions}
            expressions={expressions}
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
          variant="page"
          className="office-scene-page"
          editor={officeEditor}
          onAgentClick={handleOpenImmersiveMode}
        />
      ) : null}

      {showImmersiveView ? (
        <ImmersiveLive2DShell
          desktopMode={desktopMode}
          platform={platform}
          live2dViewerRef={live2dViewerRef}
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

      <IconButton
        className="config-toggle"
        color="primary"
        onClick={onOpenConfigPanel}
        title={t('main.openSettings')}
      >
        <TuneIcon />
      </IconButton>

      <Box className="window-bottom-controls">
        {officeScene && !showImmersiveView ? (
          <Box className="window-view-switcher" role="group" aria-label="Window view switcher">
            <Button
              className={`window-view-button ${effectiveWindowViewMode === 'avatar' ? 'is-active' : ''}`.trim()}
              size="small"
              startIcon={<ViewInArIcon />}
              onClick={() => {
                setWindowViewMode('avatar');
              }}
            >
              Live2D
            </Button>
            <Button
              className={`window-view-button ${effectiveWindowViewMode === 'office' ? 'is-active' : ''}`.trim()}
              size="small"
              startIcon={<GridViewIcon />}
              onClick={() => {
                setWindowViewMode('office');
              }}
            >
              Pixel Room
            </Button>
          </Box>
        ) : null}
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

      {showVoicePermissionWarning && voicePermissionWarningText ? (
        <Box className="window-voice-warning">{voicePermissionWarningText}</Box>
      ) : null}

      <SubtitleBar text={subtitleText} />
    </Box>
  );
}
