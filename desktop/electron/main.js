const path = require('node:path');
const { app, BrowserWindow, shell, ipcMain } = require('electron');

const { registerChatStreamIpc } = require('./ipc/chatStream');
const { registerSettingsIpc } = require('./ipc/settings');
const { SettingsStore } = require('./services/settingsStore');
const { WindowModeManager } = require('./window/windowModeManager');
const { TrayManager } = require('./window/trayManager');
const { registerModeIpc } = require('./window/modeIpc');

let mainWindow = null;
let disposeChatStreamHandlers = null;
let disposeModeHandlers = null;
let settingsStore = null;
let windowModeManager = null;
let trayManager = null;
let isQuitting = false;

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

  registerSettingsIpc({ ipcMain, settingsStore });

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

  disposeChatStreamHandlers = registerChatStreamIpc({
    ipcMain,
    getSettings: () => settingsStore.getForMain(),
    emitEvent: (payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      mainWindow.webContents.send('chat:stream:event', payload);
    },
  });

  await createMainWindow();

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

  if (disposeChatStreamHandlers) {
    disposeChatStreamHandlers();
  }

  if (disposeModeHandlers) {
    disposeModeHandlers();
  }

  trayManager?.destroy();
});
