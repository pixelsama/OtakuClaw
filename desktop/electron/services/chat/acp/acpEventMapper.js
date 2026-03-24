function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function normalizeTimeoutMs(value, fallback, max = 10 * 60 * 1000) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function normalizePermissionMode(value, fallback = 'deny') {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'allow' || normalized === 'ask' || normalized === 'deny') {
    return normalized;
  }
  return fallback;
}

function normalizeAcpTransport(value, fallback = 'stdio') {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'stdio') {
    return normalized;
  }
  if (normalized === 'http') {
    return normalized;
  }
  if (normalized === 'websocket' || normalized === 'ws') {
    return 'websocket';
  }
  return fallback;
}

function normalizeAcpProtocol(value, fallback = 'acp') {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'acp') {
    return normalized;
  }
  return fallback;
}

function normalizeRunnerArgs(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeRunnerEnv(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value)
    .map(([key, item]) => [normalizeText(key), normalizeText(item)])
    .filter(([key]) => Boolean(key));
  return Object.fromEntries(entries);
}

function normalizeRunnerHeaders(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value)
    .map(([key, item]) => [normalizeText(key), normalizeText(item)])
    .filter(([key]) => Boolean(key));
  return Object.fromEntries(entries);
}

function normalizeAcpRunner(runner = {}, defaults = {}) {
  const source = runner && typeof runner === 'object' ? runner : {};
  const fallback = defaults && typeof defaults === 'object' ? defaults : {};

  return {
    protocol: normalizeAcpProtocol(source.protocol, normalizeAcpProtocol(fallback.protocol, 'acp')),
    transport: normalizeAcpTransport(source.transport, normalizeAcpTransport(fallback.transport, 'stdio')),
    command: normalizeText(source.command, normalizeText(fallback.command, '')),
    args: normalizeRunnerArgs(
      Object.prototype.hasOwnProperty.call(source, 'args')
        ? source.args
        : fallback.args,
    ),
    cwd: normalizeText(source.cwd, normalizeText(fallback.cwd, '')),
    env: normalizeRunnerEnv(source.env),
    endpoint: normalizeText(source.endpoint, normalizeText(fallback.endpoint, '')),
    url: normalizeText(source.url, normalizeText(fallback.url, '')),
    permissionEndpoint: normalizeText(
      source.permissionEndpoint,
      normalizeText(fallback.permissionEndpoint, ''),
    ),
    headers: normalizeRunnerHeaders(source.headers),
  };
}

function normalizeAcpBackendSettings(rawSettings = {}, defaults = {}) {
  const source = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  const fallback = defaults && typeof defaults === 'object' ? defaults : {};

  return {
    enabled: Object.prototype.hasOwnProperty.call(source, 'enabled')
      ? Boolean(source.enabled)
      : Boolean(fallback.enabled),
    timeoutMs: normalizeTimeoutMs(source.timeoutMs, normalizeTimeoutMs(fallback.timeoutMs, 120_000)),
    askTimeoutMs: normalizeTimeoutMs(source.askTimeoutMs, normalizeTimeoutMs(fallback.askTimeoutMs, 8_000), 60_000),
    permissionMode: normalizePermissionMode(
      source.permissionMode,
      normalizePermissionMode(fallback.permissionMode, 'deny'),
    ),
    runner: normalizeAcpRunner(source.runner, fallback.runner),
  };
}

function normalizeToolName(value) {
  return normalizeText(value).toLowerCase();
}

const TOOL_STATE_MAP = {
  read_file: {
    businessState: 'researching',
    detail: 'Reviewing local files.',
  },
  list_dir: {
    businessState: 'researching',
    detail: 'Inspecting the workspace.',
  },
  web_search: {
    businessState: 'researching',
    detail: 'Searching for references.',
  },
  web_fetch: {
    businessState: 'researching',
    detail: 'Reading a web page.',
  },
  write_file: {
    businessState: 'executing',
    detail: 'Updating project files.',
  },
  edit_file: {
    businessState: 'executing',
    detail: 'Editing project files.',
  },
  exec: {
    businessState: 'executing',
    detail: 'Running a local command.',
  },
  spawn: {
    businessState: 'executing',
    detail: 'Launching a local process.',
  },
};

function inferBusinessStateFromTool(toolName = '') {
  const normalizedToolName = normalizeToolName(toolName);
  if (!normalizedToolName) {
    return null;
  }

  if (TOOL_STATE_MAP[normalizedToolName]) {
    return {
      toolName: normalizedToolName,
      ...TOOL_STATE_MAP[normalizedToolName],
    };
  }

  if (normalizedToolName.startsWith('read') || normalizedToolName.includes('search')) {
    return {
      toolName: normalizedToolName,
      businessState: 'researching',
      detail: 'Inspecting references.',
    };
  }

  return {
    toolName: normalizedToolName,
    businessState: 'executing',
    detail: 'Executing tool call.',
  };
}

function normalizeEventType(event = {}) {
  return normalizeText(
    event.type
      || event.eventType
      || event.kind
      || event.name,
  ).toLowerCase();
}

function normalizePayload(event = {}) {
  if (event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)) {
    return event.payload;
  }
  if (event.data && typeof event.data === 'object' && !Array.isArray(event.data)) {
    return event.data;
  }

  const clone = { ...(event || {}) };
  delete clone.type;
  delete clone.eventType;
  delete clone.kind;
  delete clone.name;
  return clone;
}

function isPermissionRequestEvent(event = {}) {
  const type = normalizeEventType(event);
  if (type.includes('permission')) {
    return true;
  }

  const payload = normalizePayload(event);
  const requested = normalizeText(payload.permissionRequestId || payload.requestId || payload.permissionId);
  return Boolean(requested && (payload.permission || payload.action || payload.toolName || payload.tool));
}

function extractPermissionRequest(event = {}) {
  const payload = normalizePayload(event);
  return {
    requestId: normalizeText(payload.permissionRequestId || payload.requestId || payload.permissionId),
    permission: normalizeText(payload.permission || payload.action || payload.type),
    toolName: normalizeText(payload.toolName || payload.tool || payload.name),
    reason: normalizeText(payload.reason || payload.detail || payload.message),
  };
}

function mapAcpEventToChatEvent(event = {}, { source = 'acp' } = {}) {
  const type = normalizeEventType(event);
  const payload = normalizePayload(event);

  if (!type) {
    return null;
  }

  if (
    type === 'done'
    || type === 'complete'
    || type === 'completed'
    || type === 'turn-complete'
    || type === 'response.completed'
  ) {
    return {
      type: 'done',
      payload: {
        source,
        finishReason: normalizeText(payload.finishReason || payload.reason || 'completed'),
        aborted: Boolean(payload.aborted),
      },
    };
  }

  if (type === 'error' || type === 'failed' || type === 'turn-error' || type === 'response.failed') {
    return {
      type: 'error',
      payload: {
        code: normalizeText(payload.code, 'acp_upstream_error'),
        message: normalizeText(payload.message, 'ACP backend request failed.'),
        status: Number.isFinite(payload.status) ? payload.status : undefined,
      },
    };
  }

  if (type === 'usage') {
    return {
      type: 'usage',
      payload: {
        ...payload,
      },
    };
  }

  if (type === 'artifact') {
    return {
      type: 'artifact',
      payload: {
        ...payload,
      },
    };
  }

  if (
    type === 'tool-call'
    || type === 'tool-start'
    || type === 'tool-progress'
    || type === 'agent-state'
    || type === 'activity'
  ) {
    const inferred = inferBusinessStateFromTool(payload.toolName || payload.tool || payload.name || payload.action);
    return {
      type: 'agent-state',
      payload: {
        businessState: normalizeText(payload.businessState || payload.state || inferred?.businessState, 'executing'),
        detail: normalizeText(payload.detail || payload.message || inferred?.detail),
        toolName: normalizeText(payload.toolName || payload.tool || inferred?.toolName),
        source,
      },
    };
  }

  const content = normalizeText(payload.content || payload.delta || payload.text);
  if (
    content
    && (
      type === 'text-delta'
      || type === 'delta'
      || type === 'message-delta'
      || type === 'output_text.delta'
      || type === 'output.delta'
      || type === 'message'
      || type === 'text'
      || type === 'response.output_text.delta'
      || type === 'response.output_text'
    )
  ) {
    return {
      type: 'text-delta',
      payload: {
        content,
        source,
      },
    };
  }

  return null;
}

module.exports = {
  mapAcpEventToChatEvent,
  normalizeAcpBackendSettings,
  normalizePermissionMode,
  normalizeEventType,
  normalizePayload,
  isPermissionRequestEvent,
  extractPermissionRequest,
  inferBusinessStateFromTool,
};
