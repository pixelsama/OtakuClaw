const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { WebSocketServer } = require('ws');

const {
  runAcpWebSocketStream,
  testAcpWebSocketRunner,
} = require('../services/chat/acp/acpWebSocketClient');

async function withWebSocketServer(onConnection, run) {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', onConnection);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const url = `ws://127.0.0.1:${address.port}/acp`;

  try {
    await run({ url });
  } finally {
    await new Promise((resolve) => {
      wss.close(() => resolve());
    });
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}

test('acp websocket client forwards text and done events', async () => {
  await withWebSocketServer((socket) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString('utf-8'));
      if (message.type !== 'start-turn') {
        return;
      }

      socket.send(JSON.stringify({
        type: 'text-delta',
        payload: { content: 'hello from ws' },
      }));
      socket.send(JSON.stringify({
        type: 'done',
        payload: { finishReason: 'completed' },
      }));
    });
  }, async ({ url }) => {
    const events = [];
    await runAcpWebSocketStream({
      backend: 'codex',
      settings: {
        runner: {
          transport: 'websocket',
          url,
        },
        timeoutMs: 2000,
        permissionMode: 'deny',
      },
      sessionId: 's1',
      content: 'hello',
      onEvent: (event) => events.push(event),
    });

    assert.deepEqual(
      events.map((event) => event.type),
      ['text-delta', 'done'],
    );
    assert.equal(events[0].payload.content, 'hello from ws');
  });
});

test('acp websocket client responds to permission requests', async () => {
  let receivedDecision = '';

  await withWebSocketServer((socket) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString('utf-8'));

      if (message.type === 'start-turn') {
        socket.send(JSON.stringify({
          type: 'permission-request',
          payload: {
            requestId: 'perm-1',
            permission: 'exec',
            toolName: 'exec',
          },
        }));
        return;
      }

      if (message.type === 'permission-response') {
        receivedDecision = message.decision;
        socket.send(JSON.stringify({
          type: 'done',
          payload: { finishReason: 'completed' },
        }));
      }
    });
  }, async ({ url }) => {
    await runAcpWebSocketStream({
      backend: 'codex',
      settings: {
        runner: {
          transport: 'websocket',
          url,
        },
        timeoutMs: 2000,
        permissionMode: 'deny',
      },
      sessionId: 's1',
      content: 'hello',
      onEvent: () => {},
    });

    assert.equal(receivedDecision, 'deny');
  });
});

test('acp websocket connection test succeeds after handshake', async () => {
  await withWebSocketServer(() => {}, async ({ url }) => {
    const result = await testAcpWebSocketRunner({
      backend: 'codex',
      settings: {
        runner: {
          transport: 'websocket',
          url,
        },
        timeoutMs: 2000,
      },
    });
    assert.equal(result.ok, true);
    assert.equal(typeof result.latencyMs, 'number');
  });
});
