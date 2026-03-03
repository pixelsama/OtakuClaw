import { useEffect } from 'react';
import { Box, IconButton } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import Live2DViewer from '../components/live2d/Live2DViewer.jsx';
import SubtitleBar from '../components/subtitle/SubtitleBar.jsx';
import { usePetDraggable } from '../hooks/pet/usePetDraggable.js';

export default function PetShell({
  desktopMode,
  platform,
  live2dViewerRef,
  currentModelPath,
  motions,
  expressions,
  onModelLoaded,
  onModelError,
  subtitleText,
  onSwitchToWindowMode,
  onOpenTextInputDialog,
  bindPetHover,
  setPetHover,
}) {
  const { isDragging, dragStyle, dragBindings } = usePetDraggable({
    enabled: desktopMode,
    onDragStateChange: (dragging) => {
      setPetHover?.('pet-dragging', dragging);
    },
  });

  useEffect(
    () => () => {
      setPetHover?.('pet-dragging', false);
    },
    [setPetHover],
  );

  const stageClassName = ['live2d-stage', 'pet-mode', desktopMode ? `platform-${platform}` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <Box className={stageClassName}>
      <Box
        className={`live2d-hitbox pet-draggable-hitbox ${isDragging ? 'pet-dragging' : ''}`.trim()}
        style={dragStyle}
        {...bindPetHover?.('live2d-hitbox')}
        {...dragBindings}
      >
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

      <Box className="window-bottom-controls pet-bottom-controls" {...bindPetHover?.('pet-bottom-controls')}>
        <IconButton
          className="mode-toggle pet-mode-toggle"
          color="primary"
          onClick={() => {
            void onSwitchToWindowMode?.();
          }}
          title="切换到主窗口模式"
        >
          <SwapHorizIcon />
        </IconButton>
        <IconButton className="text-toggle" color="primary" onClick={onOpenTextInputDialog}>
          <EditIcon />
        </IconButton>
      </Box>

      <SubtitleBar text={subtitleText} />
    </Box>
  );
}
