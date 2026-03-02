const http = require('node:http');

const DEV_SERVER_URL = process.env.ELECTRON_DEV_SERVER_URL || 'http://127.0.0.1:3000';
const MAX_WAIT_MS = Number(process.env.DEV_SERVER_WAIT_TIMEOUT_MS || 30000);
const RETRY_INTERVAL_MS = Number(process.env.DEV_SERVER_WAIT_RETRY_MS || 300);

function canConnect(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.setTimeout(1000, () => {
      request.destroy(new Error('timeout'));
    });

    request.on('error', () => {
      resolve(false);
    });
  });
}

async function waitForServer() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    // eslint-disable-next-line no-await-in-loop
    const ready = await canConnect(DEV_SERVER_URL);
    if (ready) {
      return true;
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }

  return false;
}

(async () => {
  const ready = await waitForServer();

  if (ready) {
    process.exit(0);
  }

  console.error(`Dev server did not become reachable in ${MAX_WAIT_MS}ms: ${DEV_SERVER_URL}`);
  process.exit(1);
})();
