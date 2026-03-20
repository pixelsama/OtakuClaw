import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveOfficeOccupantSprite } from './officeSceneAssets.js';
import { calculateDraggedFurniturePosition } from './officeSceneDrag.js';
import OfficeSceneEditor from './OfficeSceneEditor.jsx';
import './OfficeScene.css';

function OfficeDecorLayer({ furniture, layer, isInteractive = false, isSelected = false, isDragging = false, onPointerDown, onSelect }) {
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
        backgroundPosition: `${layer.backgroundPositionX || 0}% ${layer.backgroundPositionY || 0}%`,
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

function OfficeOccupant({ occupant }) {
  const sprite = resolveOfficeOccupantSprite(occupant);

  return (
    <div
      className={[
        'office-room__occupant',
        `palette-${occupant.palette}`,
        occupant.isPrimary ? 'is-primary' : '',
        `state-${occupant.businessState}`,
      ].filter(Boolean).join(' ')}
      style={{ left: `${occupant.slot.x}%`, top: `${occupant.slot.y}%` }}
      title={`${occupant.displayName}: ${occupant.businessState}`}
    >
      <div className="office-room__agent-shadow" aria-hidden="true" />
      <div
        className={[
          'office-room__agent-sprite',
          `office-room__agent-sprite--${sprite.variant}`,
          `mood-${occupant.mood}`,
        ].filter(Boolean).join(' ')}
        style={{
          backgroundImage: `url(${sprite.asset})`,
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
  editor = null,
}) {
  const stageRef = useRef(null);
  const dragStateRef = useRef(null);
  const [selectedFurnitureId, setSelectedFurnitureId] = useState(editor?.furniture?.[0]?.id || '');
  const [draggingFurnitureId, setDraggingFurnitureId] = useState('');
  const normalizedClassName = [
    'office-room',
    compact ? 'is-compact' : '',
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
    setDraggingFurnitureId(furniture.id);
    event.preventDefault();
  };

  if (!scene) {
    return null;
  }

  const { title, subtitle, caption, labels, config, occupants, areaSummaries, primaryAgent, agentCount } = scene;

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
          <div className="office-room__stage-wrap">
            <div className="office-room__stage" ref={stageRef}>
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
                <OfficeOccupant key={occupant.agentId} occupant={occupant} />
              ))}
            </div>
            <div className="office-room__plaque">{primaryAgent?.detail || caption || labels.multiAgentReady}</div>
          </div>

          {editor ? (
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
