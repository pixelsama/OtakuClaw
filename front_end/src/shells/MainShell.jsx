import { useState } from 'react';
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
import { useI18n } from '../i18n/I18nContext.jsx';

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
  isNarrowViewport = false,
  initialWindowViewMode = 'avatar',
}) {
  const { t } = useI18n();
  const hasOfficeScene = Boolean(officeScene);
  const [windowViewMode, setWindowViewMode] = useState(
    initialWindowViewMode === 'office' && hasOfficeScene ? 'office' : 'avatar',
  );
  const showOfficeView = hasOfficeScene && windowViewMode === 'office';
  const stageClassName = ['live2d-stage', 'window-mode', `window-view-${showOfficeView ? 'office' : 'avatar'}`, desktopMode ? `platform-${platform}` : '']
    .filter(Boolean)
    .join(' ');

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

      {!showOfficeView ? (
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
        {officeScene ? (
          <Box className="window-view-switcher" role="group" aria-label="Window view switcher">
            <Button
              className={`window-view-button ${windowViewMode === 'avatar' ? 'is-active' : ''}`.trim()}
              size="small"
              startIcon={<ViewInArIcon />}
              onClick={() => {
                setWindowViewMode('avatar');
              }}
            >
              Live2D
            </Button>
            <Button
              className={`window-view-button ${windowViewMode === 'office' ? 'is-active' : ''}`.trim()}
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
