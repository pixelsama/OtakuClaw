const DEFAULT_POLICY = 'latest-wins';
const DEFAULT_AGENT_ID = 'main';
const DEFAULT_BACKEND = 'nanobot';

function normalizeSessionId(value) {
  if (typeof value !== 'string') {
    return 'default';
  }

  const normalized = value.trim();
  return normalized || 'default';
}

function normalizeContent(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function normalizeRouteSegment(value, fallback = 'default') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function normalizeBackendName(value) {
  if (typeof value !== 'string') {
    return DEFAULT_BACKEND;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_BACKEND;
  }

  if (normalized === 'openclaw') {
    return 'nanobot';
  }

  return normalized;
}

function normalizeAgentId(value) {
  return normalizeRouteSegment(value, DEFAULT_AGENT_ID);
}

function buildRouteKey({ agentId, backend, sessionNamespace } = {}) {
  return [
    normalizeAgentId(agentId),
    normalizeBackendName(backend),
    normalizeRouteSegment(sessionNamespace, 'default'),
  ].join(':');
}

function normalizeConversationRouteContext(request = {}) {
  const source = request && typeof request === 'object' ? request : {};
  const options = source.options && typeof source.options === 'object' ? source.options : {};
  const sessionId = normalizeSessionId(source.sessionId || options.sessionId);
  const sessionNamespace = normalizeRouteSegment(
    source.sessionNamespace
      || options.sessionNamespace
      || source.routeNamespace
      || options.routeNamespace
      || sessionId,
    sessionId,
  );
  const agentId = normalizeAgentId(source.agentId || options.agentId);
  const profileId = normalizeRouteSegment(
    source.profileId || options.profileId || source.agentProfileId || options.agentProfileId,
    '',
  );
  const backend = normalizeBackendName(source.backend || options.backend);
  const routeKey = normalizeRouteSegment(
    source.routeKey || options.routeKey,
    buildRouteKey({
      agentId,
      backend,
      sessionNamespace,
    }),
  );

  return {
    sessionId,
    sessionNamespace,
    agentId,
    profileId,
    backend,
    routeKey,
  };
}

function normalizePolicy(value) {
  if (typeof value !== 'string') {
    return DEFAULT_POLICY;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'queue') {
    return 'queue';
  }
  if (normalized === 'latest-wins') {
    return 'latest-wins';
  }

  return DEFAULT_POLICY;
}

function createConversationRuntime({
  startChatStream,
  abortChatStream,
  emitConversationEvent,
  emitDebugLog,
} = {}) {
  const activeStreamByRouteKey = new Map();
  const streamContextByStreamId = new Map();
  const pendingQueueByRouteKey = new Map();
  const activeRouteKeysBySessionId = new Map();

  const debug = (payload = {}) => {
    if (typeof emitDebugLog !== 'function') {
      return;
    }
    emitDebugLog({
      source: 'conversation-runtime',
      ...payload,
    });
  };

  const emitEvent = (payload = {}) => {
    if (typeof emitConversationEvent !== 'function') {
      return;
    }

    const normalizedPayload =
      payload.payload && typeof payload.payload === 'object' ? payload.payload : {};

    emitConversationEvent({
      timestamp: new Date().toISOString(),
      ...payload,
      channel: typeof payload.channel === 'string' ? payload.channel : 'chat',
      agentId: normalizeAgentId(payload.agentId),
      backend: normalizeBackendName(payload.backend),
      routeKey: normalizeRouteSegment(payload.routeKey, ''),
      sessionId: normalizeSessionId(payload.sessionId),
      sessionNamespace: normalizeRouteSegment(payload.sessionNamespace, ''),
      profileId: normalizeRouteSegment(payload.profileId, ''),
      turnId: normalizeRouteSegment(payload.turnId || payload.streamId, ''),
      streamId: normalizeRouteSegment(payload.streamId, ''),
      type: typeof payload.type === 'string' ? payload.type : '',
      payload: normalizedPayload,
    });
  };

  const trackActiveStream = (streamId, context = {}) => {
    const normalizedContext = {
      sessionId: normalizeSessionId(context.sessionId),
      sessionNamespace: normalizeRouteSegment(context.sessionNamespace, normalizeSessionId(context.sessionId)),
      agentId: normalizeAgentId(context.agentId),
      profileId: normalizeRouteSegment(context.profileId, ''),
      backend: normalizeBackendName(context.backend),
      routeKey: normalizeRouteSegment(
        context.routeKey,
        buildRouteKey({
          agentId: context.agentId,
          backend: context.backend,
          sessionNamespace: context.sessionNamespace,
        }),
      ),
      turnId: normalizeRouteSegment(context.turnId || streamId, streamId),
    };

    streamContextByStreamId.set(streamId, {
      ...normalizedContext,
      streamId,
    });
    activeStreamByRouteKey.set(normalizedContext.routeKey, streamId);

    const activeRouteKeys = activeRouteKeysBySessionId.get(normalizedContext.sessionId) || new Set();
    activeRouteKeys.add(normalizedContext.routeKey);
    activeRouteKeysBySessionId.set(normalizedContext.sessionId, activeRouteKeys);

    return streamContextByStreamId.get(streamId);
  };

  const getContextForStream = (streamId) => {
    const context = streamContextByStreamId.get(streamId);
    if (!context) {
      return null;
    }

    return { ...context };
  };

  const clearActiveByStreamId = (streamId) => {
    const context = streamContextByStreamId.get(streamId);
    if (!context) {
      return '';
    }

    streamContextByStreamId.delete(streamId);
    if (activeStreamByRouteKey.get(context.routeKey) === streamId) {
      activeStreamByRouteKey.delete(context.routeKey);
    }

    const activeRouteKeys = activeRouteKeysBySessionId.get(context.sessionId);
    if (activeRouteKeys) {
      activeRouteKeys.delete(context.routeKey);
      if (activeRouteKeys.size === 0) {
        activeRouteKeysBySessionId.delete(context.sessionId);
      }
    }

    return context.routeKey;
  };

  const doAbortStream = async (streamId, reason) => {
    if (!streamId || typeof abortChatStream !== 'function') {
      return;
    }

    try {
      await abortChatStream({ streamId });
      debug({
        stage: 'stream-abort',
        message: 'Conversation runtime aborted chat stream.',
        details: {
          streamId,
          routeKey: streamContextByStreamId.get(streamId)?.routeKey || '',
          reason: reason || '',
        },
      });
    } catch (error) {
      debug({
        stage: 'stream-abort-failed',
        message: 'Conversation runtime failed to abort chat stream.',
        details: {
          streamId,
          routeKey: streamContextByStreamId.get(streamId)?.routeKey || '',
          reason: reason || '',
          error: error?.message || String(error),
        },
      });
    }
  };

  const clearPendingQueue = (routeKey, reason) => {
    const safeRouteKey = normalizeRouteSegment(routeKey, '');
    const queue = pendingQueueByRouteKey.get(safeRouteKey);
    if (!queue || queue.length === 0) {
      pendingQueueByRouteKey.delete(safeRouteKey);
      return;
    }

    pendingQueueByRouteKey.delete(safeRouteKey);
    for (const item of queue) {
      item.resolve({
        ok: false,
        reason: reason || 'aborted',
      });
    }
  };

  const clearPendingQueuesForSession = (sessionId, reason) => {
    const safeSessionId = normalizeSessionId(sessionId);
    for (const [routeKey, queue] of [...pendingQueueByRouteKey.entries()]) {
      if (!queue || queue.length === 0) {
        pendingQueueByRouteKey.delete(routeKey);
        continue;
      }

      const queueSessionId = normalizeSessionId(queue[0]?.request?.sessionId);
      if (queueSessionId !== safeSessionId) {
        continue;
      }

      clearPendingQueue(routeKey, reason);
    }
  };

  const drainQueue = (routeKey) => {
    const safeRouteKey = normalizeRouteSegment(routeKey, '');
    if (!safeRouteKey || activeStreamByRouteKey.has(safeRouteKey)) {
      return;
    }

    const queue = pendingQueueByRouteKey.get(safeRouteKey);
    if (!queue || queue.length === 0) {
      pendingQueueByRouteKey.delete(safeRouteKey);
      return;
    }

    const next = queue.shift();
    if (!queue.length) {
      pendingQueueByRouteKey.delete(safeRouteKey);
    }

    void startTurn(next.request, 'queue', normalizeConversationRouteContext(next.request))
      .then((result) => {
        next.resolve(result);
      })
      .catch((error) => {
        next.resolve({
          ok: false,
          reason: error?.message || 'stream_start_failed',
        });
      });
  };

  const enqueueRequest = (routeKey, request) =>
    new Promise((resolve) => {
      const safeRouteKey = normalizeRouteSegment(routeKey, '');
      const queue = pendingQueueByRouteKey.get(safeRouteKey) || [];
      queue.push({
        request: {
          ...request,
          sessionId: normalizeSessionId(request?.sessionId),
        },
        resolve,
      });
      pendingQueueByRouteKey.set(safeRouteKey, queue);
      debug({
        stage: 'queue-enqueue',
        message: 'Conversation runtime queued chat request.',
        details: {
          routeKey: safeRouteKey,
          sessionId: normalizeSessionId(request?.sessionId),
          queuedCount: queue.length,
        },
      });
    });

  const startTurn = async (request, policy, routeContext = null) => {
    const sessionId = normalizeSessionId(request?.sessionId);
    const content = normalizeContent(request?.content);
    if (!content) {
      return {
        ok: false,
        reason: 'content_required',
      };
    }

    if (typeof startChatStream !== 'function') {
      return {
        ok: false,
        reason: 'chat_stream_unavailable',
      };
    }

    const normalizedContext = routeContext || normalizeConversationRouteContext(request);
    const requestPayload = {
      ...request,
      sessionId,
      content,
      agentId: normalizedContext.agentId,
      backend: normalizedContext.backend,
      profileId: normalizedContext.profileId,
      sessionNamespace: normalizedContext.sessionNamespace,
      routeKey: normalizedContext.routeKey,
      options: {
        ...(request?.options && typeof request.options === 'object' ? request.options : {}),
        agentId: normalizedContext.agentId,
        backend: normalizedContext.backend,
        profileId: normalizedContext.profileId,
        sessionNamespace: normalizedContext.sessionNamespace,
        routeKey: normalizedContext.routeKey,
      },
    };

    const startResult = await startChatStream(requestPayload);

    if (!startResult?.ok || !startResult.streamId) {
      return {
        ok: false,
        reason: startResult?.reason || 'stream_start_failed',
      };
    }

    const streamId = startResult.streamId;
    const actualBackend = normalizeBackendName(startResult.backend || normalizedContext.backend);
    const streamContext = trackActiveStream(streamId, {
      ...normalizedContext,
      backend: actualBackend,
      turnId: streamId,
    });

    debug({
      stage: 'stream-start',
      message: 'Conversation runtime started chat stream.',
      details: {
        sessionId,
        routeKey: streamContext.routeKey,
        agentId: streamContext.agentId,
        backend: streamContext.backend,
        profileId: streamContext.profileId,
        streamId,
        policy,
        source: request?.options?.source || '',
      },
    });

    emitEvent({
      channel: 'chat',
      type: 'stream-start',
      streamId,
      agentId: streamContext.agentId,
      backend: streamContext.backend,
      routeKey: streamContext.routeKey,
      sessionId: streamContext.sessionId,
      sessionNamespace: streamContext.sessionNamespace,
      profileId: streamContext.profileId,
      turnId: streamId,
      payload: {
        sessionId: streamContext.sessionId,
        sessionNamespace: streamContext.sessionNamespace,
        routeKey: streamContext.routeKey,
        agentId: streamContext.agentId,
        backend: streamContext.backend,
        profileId: streamContext.profileId,
        source: request?.options?.source || '',
        policy,
      },
    });

    return {
      ok: true,
      streamId,
      sessionId,
      routeKey: streamContext.routeKey,
      backend: streamContext.backend,
      profileId: streamContext.profileId,
      policy,
    };
  };

  const submitUserText = async (request = {}) => {
    const sessionId = normalizeSessionId(request?.sessionId);
    const content = normalizeContent(request?.content);
    const policy = normalizePolicy(request?.policy || request?.options?.concurrencyPolicy);
    const routeContext = normalizeConversationRouteContext({
      ...request,
      sessionId,
      content,
    });
    const normalizedRequest = {
      ...request,
      sessionId,
      content,
      agentId: routeContext.agentId,
      backend: routeContext.backend,
      profileId: routeContext.profileId,
      sessionNamespace: routeContext.sessionNamespace,
      routeKey: routeContext.routeKey,
    };

    if (!content) {
      return {
        ok: false,
        reason: 'content_required',
      };
    }

    const activeStreamId = activeStreamByRouteKey.get(routeContext.routeKey) || '';
    if (policy === 'queue' && activeStreamId) {
      return enqueueRequest(routeContext.routeKey, normalizedRequest);
    }

    if (policy === 'latest-wins' && activeStreamId) {
      clearPendingQueue(routeContext.routeKey, 'superseded_by_latest');
      await doAbortStream(activeStreamId, 'latest_wins');
      clearActiveByStreamId(activeStreamId);
    }

    return startTurn(normalizedRequest, policy, routeContext);
  };

  const abortActive = async (request = {}) => {
    const requestedSessionId = normalizeSessionId(request?.sessionId);
    const requestedStreamId =
      typeof request?.streamId === 'string' ? request.streamId.trim() : '';

    if (requestedStreamId) {
      await doAbortStream(requestedStreamId, request?.reason || 'manual');
      const clearedRouteKey = clearActiveByStreamId(requestedStreamId);
      if (clearedRouteKey) {
        clearPendingQueue(clearedRouteKey, request?.reason || 'manual');
      }
      return {
        ok: true,
        aborted: [requestedStreamId],
      };
    }

    const activeStreamIds = [...streamContextByStreamId.entries()]
      .filter(([, context]) => normalizeSessionId(context.sessionId) === requestedSessionId)
      .map(([streamId]) => streamId);
    if (!activeStreamIds.length) {
      return {
        ok: true,
        aborted: [],
      };
    }

    await Promise.all(
      activeStreamIds.map((streamId) => doAbortStream(streamId, request?.reason || 'manual')),
    );

    const aborted = [];
    for (const streamId of activeStreamIds) {
      if (clearActiveByStreamId(streamId)) {
        aborted.push(streamId);
      }
    }

    clearPendingQueuesForSession(requestedSessionId, request?.reason || 'manual');
    return {
      ok: true,
      aborted,
    };
  };

  const onChatStreamEvent = (payload = {}) => {
    const streamId = typeof payload?.streamId === 'string' ? payload.streamId : '';
    const type = typeof payload?.type === 'string' ? payload.type : '';
    const rawPayload = payload?.payload && typeof payload.payload === 'object' ? payload.payload : {};
    const context = streamId ? getContextForStream(streamId) : null;
    const turnId = normalizeRouteSegment(rawPayload.turnId || rawPayload.segmentTurnId || streamId, streamId);

    emitEvent({
      channel: 'chat',
      streamId,
      turnId,
      type,
      agentId: context?.agentId || rawPayload.agentId || '',
      backend: context?.backend || rawPayload.backend || '',
      routeKey: context?.routeKey || rawPayload.routeKey || '',
      sessionId: context?.sessionId || rawPayload.sessionId || '',
      sessionNamespace: context?.sessionNamespace || rawPayload.sessionNamespace || '',
      profileId: context?.profileId || rawPayload.profileId || '',
      payload: {
        ...rawPayload,
        streamId,
        turnId,
        agentId: context?.agentId || rawPayload.agentId || '',
        backend: context?.backend || rawPayload.backend || '',
        routeKey: context?.routeKey || rawPayload.routeKey || '',
        sessionId: context?.sessionId || rawPayload.sessionId || '',
        sessionNamespace: context?.sessionNamespace || rawPayload.sessionNamespace || '',
        profileId: context?.profileId || rawPayload.profileId || '',
      },
    });

    if (!streamId || (type !== 'done' && type !== 'error')) {
      return;
    }

    const clearedRouteKey = clearActiveByStreamId(streamId);
    if (!clearedRouteKey) {
      return;
    }

    drainQueue(clearedRouteKey);
  };

  const onVoiceEvent = (payload = {}) => {
    const type = typeof payload?.type === 'string' ? payload.type : '';
    if (!type) {
      return;
    }

    emitEvent({
      channel: 'voice',
      ...payload,
    });
  };

  const dispose = async () => {
    const streamIds = Array.from(streamContextByStreamId.keys());
    await Promise.all(streamIds.map((streamId) => doAbortStream(streamId, 'dispose')));
    for (const routeKey of [...pendingQueueByRouteKey.keys()]) {
      clearPendingQueue(routeKey, 'dispose');
    }
    activeStreamByRouteKey.clear();
    streamContextByStreamId.clear();
    pendingQueueByRouteKey.clear();
    activeRouteKeysBySessionId.clear();
  };

  return {
    submitUserText,
    abortActive,
    onChatStreamEvent,
    onVoiceEvent,
    dispose,
  };
}

module.exports = {
  createConversationRuntime,
};
