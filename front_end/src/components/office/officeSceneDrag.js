function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function calculateDraggedFurniturePosition({
  stageRect,
  layerRect,
  pointerClientX,
  pointerClientY,
  pointerOffsetX,
  pointerOffsetY,
} = {}) {
  const stageWidth = Number(stageRect?.width) || 0;
  const stageHeight = Number(stageRect?.height) || 0;
  const layerWidth = Number(layerRect?.width) || 0;
  const layerHeight = Number(layerRect?.height) || 0;

  if (stageWidth <= 0 || stageHeight <= 0 || layerWidth <= 0 || layerHeight <= 0) {
    return null;
  }

  const rawLeftPx = Number(pointerClientX) - Number(stageRect.left || 0) - Number(pointerOffsetX || 0);
  const rawTopPx = Number(pointerClientY) - Number(stageRect.top || 0) - Number(pointerOffsetY || 0);
  const maxLeftPx = Math.max(0, stageWidth - layerWidth);
  const maxTopPx = Math.max(0, stageHeight - layerHeight);
  const leftPx = clamp(rawLeftPx, 0, maxLeftPx);
  const topPx = clamp(rawTopPx, 0, maxTopPx);

  return {
    left: Number(((leftPx / stageWidth) * 100).toFixed(2)),
    top: Number(((topPx / stageHeight) * 100).toFixed(2)),
  };
}
