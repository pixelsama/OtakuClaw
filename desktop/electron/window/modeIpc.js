function registerModeIpc({ ipcMain, windowModeManager, onModeChanged }) {
  const listeners = [];

  ipcMain.handle('pet:get-mode', () => ({
    mode: windowModeManager.getMode(),
  }));

  ipcMain.handle('pet:set-mode', (_event, payload = {}) => {
    const requestedMode = payload?.mode;
    const mode = windowModeManager.requestModeChange(requestedMode);
    return {
      ok: true,
      mode,
    };
  });

  const onRendererReady = (_event, payload = {}) => {
    const appliedMode = windowModeManager.applyPendingMode(payload?.mode);
    if (appliedMode) {
      onModeChanged?.(appliedMode);
    }
  };
  ipcMain.on('pet:renderer-ready', onRendererReady);
  listeners.push(['pet:renderer-ready', onRendererReady]);

  const onModeRendered = () => {
    windowModeManager.notifyModeRendered();
  };
  ipcMain.on('pet:mode-rendered', onModeRendered);
  listeners.push(['pet:mode-rendered', onModeRendered]);

  const onUpdateHover = (_event, payload = {}) => {
    windowModeManager.updateComponentHover(payload?.componentId, Boolean(payload?.isHovering));
  };
  ipcMain.on('pet:update-hover', onUpdateHover);
  listeners.push(['pet:update-hover', onUpdateHover]);

  const onToggleForceIgnore = () => {
    windowModeManager.toggleForceIgnoreMouse();
  };
  ipcMain.on('pet:toggle-force-ignore-mouse', onToggleForceIgnore);
  listeners.push(['pet:toggle-force-ignore-mouse', onToggleForceIgnore]);

  return () => {
    listeners.forEach(([channel, handler]) => {
      ipcMain.removeListener(channel, handler);
    });
    ipcMain.removeHandler('pet:get-mode');
    ipcMain.removeHandler('pet:set-mode');
  };
}

module.exports = {
  registerModeIpc,
};
