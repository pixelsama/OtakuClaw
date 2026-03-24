#!/usr/bin/env node

const http = require('node:http');

function normalizeScenario(value, fallback = 'echo') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || fallback;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

const scenario = normalizeScenario(process.env.MOCK_ACP_SCENARIO, 'echo');
const host = process.env.MOCK_ACP_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.MOCK_ACP_PORT || '8877', 10);
const permissionResponses = [];

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/acp') {
    await readBody(req);
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    if (scenario === 'permission-once') {
      res.write(`${JSON.stringify({
        type: 'permission-request',
        payload: {
          requestId: 'http-perm-1',
          permission: 'exec',
          toolName: 'shell',
          reason: 'HTTP permission once',
        },
      })}\n`);
      setTimeout(() => {
        res.end(`${JSON.stringify({ type: 'done', payload: { finishReason: 'completed' } })}\n`);
      }, 600);
      return;
    }

    if (scenario === 'long') {
      let tick = 0;
      const timer = setInterval(() => {
        tick += 1;
        res.write(`${JSON.stringify({
          type: 'text-delta',
          payload: { content: `http-long-${tick}` },
        })}\n`);
        if (tick >= 20) {
          clearInterval(timer);
          res.end(`${JSON.stringify({ type: 'done', payload: { finishReason: 'completed' } })}\n`);
        }
      }, 500);
      req.on('close', () => clearInterval(timer));
      return;
    }

    res.write(`${JSON.stringify({ type: 'text-delta', payload: { content: 'http-echo-ok' } })}\n`);
    res.end(`${JSON.stringify({ type: 'done', payload: { finishReason: 'completed' } })}\n`);
    return;
  }

  if (req.method === 'POST' && req.url === '/permission') {
    const raw = await readBody(req);
    try {
      permissionResponses.push(JSON.parse(raw));
    } catch {
      permissionResponses.push({ raw });
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, scenario, permissionResponses }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
});

server.listen(port, host, () => {
  process.stdout.write(`mock-acp-http-listening ${host}:${port} scenario=${scenario}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
