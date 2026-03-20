import { Box, IconButton } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import ChatIcon from '@mui/icons-material/Chat';
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
}) {
  const { t } = useI18n();
  const stageClassName = ['live2d-stage', 'window-mode', desktopMode ? `platform-${platform}` : '']
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

      {officeScene ? (
        <OfficeScene
          scene={officeScene}
          compact={isNarrowViewport}
          className="office-scene-dock"
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
