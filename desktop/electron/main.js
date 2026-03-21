const path = require('node:path');
const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  protocol,
  screen,
  globalShortcut,
  desktopCapturer,
  session,
  systemPreferences,
} = require('electron');

const { registerChatStreamIpc } = require('./ipc/chatStream');
const { registerConversationIpc } = require('./ipc/conversation');
const { registerOfficeStateIpc } = require('./ipc/officeState');
const { registerValueStateIpc } = require('./ipc/valueState');
const { registerLive2DModelsIpc } = require('./ipc/live2dModels');
const { registerAppUpdaterIpc } = require('./ipc/appUpdater');
const { registerNanobotSkillsIpc } = require('./ipc/nanobotSkills');
const { registerNanobotRuntimeIpc } = require('./ipc/nanobotRuntime');
const { registerSettingsIpc } = require('./ipc/settings');
const { registerScreenshotCaptureIpc } = require('./ipc/screenshotCapture');
const { registerVoiceModelsIpc } = require('./ipc/voiceModels');
const { registerVoiceSessionIpc } = require('./ipc/voiceSession');
const { createConversationRuntime } = require('./services/chat/conversationRuntime');
const { createChatBackendManager } = require('./services/chat/backendManager');
const { NanobotBackendAdapter } = require('./services/chat/backends/nanobotBackend');
const { NanobotRuntimeManager } = require('./services/chat/nanobot/nanobotRuntimeManager');
const { NanobotSkillsLibrary } = require('./services/chat/nanobot/nanobotSkillsLibrary');
const { Live2DModelLibrary, MODEL_PROTOCOL } = require('./services/live2dModelLibrary');
const { createOfficePresenceProducer } = require('./services/officePresenceProducer');
const { PythonEnvManager } = require('./services/python/pythonEnvManager');
const { PythonRuntimeManager } = require('./services/python/pythonRuntimeManager');
const { createOfficeStateStore } = require('./services/officeStateStore');
const { createValueStateStore } = require('./services/valueState/valueStateStore');
const { createValueProposalService } = require('./services/valueState/valueProposalService');
const { SettingsStore } = require('./services/settingsStore');
const { AppUpdaterService } = require('./services/appUpdaterService');
const { ScreenshotCaptureService } = require('./services/screenshotCaptureService');
const { ScreenshotSelectionService } = require('./services/screenshotSelectionService');
const { VoiceModelLibrary } = require('./services/voice/voiceModelLibrary');
const { WindowModeManager } = require('./window/windowModeManager');
const { TrayManager } = require('./window/trayManager');
const { registerModeIpc } = require('./window/modeIpc');

protocol.registerSchemesAsPrivileged([
  {
    scheme: MODEL_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mainWindow = null;
let disposeChatStreamHandlers = null;
let disposeConversationHandlers = null;
let disposeOfficeStateHandlers = null;
let disposeValueStateHandlers = null;
let disposeModeHandlers = null;
let disposeLive2DModelsHandlers = null;
let disposeAppUpdaterHandlers = null;
let disposeNanobotRuntimeHandlers = null;
let disposeNanobotSkillsHandlers = null;
let disposeVoiceModelsHandlers = null;
let disposeVoiceSessionHandlers = null;
let disposeScreenshotCaptureHandlers = null;
let startChatStreamFromMain = null;
let conversationRuntime = null;
let officeStateStore = null;
let officePresenceProducer = null;
let valueStateStore = null;
let valueProposalService = null;
let settingsStore = null;
let windowModeManager = null;
let trayManager = null;
let live2dModelLibrary = null;
let screenshotCaptureService = null;
let screenshotSelectionService = null;
let pythonRuntimeManager = null;
let pythonEnvManager = null;
let voiceModelLibrary = null;
let nanobotRuntimeManager = null;
let nanobotSkillsLibrary = null;
let isQuitting = false;
let chatBackendManager = null;
let appUpdaterService = null;
let disposeOfficeStateSubscription = null;
let disposeValueStateSubscription = null;
const PINNED_NANOBOT_ARCHIVE_URL = 'https://codeload.github.com/HKUDS/nanobot/tar.gz/refs/tags/v0.1.4.post4';
const legacyConversationMirrorEnabled = (() => {
  const value = process.env.OPENCLAW_ENABLE_LEGACY_STREAM_EVENTS;
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
})();

function normalizeEnvText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function prepareQuitForUpdate() {
  isQuitting = true;
}

function getDefaultVoiceToggleAccelerator() {
  if (process.platform === 'darwin') {
    // Space-based shortcuts are commonly intercepted by macOS and IMEs.
    return 'F8';
  }

  return 'CommandOrControl+Shift+Space';
}

const DEFAULT_GLOBAL_VOICE_TOGGLE_ACCELERATOR =
  typeof process.env.OPENCLAW_VOICE_TOGGLE_ACCELERATOR === 'string'
    ? process.env.OPENCLAW_VOICE_TOGGLE_ACCELERATOR.trim() || getDefaultVoiceToggleAccelerator()
    : getDefaultVoiceToggleAccelerator();
let registeredVoiceToggleAccelerator = '';

function emitVoiceToggleRequest(payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('voice:toggle-request', payload);
}

function registerGlobalVoiceToggleShortcut() {
  if (!DEFAULT_GLOBAL_VOICE_TOGGLE_ACCELERATOR) {
    return;
  }

  if (registeredVoiceToggleAccelerator) {
    globalShortcut.unregister(registeredVoiceToggleAccelerator);
    registeredVoiceToggleAccelerator = '';
  }

  const registered = globalShortcut.register(DEFAULT_GLOBAL_VOICE_TOGGLE_ACCELERATOR, () => {
    emitVoiceToggleRequest({
      source: 'global-shortcut',
      accelerator: DEFAULT_GLOBAL_VOICE_TOGGLE_ACCELERATOR,
    });
  });

  if (!registered) {
    console.warn('Failed to register global voice toggle shortcut.', {
      accelerator: DEFAULT_GLOBAL_VOICE_TOGGLE_ACCELERATOR,
    });
    return;
  }

  registeredVoiceToggleAccelerator = DEFAULT_GLOBAL_VOICE_TOGGLE_ACCELERATOR;
  console.info('Registered global voice toggle shortcut.', {
    accelerator: registeredVoiceToggleAccelerator,
  });
}

function unregisterGlobalVoiceToggleShortcut() {
  if (!registeredVoiceToggleAccelerator) {
    return;
  }

  globalShortcut.unregister(registeredVoiceToggleAccelerator);
  registeredVoiceToggleAccelerator = '';
}

function registerWindowControlIpc() {
  ipcMain.handle('window:get-platform', () => ({
    platform: process.platform,
  }));

  ipcMain.handle('window:control', (_event, payload = {}) => {
    const window = mainWindow;
    if (!window || window.isDestroyed()) {
      return { ok: false, reason: 'window_unavailable' };
    }

    const action = payload?.action;
    if (action === 'minimize') {
      window.minimize();
      return { ok: true };
    }

    if (action === 'toggle-maximize') {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
      return { ok: true, maximized: window.isMaximized() };
    }

    if (action === 'close') {
      if (process.platform === 'darwin') {
        window.hide();
      } else {
        window.close();
      }
      return { ok: true };
    }

    return { ok: false, reason: 'unsupported_action' };
  });

  ipcMain.handle('window:get-cursor-context', () => {
    const window = mainWindow;
    if (!window || window.isDestroyed()) {
      return { ok: false, reason: 'window_unavailable' };
    }

    const displays = screen.getAllDisplays();
    if (!displays.length) {
      return { ok: false, reason: 'display_unavailable' };
    }

    const minX = Math.min(...displays.map((item) => item.bounds.x));
    const minY = Math.min(...displays.map((item) => item.bounds.y));
    const maxX = Math.max(...displays.map((item) => item.bounds.x + item.bounds.width));
    const maxY = Math.max(...displays.map((item) => item.bounds.y + item.bounds.height));

    return {
      ok: true,
      mode: windowModeManager?.getMode?.() || 'window',
      cursor: screen.getCursorScreenPoint(),
      windowBounds: window.getBounds(),
      desktopBounds: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      },
    };
  });
}

function sendOfficeStateChange(payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('office-state:changed', payload);
}

function sendValueStateChange(payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('value-state:changed', payload);
}

function normalizeMainText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMainAgentId(value) {
  return normalizeMainText(value) || 'main';
}

function normalizeMainBackendName(value) {
  const normalized = normalizeMainText(value).toLowerCase();
  if (!normalized) {
    return 'nanobot';
  }

  if (normalized === 'openclaw') {
    return 'nanobot';
  }

  return normalized;
}

function buildOfficeConversationUpdate(event = {}) {
  if (!event || typeof event !== 'object' || event.channel !== 'chat') {
    return null;
  }

  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const eventType = normalizeMainText(event.type).toLowerCase();
  const agentId = normalizeMainAgentId(event.agentId || payload.agentId);
  const backend = normalizeMainBackendName(event.backend || payload.backend);
  const routeKey = normalizeMainText(event.routeKey || payload.routeKey);
  const sessionId = normalizeMainText(event.sessionId || payload.sessionId);
  const sessionNamespace = normalizeMainText(event.sessionNamespace || payload.sessionNamespace || sessionId);
  const profileId = normalizeMainText(event.profileId || payload.profileId);
  const turnId = normalizeMainText(event.turnId || payload.turnId || event.streamId || payload.streamId);
  const activeState =
    normalizeMainText(payload.businessState || payload.state || payload.activity || payload.status)
    || (eventType === 'error' ? 'error' : eventType === 'done' ? 'idle' : eventType === 'stream-start' ? 'writing' : '');
  const detail =
    normalizeMainText(payload.detail || payload.message || payload.text || payload.content)
    || (eventType === 'error' ? 'stream error' : eventType === 'done' ? 'stream complete' : '');

  if (!agentId) {
    return null;
  }

  if (!['stream-start', 'agent-state', 'done', 'error', 'text-delta'].includes(eventType)) {
    return null;
  }

  return {
    channel: 'office',
    type: 'upsert',
    payload: {
      activeAgentId: agentId,
      agent: {
        id: agentId,
        agentId,
        backend,
        routeKey,
        sessionId,
        sessionNamespace,
        profileId,
        turnId,
        businessState: activeState || 'writing',
        detail,
        updatedAt: event.timestamp || new Date().toISOString(),
      },
    },
  };
}

function buildValueProposalUpdate(event = {}) {
  if (!event || typeof event !== 'object' || event.channel !== 'chat') {
    return null;
  }

  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const statUpdates =
    Array.isArray(payload.statUpdates)
      ? payload.statUpdates
      : Array.isArray(payload.stat_updates)
        ? payload.stat_updates
        : Array.isArray(payload.proposal?.statUpdates)
          ? payload.proposal.statUpdates
          : Array.isArray(payload.proposal?.stat_updates)
            ? payload.proposal.stat_updates
            : [];

  if (!statUpdates.length) {
    return null;
  }

  return {
    agentId: normalizeMainAgentId(event.agentId || payload.agentId),
    characterId: normalizeMainText(event.characterId || payload.characterId || payload.avatarId) || 'default-character',
    routeKey: normalizeMainText(event.routeKey || payload.routeKey),
    sessionId: normalizeMainText(event.sessionId || payload.sessionId),
    sessionNamespace: normalizeMainText(event.sessionNamespace || payload.sessionNamespace),
    profileId: normalizeMainText(event.profileId || payload.profileId),
    turnId: normalizeMainText(event.turnId || payload.turnId || event.streamId || payload.streamId),
    source: normalizeMainText(event.source || payload.source || 'conversation'),
    statUpdates,
  };
}

function getRendererDevUrl() {
  return process.env.ELECTRON_DEV_SERVER_URL || 'http://127.0.0.1:3000';
}

function isAllowedExternalUrl(targetUrl) {
  try {
    const parsedTarget = new URL(targetUrl);
    const parsedBase = new URL(settingsStore.getPublic().baseUrl);
    return parsedTarget.origin === parsedBase.origin;
  } catch {
    return false;
  }
}

function createWindowOptions() {
  return {
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
}

function registerDisplayMediaHandler() {
  const defaultSession = session.defaultSession;
  if (!defaultSession || typeof defaultSession.setDisplayMediaRequestHandler !== 'function') {
    return;
  }

  defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({
        types: ['screen'],
        thumbnailSize: {
          width: 0,
          height: 0,
        },
      })
      .then((sources) => {
        const primaryDisplay = screen.getPrimaryDisplay();
        const selectedSource =
          sources.find((source) => source.display_id === String(primaryDisplay?.id || ''))
          || sources[0]
          || null;

        if (!selectedSource) {
          callback({});
          return;
        }

        callback({
          video: selectedSource,
        });
      })
      .catch((error) => {
        console.warn('Failed to resolve desktop capture sources:', error);
        callback({});
      });
  });
}

function isTrustedMediaOrigin(origin = '') {
  const normalizedOrigin = typeof origin === 'string' ? origin.trim() : '';
  if (!normalizedOrigin) {
    return false;
  }

  if (normalizedOrigin.startsWith('file://')) {
    return true;
  }

  try {
    const parsedOrigin = new URL(normalizedOrigin);
    const devOrigin = new URL(getRendererDevUrl());
    if (parsedOrigin.origin === devOrigin.origin || parsedOrigin.href.startsWith(devOrigin.origin)) {
      return true;
    }
  } catch {
    // noop
  }

  return false;
}

function registerMediaPermissionHandlers() {
  const defaultSession = session.defaultSession;
  if (!defaultSession) {
    return;
  }

  if (typeof defaultSession.setPermissionCheckHandler === 'function') {
    defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details = {}) => {
      if (permission !== 'media') {
        return false;
      }

      const currentUrl = typeof webContents?.getURL === 'function' ? webContents.getURL() : '';
      if (!isTrustedMediaOrigin(requestingOrigin) && !isTrustedMediaOrigin(currentUrl)) {
        return false;
      }

      const mediaType = typeof details.mediaType === 'string' ? details.mediaType : '';
      const mediaTypes = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
      // Some Electron builds provide empty mediaType/mediaTypes for permission preflight.
      return !mediaType && mediaTypes.length === 0
        ? true
        : mediaType === 'audio' || mediaTypes.includes('audio');
    });
  }

  if (typeof defaultSession.setPermissionRequestHandler === 'function') {
    defaultSession.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
      if (permission !== 'media') {
        callback(false);
        return;
      }

      const requestingOrigin =
        typeof details.requestingOrigin === 'string'
          ? details.requestingOrigin
          : typeof webContents?.getURL === 'function'
            ? webContents.getURL()
            : '';
      const currentUrl = typeof webContents?.getURL === 'function' ? webContents.getURL() : '';
      if (!isTrustedMediaOrigin(requestingOrigin) && !isTrustedMediaOrigin(currentUrl)) {
        callback(false);
        return;
      }

      const mediaType = typeof details.mediaType === 'string' ? details.mediaType : '';
      const mediaTypes = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
      const hasAudioRequest = mediaType === 'audio' || mediaTypes.includes('audio');
      const isPreflight = !mediaType && mediaTypes.length === 0;
      if (!hasAudioRequest && !isPreflight) {
        callback(false);
        return;
      }

      if (process.platform !== 'darwin' || typeof systemPreferences?.askForMediaAccess !== 'function') {
        callback(true);
        return;
      }

      Promise.resolve(systemPreferences.askForMediaAccess('microphone'))
        .then((granted) => {
          callback(Boolean(granted));
        })
        .catch((error) => {
          console.warn('Failed to ask microphone media access:', error);
          callback(false);
        });
    });
  }
}

function registerModelProtocol() {
  protocol.handle(MODEL_PROTOCOL, async (request) => {
    try {
      const { buffer, mimeType } = await live2dModelLibrary.readAssetFromProtocolUrl(request.url);
      return new Response(buffer, {
        status: 200,
        headers: {
          'content-type': mimeType,
          'cache-control': 'no-store',
        },
      });
    } catch (error) {
      return new Response('Not Found', { status: 404 });
    }
  });
}

async function createMainWindow() {
  mainWindow = new BrowserWindow(createWindowOptions());
  windowModeManager.attachWindow(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL() || '';
    if (url !== currentUrl) {
      event.preventDefault();
    }
  });

  if (app.isPackaged) {
    const indexFile = path.join(app.getAppPath(), 'front_end', 'dist', 'index.html');
    await mainWindow.loadFile(indexFile);
  } else {
    await mainWindow.loadURL(getRendererDevUrl());
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    windowModeManager.detachWindow();
    mainWindow = null;
  });
}

async function bootstrap() {
  settingsStore = new SettingsStore(app);
  await settingsStore.init();
  live2dModelLibrary = new Live2DModelLibrary(app);
  await live2dModelLibrary.init();
  screenshotCaptureService = new ScreenshotCaptureService(app);
  await screenshotCaptureService.init();
  screenshotSelectionService = new ScreenshotSelectionService(app, {
    screenshotCaptureService,
    getOverlayPreloadPath: () => path.join(__dirname, 'preload.js'),
    getRendererDevUrl,
  });
  pythonRuntimeManager = new PythonRuntimeManager(app);
  await pythonRuntimeManager.init();
  pythonEnvManager = new PythonEnvManager(app, {
    pythonRuntimeManager,
  });
  await pythonEnvManager.init();
  voiceModelLibrary = new VoiceModelLibrary(app, {
    pythonRuntimeManager,
    pythonEnvManager,
  });
  await voiceModelLibrary.init();
  officeStateStore = createOfficeStateStore();
  valueStateStore = createValueStateStore({
    app,
  });
  await valueStateStore.init();
  valueProposalService = createValueProposalService({
    valueStateStore,
  });
  officePresenceProducer = createOfficePresenceProducer({
    officeStateStore,
  });
  nanobotRuntimeManager = new NanobotRuntimeManager(app, {
    pythonRuntimeManager,
    pythonEnvManager,
    env: {
      ...process.env,
      NANOBOT_RUNTIME_ARCHIVE_URL:
        normalizeEnvText(process.env.NANOBOT_RUNTIME_ARCHIVE_URL)
        || normalizeEnvText(process.env.NANOBOT_DOWNLOAD_URL)
        || PINNED_NANOBOT_ARCHIVE_URL,
    },
  });
  await nanobotRuntimeManager.init();
  nanobotSkillsLibrary = new NanobotSkillsLibrary(app, {
    nanobotRuntimeManager,
  });
  await nanobotSkillsLibrary.init();
  chatBackendManager = createChatBackendManager({
    backends: [
      new NanobotBackendAdapter({
        resolveRuntime: () => ({
          ...nanobotRuntimeManager.resolveLaunchConfig(),
          nanobotSkillsLibraryPath: nanobotSkillsLibrary.getRootDir(),
        }),
        resolveCapture: (captureId) => screenshotCaptureService?.resolveCapture(captureId) || null,
      }),
    ],
  });
  registerModelProtocol();
  registerDisplayMediaHandler();
  registerMediaPermissionHandlers();

  registerSettingsIpc({
    ipcMain,
    settingsStore,
    getWindow: () => mainWindow,
    backendManager: chatBackendManager,
  });
  disposeOfficeStateHandlers = registerOfficeStateIpc({
    ipcMain,
    officeStateStore,
    officePresenceProducer,
  });
  disposeValueStateHandlers = registerValueStateIpc({
    ipcMain,
    valueStateStore,
    valueProposalService,
  });
  appUpdaterService = new AppUpdaterService({
    app,
    onBeforeInstallUpdate: () => {
      prepareQuitForUpdate();
    },
    emitState: (payload = {}) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send('app-updater:state', payload);
    },
  });
  disposeAppUpdaterHandlers = registerAppUpdaterIpc({
    ipcMain,
    appUpdaterService,
  });

  windowModeManager = new WindowModeManager();

  trayManager = new TrayManager({
    onSetMode: (mode) => {
      trayManager?.setMode(mode);
      windowModeManager.requestModeChange(mode);
    },
    onToggleMousePassthrough: () => {
      windowModeManager.toggleForceIgnoreMouse();
    },
    onShow: () => {
      mainWindow?.show();
    },
    onHide: () => {
      mainWindow?.hide();
    },
  });
  trayManager.create();

  disposeModeHandlers = registerModeIpc({
    ipcMain,
    windowModeManager,
    onModeChanged: (mode) => {
      trayManager?.setMode(mode);
    },
  });

  registerWindowControlIpc();
  disposeLive2DModelsHandlers = registerLive2DModelsIpc({
    ipcMain,
    getWindow: () => mainWindow,
    modelLibrary: live2dModelLibrary,
  });
  disposeScreenshotCaptureHandlers = registerScreenshotCaptureIpc({
    ipcMain,
    getWindow: () => mainWindow,
    screenshotCaptureService,
    screenshotSelectionService,
  });
  disposeNanobotRuntimeHandlers = registerNanobotRuntimeIpc({
    ipcMain,
    nanobotRuntimeManager,
    emitProgress: (payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send('nanobot-runtime:progress', payload);
    },
  });
  disposeNanobotSkillsHandlers = registerNanobotSkillsIpc({
    ipcMain,
    getWindow: () => mainWindow,
    skillsLibrary: nanobotSkillsLibrary,
  });
  disposeVoiceModelsHandlers = registerVoiceModelsIpc({
    ipcMain,
    voiceModelLibrary,
    emitDownloadProgress: (payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send('voice-models:download-progress', payload);
    },
    onSelectionChanged: async () => {
      if (!disposeVoiceSessionHandlers || typeof disposeVoiceSessionHandlers.warmupRuntime !== 'function') {
        return;
      }

      await disposeVoiceSessionHandlers.warmupRuntime({
        reload: true,
        warmAsr: true,
        warmTts: true,
      });
    },
  });

  const chatStreamControl = registerChatStreamIpc({
    ipcMain,
    getSettings: () => settingsStore.getForMain(),
    backendManager: chatBackendManager,
    emitEvent: (payload) => {
      conversationRuntime?.onChatStreamEvent?.(payload);
      if (disposeVoiceSessionHandlers && typeof disposeVoiceSessionHandlers.enqueueSegmentReady === 'function') {
        if (payload?.type === 'segment-ready' && payload?.payload) {
          try {
            disposeVoiceSessionHandlers.enqueueSegmentReady(payload.payload);
          } catch (error) {
            console.warn('Failed to enqueue segment-ready for voice playback:', error);
          }
        } else if (
          typeof disposeVoiceSessionHandlers.markTurnDone === 'function'
          && (payload?.type === 'done' || payload?.type === 'error')
        ) {
          try {
            const eventPayload = payload?.payload || {};
            const sessionId = typeof eventPayload.sessionId === 'string' ? eventPayload.sessionId : '';
            const turnId =
              typeof eventPayload.turnId === 'string'
                ? eventPayload.turnId
                : typeof payload?.streamId === 'string'
                  ? payload.streamId
                  : '';
            if (sessionId && turnId) {
              disposeVoiceSessionHandlers.markTurnDone({
                sessionId,
                turnId,
                aborted:
                  payload.type === 'error'
                  || Boolean(eventPayload.aborted),
                reason: payload.type === 'error' ? 'turn_error' : '',
              });
            }
          } catch (error) {
            console.warn('Failed to mark voice segment turn done:', error);
          }
        }
      }

      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      if (legacyConversationMirrorEnabled) {
        mainWindow.webContents.send('chat:stream:event', payload);
      }
    },
  });
  disposeChatStreamHandlers = chatStreamControl;
  startChatStreamFromMain =
    typeof chatStreamControl?.start === 'function' ? chatStreamControl.start : null;
  conversationRuntime = createConversationRuntime({
    startChatStream: async (request = {}) => {
      if (typeof startChatStreamFromMain !== 'function') {
        return {
          ok: false,
          reason: 'chat_stream_unavailable',
        };
      }
      return startChatStreamFromMain(request);
    },
    abortChatStream: async ({ streamId } = {}) => {
      if (!streamId) {
        return {
          ok: false,
          reason: 'invalid_stream_id',
        };
      }
      if (typeof chatStreamControl?.abort !== 'function') {
        return {
          ok: false,
          reason: 'chat_stream_unavailable',
        };
      }
      return chatStreamControl.abort({ streamId });
    },
    emitConversationEvent: (payload) => {
      const conversationEvent = payload && typeof payload === 'object' ? payload : {};
      if (conversationEvent.channel === 'chat') {
        const officeEvent = buildOfficeConversationUpdate(conversationEvent);
        if (officeEvent) {
          officeStateStore?.applyConversationEvent?.(officeEvent);
        }

        const valueProposal = buildValueProposalUpdate(conversationEvent);
        if (valueProposal) {
          void valueProposalService?.applyProposal?.(valueProposal).then((result) => {
            if (!result?.ok || !result?.changed || !mainWindow || mainWindow.isDestroyed()) {
              return;
            }

            mainWindow.webContents.send('conversation:event', {
              channel: 'system',
              type: 'stat-updated',
              timestamp: new Date().toISOString(),
              agentId: valueProposal.agentId,
              routeKey: valueProposal.routeKey,
              sessionId: valueProposal.sessionId,
              turnId: valueProposal.turnId,
              payload: {
                agentId: valueProposal.agentId,
                routeKey: valueProposal.routeKey,
                sessionId: valueProposal.sessionId,
                turnId: valueProposal.turnId,
                stats: result?.state?.stats || {},
                statUpdates: valueProposal.statUpdates || [],
              },
            });
          }).catch((error) => {
            console.warn('Failed to apply value proposal from chat event:', error);
          });
        }
      } else if (conversationEvent.channel === 'office') {
        officePresenceProducer?.applyConversationEvent?.(conversationEvent);
      }

      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      mainWindow.webContents.send('conversation:event', conversationEvent);
    },
  });
  disposeConversationHandlers = registerConversationIpc({
    ipcMain,
    conversationRuntime,
  });

  disposeVoiceSessionHandlers = registerVoiceSessionIpc({
    ipcMain,
    emitEvent: (payload) => {
      conversationRuntime?.onVoiceEvent?.(payload);
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      if (legacyConversationMirrorEnabled) {
        mainWindow.webContents.send('voice:event', payload);
      }
    },
    emitFlowControl: (payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      mainWindow.webContents.send('voice:flow-control', payload);
    },
    onAsrFinal: async ({ sessionId, text }) => {
      const content = typeof text === 'string' ? text.trim() : '';
      if (!content || !conversationRuntime) {
        return;
      }

      try {
        const started = await conversationRuntime.submitUserText({
          sessionId,
          content,
          policy: 'latest-wins',
          options: {
            source: 'voice-asr',
          },
        });
        if (!started?.ok) {
          console.warn('Auto chat stream from ASR final skipped:', started?.reason || 'unknown_reason');
        }
      } catch (error) {
        console.error('Failed to auto-start chat stream from ASR final:', error);
      }
    },
    resolveVoiceEnv: () => {
      const envWithVoiceSettings =
        settingsStore && typeof settingsStore.getVoiceRuntimeEnv === 'function'
          ? settingsStore.getVoiceRuntimeEnv(process.env)
          : process.env;
      if (!voiceModelLibrary) {
        return envWithVoiceSettings;
      }
      return voiceModelLibrary.getRuntimeEnv(envWithVoiceSettings);
    },
    ttsBackpressureTimeoutMs: process.env.VOICE_TTS_BACKPRESSURE_TIMEOUT_MS,
  });

  await createMainWindow();
  disposeOfficeStateSubscription =
    officeStateStore?.subscribe?.((state, mutation) => {
      sendOfficeStateChange({
        state,
        mutation,
      });
    }) || null;
  disposeValueStateSubscription =
    valueStateStore?.subscribe?.((state, mutation) => {
      sendValueStateChange({
        channel: 'value',
        type: mutation?.type || 'state-changed',
        timestamp: mutation?.event?.timestamp || state?.updatedAt || new Date().toISOString(),
        agentId: state?.agentId || mutation?.agentId || '',
        routeKey: state?.routeKey || mutation?.event?.routeKey || '',
        sessionId: state?.sessionId || mutation?.event?.sessionId || '',
        payload: {
          ...(state || {}),
          lastEvent: mutation?.event || state?.lastEvent || null,
        },
      });
    }) || null;
  registerGlobalVoiceToggleShortcut();
  if (disposeVoiceSessionHandlers && typeof disposeVoiceSessionHandlers.warmupRuntime === 'function') {
    Promise.resolve(
      disposeVoiceSessionHandlers.warmupRuntime({
        reload: true,
        warmAsr: true,
        warmTts: true,
      }),
    ).catch((error) => {
      console.warn('Initial voice model warmup failed:', error);
    });
  }

  app.on('activate', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      await createMainWindow();
      return;
    }

    mainWindow.show();
  });
}

app
  .whenReady()
  .then(bootstrap)
  .catch((error) => {
    console.error('Electron bootstrap failed:', error);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  prepareQuitForUpdate();
  unregisterGlobalVoiceToggleShortcut();

  if (conversationRuntime) {
    void conversationRuntime.dispose();
    conversationRuntime = null;
  }
  if (disposeConversationHandlers) {
    disposeConversationHandlers();
  }
  if (disposeOfficeStateHandlers) {
    disposeOfficeStateHandlers();
  }
  if (disposeValueStateHandlers) {
    disposeValueStateHandlers();
  }
  if (disposeChatStreamHandlers) {
    disposeChatStreamHandlers();
  }
  startChatStreamFromMain = null;

  if (disposeModeHandlers) {
    disposeModeHandlers();
  }
  if (disposeLive2DModelsHandlers) {
    disposeLive2DModelsHandlers();
  }
  if (disposeAppUpdaterHandlers) {
    disposeAppUpdaterHandlers();
  }
  if (disposeNanobotRuntimeHandlers) {
    disposeNanobotRuntimeHandlers();
  }
  if (disposeNanobotSkillsHandlers) {
    disposeNanobotSkillsHandlers();
  }
  if (disposeScreenshotCaptureHandlers) {
    disposeScreenshotCaptureHandlers();
  }
  if (disposeVoiceModelsHandlers) {
    disposeVoiceModelsHandlers();
  }
  if (disposeVoiceSessionHandlers) {
    disposeVoiceSessionHandlers();
  }
  if (disposeOfficeStateSubscription) {
    disposeOfficeStateSubscription();
    disposeOfficeStateSubscription = null;
  }
  if (disposeValueStateSubscription) {
    disposeValueStateSubscription();
    disposeValueStateSubscription = null;
  }
  if (officePresenceProducer) {
    officePresenceProducer.dispose();
    officePresenceProducer = null;
  }
  if (valueStateStore) {
    valueStateStore = null;
  }
  if (valueProposalService) {
    valueProposalService = null;
  }
  if (chatBackendManager) {
    void chatBackendManager.dispose();
    chatBackendManager = null;
  }
  if (appUpdaterService) {
    appUpdaterService.dispose();
    appUpdaterService = null;
  }
  pythonRuntimeManager = null;
  pythonEnvManager = null;
  voiceModelLibrary = null;
  nanobotRuntimeManager = null;
  nanobotSkillsLibrary = null;
  screenshotCaptureService = null;
  screenshotSelectionService = null;

  ipcMain.removeHandler('window:get-platform');
  ipcMain.removeHandler('window:control');
  ipcMain.removeHandler('window:get-cursor-context');
  ipcMain.removeHandler('office-state:get');
  ipcMain.removeHandler('office-state:upsert');
  ipcMain.removeHandler('office-state:update');
  ipcMain.removeHandler('office-state:presence');
  ipcMain.removeHandler('office-state:heartbeat');
  ipcMain.removeHandler('office-state:remove');
  ipcMain.removeHandler('office-state:set-active');
  ipcMain.removeHandler('value-state:get');
  ipcMain.removeHandler('value-state:upsert');
  ipcMain.removeHandler('value-state:propose');
  ipcMain.removeHandler('value-state:update');
  ipcMain.removeHandler('value-state:apply-interaction');
  try {
    protocol.unhandle(MODEL_PROTOCOL);
  } catch {
    // noop
  }

  trayManager?.destroy();
  globalShortcut.unregisterAll();
});

app.on('before-quit-for-update', () => {
  prepareQuitForUpdate();
});
