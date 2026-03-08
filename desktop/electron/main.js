const path = require('node:path');
const { app, BrowserWindow, shell, ipcMain, protocol, screen } = require('electron');

const { registerChatStreamIpc } = require('./ipc/chatStream');
const { registerConversationIpc } = require('./ipc/conversation');
const { registerLive2DModelsIpc } = require('./ipc/live2dModels');
const { registerNanobotRuntimeIpc } = require('./ipc/nanobotRuntime');
const { registerSettingsIpc } = require('./ipc/settings');
const { registerVoiceModelsIpc } = require('./ipc/voiceModels');
const { registerVoiceSessionIpc } = require('./ipc/voiceSession');
const { createConversationRuntime } = require('./services/chat/conversationRuntime');
const { createChatBackendManager } = require('./services/chat/backendManager');
const { NanobotBackendAdapter } = require('./services/chat/backends/nanobotBackend');
const { OpenClawBackendAdapter } = require('./services/chat/backends/openclawBackend');
const { NanobotRuntimeManager } = require('./services/chat/nanobot/nanobotRuntimeManager');
const { Live2DModelLibrary, MODEL_PROTOCOL } = require('./services/live2dModelLibrary');
const { PythonEnvManager } = require('./services/python/pythonEnvManager');
const { PythonRuntimeManager } = require('./services/python/pythonRuntimeManager');
const { SettingsStore } = require('./services/settingsStore');
const { VoiceModelLibrary } = require('./services/voice/voiceModelLibrary');
const { GlobalPttManager } = require('./services/voice/globalPttManager');
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
let disposeModeHandlers = null;
let disposeLive2DModelsHandlers = null;
let disposeNanobotRuntimeHandlers = null;
let disposeVoiceModelsHandlers = null;
let disposeVoiceSessionHandlers = null;
let startChatStreamFromMain = null;
let conversationRuntime = null;
let settingsStore = null;
let windowModeManager = null;
let trayManager = null;
let live2dModelLibrary = null;
let pythonRuntimeManager = null;
let pythonEnvManager = null;
let voiceModelLibrary = null;
let nanobotRuntimeManager = null;
let globalPttManager = null;
let isQuitting = false;
let chatBackendManager = null;
const legacyConversationMirrorEnabled = (() => {
  const value = process.env.OPENCLAW_ENABLE_LEGACY_STREAM_EVENTS;
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
})();

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
  globalPttManager?.emitCurrentStatus();

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
  globalPttManager = new GlobalPttManager({
    emitCommand: (payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send('voice:ptt-command', payload);
    },
    emitStatus: (payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send('voice:ptt-status', payload);
    },
  });
  globalPttManager.updateSettings(settingsStore.getPublic());
  globalPttManager.start();
  live2dModelLibrary = new Live2DModelLibrary(app);
  await live2dModelLibrary.init();
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
  nanobotRuntimeManager = new NanobotRuntimeManager(app, {
    pythonRuntimeManager,
    pythonEnvManager,
  });
  await nanobotRuntimeManager.init();
  chatBackendManager = createChatBackendManager({
    backends: [
      new OpenClawBackendAdapter(),
      new NanobotBackendAdapter({
        resolveRuntime: () => nanobotRuntimeManager.resolveLaunchConfig(),
        emitDebugLog: (payload = {}) => {
          if (!mainWindow || mainWindow.isDestroyed()) {
            return;
          }
          mainWindow.webContents.send('nanobot-debug:log', {
            timestamp: new Date().toISOString(),
            ...payload,
          });
        },
      }),
    ],
  });
  registerModelProtocol();

  registerSettingsIpc({
    ipcMain,
    settingsStore,
    backendManager: chatBackendManager,
    onSaved: async (saved) => {
      globalPttManager?.updateSettings(saved);
    },
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
    emitDebugLog: (payload = {}) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send('nanobot-debug:log', {
        timestamp: new Date().toISOString(),
        ...payload,
      });
    },
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
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      mainWindow.webContents.send('conversation:event', payload);
    },
    emitDebugLog: (payload = {}) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send('nanobot-debug:log', {
        timestamp: new Date().toISOString(),
        ...payload,
      });
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
      if (!voiceModelLibrary) {
        return process.env;
      }
      return voiceModelLibrary.getRuntimeEnv(process.env);
    },
    ttsBackpressureTimeoutMs: process.env.VOICE_TTS_BACKPRESSURE_TIMEOUT_MS,
  });

  await createMainWindow();
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
  isQuitting = true;

  if (conversationRuntime) {
    void conversationRuntime.dispose();
    conversationRuntime = null;
  }
  if (disposeConversationHandlers) {
    disposeConversationHandlers();
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
  if (disposeNanobotRuntimeHandlers) {
    disposeNanobotRuntimeHandlers();
  }
  if (disposeVoiceModelsHandlers) {
    disposeVoiceModelsHandlers();
  }
  if (disposeVoiceSessionHandlers) {
    disposeVoiceSessionHandlers();
  }
  if (chatBackendManager) {
    void chatBackendManager.dispose();
    chatBackendManager = null;
  }
  globalPttManager?.stop();
  globalPttManager = null;
  pythonRuntimeManager = null;
  pythonEnvManager = null;
  voiceModelLibrary = null;
  nanobotRuntimeManager = null;

  ipcMain.removeHandler('window:get-platform');
  ipcMain.removeHandler('window:control');
  ipcMain.removeHandler('window:get-cursor-context');
  try {
    protocol.unhandle(MODEL_PROTOCOL);
  } catch {
    // noop
  }

  trayManager?.destroy();
});
