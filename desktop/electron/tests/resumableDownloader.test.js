const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildStableDownloadPath,
  downloadFileWithRetry,
} = require('../services/shared/resumableDownloader');

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseRangeStart(headerValue) {
  const match = String(headerValue || '').match(/^bytes=(\d+)-$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/model.bin`;
  try {
    await run(url);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

test('downloadFileWithRetry resumes from partial content after connection drop', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resumable-downloader-test-'));
  const destinationPath = path.join(tmpDir, 'voice-model.bin');
  const payload = Buffer.from('resumable-download-payload', 'utf-8');
  const requests = [];

  await withServer((request, response) => {
    requests.push(request.headers.range || '');
    const rangeHeader = request.headers.range;

    if (!rangeHeader) {
      response.writeHead(200, {
        'content-length': payload.length,
        'accept-ranges': 'bytes',
      });
      response.end(payload.subarray(0, 8));
      return;
    }

    assert.equal(rangeHeader, 'bytes=8-');
    response.writeHead(206, {
      'content-length': payload.length - 8,
      'content-range': `bytes 8-${payload.length - 1}/${payload.length}`,
      'accept-ranges': 'bytes',
    });
    response.end(payload.subarray(8));
  }, async (url) => {
    const result = await downloadFileWithRetry({
      url,
      destinationPath,
      createError,
      errorCodes: {
        protocolUnsupported: 'download_protocol_unsupported',
        invalidUrl: 'download_invalid_url',
        redirectOverflow: 'download_redirect_overflow',
        httpError: 'download_http_error',
        timeout: 'download_timeout',
        downloadFailed: 'download_failed',
      },
      userAgent: 'resumable-downloader-test',
      maxAttempts: 3,
      retryBaseDelayMs: 5,
      retryMaxDelayMs: 10,
    });

    assert.equal(result.downloadedBytes, payload.length);
    assert.equal(result.attempts, requests.length);
    assert.ok(result.attempts >= 2);
  });

  assert.equal(requests[0], '');
  assert.ok(requests.length >= 2);
  for (const rangeHeader of requests.slice(1)) {
    const rangeStart = parseRangeStart(rangeHeader);
    assert.ok(Number.isFinite(rangeStart) && rangeStart > 0 && rangeStart < payload.length);
  }
  assert.deepEqual(await fs.readFile(destinationPath), payload);
  await assert.rejects(() => fs.stat(`${destinationPath}.part`), { code: 'ENOENT' });
});

test('downloadFileWithRetry keeps partial file when retries are exhausted', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resumable-downloader-test-'));
  const destinationPath = path.join(tmpDir, 'python-runtime.tar.gz');
  const payload = Buffer.from('partial-content-only', 'utf-8');
  const requests = [];

  await withServer((request, response) => {
    const rangeHeader = request.headers.range || '';
    requests.push(rangeHeader);

    let offset = 0;
    if (rangeHeader) {
      const match = rangeHeader.match(/^bytes=(\d+)-$/);
      offset = Number.parseInt(match?.[1] || '0', 10);
    }

    response.writeHead(offset > 0 ? 206 : 200, {
      'content-length': payload.length - offset,
      ...(offset > 0
        ? { 'content-range': `bytes ${offset}-${payload.length - 1}/${payload.length}` }
        : {}),
      'accept-ranges': 'bytes',
    });
    response.end(payload.subarray(offset, Math.min(offset + 4, payload.length)));
  }, async (url) => {
    await assert.rejects(
      () => downloadFileWithRetry({
        url,
        destinationPath,
        createError,
        errorCodes: {
          protocolUnsupported: 'download_protocol_unsupported',
          invalidUrl: 'download_invalid_url',
          redirectOverflow: 'download_redirect_overflow',
          httpError: 'download_http_error',
          timeout: 'download_timeout',
          downloadFailed: 'download_failed',
        },
        userAgent: 'resumable-downloader-test',
        maxAttempts: 2,
        retryBaseDelayMs: 5,
        retryMaxDelayMs: 10,
      }),
      (error) => error?.code === 'download_failed',
    );
  });

  assert.equal(requests[0], '');
  assert.equal(requests.length, 2);
  assert.ok(parseRangeStart(requests[1]) > 0);
  const partialStats = await fs.stat(`${destinationPath}.part`);
  assert.ok(partialStats.size > 0);
  assert.ok(partialStats.size < payload.length);
  await assert.rejects(() => fs.stat(destinationPath), { code: 'ENOENT' });
});

test('buildStableDownloadPath keeps stable names and archive extensions', () => {
  const firstPath = buildStableDownloadPath('/tmp/downloads', 'https://example.com/files/python.tar.gz', 'python-3.12.tar.gz');
  const secondPath = buildStableDownloadPath('/tmp/downloads', 'https://example.com/files/python.tar.gz', 'python-3.12.tar.gz');

  assert.equal(firstPath, secondPath);
  assert.match(firstPath, /python-3\.12-[a-f0-9]{16}\.tar\.gz$/);
});
