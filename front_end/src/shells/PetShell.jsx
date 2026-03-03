import { useCallback, useEffect, useRef } from 'react';
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
  const modelHoverRef = useRef(false);

  const setModelHover = useCallback(
    (nextHovering) => {
      const normalized = Boolean(nextHovering);
      if (modelHoverRef.current === normalized) {
        return;
      }

      modelHoverRef.current = normalized;
      setPetHover?.('live2d-hitbox', normalized);
    },
    [setPetHover],
  );

  const detectModelPixelHover = useCallback(
    (event) => {
      if (!desktopMode || !event) {
        return false;
      }

      return Boolean(live2dViewerRef.current?.isPointOnModel?.(event.clientX, event.clientY, 12));
    },
    [desktopMode, live2dViewerRef],
  );

  const { isDragging, dragStyle, dragBindings } = usePetDraggable({
    enabled: desktopMode,
    canStartDrag: (event) => detectModelPixelHover(event),
    onDragStateChange: (dragging) => {
      setPetHover?.('pet-dragging', dragging);
      setModelHover(dragging);
    },
  });

  useEffect(
    () => () => {
      setPetHover?.('live2d-hitbox', false);
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
        onMouseEnter={(event) => {
          if (isDragging) {
            setModelHover(true);
            return;
          }

          setModelHover(detectModelPixelHover(event));
        }}
        onMouseMove={(event) => {
          if (isDragging) {
            setModelHover(true);
            return;
          }

          setModelHover(detectModelPixelHover(event));
        }}
        onMouseLeave={() => {
          if (!isDragging) {
            setModelHover(false);
          }
        }}
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

        <Box
          className="pet-hitbox-controls"
          {...bindPetHover?.('pet-bottom-controls')}
          onPointerDownCapture={(event) => {
            event.stopPropagation();
          }}
        >
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
      </Box>

      <SubtitleBar text={subtitleText} />
    </Box>
  );
}
