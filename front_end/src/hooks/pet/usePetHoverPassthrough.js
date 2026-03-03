import { useCallback } from 'react';

export function usePetHoverPassthrough({
  desktopMode,
  isPetMode,
  updateHover,
}) {
  const setHover = useCallback(
    (componentId, isHovering) => {
      if (!desktopMode || !isPetMode || typeof updateHover !== 'function' || !componentId) {
        return;
      }

      updateHover(componentId, Boolean(isHovering));
    },
    [desktopMode, isPetMode, updateHover],
  );

  const bindHover = useCallback(
    (componentId) => {
      if (!desktopMode || !isPetMode || !componentId) {
        return {};
      }

      return {
        onMouseEnter: () => setHover(componentId, true),
        onMouseLeave: () => setHover(componentId, false),
      };
    },
    [desktopMode, isPetMode, setHover],
  );

  return {
    bindHover,
    setHover,
  };
}
