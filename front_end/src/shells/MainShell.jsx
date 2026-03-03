import { Box, IconButton } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import EditIcon from '@mui/icons-material/Edit';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import Live2DViewer from '../components/live2d/Live2DViewer.jsx';
import SubtitleBar from '../components/subtitle/SubtitleBar.jsx';
import WindowTitleBar from '../components/window/WindowTitleBar.jsx';

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
  onOpenTextInputDialog,
  onSwitchToPetMode,
  onWindowControl,
}) {
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

      <IconButton className="config-toggle" color="primary" onClick={onOpenConfigPanel}>
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
            title="切换到桌宠模式"
          >
            <SwapHorizIcon />
          </IconButton>
        )}
        <IconButton className="text-toggle" color="primary" onClick={onOpenTextInputDialog}>
          <EditIcon />
        </IconButton>
      </Box>

      <SubtitleBar text={subtitleText} />
    </Box>
  );
}
