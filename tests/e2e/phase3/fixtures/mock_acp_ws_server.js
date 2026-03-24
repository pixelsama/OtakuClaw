#!/usr/bin/env node

const http = require('node:http');
const { WebSocketServer } = require('ws');

function normalizeScenario(value, fallback = 'echo') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || fallback;
}

const scenario = normalizeScenario(process.env.MOCK_ACP_SCENARIO, 'echo');
const host = process.env.MOCK_ACP_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.MOCK_ACP_PORT || '8878', 10);

const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  let longTimer = null;

  socket.on('message', (raw) => {
    let payload = null;
    try {
      payload = JSON.parse(raw.toString('utf-8'));
    } catch {
      return;
    }

    const type = typeof payload.type === 'string' ? payload.type.trim() : '';
    if (!type) {
      return;
    }

    if (type === 'abort-turn') {
      if (longTimer) {
        clearInterval(longTimer);
        longTimer = null;
      }
      socket.send(JSON.stringify({
        type: 'done',
        payload: {
          finishReason: 'aborted',
          aborted: true,
        },
      }));
      return;
    }

    if (type === 'permission-response' && scenario === 'permission-once') {
      if (payload.decision === 'allow') {
        socket.send(JSON.stringify({
          type: 'text-delta',
          payload: { content: 'ws-permission-allow-ok' },
        }));
        socket.send(JSON.stringify({
          type: 'done',
          payload: { finishReason: 'completed' },
        }));
      } else {
        socket.send(JSON.stringify({
          type: 'error',
          payload: {
            code: 'permission_denied',
            message: payload.reason || 'Denied by user.',
          },
        }));
      }
      return;
    }

    if (type !== 'start-turn') {
      return;
    }

    if (scenario === 'permission-once') {
      socket.send(JSON.stringify({
        type: 'permission-request',
        payload: {
          requestId: 'ws-perm-1',
          permission: 'exec',
          toolName: 'shell',
          reason: 'WebSocket permission once',
        },
      }));
      return;
    }

    if (scenario === 'disconnect') {
      setTimeout(() => {
        socket.close(1011, 'intentional_disconnect');
      }, 250);
      return;
    }

    if (scenario === 'long') {
      let tick = 0;
      longTimer = setInterval(() => {
        tick += 1;
        socket.send(JSON.stringify({
          type: 'text-delta',
          payload: { content: `ws-long-${tick}` },
        }));
        if (tick >= 20) {
          clearInterval(longTimer);
          longTimer = null;
          socket.send(JSON.stringify({ type: 'done', payload: { finishReason: 'completed' } }));
        }
      }, 500);
      return;
    }

    socket.send(JSON.stringify({
      type: 'text-delta',
      payload: { content: 'ws-echo-ok' },
    }));
    socket.send(JSON.stringify({
      type: 'done',
      payload: { finishReason: 'completed' },
    }));
  });

  socket.on('close', () => {
    if (longTimer) {
      clearInterval(longTimer);
      longTimer = null;
    }
  });
});

server.listen(port, host, () => {
  process.stdout.write(`mock-acp-ws-listening ws://${host}:${port}/acp scenario=${scenario}\n`);
});

function shutdown() {
  wss.close(() => {
    server.close(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
