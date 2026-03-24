const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const DEV_SERVER_URL = process.env.ELECTRON_DEV_SERVER_URL || 'http://127.0.0.1:3000';
const SERVER_WAIT_TIMEOUT_MS = Number(process.env.DEV_SERVER_WAIT_TIMEOUT_MS || 30_000);
const SERVER_RETRY_MS = Number(process.env.DEV_SERVER_WAIT_RETRY_MS || 300);
const OUTPUT_DIR = process.env.PLAYWRIGHT_SMOKE_OUTPUT_DIR || '/tmp/openclaw-playwright';

function canConnect(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.setTimeout(1_000, () => {
      request.destroy(new Error('timeout'));
    });

    request.on('error', () => {
      resolve(false);
    });
  });
}

async function waitForServer(url, timeoutMs) {
  const startAt = Date.now();
  while (Date.now() - startAt < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await canConnect(url);
    if (ok) {
      return true;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, SERVER_RETRY_MS));
  }
  return false;
}

async function ensureRendererServer(cwd) {
  const alreadyReady = await canConnect(DEV_SERVER_URL);
  if (alreadyReady) {
    return {
      startedByScript: false,
      process: null,
    };
  }

  const child = spawn('pnpm', ['run', 'frontend:dev'], {
    cwd,
    stdio: 'pipe',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
    },
  });

  child.stdout.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) {
      console.log(`[renderer] ${text}`);
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) {
      console.error(`[renderer] ${text}`);
    }
  });

  const ready = await waitForServer(DEV_SERVER_URL, SERVER_WAIT_TIMEOUT_MS);
  if (!ready) {
    child.kill('SIGTERM');
    throw new Error(`Renderer dev server did not become ready: ${DEV_SERVER_URL}`);
  }

  return {
    startedByScript: true,
    process: child,
  };
}

async function run() {
  const cwd = path.resolve(__dirname, '..', '..', '..');
  const rendererServer = await ensureRendererServer(cwd);

  let electronApp = null;

  try {
    const { _electron: electronLauncher } = await import('playwright');

    electronApp = await electronLauncher.launch({
      args: ['.'],
      cwd,
      env: {
        ...process.env,
        ELECTRON_DEV_SERVER_URL: DEV_SERVER_URL,
      },
    });

    const appWindow = await electronApp.firstWindow();
    await appWindow.waitForLoadState('domcontentloaded');

    const waitForModeApiReady = async () => {
      const startAt = Date.now();
      while (Date.now() - startAt < 10_000) {
        // eslint-disable-next-line no-await-in-loop
        const ready = await appWindow.evaluate(() => {
          return Boolean(
            window.desktop?.windowMode?.setMode
            && window.desktop?.windowMode?.getMode,
          );
        });
        if (ready) {
          return true;
        }
        // eslint-disable-next-line no-await-in-loop
        await appWindow.waitForTimeout(100);
      }
      return false;
    };

    const waitForMode = async (expectedMode) => {
      const startAt = Date.now();
      while (Date.now() - startAt < 5_000) {
        // eslint-disable-next-line no-await-in-loop
        const modeResult = await appWindow.evaluate(async () => {
          return window.desktop?.windowMode?.getMode?.();
        });
        if (modeResult?.mode === expectedMode) {
          return true;
        }
        // eslint-disable-next-line no-await-in-loop
        await appWindow.waitForTimeout(100);
      }
      return false;
    };

    const waitForOpacityRecover = async () => {
      const startAt = Date.now();
      while (Date.now() - startAt < 4_000) {
        // eslint-disable-next-line no-await-in-loop
        const state = await electronApp.evaluate(async ({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0];
          return {
            opacity: win?.getOpacity?.() ?? null,
          };
        });
        if (typeof state.opacity === 'number' && state.opacity >= 0.99) {
          return state;
        }
        // eslint-disable-next-line no-await-in-loop
        await appWindow.waitForTimeout(100);
      }
      return {
        opacity: null,
      };
    };

    const modeApiReady = await waitForModeApiReady();
    if (!modeApiReady) {
      throw new Error('windowMode API is not ready in renderer.');
    }

    // QA inventory (smoke scope):
    // 1) Window mode handshake can complete when requestAnimationFrame is suspended.
    // 2) Window opacity must recover to 1 after switching modes.
    // 3) Basic window<->pet mode roundtrip remains functional.

    const initialMode = await appWindow.evaluate(async () => {
      return window.desktop?.windowMode?.getMode?.();
    });
    if (initialMode?.mode !== 'window' && initialMode?.mode !== 'pet') {
      throw new Error(`Unexpected initial mode: ${JSON.stringify(initialMode)}`);
    }
    console.log('Initial mode:', initialMode.mode);

    await appWindow.evaluate(() => {
      window.__playwrightOrigRaf = window.requestAnimationFrame;
      window.requestAnimationFrame = () => 1;
    });

    await appWindow.evaluate(async () => {
      return window.desktop?.windowMode?.setMode?.('pet');
    });

    const reachedPetMode = await waitForMode('pet');
    if (!reachedPetMode) {
      throw new Error('Failed to switch to pet mode during smoke test.');
    }

    const afterPet = await waitForOpacityRecover();
    if (typeof afterPet.opacity !== 'number' || afterPet.opacity < 0.99) {
      throw new Error(`Expected pet mode opacity to recover to 1, got ${afterPet.opacity}`);
    }

    await appWindow.evaluate(() => {
      if (typeof window.__playwrightOrigRaf === 'function') {
        window.requestAnimationFrame = window.__playwrightOrigRaf;
      }
    });

    await appWindow.evaluate(async () => {
      return window.desktop?.windowMode?.setMode?.('window');
    });

    const reachedWindowMode = await waitForMode('window');
    if (!reachedWindowMode) {
      throw new Error('Failed to switch back to window mode during smoke test.');
    }

    const afterWindow = await waitForOpacityRecover();
    if (typeof afterWindow.opacity !== 'number' || afterWindow.opacity < 0.99) {
      throw new Error(`Expected window mode opacity to stay 1, got ${afterWindow.opacity}`);
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const screenshotPath = path.join(OUTPUT_DIR, 'mode-handshake-smoke.jpg');
    await appWindow.screenshot({
      path: screenshotPath,
      type: 'jpeg',
      quality: 85,
    });

    console.log('Smoke test passed.');
    console.log(`Screenshot: ${screenshotPath}`);
  } finally {
    if (electronApp) {
      await electronApp.close().catch(() => {});
    }

    if (rendererServer.startedByScript && rendererServer.process) {
      rendererServer.process.kill('SIGTERM');
    }
  }
}

run().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
