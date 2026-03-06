import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, IconButton } from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import Live2DViewer from '../components/live2d/Live2DViewer.jsx';
import SubtitleBar from '../components/subtitle/SubtitleBar.jsx';
import { usePetDraggable } from '../hooks/pet/usePetDraggable.js';
import EdgeComposer from '../components/chat/EdgeComposer.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import { STORAGE_KEYS } from '../components/controls/constants.js';

const PET_DEFAULT_MODEL_SCALE = 0.7;

function normalizeModelScale(scale) {
  const rounded = Math.round(scale * 10) / 10;
  return Math.max(0.1, Math.min(3, rounded));
}

function readStoredModelScale() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.petModelScale);
    return typeof stored === 'string' && stored.trim()
      ? normalizeModelScale(Number(stored))
      : null;
  } catch (error) {
    console.warn('Failed to read stored model scale for pet mode:', error);
    return null;
  }
}

function persistModelScale(scale) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEYS.petModelScale, String(normalizeModelScale(scale)));
  } catch (error) {
    console.warn('Failed to persist pet mode model scale:', error);
  }
}

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
  bindPetHover,
  setPetHover,
  textComposerProps,
}) {
  const { t } = useI18n();
  const modelHoverRef = useRef(false);
  const hitboxRef = useRef(null);
  const controlsRef = useRef(null);
  const [isActivationRectHovering, setIsActivationRectHovering] = useState(false);
  const [isModelHovering, setIsModelHovering] = useState(false);
  const [isControlsHovering, setIsControlsHovering] = useState(false);
  const [isComposerExpanded, setIsComposerExpanded] = useState(false);
  const [isModelLocked, setIsModelLocked] = useState(false);

  const setModelHover = useCallback(
    (nextHovering) => {
      const normalized = Boolean(nextHovering);
      if (modelHoverRef.current === normalized) {
        return;
      }

      modelHoverRef.current = normalized;
      setIsModelHovering(normalized);
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

  const detectActivationRectHover = useCallback((event) => {
    if (!event) {
      return false;
    }

    const hitboxRect = hitboxRef.current?.getBoundingClientRect?.();
    if (!hitboxRect) {
      return false;
    }

    const controlsRect = controlsRef.current?.getBoundingClientRect?.();
    if (!controlsRect) {
      const { clientX, clientY } = event;
      return (
        clientX >= hitboxRect.left &&
        clientX <= hitboxRect.right &&
        clientY >= hitboxRect.top &&
        clientY <= hitboxRect.bottom
      );
    }

    const centerX = hitboxRect.left + hitboxRect.width / 2;
    const centerY = hitboxRect.top + hitboxRect.height / 2;
    const minX = Math.min(hitboxRect.left, controlsRect.left);
    const maxX = Math.max(hitboxRect.right, controlsRect.right);
    const minY = Math.min(hitboxRect.top, controlsRect.top);
    const maxY = Math.max(hitboxRect.bottom, controlsRect.bottom);
    const halfWidth = Math.max(centerX - minX, maxX - centerX);
    const halfHeight = Math.max(centerY - minY, maxY - centerY);

    const rect = {
      left: centerX - halfWidth,
      right: centerX + halfWidth,
      top: centerY - halfHeight,
      bottom: centerY + halfHeight,
    };

    const { clientX, clientY } = event;
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }, []);

  const { isDragging, dragStyle, dragBindings } = usePetDraggable({
    enabled: desktopMode && !isModelLocked,
    canStartDrag: (event) => detectModelPixelHover(event),
    onDragStateChange: (dragging) => {
      setPetHover?.('pet-dragging', dragging);
      setModelHover(dragging);
    },
  });

  const handleModelScaleByWheel = useCallback(
    (event) => {
      if (!desktopMode || isModelLocked) {
        return;
      }

      const manager = live2dViewerRef.current?.getManager?.();
      if (!manager || !manager.isModelLoaded || typeof manager.setModelScale !== 'function') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const currentScale =
        typeof manager.getModelScale === 'function'
          ? manager.getModelScale()
          : typeof manager.currentScale === 'number'
            ? manager.currentScale
            : 1.0;
      const scaleStep = 0.08;
      const direction = event.deltaY < 0 ? 1 : -1;
      const nextScale = normalizeModelScale(currentScale + direction * scaleStep);
      manager.setModelScale(nextScale);
      persistModelScale(nextScale);
    },
    [desktopMode, isModelLocked, live2dViewerRef],
  );

  const handlePetModelLoaded = useCallback(
    (model) => {
      const manager = live2dViewerRef.current?.getManager?.();
      if (manager?.isModelLoaded && typeof manager.setModelScale === 'function') {
        manager.setModelScale(readStoredModelScale() ?? PET_DEFAULT_MODEL_SCALE);
      }

      onModelLoaded?.(model);
    },
    [live2dViewerRef, onModelLoaded],
  );

  useEffect(() => {
    const hitboxElement = hitboxRef.current;
    if (!hitboxElement) {
      return undefined;
    }

    const handleWheel = (event) => {
      handleModelScaleByWheel(event);
    };

    hitboxElement.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      hitboxElement.removeEventListener('wheel', handleWheel);
    };
  }, [handleModelScaleByWheel]);

  useEffect(
    () => () => {
      setPetHover?.('live2d-hitbox', false);
      setPetHover?.('pet-dragging', false);
      setPetHover?.('pet-bottom-controls', false);
      setPetHover?.('pet-composer', false);
    },
    [setPetHover],
  );

  const controlsVisible =
    isActivationRectHovering || isModelHovering || isDragging || isControlsHovering || isComposerExpanded;
  const controlsHoverBindings = bindPetHover?.('pet-bottom-controls') ?? {};

  const stageClassName = ['live2d-stage', 'pet-mode', desktopMode ? `platform-${platform}` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <Box className={stageClassName}>
      <Box
        ref={hitboxRef}
        className={`live2d-hitbox pet-draggable-hitbox ${isDragging ? 'pet-dragging' : ''}`.trim()}
        style={dragStyle}
        onMouseEnter={(event) => {
          if (isDragging) {
            setModelHover(true);
            setIsActivationRectHovering(true);
            return;
          }

          setModelHover(detectModelPixelHover(event));
          setIsActivationRectHovering(detectActivationRectHover(event));
        }}
        onMouseMove={(event) => {
          if (isDragging) {
            setModelHover(true);
            setIsActivationRectHovering(true);
            return;
          }

          setModelHover(detectModelPixelHover(event));
          setIsActivationRectHovering(detectActivationRectHover(event));
        }}
        onMouseLeave={() => {
          setIsActivationRectHovering(false);
          if (!isDragging) {
            setModelHover(false);
          }
        }}
        {...dragBindings}
      >
        <Box className="pet-render-shell">
          <Live2DViewer
            ref={live2dViewerRef}
            modelPath={currentModelPath}
            motions={motions}
            expressions={expressions}
            width={400}
            height={600}
            onModelLoaded={handlePetModelLoaded}
            onModelError={onModelError}
            className="live2d-viewer"
          />
        </Box>
        <SubtitleBar text={subtitleText} className="subtitle-pet-head" />
        <Box
          ref={controlsRef}
          className={`pet-hitbox-controls ${controlsVisible ? 'is-visible' : ''}`.trim()}
          onMouseEnter={(event) => {
            setIsControlsHovering(true);
            controlsHoverBindings.onMouseEnter?.(event);
          }}
          onMouseLeave={(event) => {
            setIsControlsHovering(false);
            controlsHoverBindings.onMouseLeave?.(event);
          }}
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
            title={t('pet.switchToWindowMode')}
          >
            <SwapHorizIcon />
          </IconButton>
          <IconButton
            className="mode-toggle pet-mode-toggle"
            color={isModelLocked ? 'secondary' : 'primary'}
            onClick={() => {
              setIsModelLocked((prev) => !prev);
            }}
            title={isModelLocked ? t('pet.lockedTitle') : t('pet.unlockedTitle')}
          >
            {isModelLocked ? <LockIcon /> : <LockOpenIcon />}
          </IconButton>
          <EdgeComposer
            variant="pet"
            onExpandedChange={(expanded) => {
              setIsComposerExpanded(expanded);
              setPetHover?.('pet-composer', expanded);
            }}
            {...textComposerProps}
          />
        </Box>
      </Box>
    </Box>
  );
}
