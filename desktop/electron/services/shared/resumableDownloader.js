const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 8_000;
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'EMFILE',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'ENFILE',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveHttpModule(protocol, createError, protocolUnsupportedCode) {
  if (protocol === 'http:') {
    return http;
  }
  if (protocol === 'https:') {
    return https;
  }

  throw createError(protocolUnsupportedCode, `Unsupported protocol: ${protocol}`);
}

function createAugmentedError(createError, code, message, extras = {}) {
  const error = createError(code, message);
  Object.assign(error, extras);
  return error;
}

function isRetryableStatusCode(statusCode) {
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

function getRetryCode(error) {
  const directCode = sanitizeText(error?.retryCode || error?.causeCode || error?.syscallCode || error?.errno);
  if (directCode) {
    return directCode.toUpperCase();
  }
  const normalizedCode = sanitizeText(error?.code);
  if (normalizedCode && normalizedCode.toUpperCase() === normalizedCode) {
    return normalizedCode;
  }
  return normalizedCode.toUpperCase();
}

function isRetryableError(error, { retryableErrorCodes = [] } = {}) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  if (isRetryableStatusCode(error.statusCode)) {
    return true;
  }

  const normalizedCode = getRetryCode(error);
  if (retryableErrorCodes.includes(normalizedCode)) {
    return true;
  }

  return RETRYABLE_NETWORK_CODES.has(normalizedCode);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function throwIfAborted(signal, createError, errorCodes) {
  if (!signal?.aborted) {
    return;
  }
  throw createAugmentedError(
    createError,
    errorCodes.downloadFailed,
    'Download canceled by user.',
    { retryCode: 'ABORT_ERR', causeCode: 'ABORT_ERR' },
  );
}

function inferCompoundExtension(fileName) {
  const normalized = sanitizeText(fileName).toLowerCase();
  if (!normalized) {
    return '';
  }

  const compoundExtensions = ['.tar.gz', '.tar.bz2', '.tar.xz'];
  const matched = compoundExtensions.find((item) => normalized.endsWith(item));
  if (matched) {
    return matched;
  }

  return path.extname(normalized);
}

function buildStableDownloadPath(directoryPath, url, fallbackName = 'download.bin') {
  const normalizedDirectory = sanitizeText(directoryPath);
  if (!normalizedDirectory) {
    throw new Error('directoryPath is required');
  }

  let parsedUrl = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }

  const candidateName = sanitizeText(fallbackName) || path.basename(parsedUrl?.pathname || '') || 'download.bin';
  const extension = inferCompoundExtension(candidateName || parsedUrl?.pathname || '') || '.bin';
  const baseName = candidateName.endsWith(extension)
    ? candidateName.slice(0, candidateName.length - extension.length)
    : candidateName;
  const safeBaseName = sanitizeText(baseName)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'download';
  const hash = crypto.createHash('sha256').update(sanitizeText(url)).digest('hex').slice(0, 16);
  return path.join(normalizedDirectory, `${safeBaseName}-${hash}${extension}`);
}

function parseContentRangeStart(headerValue) {
  const normalized = sanitizeText(headerValue);
  const match = normalized.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

function parseContentRangeTotal(headerValue) {
  const normalized = sanitizeText(headerValue);
  const match = normalized.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match || match[3] === '*') {
    return 0;
  }
  const total = Number.parseInt(match[3], 10);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

async function getFileSize(filePath) {
  try {
    const stats = await fsp.stat(filePath);
    return stats.isFile() ? stats.size : 0;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

function requestWithRedirect(urlString, redirectsLeft, options) {
  const {
    createError,
    errorCodes,
    requestTimeoutMs,
    userAgent,
    headers = {},
    signal,
  } = options;

  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch {
      reject(createError(errorCodes.invalidUrl, `Invalid URL: ${urlString}`));
      return;
    }

    let client = null;
    try {
      client = resolveHttpModule(parsedUrl.protocol, createError, errorCodes.protocolUnsupported);
    } catch (error) {
      reject(error);
      return;
    }

    const request = client.get(
      parsedUrl,
      {
        headers: {
          'user-agent': userAgent,
          ...headers,
        },
        timeout: requestTimeoutMs,
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const redirectLocation = response.headers.location;
        if (redirectLocation && statusCode >= 300 && statusCode < 400) {
          response.resume();
          if (redirectsLeft <= 0) {
            reject(
              createAugmentedError(
                createError,
                errorCodes.redirectOverflow,
                `Too many redirects while downloading: ${urlString}`,
              ),
            );
            return;
          }

          const nextUrl = new URL(redirectLocation, parsedUrl).toString();
          requestWithRedirect(nextUrl, redirectsLeft - 1, options).then(resolve).catch(reject);
          return;
        }

        if (statusCode === 416) {
          response.resume();
          reject(
            createAugmentedError(
              createError,
              errorCodes.httpError,
              `Download failed (${statusCode}) for ${urlString}`,
              { statusCode },
            ),
          );
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(
            createAugmentedError(
              createError,
              errorCodes.httpError,
              `Download failed (${statusCode}) for ${urlString}`,
              { statusCode },
            ),
          );
          return;
        }

        resolve({
          response,
          finalUrl: parsedUrl.toString(),
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(
        createAugmentedError(
          createError,
          errorCodes.timeout,
          `Download timeout for ${urlString}`,
          { retryCode: 'ETIMEDOUT' },
        ),
      );
    });

    request.on('error', (error) => {
      reject(
        createAugmentedError(
          createError,
          errorCodes.downloadFailed,
          error?.message || 'Failed to download file.',
          {
            retryCode: error?.code,
            causeCode: error?.code,
          },
        ),
      );
    });

    if (signal) {
      const onAbort = () => {
        request.destroy(
          createAugmentedError(
            createError,
            errorCodes.downloadFailed,
            'Download canceled by user.',
            { retryCode: 'ABORT_ERR', causeCode: 'ABORT_ERR' },
          ),
        );
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
        request.once('close', () => signal.removeEventListener('abort', onAbort));
      }
    }
  });
}

async function finalizeDownload(partialPath, destinationPath) {
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  await fsp.rm(destinationPath, { force: true }).catch(() => {});

  try {
    await fsp.rename(partialPath, destinationPath);
  } catch (error) {
    if (error?.code !== 'EXDEV') {
      throw error;
    }
    await fsp.copyFile(partialPath, destinationPath);
    await fsp.rm(partialPath, { force: true }).catch(() => {});
  }
}

async function downloadFileWithRetry({
  url,
  destinationPath,
  onProgress,
  createError,
  errorCodes,
  userAgent,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  retryMaxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
  signal,
}) {
  const partialPath = `${destinationPath}.part`;
  const retryableErrorCodes = [
    sanitizeText(errorCodes.timeout).toUpperCase(),
    sanitizeText(errorCodes.downloadFailed).toUpperCase(),
  ].filter(Boolean);

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(signal, createError, errorCodes);
    let partialSize = 0;
    try {
      partialSize = await getFileSize(partialPath);
      const headers = partialSize > 0
        ? {
            Range: `bytes=${partialSize}-`,
          }
        : {};

      const { response } = await requestWithRedirect(url, maxRedirects, {
        createError,
        errorCodes,
        requestTimeoutMs,
        userAgent,
        headers,
        signal,
      });

      const statusCode = response.statusCode || 0;
      const contentLength = Number.parseInt(response.headers['content-length'], 10);
      const contentRange = response.headers['content-range'];

      let startingBytes = 0;
      let totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;
      let writeFlags = 'w';

      if (partialSize > 0 && statusCode === 206) {
        const rangeStart = parseContentRangeStart(contentRange);
        if (rangeStart !== partialSize) {
          response.resume();
          await fsp.rm(partialPath, { force: true }).catch(() => {});
          partialSize = 0;
          attempt -= 1;
          continue;
        }
        startingBytes = partialSize;
        totalBytes = parseContentRangeTotal(contentRange) || (contentLength > 0 ? startingBytes + contentLength : 0);
        writeFlags = 'a';
      } else if (partialSize > 0 && statusCode === 200) {
        await fsp.rm(partialPath, { force: true }).catch(() => {});
        partialSize = 0;
      }

      await fsp.mkdir(path.dirname(partialPath), { recursive: true });
      const writeStream = fs.createWriteStream(partialPath, { flags: writeFlags });

      let downloadedBytes = startingBytes;
      const startedAt = Date.now();
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (typeof onProgress === 'function') {
          const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
          const bytesPerSecond = Math.max(0, (downloadedBytes - startingBytes) / elapsedSeconds);
          const estimatedRemainingSeconds =
            totalBytes > 0 && bytesPerSecond > 0
              ? Math.max(0, (totalBytes - downloadedBytes) / bytesPerSecond)
              : null;
          onProgress({
            downloadedBytes,
            totalBytes,
            bytesPerSecond,
            estimatedRemainingSeconds,
            attempt,
            maxAttempts,
          });
        }
      });

      try {
        await pipeline(response, writeStream);
      } catch (error) {
        throw createAugmentedError(
          createError,
          errorCodes.downloadFailed,
          error?.message || 'Failed to persist download.',
          {
            retryCode: error?.code,
            causeCode: error?.code,
          },
        );
      }

      await finalizeDownload(partialPath, destinationPath);
      return {
        downloadedBytes,
        totalBytes,
        attempts: attempt,
      };
    } catch (error) {
      if (error?.statusCode === 416) {
        await fsp.rm(partialPath, { force: true }).catch(() => {});
        attempt -= 1;
        continue;
      }

      lastError = error;
      if (!isRetryableError(error, { retryableErrorCodes }) || attempt >= maxAttempts) {
        throw error;
      }

      const delayMs = Math.min(retryMaxDelayMs, retryBaseDelayMs * (2 ** (attempt - 1)));
      await sleep(delayMs);
    }
  }

  throw lastError || createError(errorCodes.downloadFailed, 'Failed to download file.');
}

module.exports = {
  buildStableDownloadPath,
  downloadFileWithRetry,
};
