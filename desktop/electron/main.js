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
const { DownloadInstallTaskManager } = require('./services/download/downloadInstallTaskManager');
const { registerVoiceSessionIpc } = require('./ipc/voiceSession');
const { createConversationRuntime } = require('./services/chat/conversationRuntime');
const { createChatBackendManager } = require('./services/chat/backendManager');
const { NanobotBackendAdapter } = require('./services/chat/backends/nanobotBackend');
const { ClaudeCodeBackendAdapter } = require('./services/chat/backends/claudeCodeBackend');
const { CodexBackendAdapter } = require('./services/chat/backends/codexBackend');
const { NanobotRuntimeManager } = require('./services/chat/nanobot/nanobotRuntimeManager');
const { NanobotSkillsLibrary } = require('./services/chat/nanobot/nanobotSkillsLibrary');
const { Live2DModelLibrary, MODEL_PROTOCOL } = require('./services/live2dModelLibrary');
const { createOfficePresenceProducer } = require('./services/officePresenceProducer');
const { PythonEnvManager } = require('./services/python/pythonEnvManager');
const { PythonRuntimeManager } = require('./services/python/pythonRuntimeManager');
const { createOfficeStateStore } = require('./services/officeStateStore');
const { createFastPersonaService } = require('./services/persona/fastPersonaService');
const { createQuickPersonaBackendManager } = require('./services/persona/quickPersonaBackendManager');
const { createPersonaResponseRewriter } = require('./services/persona/personaResponseRewriter');
const { createShortTermMemoryStore } = require('./services/persona/shortTermMemoryStore');
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
let shortTermMemoryStore = null;
let fastPersonaService = null;
let quickPersonaBackendManager = null;
let personaResponseRewriter = null;
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
let downloadInstallTaskManager = null;
let nanobotRuntimeManager = null;
let nanobotSkillsLibrary = null;
let isQuitting = false;
let chatBackendManager = null;
let appUpdaterService = null;
let disposeOfficeStateSubscription = null;
let disposeValueStateSubscription = null;
const personaTurnStateByStreamId = new Map();
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

  if (normalized === 'claude code' || normalized === 'claudecode' || normalized === 'claude_code') {
    return 'claude-code';
  }

  if (normalized === 'openclaw') {
    return 'nanobot';
  }

  return normalized;
}

function resolveOfficeAreaForBusinessState(businessState = '') {
  const normalized = normalizeMainText(businessState).toLowerCase();
  if (!normalized) {
    return 'lounge';
  }

  if (normalized === 'syncing') {
    return 'syncDock';
  }
  if (normalized === 'error') {
    return 'bugNook';
  }
  if (
    normalized === 'writing'
    || normalized === 'researching'
    || normalized === 'executing'
    || normalized === 'thinking'
    || normalized === 'streaming'
    || normalized === 'gaming'
    || normalized === 'singing'
  ) {
    return 'desk';
  }

  return 'lounge';
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
  const normalizedPayloadState = normalizeMainText(
    payload.businessState || payload.state || payload.activity || payload.status,
  ).toLowerCase();
  const inferredFactState = normalizedPayloadState
    || (eventType === 'error'
      ? 'error'
      : eventType === 'stream-start' || eventType === 'text-delta'
        ? 'writing'
        : '');
  const detail = normalizeMainText(payload.detail || payload.message || payload.text || payload.content);

  if (!agentId) {
    return null;
  }

  if (!['stream-start', 'agent-state', 'done', 'error', 'text-delta'].includes(eventType)) {
    return null;
  }

  if (eventType === 'done' || eventType === 'error') {
    return {
      channel: 'office',
      type: 'execution-fact',
      payload: {
        activeAgentId: agentId,
        agentId,
        backend,
        routeKey,
        sessionId,
        sessionNamespace,
        profileId,
        turnId,
        clearFact: true,
        terminalType: eventType,
        updatedAt: event.timestamp || new Date().toISOString(),
      },
    };
  }

  if (!inferredFactState) {
    return null;
  }

  return {
    channel: 'office',
    type: 'execution-fact',
    payload: {
      activeAgentId: agentId,
      agentId,
      backend,
      routeKey,
      sessionId,
      sessionNamespace,
      profileId,
      turnId,
      fact: {
        businessState: inferredFactState,
        areaId: resolveOfficeAreaForBusinessState(inferredFactState),
        detail,
        source: 'backend',
        turnId,
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
    backend: normalizeMainBackendName(event.backend || payload.backend),
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

function extractNumericStatValue(stat = null, fallback = 0) {
  if (Number.isFinite(stat)) {
    return Number(stat);
  }

  if (stat && typeof stat === 'object') {
    if (Number.isFinite(stat.value)) {
      return Number(stat.value);
    }
    if (Number.isFinite(stat.current)) {
      return Number(stat.current);
    }
  }

  return fallback;
}

function derivePersonaMood(valueState = {}) {
  const moodValue = extractNumericStatValue(valueState?.stats?.mood, 0);
  let label = 'neutral';
  if (moodValue >= 10) {
    label = 'excited';
  } else if (moodValue >= 4) {
    label = 'warm';
  } else if (moodValue <= -10) {
    label = 'upset';
  } else if (moodValue <= -4) {
    label = 'low';
  }

  return {
    label,
    score: moodValue,
    note: '',
  };
}

function resolvePersonaAffinity(valueState = {}) {
  return extractNumericStatValue(valueState?.stats?.affinity, 0);
}

function buildPersonaMemorySummary(memorySnapshot = {}) {
  const summaryText = normalizeMainText(memorySnapshot?.summary?.text);
  if (summaryText) {
    return summaryText;
  }

  const highlights = Array.isArray(memorySnapshot?.summary?.highlights)
    ? memorySnapshot.summary.highlights.map((item) => normalizeMainText(item)).filter(Boolean)
    : [];
  return normalizeMainText(highlights.slice(0, 3).join('；'));
}

function buildPersonaEscalationContent({
  userContent = '',
  routeContext = {},
  valueState = {},
  memorySnapshot = {},
  personaResult = {},
} = {}) {
  const mood = derivePersonaMood(valueState);
  const affinity = resolvePersonaAffinity(valueState);
  const summaryText = buildPersonaMemorySummary(memorySnapshot);
  const recentTurns = Array.isArray(memorySnapshot?.turns)
    ? memorySnapshot.turns.slice(-4).map((turn) => ({
      role: normalizeMainText(turn?.role || 'user'),
      content: normalizeMainText(turn?.content),
    })).filter((turn) => turn.content)
    : [];

  return [
    '[Desktop companion persona overlay]',
    `Agent: ${normalizeMainText(routeContext.agentId || 'main')}`,
    `Backend: ${normalizeMainText(routeContext.backend || 'nanobot')}`,
    `Mood: ${mood.label} (${mood.score})`,
    `Affinity: ${affinity}`,
    summaryText ? `Short-term memory: ${summaryText}` : 'Short-term memory: (empty)',
    recentTurns.length
      ? `Recent turns: ${JSON.stringify(recentTurns)}`
      : 'Recent turns: []',
    normalizeMainText(personaResult?.reply)
      ? `Fast persona prelude: ${normalizeMainText(personaResult.reply)}`
      : 'Fast persona prelude: (none)',
    'When tools or deeper reasoning are needed, use them.',
    'Keep the final answer warm, concise, in-character, and do not expose internal tool traces.',
    '',
    'User request:',
    userContent,
  ].join('\n');
}

function buildOfficeSystemUpdate(event = {}) {
  if (!event || typeof event !== 'object' || event.channel !== 'system') {
    return null;
  }

  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const type = normalizeMainText(event.type).toLowerCase();
  const agentId = normalizeMainAgentId(event.agentId || payload.agentId);
  if (!agentId) {
    return null;
  }

  if (type === 'persona-plan') {
    return {
      channel: 'office',
      type: 'upsert',
      payload: {
        agent: {
          id: agentId,
          agentId,
          backend: normalizeMainBackendName(event.backend || payload.backend),
          routeKey: normalizeMainText(event.routeKey || payload.routeKey),
          sessionId: normalizeMainText(event.sessionId || payload.sessionId),
          sessionNamespace: normalizeMainText(event.sessionNamespace || payload.sessionNamespace),
          profileId: normalizeMainText(event.profileId || payload.profileId),
          turnId: normalizeMainText(event.turnId || payload.turnId),
          businessState: payload.needsEscalation ? 'researching' : 'writing',
          detail: normalizeMainText(payload.reply || payload.reason || 'persona planning'),
          updatedAt: event.timestamp || new Date().toISOString(),
        },
      },
    };
  }

  if (type === 'persona-memory-updated') {
    return {
      channel: 'office',
      type: 'upsert',
      payload: {
        agent: {
          id: agentId,
          agentId,
          backend: normalizeMainBackendName(event.backend || payload.backend),
          routeKey: normalizeMainText(event.routeKey || payload.routeKey),
          sessionId: normalizeMainText(event.sessionId || payload.sessionId),
          sessionNamespace: normalizeMainText(event.sessionNamespace || payload.sessionNamespace),
          profileId: normalizeMainText(event.profileId || payload.profileId),
          turnId: normalizeMainText(event.turnId || payload.turnId),
          detail: normalizeMainText(payload.summaryText || payload.summary || ''),
          updatedAt: event.timestamp || new Date().toISOString(),
        },
      },
    };
  }

  return null;
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
  downloadInstallTaskManager = new DownloadInstallTaskManager(app);
  await downloadInstallTaskManager.init();
  downloadInstallTaskManager.on('download-task:progress', (payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send('download-task:progress', payload);
  });
  officeStateStore = createOfficeStateStore();
  shortTermMemoryStore = createShortTermMemoryStore({
    baseDir: path.join(app.getPath('userData'), 'persona'),
  });
  personaResponseRewriter = createPersonaResponseRewriter();
  fastPersonaService = createFastPersonaService({
    memoryStore: shortTermMemoryStore,
    responseRewriter: personaResponseRewriter,
  });
  quickPersonaBackendManager = createQuickPersonaBackendManager();
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
      new ClaudeCodeBackendAdapter(),
      new CodexBackendAdapter(),
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
    emitTaskProgress: (payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send('download-task:progress', payload);
    },
    taskManager: downloadInstallTaskManager,
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
  const emitValueProposalUpdate = (emitEvent, proposal, result) => {
    if (!result?.ok || !result?.changed || typeof emitEvent !== 'function') {
      return;
    }

    emitEvent({
      channel: 'system',
      type: 'stat-updated',
      timestamp: new Date().toISOString(),
      agentId: proposal.agentId,
      backend: proposal.backend,
      routeKey: proposal.routeKey,
      sessionId: proposal.sessionId,
      sessionNamespace: proposal.sessionNamespace,
      profileId: proposal.profileId,
      turnId: proposal.turnId,
      payload: {
        agentId: proposal.agentId,
        backend: proposal.backend,
        routeKey: proposal.routeKey,
        sessionId: proposal.sessionId,
        sessionNamespace: proposal.sessionNamespace,
        profileId: proposal.profileId,
        turnId: proposal.turnId,
        stats: result?.state?.stats || {},
        statUpdates: proposal.statUpdates || [],
      },
    });
  };
  const emitPersonaMemoryUpdate = (emitEvent, routeContext, personaResult, memorySnapshot) => {
    if (typeof emitEvent !== 'function' || !routeContext) {
      return;
    }

    emitEvent({
      channel: 'system',
      type: 'persona-memory-updated',
      timestamp: new Date().toISOString(),
      agentId: routeContext.agentId,
      backend: routeContext.backend,
      routeKey: routeContext.routeKey,
      sessionId: routeContext.sessionId,
      sessionNamespace: routeContext.sessionNamespace,
      profileId: routeContext.profileId,
      turnId: routeContext.turnId || '',
      payload: {
        agentId: routeContext.agentId,
        backend: routeContext.backend,
        routeKey: routeContext.routeKey,
        sessionId: routeContext.sessionId,
        sessionNamespace: routeContext.sessionNamespace,
        profileId: routeContext.profileId,
        summaryText: buildPersonaMemorySummary(memorySnapshot),
        summary: memorySnapshot?.summary || {},
        state: memorySnapshot?.state || {},
        directModelUsed: Boolean(personaResult?.directModelUsed),
      },
    });
  };
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
    prepareTurn: async ({ request = {}, routeContext = {}, policy, emitEvent }) => {
      const settings = settingsStore.getForMain();
      const valueState = valueStateStore?.getState?.({
        agentId: routeContext.agentId || 'main',
        characterId: routeContext.agentId || 'main',
      }) || {};
      const quickPersonaResolution = quickPersonaBackendManager?.resolveConfig?.(settings) || {
        ok: false,
        disabled: false,
        reason: 'fast_persona_unavailable',
      };
      const directModelRunner = quickPersonaResolution.ok
        ? quickPersonaBackendManager.createRunner({
            settings,
          })
        : null;
      const rawPersonaResult = await fastPersonaService.evaluateTurn({
        agentId: routeContext.agentId,
        backend: routeContext.backend,
        routeKey: routeContext.routeKey,
        sessionId: routeContext.sessionId,
        userInput: request.content,
        mood: derivePersonaMood(valueState),
        affinity: resolvePersonaAffinity(valueState),
        channel: 'chat',
        directModelRunner,
        metadata: {
          policy,
          source: request?.options?.source || '',
        },
      });
      const shouldForceBackendEscalation = Boolean(
        !rawPersonaResult.directModelUsed
        && quickPersonaResolution.disabled !== true,
      );
      const personaResult = shouldForceBackendEscalation
        ? {
            ...rawPersonaResult,
            needsEscalation: true,
            reason: 'fast_persona_direct_unavailable',
            forcedBackendEscalation: true,
          }
        : rawPersonaResult;
      const personaPayload = {
        agentId: routeContext.agentId,
        backend: routeContext.backend,
        routeKey: routeContext.routeKey,
        sessionId: routeContext.sessionId,
        sessionNamespace: routeContext.sessionNamespace,
        profileId: routeContext.profileId,
        reply: personaResult.reply,
        needsEscalation: personaResult.needsEscalation,
        reason: personaResult.reason,
        confidence: personaResult.confidence,
        directModelUsed: personaResult.directModelUsed,
        directModelConfigMode: quickPersonaResolution?.config?.configMode || '',
        directModelInheritedFrom: quickPersonaResolution?.config?.inheritedFrom || '',
        forcedBackendEscalation: Boolean(personaResult.forcedBackendEscalation),
        statUpdates: personaResult.statUpdates,
      };
      emitEvent({
        channel: 'system',
        type: 'persona-plan',
        timestamp: new Date().toISOString(),
        agentId: routeContext.agentId,
        backend: routeContext.backend,
        routeKey: routeContext.routeKey,
        sessionId: routeContext.sessionId,
        sessionNamespace: routeContext.sessionNamespace,
        profileId: routeContext.profileId,
        payload: personaPayload,
      });

      if (personaResult.statUpdates.length > 0) {
        const proposal = {
          agentId: routeContext.agentId,
          backend: routeContext.backend,
          characterId: routeContext.agentId || 'main',
          routeKey: routeContext.routeKey,
          sessionId: routeContext.sessionId,
          sessionNamespace: routeContext.sessionNamespace,
          profileId: routeContext.profileId,
          turnId: routeContext.turnId || '',
          source: 'fast-persona',
          statUpdates: personaResult.statUpdates,
        };
        const valueResult = await Promise.resolve(valueProposalService?.applyProposal?.(proposal));
        emitValueProposalUpdate(emitEvent, proposal, valueResult);
      }

      emitPersonaMemoryUpdate(emitEvent, routeContext, personaResult, personaResult.memorySnapshot);

      const fastIntentBusinessState = personaResult.needsEscalation ? 'researching' : 'writing';
      const fastIntentDetail = normalizeMainText(personaResult.reply || '');
      emitEvent({
        channel: 'office',
        type: 'scene-intent',
        timestamp: new Date().toISOString(),
        agentId: routeContext.agentId,
        backend: routeContext.backend,
        routeKey: routeContext.routeKey,
        sessionId: routeContext.sessionId,
        sessionNamespace: routeContext.sessionNamespace,
        profileId: routeContext.profileId,
        turnId: routeContext.turnId || '',
        payload: {
          activeAgentId: routeContext.agentId,
          agentId: routeContext.agentId,
          source: 'fast',
          turnId: routeContext.turnId || '',
          intent: {
            businessState: fastIntentBusinessState,
            areaId: resolveOfficeAreaForBusinessState(fastIntentBusinessState),
            detail: fastIntentDetail,
            ttlMs: personaResult.needsEscalation ? 6000 : 4000,
            source: 'fast',
          },
        },
      });

      if (!personaResult.needsEscalation) {
        return {
          needsBackend: false,
          reply: personaResult.reply,
          personaResult,
          originalUserContent: request.content,
        };
      }

      return {
        needsBackend: true,
        request: {
          ...request,
          content: buildPersonaEscalationContent({
            userContent: request.content,
            routeContext,
            valueState,
            memorySnapshot: personaResult.memorySnapshot,
            personaResult,
          }),
          options: {
            ...(request.options && typeof request.options === 'object' ? request.options : {}),
            personaPrelude: personaResult.reply,
            personaEscalationReason: personaResult.reason,
          },
        },
        personaResult,
        originalUserContent: request.content,
      };
    },
    onTurnStarted: async ({ streamId, routeContext, prepareResult, synthetic }) => {
      personaTurnStateByStreamId.set(streamId, {
        routeContext,
        prepareResult,
        synthetic: Boolean(synthetic),
        text: '',
      });
    },
    onTurnEvent: async ({ streamId, type, payload }) => {
      if (type !== 'text-delta' || !payload?.content) {
        return;
      }

      const current = personaTurnStateByStreamId.get(streamId);
      if (!current) {
        return;
      }

      current.text += payload.content;
      personaTurnStateByStreamId.set(streamId, current);
    },
    onTurnSettled: async ({ streamId, type }) => {
      const current = personaTurnStateByStreamId.get(streamId);
      if (!current) {
        return;
      }

      personaTurnStateByStreamId.delete(streamId);
      if (current.synthetic || !current.prepareResult?.personaResult?.needsEscalation) {
        return;
      }

      if (type !== 'done') {
        await shortTermMemoryStore?.patch?.(current.routeContext, {
          metadata: {
            lastEscalationStatus: type,
            lastEscalationReason: current.prepareResult.personaResult.reason || '',
          },
        });
        return;
      }

      const backendReply = normalizeMainText(current.text);
      if (!backendReply) {
        return;
      }

      const rewritten = personaResponseRewriter?.rewrite?.(backendReply, {
        maxChars: 1200,
      }) || { reply: backendReply };
      const memoryCommit = await shortTermMemoryStore?.patch?.(current.routeContext, {
        appendTurns: [
          {
            role: 'assistant',
            content: rewritten.reply || backendReply,
            metadata: {
              channel: 'chat',
              turnKind: 'assistant-backend',
              source: 'backend',
            },
          },
        ],
        metadata: {
          lastEscalationStatus: 'done',
          lastEscalationReason: current.prepareResult.personaResult.reason || '',
        },
        compact: true,
      });
      if (memoryCommit?.snapshot) {
        emitPersonaMemoryUpdate(
          (event) => {
            const officeEvent = buildOfficeSystemUpdate(event);
            if (officeEvent) {
              officeStateStore?.applyConversationEvent?.(officeEvent);
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('conversation:event', event);
            }
          },
          current.routeContext,
          current.prepareResult.personaResult,
          memoryCommit.snapshot,
        );
      }
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
          try {
            void Promise.resolve(valueProposalService?.applyProposal?.(valueProposal))
              .then((result) => {
                if (!result?.ok || !result?.changed || !mainWindow || mainWindow.isDestroyed()) {
                  return;
                }

                emitValueProposalUpdate(
                  (event) => {
                    mainWindow.webContents.send('conversation:event', event);
                  },
                  valueProposal,
                  result,
                );
              })
              .catch((error) => {
                console.warn('Failed to apply value proposal from chat event:', error);
              });
          } catch (error) {
            console.warn('Failed to apply value proposal from chat event:', error);
          }
        }
      } else if (conversationEvent.channel === 'office') {
        officePresenceProducer?.applyConversationEvent?.(conversationEvent);
      } else if (conversationEvent.channel === 'system') {
        const officeEvent = buildOfficeSystemUpdate(conversationEvent);
        if (officeEvent) {
          officeStateStore?.applyConversationEvent?.(officeEvent);
        }
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
      const moodValue = Number.isFinite(state?.stats?.mood?.value) ? state.stats.mood.value : null;
      const affinityValue = Number.isFinite(state?.stats?.affinity?.value) ? state.stats.affinity.value : null;
      if (state?.agentId) {
        officeStateStore?.upsertAgents?.({
          agent: {
            id: state.agentId,
            agentId: state.agentId,
            routeKey: state.routeKey || mutation?.event?.routeKey || '',
            sessionId: state.sessionId || mutation?.event?.sessionId || '',
            turnId: state.turnId || mutation?.event?.turnId || '',
            mood: moodValue,
            affinity: affinityValue,
            stats: state.stats || {},
            valueState: state || {},
          },
        });
      }
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
  if (shortTermMemoryStore) {
    shortTermMemoryStore = null;
  }
  if (fastPersonaService) {
    fastPersonaService = null;
  }
  if (personaResponseRewriter) {
    personaResponseRewriter = null;
  }
  personaTurnStateByStreamId.clear();
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
