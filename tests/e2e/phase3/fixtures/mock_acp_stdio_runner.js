#!/usr/bin/env node

const readline = require('node:readline');

function write(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function getScenario(startTurnPayload = {}) {
  const fromOptions = startTurnPayload?.options?.mockScenario;
  if (typeof fromOptions === 'string' && fromOptions.trim()) {
    return fromOptions.trim();
  }
  const fromArgv = typeof process.argv[2] === 'string' ? process.argv[2].trim() : '';
  if (fromArgv) {
    return fromArgv;
  }
  const fromEnv = typeof process.env.MOCK_ACP_SCENARIO === 'string' ? process.env.MOCK_ACP_SCENARIO.trim() : '';
  if (fromEnv) {
    return fromEnv;
  }
  return 'echo';
}

function emitDone({ aborted = false, finishReason = aborted ? 'aborted' : 'completed' } = {}) {
  write({
    type: 'done',
    payload: {
      source: 'mock-acp-stdio',
      aborted,
      finishReason,
    },
  });
}

let activeTurn = null;
let scenario = 'echo';
let aborted = false;
let longTimer = null;
const permissionResponses = new Map();

function clearTimers() {
  if (longTimer) {
    clearInterval(longTimer);
    longTimer = null;
  }
}

function startLongStream() {
  let tick = 0;
  longTimer = setInterval(() => {
    if (aborted) {
      clearTimers();
      return;
    }
    tick += 1;
    write({
      type: 'text-delta',
      payload: {
        content: `long-chunk-${tick}`,
        source: 'mock-acp-stdio',
      },
    });
    if (tick >= 30) {
      clearTimers();
      emitDone();
    }
  }, 1000);
}

function startPermissionOnce() {
  write({
    type: 'permission-request',
    payload: {
      requestId: 'perm-1',
      permission: 'exec',
      toolName: 'shell',
      reason: 'Need shell access for checklist validation.',
    },
  });
}

function startPermissionQueue() {
  write({
    type: 'permission-request',
    payload: {
      requestId: 'perm-q-1',
      permission: 'read',
      toolName: 'fs-read',
      reason: 'Queue test request #1',
    },
  });
  setTimeout(() => {
    write({
      type: 'permission-request',
      payload: {
        requestId: 'perm-q-2',
        permission: 'exec',
        toolName: 'shell',
        reason: 'Queue test request #2',
      },
    });
  }, 120);
}

function maybeFinalizeQueue() {
  if (!permissionResponses.has('perm-q-1') || !permissionResponses.has('perm-q-2')) {
    return;
  }
  const first = permissionResponses.get('perm-q-1');
  const second = permissionResponses.get('perm-q-2');
  write({
    type: 'text-delta',
    payload: {
      content: `queue-decisions: ${first.decision}/${second.decision}`,
      source: 'mock-acp-stdio',
    },
  });
  emitDone();
}

function onStartTurn(payload = {}) {
  activeTurn = payload.turnId || 'turn';
  aborted = false;
  permissionResponses.clear();
  scenario = getScenario(payload);

  if (scenario === 'echo') {
    write({
      type: 'text-delta',
      payload: {
        content: 'echo-ok',
        source: 'mock-acp-stdio',
      },
    });
    emitDone();
    return;
  }

  if (scenario === 'error') {
    write({
      type: 'error',
      payload: {
        code: 'mock_error',
        message: 'Intentional mock error.',
      },
    });
    return;
  }

  if (scenario === 'long') {
    startLongStream();
    return;
  }

  if (scenario === 'permission-once') {
    startPermissionOnce();
    return;
  }

  if (scenario === 'permission-queue') {
    startPermissionQueue();
    return;
  }

  write({
    type: 'error',
    payload: {
      code: 'mock_unknown_scenario',
      message: `Unknown scenario: ${scenario}`,
    },
  });
}

function onAbortTurn() {
  aborted = true;
  clearTimers();
  emitDone({ aborted: true });
}

function onPermissionResponse(payload = {}) {
  const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
  if (!requestId) {
    return;
  }

  permissionResponses.set(requestId, {
    decision: payload.decision || 'deny',
    reason: payload.reason || '',
  });

  if (scenario === 'permission-once' && requestId === 'perm-1') {
    const decision = payload.decision === 'allow' ? 'allow' : 'deny';
    if (decision === 'allow') {
      write({
        type: 'text-delta',
        payload: {
          content: 'permission-allow-ok',
          source: 'mock-acp-stdio',
        },
      });
      emitDone();
    } else {
      write({
        type: 'error',
        payload: {
          code: 'permission_denied',
          message: payload.reason || 'Denied by user.',
        },
      });
    }
    return;
  }

  if (scenario === 'permission-queue') {
    maybeFinalizeQueue();
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', (line) => {
  let payload = null;
  try {
    payload = JSON.parse(line);
  } catch {
    return;
  }
  const type = typeof payload.type === 'string' ? payload.type.trim() : '';
  if (!type) {
    return;
  }

  if (type === 'start-turn') {
    onStartTurn(payload);
    return;
  }

  if (type === 'abort-turn') {
    onAbortTurn(payload);
    return;
  }

  if (type === 'permission-response') {
    onPermissionResponse(payload);
  }
});

process.on('SIGTERM', () => {
  clearTimers();
  if (activeTurn && !aborted) {
    onAbortTurn();
  }
  process.exit(0);
});
