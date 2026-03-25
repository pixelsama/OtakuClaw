import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveOfficeOccupantSprite } from './officeSceneAssets.js';
import { calculateDraggedFurniturePosition } from './officeSceneDrag.js';
import OfficeSceneEditor from './OfficeSceneEditor.jsx';
import './OfficeScene.css';

const OFFICE_PRESENTATION_MODES = new Set(['auto', 'browse', 'workspace']);
const OFFICE_STAGE_ASPECT_RATIO = 16 / 9;

export function resolveContainedStageSize({ containerWidth = 0, containerHeight = 0, aspectRatio = OFFICE_STAGE_ASPECT_RATIO } = {}) {
  const safeContainerWidth = Number(containerWidth) || 0;
  const safeContainerHeight = Number(containerHeight) || 0;
  const safeAspectRatio = Number(aspectRatio) || OFFICE_STAGE_ASPECT_RATIO;
  if (safeContainerWidth <= 0 || safeContainerHeight <= 0 || safeAspectRatio <= 0) {
    return null;
  }

  let width = safeContainerWidth;
  let height = width / safeAspectRatio;
  if (height > safeContainerHeight) {
    height = safeContainerHeight;
    width = height * safeAspectRatio;
  }

  return {
    width,
    height,
  };
}

function resolveBackgroundPosition(frameIndex = 0, cols = 1, rows = 1) {
  const safeCols = Math.max(1, Number(cols) || 1);
  const safeRows = Math.max(1, Number(rows) || 1);
  const safeFrameCount = safeCols * safeRows;
  const normalizedFrameIndex = Math.max(0, Math.min(safeFrameCount - 1, Math.round(Number(frameIndex) || 0)));
  const frameColumn = normalizedFrameIndex % safeCols;
  const frameRow = Math.floor(normalizedFrameIndex / safeCols);
  return {
    x: safeCols === 1 ? 0 : (frameColumn / (safeCols - 1)) * 100,
    y: safeRows === 1 ? 0 : (frameRow / (safeRows - 1)) * 100,
  };
}

function resolveAnimationFrames(animation = null) {
  if (!animation || typeof animation !== 'object') {
    return [];
  }

  if (Array.isArray(animation.frames) && animation.frames.length > 0) {
    return animation.frames
      .map((frame) => Math.round(Number(frame)))
      .filter((frame) => Number.isFinite(frame));
  }

  const fromFrame = Math.round(Number(animation.fromFrame));
  const toFrame = Math.round(Number(animation.toFrame));
  if (!Number.isFinite(fromFrame) || !Number.isFinite(toFrame)) {
    return [];
  }

  const step = fromFrame <= toFrame ? 1 : -1;
  const frames = [];
  for (let frame = fromFrame; step > 0 ? frame <= toFrame : frame >= toFrame; frame += step) {
    frames.push(frame);
  }
  return frames;
}

function resolveSpriteAssetUrl(sprite = {}) {
  return sprite.assetUrl || sprite.asset || sprite.url || '';
}

function OfficeDecorLayer({ furniture, layer, isInteractive = false, isSelected = false, isDragging = false, onPointerDown, onSelect }) {
  const animationFrames = useMemo(() => resolveAnimationFrames(layer.animation), [layer.animation]);
  const [displayFrameIndex, setDisplayFrameIndex] = useState(layer.frameIndex || 0);

  useEffect(() => {
    if (!animationFrames.length) {
      setDisplayFrameIndex(layer.frameIndex || 0);
      return () => {};
    }

    let currentFramePointer = 0;
    const fps = Number(layer.animation?.fps);
    const frameDurationMs = Math.max(50, Math.round(1000 / (Number.isFinite(fps) && fps > 0 ? fps : 12)));
    setDisplayFrameIndex(animationFrames[0]);
    const timer = globalThis.setInterval(() => {
      currentFramePointer = (currentFramePointer + 1) % animationFrames.length;
      setDisplayFrameIndex(animationFrames[currentFramePointer]);
    }, frameDurationMs);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, [animationFrames, layer.animation?.fps, layer.frameIndex]);

  const backgroundPosition = useMemo(
    () => resolveBackgroundPosition(displayFrameIndex, layer.cols, layer.rows),
    [displayFrameIndex, layer.cols, layer.rows],
  );

  return (
    <div
      className={[
        'office-room__prop',
        `office-room__prop--${layer.id}`,
        isInteractive ? 'is-editable' : '',
        isSelected ? 'is-selected' : '',
        isDragging ? 'is-dragging' : '',
      ].filter(Boolean).join(' ')}
      style={{
        left: `${furniture.left}%`,
        top: `${furniture.top}%`,
        width: `${layer.width || furniture.width}%`,
        aspectRatio: layer.aspectRatio,
        zIndex: layer.zIndex,
        opacity: layer.opacity,
        backgroundImage: `url(${layer.assetUrl})`,
        backgroundPosition: `${backgroundPosition.x}% ${backgroundPosition.y}%`,
        '--office-cols': layer.cols,
        '--office-rows': layer.rows,
      }}
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onClick={onSelect}
    />
  );
}

function OfficeAreaLabel({ area, count }) {
  return (
    <div
      className="office-room__area-label"
      style={{ left: `${area.x}%`, top: `${area.y}%` }}
      aria-hidden="true"
    >
      <span>{area.label}</span>
      {count > 0 ? <strong>{count}</strong> : null}
    </div>
  );
}

function OfficeOccupant({ occupant, assetRegistry = null, onClick }) {
  const sprite = resolveOfficeOccupantSprite(occupant, assetRegistry);
  const animationFrames = useMemo(() => resolveAnimationFrames(sprite.animation), [sprite.animation]);
  const [displayFrameIndex, setDisplayFrameIndex] = useState(sprite.frameIndex || 0);

  useEffect(() => {
    if (!animationFrames.length) {
      setDisplayFrameIndex(sprite.frameIndex || 0);
      return () => {};
    }

    let currentFramePointer = 0;
    const fps = Number(sprite.animation?.fps);
    const frameDurationMs = Math.max(50, Math.round(1000 / (Number.isFinite(fps) && fps > 0 ? fps : 8)));
    setDisplayFrameIndex(animationFrames[0]);
    const timer = globalThis.setInterval(() => {
      currentFramePointer = (currentFramePointer + 1) % animationFrames.length;
      setDisplayFrameIndex(animationFrames[currentFramePointer]);
    }, frameDurationMs);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, [animationFrames, sprite.animation?.fps, sprite.frameIndex]);

  const backgroundPosition = useMemo(
    () => resolveBackgroundPosition(displayFrameIndex, sprite.cols, sprite.rows),
    [displayFrameIndex, sprite.cols, sprite.rows],
  );

  const handleKeyDown = (event) => {
    if (typeof onClick !== 'function') {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick(event);
    }
  };

  return (
    <div
      className={[
        'office-room__occupant',
        `palette-${occupant.palette}`,
        occupant.isPrimary ? 'is-primary' : '',
        `state-${occupant.businessState}`,
        typeof onClick === 'function' ? 'is-clickable' : '',
      ].filter(Boolean).join(' ')}
      style={{ left: `${occupant.slot.x}%`, top: `${occupant.slot.y}%` }}
      title={`${occupant.displayName}: ${occupant.businessState}`}
      role={typeof onClick === 'function' ? 'button' : undefined}
      tabIndex={typeof onClick === 'function' ? 0 : undefined}
      aria-label={typeof onClick === 'function'
        ? `${occupant.displayName} ${occupant.businessState}`
        : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <div className="office-room__agent-shadow" aria-hidden="true" />
      <div
        className={[
          'office-room__agent-sprite',
          `office-room__agent-sprite--${sprite.variant}`,
          `mood-${occupant.mood}`,
        ].filter(Boolean).join(' ')}
        style={{
          backgroundImage: `url(${resolveSpriteAssetUrl(sprite)})`,
          backgroundPosition: `${backgroundPosition.x}% ${backgroundPosition.y}%`,
          '--office-cols': sprite.cols,
          '--office-rows': sprite.rows,
        }}
        aria-hidden="true"
      />
      <div className="office-room__agent-name">{occupant.displayName}</div>
      <div className="office-room__agent-state">{occupant.businessState}</div>
      {occupant.detail ? <div className="office-room__agent-bubble">{occupant.detail}</div> : null}
    </div>
  );
}

export default function OfficeScene({
  scene,
  compact = false,
  className = '',
  variant = 'dock',
  presentationMode = 'auto',
  editor = null,
  onAgentClick = null,
}) {
  const stageRef = useRef(null);
  const stageWrapRef = useRef(null);
  const dragStateRef = useRef(null);
  const [selectedFurnitureId, setSelectedFurnitureId] = useState(editor?.furniture?.[0]?.id || '');
  const [draggingFurnitureId, setDraggingFurnitureId] = useState('');
  const [browseStageSize, setBrowseStageSize] = useState(null);
  const resolvedPresentationMode = OFFICE_PRESENTATION_MODES.has(presentationMode)
    ? presentationMode
    : 'auto';
  const effectivePresentationMode = resolvedPresentationMode === 'auto'
    ? (editor ? 'workspace' : 'browse')
    : resolvedPresentationMode;
  const isBrowseMode = effectivePresentationMode === 'browse';
  const isWorkspaceMode = effectivePresentationMode === 'workspace';
  const assetRegistry = scene?.config?.assetRegistry || null;
  const normalizedClassName = [
    'office-room',
    isBrowseMode ? 'office-room--browse' : 'office-room--workspace',
    compact && !isBrowseMode ? 'is-compact' : '',
    variant === 'page' ? 'office-room--page' : 'office-room--dock',
    className,
  ].filter(Boolean).join(' ');
  const editableFurniture = useMemo(() => editor?.furniture || [], [editor?.furniture]);
  const selectedFurniture = useMemo(
    () => editableFurniture.find((item) => item.id === selectedFurnitureId) || editableFurniture[0] || null,
    [editableFurniture, selectedFurnitureId],
  );

  useEffect(() => {
    if (!editableFurniture.length) {
      if (selectedFurnitureId) {
        setSelectedFurnitureId('');
      }
      return;
    }

    if (!editableFurniture.some((item) => item.id === selectedFurnitureId)) {
      setSelectedFurnitureId(editableFurniture[0].id);
    }
  }, [editableFurniture, selectedFurnitureId]);

  useEffect(() => {
    if (!isBrowseMode) {
      setBrowseStageSize(null);
      return () => {};
    }

    const stageWrapElement = stageWrapRef.current;
    if (!stageWrapElement) {
      return () => {};
    }

    let animationFrameId = 0;
    const updateStageSize = () => {
      const bounds = stageWrapElement.getBoundingClientRect();
      const nextSize = resolveContainedStageSize({
        containerWidth: bounds.width,
        containerHeight: bounds.height,
      });
      setBrowseStageSize((current) => {
        if (!nextSize) {
          return null;
        }
        if (
          current
          && Math.abs(current.width - nextSize.width) < 0.5
          && Math.abs(current.height - nextSize.height) < 0.5
        ) {
          return current;
        }
        return nextSize;
      });
    };
    const scheduleStageSizeUpdate = () => {
      globalThis.cancelAnimationFrame(animationFrameId);
      animationFrameId = globalThis.requestAnimationFrame(updateStageSize);
    };

    scheduleStageSizeUpdate();

    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => {
        scheduleStageSizeUpdate();
      });
      resizeObserver.observe(stageWrapElement);
    }

    globalThis.addEventListener('resize', scheduleStageSizeUpdate);

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
      globalThis.removeEventListener('resize', scheduleStageSizeUpdate);
      resizeObserver?.disconnect?.();
    };
  }, [isBrowseMode]);

  useEffect(() => {
    if (!draggingFurnitureId) {
      return () => {};
    }

    const handlePointerMove = (event) => {
      const dragState = dragStateRef.current;
      const stageElement = stageRef.current;
      if (!dragState || !stageElement || dragState.furnitureId !== draggingFurnitureId) {
        return;
      }

      const nextPosition = calculateDraggedFurniturePosition({
        stageRect: stageElement.getBoundingClientRect(),
        layerRect: {
          width: dragState.layerWidth,
          height: dragState.layerHeight,
        },
        pointerClientX: event.clientX,
        pointerClientY: event.clientY,
        pointerOffsetX: dragState.pointerOffsetX,
        pointerOffsetY: dragState.pointerOffsetY,
      });

      if (!nextPosition) {
        return;
      }

      editor?.onFurniturePositionChange?.(dragState.furnitureId, nextPosition);
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      setDraggingFurnitureId('');
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [draggingFurnitureId, editor]);

  const handleDecorPointerDown = (event, furniture) => {
    if (!editor?.onFurniturePositionChange || !stageRef.current) {
      return;
    }

    const layerRect = event.currentTarget.getBoundingClientRect();
    dragStateRef.current = {
      furnitureId: furniture.id,
      pointerOffsetX: event.clientX - layerRect.left,
      pointerOffsetY: event.clientY - layerRect.top,
      layerWidth: layerRect.width,
      layerHeight: layerRect.height,
    };
    setSelectedFurnitureId(furniture.id);
    editor?.onFurnitureSelect?.(furniture.id);
    setDraggingFurnitureId(furniture.id);
    event.preventDefault();
  };

  if (!scene) {
    return null;
  }

  const { title, subtitle, caption, labels, config, occupants, areaSummaries, primaryAgent, agentCount } = scene;
  const browseStageStyle = isBrowseMode && browseStageSize
    ? {
        width: `${browseStageSize.width}px`,
        height: `${browseStageSize.height}px`,
      }
    : undefined;
  const stage = (
    <div className="office-room__stage-wrap" ref={stageWrapRef}>
      <div className="office-room__stage" ref={stageRef} style={browseStageStyle}>
        <div
          className="office-room__scene-backdrop"
          style={{ backgroundImage: `url(${config.backdrop.assetUrl})` }}
          aria-hidden="true"
        />
        <div className="office-room__scene-vignette" aria-hidden="true" />
        {config.furniture.filter((item) => item.isVisible !== false).flatMap((item) => (
          (item.layers || []).map((layer) => (
            <OfficeDecorLayer
              key={`${item.id}:${layer.id}`}
              furniture={item}
              layer={layer}
              isInteractive={Boolean(editor?.onFurniturePositionChange)}
              isSelected={selectedFurniture?.id === item.id}
              isDragging={draggingFurnitureId === item.id}
              onPointerDown={(event) => {
                handleDecorPointerDown(event, item);
              }}
              onSelect={() => {
                setSelectedFurnitureId(item.id);
              }}
            />
          ))
        ))}
        {Object.values(config.areas).map((area) => {
          const areaSummary = areaSummaries.find((item) => item.id === area.id);
          return (
            <OfficeAreaLabel
              key={area.id}
              area={area}
              count={areaSummary?.occupantCount || 0}
            />
          );
        })}
        {occupants.map((occupant) => (
          <OfficeOccupant
            key={occupant.agentId}
            occupant={occupant}
            assetRegistry={assetRegistry}
            onClick={
              typeof onAgentClick === 'function'
                ? (event) => {
                    event?.preventDefault?.();
                    onAgentClick({
                      agent: occupant,
                      agentId: occupant.agentId,
                      areaId: occupant.areaId,
                      slot: occupant.slot,
                      scene,
                    });
                  }
                : null
            }
          />
        ))}
      </div>
      {isWorkspaceMode ? <div className="office-room__plaque">{primaryAgent?.detail || caption || labels.multiAgentReady}</div> : null}
    </div>
  );

  if (isBrowseMode) {
    return (
      <section className={normalizedClassName} aria-label={title}>
        {stage}
      </section>
    );
  }

  return (
    <section className={normalizedClassName} aria-label={title}>
      <div className="office-room__chrome">
        <div className="office-room__header">
          <div>
            <div className="office-room__eyebrow">{subtitle}</div>
            <h2 className="office-room__title">{title}</h2>
          </div>
          <div className="office-room__summary">
            <span>{labels.primaryAgent}: {primaryAgent?.displayName || 'OtakuClaw'}</span>
            <span>{agentCount} agent{agentCount === 1 ? '' : 's'}</span>
          </div>
        </div>

        <div className={`office-room__content ${editor ? 'has-editor' : ''}`.trim()}>
          {stage}

          {editor && isWorkspaceMode ? (
            <OfficeSceneEditor
              {...editor}
              selectedFurnitureId={selectedFurniture?.id || ''}
              onSelectFurniture={setSelectedFurnitureId}
            />
          ) : null}
        </div>

        <div className="office-room__footer">
          <div className="office-room__legend">
            <span className="tone-idle">idle</span>
            <span className="tone-focus">writing</span>
            <span className="tone-think">researching</span>
            <span className="tone-exec">executing</span>
            <span className="tone-sync">syncing</span>
            <span className="tone-error">error</span>
          </div>
          <div className="office-room__caption">{caption || labels.multiAgentReady}</div>
        </div>
      </div>
    </section>
  );
}
