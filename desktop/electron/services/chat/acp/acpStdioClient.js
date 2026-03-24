const readline = require('node:readline');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

const {
  mapAcpEventToChatEvent,
  normalizeAcpBackendSettings,
  normalizeEventType,
  normalizePayload,
  isPermissionRequestEvent,
  extractPermissionRequest,
} = require('./acpEventMapper');

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function createAcpError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  if (typeof status === 'number') {
    error.status = status;
  }
  return error;
}

function sanitizeRunnerEnv(env = {}) {
  const source = env && typeof env === 'object' && !Array.isArray(env) ? env : {};
  const entries = Object.entries(source)
    .map(([key, value]) => [normalizeText(key), normalizeText(value)])
    .filter(([key]) => Boolean(key));
  return Object.fromEntries(entries);
}

function parseAcpJsonLine(line = '') {
  const raw = normalizeText(line);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toArgsArray(args) {
  if (Array.isArray(args)) {
    return args
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }

  if (typeof args === 'string') {
    return args
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function debugLogger(emitDebugLog, stage, message, details = undefined) {
  if (typeof emitDebugLog !== 'function') {
    return;
  }

  emitDebugLog({
    source: 'acp-stdio-client',
    stage,
    message,
    details,
  });
}

function writeJsonLine(stream, payload = {}) {
  if (!stream || typeof stream.write !== 'function') {
    return;
  }

  stream.write(`${JSON.stringify(payload)}\n`);
}

function createPermissionDecision({
  mode,
  request,
}) {
  if (mode === 'allow') {
    return {
      decision: 'allow',
      reason: 'policy_allow',
    };
  }

  return {
    decision: 'deny',
    reason: mode === 'ask' ? 'policy_ask_timeout' : 'policy_deny',
  };
}

async function runAcpStdioStream({
  backend = 'acp',
  settings = {},
  sessionId,
  content,
  options = {},
  signal,
  onEvent,
  emitDebugLog,
  spawnFn = spawn,
} = {}) {
  const normalizedSettings = normalizeAcpBackendSettings(settings);
  const runner = normalizedSettings.runner || {};
  const command = normalizeText(runner.command);
  const args = toArgsArray(runner.args);
  const timeoutMs = normalizedSettings.timeoutMs;
  const askTimeoutMs = normalizedSettings.askTimeoutMs;
  const permissionMode = normalizedSettings.permissionMode;

  if (!command) {
    throw createAcpError(
      `${backend}_runner_missing_command`,
      `${backend} backend runner command is required.`,
    );
  }

  if (runner.protocol !== 'acp') {
    throw createAcpError(
      `${backend}_runner_protocol_unsupported`,
      `${backend} backend currently supports ACP protocol only.`,
    );
  }

  if (runner.transport !== 'stdio') {
    throw createAcpError(
      `${backend}_runner_transport_unsupported`,
      `${backend} backend currently supports stdio transport only.`,
    );
  }

  await new Promise((resolve, reject) => {
    const turnId = randomUUID();
    let child;
    let settled = false;
    let terminalSeen = false;
    let aborted = false;
    let timeoutId = null;
    let askTimerByRequestId = new Map();
    let stderrLines = [];

    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = null;

      for (const timer of askTimerByRequestId.values()) {
        clearTimeout(timer);
      }
      askTimerByRequestId = new Map();

      if (stdoutRl) {
        stdoutRl.close();
      }
      if (stderrRl) {
        stderrRl.close();
      }

      resolve();
    };

    const emitEvent = (event = {}) => {
      if (typeof onEvent !== 'function' || !event || typeof event !== 'object') {
        return;
      }

      if (terminalSeen && event.type !== 'done' && event.type !== 'error') {
        return;
      }

      onEvent(event);

      if (event.type === 'done' || event.type === 'error') {
        terminalSeen = true;
      }
    };

    const sendAbort = (reason = 'aborted') => {
      if (!child || child.killed || !child.stdin || child.stdin.destroyed) {
        return;
      }

      writeJsonLine(child.stdin, {
        protocolVersion: 'acp.v1',
        type: 'abort-turn',
        turnId,
        reason,
      });
    };

    const finishWithoutTerminal = () => {
      if (terminalSeen) {
        settle();
        return;
      }

      if (aborted) {
        emitEvent({
          type: 'done',
          payload: {
            source: backend,
            aborted: true,
            finishReason: 'aborted',
          },
        });
        settle();
        return;
      }

      const stderrSummary = stderrLines.join('\n').trim();
      emitEvent({
        type: 'error',
        payload: {
          code: 'acp_stream_closed',
          message: stderrSummary || `${backend} ACP stream closed unexpectedly.`,
        },
      });
      settle();
    };

    const onPermissionRequest = (event = {}) => {
      const request = extractPermissionRequest(event);
      const requestId = normalizeText(request.requestId);
      if (!requestId) {
        return;
      }

      const sendDecision = () => {
        const decisionPayload = createPermissionDecision({
          mode: permissionMode,
          request,
        });

        debugLogger(
          emitDebugLog,
          'permission-decision',
          'Resolved ACP permission request with local policy.',
          {
            backend,
            mode: permissionMode,
            requestId,
            permission: request.permission,
            toolName: request.toolName,
            decision: decisionPayload.decision,
            reason: decisionPayload.reason,
          },
        );

        writeJsonLine(child.stdin, {
          protocolVersion: 'acp.v1',
          type: 'permission-response',
          turnId,
          requestId,
          decision: decisionPayload.decision,
          reason: decisionPayload.reason,
        });
      };

      if (permissionMode === 'ask') {
        const timer = setTimeout(() => {
          askTimerByRequestId.delete(requestId);
          sendDecision();
        }, askTimeoutMs);
        askTimerByRequestId.set(requestId, timer);
        return;
      }

      sendDecision();
    };

    let stdoutRl = null;
    let stderrRl = null;
    try {
      child = spawnFn(command, args, {
        cwd: normalizeText(runner.cwd) || undefined,
        env: {
          ...process.env,
          ...sanitizeRunnerEnv(runner.env),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(
        createAcpError(
          `${backend}_runner_spawn_failed`,
          error?.message || `Failed to spawn ACP runner for ${backend}.`,
        ),
      );
      return;
    }

    timeoutId = setTimeout(() => {
      debugLogger(emitDebugLog, 'stream-timeout', 'ACP stream timed out.', {
        backend,
        timeoutMs,
      });
      sendAbort('timeout');
      aborted = true;
      emitEvent({
        type: 'error',
        payload: {
          code: 'acp_stream_timeout',
          message: `${backend} ACP stream timed out (${timeoutMs} ms).`,
        },
      });
      terminalSeen = true;
      settle();
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    }, timeoutMs);

    if (signal?.aborted) {
      aborted = true;
      sendAbort('aborted');
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    } else if (signal?.addEventListener) {
      signal.addEventListener('abort', () => {
        if (settled) {
          return;
        }

        aborted = true;
        sendAbort('aborted');
        if (!child.killed) {
          child.kill('SIGTERM');
        }
      }, { once: true });
    }

    child.once('error', (error) => {
      if (settled) {
        return;
      }

      reject(
        createAcpError(
          error?.code === 'ENOENT' ? `${backend}_runner_not_found` : `${backend}_runner_spawn_failed`,
          error?.message || `Failed to launch ACP runner for ${backend}.`,
        ),
      );
    });

    child.once('spawn', () => {
      debugLogger(emitDebugLog, 'stream-start', 'ACP runner spawned for stream.', {
        backend,
        command,
        args,
      });

      writeJsonLine(child.stdin, {
        protocolVersion: 'acp.v1',
        type: 'start-turn',
        turnId,
        sessionId,
        backend,
        content,
        options,
      });
    });

    stdoutRl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    stderrRl = readline.createInterface({
      input: child.stderr,
      crlfDelay: Infinity,
    });

    stdoutRl.on('line', (line) => {
      if (settled) {
        return;
      }

      const parsed = parseAcpJsonLine(line);
      if (!parsed) {
        const plainText = normalizeText(line);
        if (plainText) {
          emitEvent({
            type: 'text-delta',
            payload: {
              content: plainText,
              source: backend,
            },
          });
        }
        return;
      }

      if (isPermissionRequestEvent(parsed)) {
        onPermissionRequest(parsed);
      }

      const mapped = mapAcpEventToChatEvent(parsed, { source: backend });
      if (!mapped) {
        return;
      }

      if (mapped.type === 'error' || mapped.type === 'done') {
        terminalSeen = true;
      }
      emitEvent(mapped);

      if (terminalSeen && !child.killed) {
        child.kill('SIGTERM');
      }
    });

    stderrRl.on('line', (line) => {
      const text = normalizeText(line);
      if (!text) {
        return;
      }

      stderrLines.push(text);
      if (stderrLines.length > 80) {
        stderrLines = stderrLines.slice(stderrLines.length - 80);
      }

      const parsed = parseAcpJsonLine(text);
      if (!parsed) {
        return;
      }

      const type = normalizeEventType(parsed);
      if (type !== 'error') {
        return;
      }

      const payload = normalizePayload(parsed);
      emitEvent({
        type: 'error',
        payload: {
          code: normalizeText(payload.code, 'acp_upstream_error'),
          message: normalizeText(payload.message, text),
          status: Number.isFinite(payload.status) ? payload.status : undefined,
        },
      });
    });

    child.once('exit', () => {
      finishWithoutTerminal();
    });
  });
}

async function testAcpStdioRunner({
  backend = 'acp',
  settings = {},
  signal,
  spawnFn = spawn,
} = {}) {
  const normalizedSettings = normalizeAcpBackendSettings(settings);
  const runner = normalizedSettings.runner || {};
  const command = normalizeText(runner.command);
  const args = toArgsArray(runner.args);
  const timeoutMs = Math.min(normalizedSettings.timeoutMs, 15_000);

  if (!command) {
    throw createAcpError(
      `${backend}_runner_missing_command`,
      `${backend} backend runner command is required.`,
    );
  }

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    const startAt = Date.now();

    const settleSuccess = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve({
        ok: true,
        latencyMs: Date.now() - startAt,
      });
      if (child && !child.killed) {
        child.kill('SIGTERM');
      }
    };

    const settleError = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(error);
      if (child && !child.killed) {
        child.kill('SIGTERM');
      }
    };

    let timeoutId = null;

    try {
      child = spawnFn(command, args, {
        cwd: normalizeText(runner.cwd) || undefined,
        env: {
          ...process.env,
          ...sanitizeRunnerEnv(runner.env),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      settleError(
        createAcpError(
          `${backend}_runner_spawn_failed`,
          error?.message || `Failed to spawn ACP runner for ${backend}.`,
        ),
      );
      return;
    }

    timeoutId = setTimeout(() => {
      settleError(
        createAcpError(
          'acp_test_timeout',
          `${backend} connection test timed out (${timeoutMs} ms).`,
        ),
      );
    }, timeoutMs);

    if (signal?.aborted) {
      settleError(createAcpError('aborted', 'stream aborted'));
      return;
    }
    if (signal?.addEventListener) {
      signal.addEventListener('abort', () => {
        settleError(createAcpError('aborted', 'stream aborted'));
      }, { once: true });
    }

    child.once('error', (error) => {
      settleError(
        createAcpError(
          error?.code === 'ENOENT' ? `${backend}_runner_not_found` : `${backend}_runner_spawn_failed`,
          error?.message || `Failed to launch ACP runner for ${backend}.`,
        ),
      );
    });

    child.once('spawn', () => {
      settleSuccess();
    });
  });
}

module.exports = {
  runAcpStdioStream,
  testAcpStdioRunner,
  createAcpError,
};
