const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { resolveExternalScriptPath } = require('../../externalScriptPath');

function createAbortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function createBridgeError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  if (typeof status === 'number') {
    error.status = status;
  }
  return error;
}

function normalizeErrorPayload(payload = {}) {
  if (payload && typeof payload === 'object' && typeof payload.code === 'string') {
    return payload;
  }

  return {
    code: 'nanobot_unreachable',
    message: typeof payload?.message === 'string' ? payload.message : 'Nanobot bridge request failed.',
  };
}

function toRequestId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeString(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim();
}

function isTruthyEnv(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return fallback;
}

function resolveDefaultPythonBin(env = process.env) {
  const configured = normalizeString(env.NANOBOT_PYTHON_BIN);
  if (configured) {
    return configured;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function resolveDefaultNanobotRepoPath(env = process.env) {
  const configured = normalizeString(env.NANOBOT_REPO_PATH);
  if (configured) {
    return configured;
  }
  return path.resolve(process.cwd(), '../nanobot');
}

function sanitizeDebugPayload(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDebugPayload(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase().includes('apikey') || key.toLowerCase() === 'apikey') {
      result[key] = item ? '[redacted]' : '';
      continue;
    }
    result[key] = sanitizeDebugPayload(item);
  }
  return result;
}

function createNanobotBridgeClient({
  spawnImpl = spawn,
  pythonBin,
  scriptPath = resolveExternalScriptPath(path.join(__dirname, 'nanobot_bridge.py')),
  env = process.env,
  resolveLaunchConfig,
  emitDebugLog,
} = {}) {
  let child = null;
  let disposed = false;
  let requestSeq = 0;
  let readyPromise = null;
  let readyState = null;
  let processPromise = null;
  let stdoutBuffer = '';
  const bridgeDebugEnabled = isTruthyEnv(env?.NANOBOT_BRIDGE_DEBUG, false);
  const pendingStreamRequests = new Map();
  const pendingTestRequests = new Map();
  const debug = (stage, message, details = undefined) => {
    if (typeof emitDebugLog !== 'function') {
      return;
    }
    emitDebugLog({
      source: 'bridge',
      stage,
      message,
      details: sanitizeDebugPayload(details),
    });
  };

  const settleAllPending = (error) => {
    for (const [, pending] of pendingStreamRequests.entries()) {
      if (pending.signal && pending.onAbort) {
        pending.signal.removeEventListener('abort', pending.onAbort);
      }
      pending.reject(error);
    }
    pendingStreamRequests.clear();

    for (const [, pending] of pendingTestRequests.entries()) {
      if (pending.signal && pending.onAbort) {
        pending.signal.removeEventListener('abort', pending.onAbort);
      }
      pending.reject(error);
    }
    pendingTestRequests.clear();
  };

  const handleJsonLine = (line) => {
    let message = null;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'ready') {
      debug('bridge-ready', 'Nanobot bridge reported ready.');
      return;
    }

    const requestId = toRequestId(message.requestId);
    if (!requestId) {
      return;
    }

    if (message.type === 'event') {
      debug('bridge-event', 'Bridge emitted stream event.', {
        requestId,
        eventType: message.event?.type || '',
        payload: message.event?.payload || null,
      });
      const pending = pendingStreamRequests.get(requestId);
      if (!pending) {
        return;
      }

      const event = message.event && typeof message.event === 'object' ? message.event : null;
      if (!event || typeof event.type !== 'string') {
        return;
      }

      if (typeof pending.onEvent === 'function') {
        pending.onEvent(event);
      }

      if (event.type === 'done') {
        if (pending.signal && pending.onAbort) {
          pending.signal.removeEventListener('abort', pending.onAbort);
        }
        pendingStreamRequests.delete(requestId);
        pending.resolve({
          ok: true,
          payload: event.payload || {},
        });
        return;
      }

      if (event.type === 'error') {
        if (pending.signal && pending.onAbort) {
          pending.signal.removeEventListener('abort', pending.onAbort);
        }
        pendingStreamRequests.delete(requestId);
        const payload = normalizeErrorPayload(event.payload);
        pending.reject(createBridgeError(payload.code, payload.message, payload.status));
      }
      return;
    }

    if (message.type === 'test-result') {
      debug('bridge-test-result', 'Bridge returned test result.', {
        requestId,
        ok: Boolean(message.ok),
        latencyMs: Number.isFinite(message.latencyMs) ? Math.floor(message.latencyMs) : undefined,
        error: message.error || null,
      });
      const pending = pendingTestRequests.get(requestId);
      if (!pending) {
        return;
      }

      if (pending.signal && pending.onAbort) {
        pending.signal.removeEventListener('abort', pending.onAbort);
      }
      pendingTestRequests.delete(requestId);

      if (message.ok) {
        pending.resolve({
          ok: true,
          latencyMs: Number.isFinite(message.latencyMs) ? Math.floor(message.latencyMs) : undefined,
        });
      } else {
        const payload = normalizeErrorPayload(message.error);
        pending.reject(createBridgeError(payload.code, payload.message, payload.status));
      }
    }
  };

  const pushStdout = (chunk) => {
    stdoutBuffer += chunk.toString('utf-8');

    while (true) {
      const newlineIndex = stdoutBuffer.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }

      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      handleJsonLine(line);
    }
  };

  const sendMessage = (payload) => {
    if (!child || child.killed || !child.stdin || child.stdin.destroyed) {
      throw createBridgeError('nanobot_unreachable', 'Nanobot bridge is unavailable.');
    }

    debug('bridge-send', 'Sending message to bridge.', payload);
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  const ensureProcess = async () => {
    if (disposed) {
      throw createBridgeError('nanobot_runtime_not_ready', 'Nanobot bridge client has been disposed.');
    }

    if (child && !child.killed) {
      return child;
    }
    if (processPromise) {
      return processPromise;
    }

    processPromise = (async () => {
      let runtimeConfig = {};
      if (typeof resolveLaunchConfig === 'function') {
        runtimeConfig = (await Promise.resolve(resolveLaunchConfig())) || {};
      }

      const resolvedPythonBin =
        normalizeString(runtimeConfig.pythonBin)
        || normalizeString(pythonBin)
        || resolveDefaultPythonBin(env);
      const resolvedRepoPath =
        normalizeString(runtimeConfig.nanobotRepoPath)
        || resolveDefaultNanobotRepoPath(env);

      const launchEnv = {
        ...env,
        ...(runtimeConfig.env && typeof runtimeConfig.env === 'object' ? runtimeConfig.env : {}),
        PYTHONUNBUFFERED: '1',
        NANOBOT_REPO_PATH: resolvedRepoPath,
      };
      const resolvedScriptPath = resolveExternalScriptPath(scriptPath);
      debug('bridge-launch', 'Launching Nanobot bridge process.', {
        pythonBin: resolvedPythonBin,
        repoPath: resolvedRepoPath,
        scriptPath: resolvedScriptPath,
      });

      const scriptExists = fs.existsSync(resolvedScriptPath);
      if (!scriptExists) {
        throw createBridgeError('nanobot_runtime_not_ready', `Nanobot bridge script not found: ${resolvedScriptPath}`);
      }

      try {
        child = spawnImpl(resolvedPythonBin, [resolvedScriptPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: launchEnv,
        });
      } catch (error) {
        throw createBridgeError(
          'nanobot_boot_failed',
          `Failed to launch Nanobot bridge: ${error?.message || 'unknown error'}`,
        );
      }

      child.stdout?.on('data', pushStdout);
      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString('utf-8').trim();
        if (text) {
          debug('bridge-stderr', 'Bridge stderr.', { text });
        }
        if (!bridgeDebugEnabled) {
          return;
        }
        if (text) {
          console.warn(`[nanobot-bridge] ${text}`);
        }
      });

      const resolveReady = () => {
        if (!readyState) {
          return;
        }

        const { timeoutId, onReadyData, resolve } = readyState;
        readyState = null;
        clearTimeout(timeoutId);
        child?.stdout?.off('data', onReadyData);
        child?.stdout?.on('data', pushStdout);
        resolve();
      };

      const rejectReady = (error) => {
        if (!readyState) {
          return;
        }

        const { timeoutId, onReadyData, reject } = readyState;
        readyState = null;
        clearTimeout(timeoutId);
        child?.stdout?.off('data', onReadyData);
        reject(error);
      };

      child.on('error', (error) => {
        debug('bridge-error', 'Nanobot bridge process emitted error.', {
          message: error?.message || 'unknown error',
        });
        const bridgeError = createBridgeError(
          'nanobot_boot_failed',
          `Nanobot bridge process error: ${error?.message || 'unknown error'}`,
        );
        rejectReady(bridgeError);
        settleAllPending(bridgeError);
      });

      child.on('exit', (code, signal) => {
        debug('bridge-exit', 'Nanobot bridge process exited.', {
          code,
          signal: signal || 'none',
        });
        const reason = `Nanobot bridge exited (code=${code}, signal=${signal || 'none'}).`;
        const bridgeError = createBridgeError('nanobot_unreachable', reason);
        rejectReady(bridgeError);
        child = null;
        readyPromise = null;
        settleAllPending(bridgeError);
      });

      readyPromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          debug('bridge-timeout', 'Nanobot bridge init timeout.');
          readyState = null;
          reject(createBridgeError('nanobot_boot_failed', 'Nanobot bridge init timeout.'));
        }, 5000);

        const onReadyData = (chunk) => {
          stdoutBuffer += chunk.toString('utf-8');

          while (true) {
            const newlineIndex = stdoutBuffer.indexOf('\n');
            if (newlineIndex === -1) {
              break;
            }
            const line = stdoutBuffer.slice(0, newlineIndex).trim();
            stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
            if (!line) {
              continue;
            }

            let message = null;
            try {
              message = JSON.parse(line);
            } catch {
              continue;
            }

            if (message?.type === 'ready') {
              debug('bridge-ready', 'Nanobot bridge ready handshake completed.');
              resolveReady();
              return;
            }

            handleJsonLine(line);
          }
        };

        readyState = {
          timeoutId,
          onReadyData,
          resolve,
          reject,
        };
        child?.stdout?.off('data', pushStdout);
        child?.stdout?.on('data', onReadyData);
      });

      return child;
    })();

    try {
      return await processPromise;
    } finally {
      processPromise = null;
    }
  };

  const ensureReady = async () => {
    await ensureProcess();
    if (readyPromise) {
      await readyPromise;
    }
  };

  const nextRequestId = () => {
    requestSeq += 1;
    return `nanobot-${Date.now().toString(36)}-${requestSeq.toString(36)}`;
  };

  const start = async ({ sessionId, content, mediaPaths = [], config, signal, onEvent }) => {
    await ensureReady();

    const requestId = nextRequestId();
    debug('bridge-start', 'Creating Nanobot stream request.', {
      requestId,
      sessionId,
      content,
      mediaPaths,
      config,
    });
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        try {
          sendMessage({
            type: 'abort',
            requestId,
          });
        } catch {
          // noop
        }
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        pendingStreamRequests.delete(requestId);
        reject(createAbortError());
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      pendingStreamRequests.set(requestId, {
        resolve,
        reject,
        signal,
        onAbort,
        onEvent,
      });

      try {
        sendMessage({
          type: 'start',
          requestId,
          sessionId,
          content,
          mediaPaths: Array.isArray(mediaPaths) ? mediaPaths : [],
          config,
        });
      } catch (error) {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        pendingStreamRequests.delete(requestId);
        reject(error);
      }
    });
  };

  const testConnection = async ({ config, signal }) => {
    await ensureReady();

    const requestId = nextRequestId();
    debug('bridge-test', 'Creating Nanobot test request.', {
      requestId,
      config,
    });
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        try {
          sendMessage({
            type: 'abort',
            requestId,
          });
        } catch {
          // noop
        }
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        pendingTestRequests.delete(requestId);
        reject(createAbortError());
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      pendingTestRequests.set(requestId, {
        resolve,
        reject,
        signal,
        onAbort,
      });

      try {
        sendMessage({
          type: 'test',
          requestId,
          config,
        });
      } catch (error) {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        pendingTestRequests.delete(requestId);
        reject(error);
      }
    });
  };

  const dispose = async () => {
    if (disposed) {
      return;
    }
    disposed = true;

    const error = createBridgeError('nanobot_runtime_not_ready', 'Nanobot bridge client disposed.');
    settleAllPending(error);

    debug('bridge-dispose', 'Disposing Nanobot bridge client.');
    if (child && !child.killed) {
      child.kill();
    }
    child = null;
    readyState = null;
    readyPromise = null;
  };

  return {
    start,
    testConnection,
    dispose,
  };
}

module.exports = {
  createNanobotBridgeClient,
};
