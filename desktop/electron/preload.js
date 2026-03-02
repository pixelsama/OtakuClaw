const { contextBridge, ipcRenderer } = require('electron');

function onChannel(channel, handler) {
  if (typeof handler !== 'function') {
    return () => {};
  }

  const listener = (_event, payload) => {
    handler(payload);
  };

  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const chatStream = {
  start(request) {
    return ipcRenderer.invoke('chat:stream:start', request);
  },
  abort(request) {
    return ipcRenderer.invoke('chat:stream:abort', request);
  },
  onEvent(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }

    const listener = (_event, payload) => {
      handler(payload);
    };

    ipcRenderer.on('chat:stream:event', listener);

    return () => {
      ipcRenderer.removeListener('chat:stream:event', listener);
    };
  },
};

const settings = {
  get() {
    return ipcRenderer.invoke('settings:get');
  },
  save(partialSettings) {
    return ipcRenderer.invoke('settings:save', partialSettings);
  },
  testConnection(overrideSettings) {
    return ipcRenderer.invoke('settings:test', overrideSettings);
  },
};

const windowMode = {
  setMode(mode) {
    return ipcRenderer.invoke('pet:set-mode', { mode });
  },
  getMode() {
    return ipcRenderer.invoke('pet:get-mode');
  },
  notifyRendererReady(mode) {
    ipcRenderer.send('pet:renderer-ready', { mode });
  },
  notifyModeRendered(mode) {
    ipcRenderer.send('pet:mode-rendered', { mode });
  },
  updateComponentHover(componentId, isHovering) {
    ipcRenderer.send('pet:update-hover', {
      componentId,
      isHovering,
    });
  },
  toggleForceIgnoreMouse() {
    ipcRenderer.send('pet:toggle-force-ignore-mouse');
  },
  onPreModeChanged(handler) {
    return onChannel('pet:pre-mode-changed', handler);
  },
  onModeChanged(handler) {
    return onChannel('pet:mode-changed', handler);
  },
  onForceIgnoreMouseChanged(handler) {
    return onChannel('pet:force-ignore-mouse-changed', handler);
  },
};

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  chatStream,
  settings,
  windowMode,
});
