import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function getPointerCoordinates(event) {
  return {
    x: event.clientX,
    y: event.clientY,
  };
}

function clampOffset(nextOffset, containerElement) {
  if (!containerElement) {
    return nextOffset;
  }

  const stageElement = containerElement.closest('.live2d-stage');
  if (!stageElement) {
    return nextOffset;
  }

  const keepVisiblePx = 80;
  const maxX = Math.max(stageElement.clientWidth - keepVisiblePx, 0);
  const maxY = Math.max(stageElement.clientHeight - keepVisiblePx, 0);

  return {
    x: Math.max(-maxX, Math.min(maxX, nextOffset.x)),
    y: Math.max(-maxY, Math.min(maxY, nextOffset.y)),
  };
}

export function usePetDraggable({ enabled, onDragStateChange }) {
  const containerRef = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef({
    active: false,
    pointerX: 0,
    pointerY: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const offsetRef = useRef(offset);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  const endDragging = useCallback(() => {
    if (!dragStateRef.current.active) {
      return;
    }

    dragStateRef.current.active = false;
    setIsDragging(false);
    if (typeof onDragStateChange === 'function') {
      onDragStateChange(false);
    }
  }, [onDragStateChange]);

  const onPointerMove = useCallback(
    (event) => {
      if (!enabled || !dragStateRef.current.active) {
        return;
      }

      const pointer = getPointerCoordinates(event);
      const rawOffset = {
        x: dragStateRef.current.offsetX + pointer.x - dragStateRef.current.pointerX,
        y: dragStateRef.current.offsetY + pointer.y - dragStateRef.current.pointerY,
      };

      const nextOffset = clampOffset(rawOffset, containerRef.current);
      setOffset(nextOffset);
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) {
      endDragging();
      return undefined;
    }

    const handlePointerUp = () => {
      endDragging();
    };

    globalThis.addEventListener('pointermove', onPointerMove);
    globalThis.addEventListener('pointerup', handlePointerUp);
    globalThis.addEventListener('pointercancel', handlePointerUp);

    return () => {
      globalThis.removeEventListener('pointermove', onPointerMove);
      globalThis.removeEventListener('pointerup', handlePointerUp);
      globalThis.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [enabled, endDragging, onPointerMove]);

  const onPointerDown = useCallback(
    (event) => {
      if (!enabled) {
        return;
      }

      if (typeof event.button === 'number' && event.button !== 0) {
        return;
      }

      const pointer = getPointerCoordinates(event);
      dragStateRef.current = {
        active: true,
        pointerX: pointer.x,
        pointerY: pointer.y,
        offsetX: offsetRef.current.x,
        offsetY: offsetRef.current.y,
      };

      setIsDragging(true);
      if (typeof onDragStateChange === 'function') {
        onDragStateChange(true);
      }

      if (typeof event.currentTarget?.setPointerCapture === 'function') {
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      event.preventDefault();
    },
    [enabled, onDragStateChange],
  );

  const dragStyle = useMemo(
    () => ({
      transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
      cursor: isDragging ? 'grabbing' : 'grab',
      touchAction: 'none',
    }),
    [isDragging, offset.x, offset.y],
  );

  return {
    isDragging,
    dragStyle,
    dragBindings: {
      onPointerDown,
    },
    resetOffset: () => setOffset({ x: 0, y: 0 }),
  };
}
