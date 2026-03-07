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
    return onChannel('conversation:event', (event = {}) => {
      if (event?.channel !== 'chat') {
        return;
      }
      handler({
        streamId: typeof event.streamId === 'string' ? event.streamId : '',
        type: typeof event.type === 'string' ? event.type : '',
        payload: event.payload && typeof event.payload === 'object' ? event.payload : {},
      });
    });
  },
};

const conversation = {
  submitUserText(request) {
    return ipcRenderer.invoke('conversation:submit-user-text', request);
  },
  abortActive(request) {
    return ipcRenderer.invoke('conversation:abort-active', request);
  },
  onEvent(handler) {
    return onChannel('conversation:event', handler);
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

const nanobotRuntime = {
  status() {
    return ipcRenderer.invoke('nanobot-runtime:status');
  },
  install(payload) {
    return ipcRenderer.invoke('nanobot-runtime:install', payload);
  },
  onProgress(handler) {
    return onChannel('nanobot-runtime:progress', handler);
  },
};

const nanobotDebug = {
  onLog(handler) {
    return onChannel('nanobot-debug:log', handler);
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

const windowControls = {
  getPlatform() {
    return ipcRenderer.invoke('window:get-platform');
  },
  control(action) {
    return ipcRenderer.invoke('window:control', { action });
  },
  getCursorContext() {
    return ipcRenderer.invoke('window:get-cursor-context');
  },
};

const voice = {
  getPttStatus() {
    return ipcRenderer.invoke('voice:ptt-status:get');
  },
  startSession(request) {
    return ipcRenderer.invoke('voice:session:start', request);
  },
  sendAudioChunk(request) {
    return ipcRenderer.invoke('voice:audio:chunk', request);
  },
  commitInput(request) {
    return ipcRenderer.invoke('voice:input:commit', request);
  },
  stopSession(request) {
    return ipcRenderer.invoke('voice:session:stop', request);
  },
  stopTts(request) {
    return ipcRenderer.invoke('voice:tts:stop', request);
  },
  sendPlaybackAck(request) {
    return ipcRenderer.invoke('voice:playback:ack', request);
  },
  runAsrDiagnostics(request) {
    return ipcRenderer.invoke('voice:diagnostics:asr', request);
  },
  runTtsDiagnostics(request) {
    return ipcRenderer.invoke('voice:diagnostics:tts', request);
  },
  listSegmentTrace(request) {
    return ipcRenderer.invoke('voice:segment:trace:list', request);
  },
  onEvent(handler) {
    return onChannel('conversation:event', (event = {}) => {
      if (event?.channel !== 'voice') {
        return;
      }
      const { channel, ...voicePayload } = event;
      handler(voicePayload);
    });
  },
  onFlowControl(handler) {
    return onChannel('voice:flow-control', handler);
  },
  onPttCommand(handler) {
    return onChannel('voice:ptt-command', handler);
  },
  onPttStatus(handler) {
    return onChannel('voice:ptt-status', handler);
  },
};

const live2dModels = {
  list() {
    return ipcRenderer.invoke('live2d-models:list');
  },
  importZip() {
    return ipcRenderer.invoke('live2d-models:import-zip');
  },
};

const voiceModels = {
  catalog() {
    return ipcRenderer.invoke('voice-models:catalog');
  },
  list() {
    return ipcRenderer.invoke('voice-models:list');
  },
  installCatalog(payload) {
    return ipcRenderer.invoke('voice-models:install-catalog', payload);
  },
  select(payload) {
    return ipcRenderer.invoke('voice-models:select', payload);
  },
  download(payload) {
    return ipcRenderer.invoke('voice-models:download', payload);
  },
  onDownloadProgress(handler) {
    return onChannel('voice-models:download-progress', handler);
  },
};

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  platform: process.platform,
  chatStream,
  conversation,
  settings,
  nanobotRuntime,
  nanobotDebug,
  windowMode,
  windowControls,
  voice,
  live2dModels,
  voiceModels,
});
