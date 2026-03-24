const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { runAcpHttpStream } = require('../services/chat/acp/acpHttpClient');

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function withHttpServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}`;

  try {
    await run({ endpoint });
  } finally {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}

test('acp http client streams ndjson text-delta and done events', async () => {
  await withHttpServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/acp') {
      await readRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ type: 'text-delta', payload: { content: 'hello' } })}\n`);
      res.end(`${JSON.stringify({ type: 'done', payload: { finishReason: 'completed' } })}\n`);
      return;
    }

    res.writeHead(404);
    res.end('not found');
  }, async ({ endpoint }) => {
    const events = [];
    await runAcpHttpStream({
      backend: 'codex',
      settings: {
        runner: {
          transport: 'http',
          endpoint: `${endpoint}/acp`,
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
    assert.equal(events[0].payload.content, 'hello');
  });
});

test('acp http client sends permission response to permission endpoint', async () => {
  const permissionResponses = [];

  await withHttpServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/acp') {
      await readRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({
        type: 'permission-request',
        payload: {
          requestId: 'perm-1',
          permission: 'exec',
          toolName: 'exec',
        },
      })}\n`);
      res.end(`${JSON.stringify({ type: 'done', payload: { finishReason: 'completed' } })}\n`);
      return;
    }

    if (req.method === 'POST' && req.url === '/permission') {
      const raw = await readRequestBody(req);
      permissionResponses.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end('not found');
  }, async ({ endpoint }) => {
    await runAcpHttpStream({
      backend: 'codex',
      settings: {
        runner: {
          transport: 'http',
          endpoint: `${endpoint}/acp`,
          permissionEndpoint: `${endpoint}/permission`,
        },
        timeoutMs: 2000,
        permissionMode: 'deny',
      },
      sessionId: 's1',
      content: 'hello',
      onEvent: () => {},
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(permissionResponses.length, 1);
    assert.equal(permissionResponses[0].type, 'permission-response');
    assert.equal(permissionResponses[0].requestId, 'perm-1');
    assert.equal(permissionResponses[0].decision, 'deny');
  });
});

test('acp http client uses ask resolver decision when provided', async () => {
  const permissionResponses = [];

  await withHttpServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/acp') {
      await readRequestBody(req);
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({
        type: 'permission-request',
        payload: {
          requestId: 'perm-allow',
          permission: 'exec',
          toolName: 'exec',
        },
      })}\n`);
      res.end(`${JSON.stringify({ type: 'done', payload: { finishReason: 'completed' } })}\n`);
      return;
    }

    if (req.method === 'POST' && req.url === '/permission') {
      const raw = await readRequestBody(req);
      permissionResponses.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end('not found');
  }, async ({ endpoint }) => {
    await runAcpHttpStream({
      backend: 'codex',
      settings: {
        runner: {
          transport: 'http',
          endpoint: `${endpoint}/acp`,
          permissionEndpoint: `${endpoint}/permission`,
        },
        timeoutMs: 2000,
        permissionMode: 'ask',
        askTimeoutMs: 3000,
      },
      sessionId: 's1',
      content: 'hello',
      onEvent: () => {},
      resolvePermissionRequest: async () => ({
        decision: 'allow',
        reason: 'user_allow',
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(permissionResponses.length, 1);
    assert.equal(permissionResponses[0].decision, 'allow');
    assert.equal(permissionResponses[0].reason, 'user_allow');
  });
});
