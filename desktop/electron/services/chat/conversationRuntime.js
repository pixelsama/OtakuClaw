const { randomUUID } = require('node:crypto');

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
  prepareTurn,
  onTurnStarted,
  onTurnEvent,
  onTurnSettled,
} = {}) {
  const activeStreamByRouteKey = new Map();
  const activeTurnByRouteKey = new Map();
  const streamContextByStreamId = new Map();
  const pendingQueueByRouteKey = new Map();
  const activeRouteKeysBySessionId = new Map();
  let turnTokenSeq = 0;

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

  const callHook = async (hook, payload = {}, label = 'hook') => {
    if (typeof hook !== 'function') {
      return null;
    }

    try {
      return await Promise.resolve(hook(payload));
    } catch (error) {
      debug({
        stage: `${label}-failed`,
        message: `Conversation runtime ${label} failed.`,
        details: {
          error: error?.message || String(error),
          payload,
        },
      });
      return null;
    }
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
    const activeTurn = activeTurnByRouteKey.get(normalizedContext.routeKey);
    if (activeTurn) {
      activeTurnByRouteKey.set(normalizedContext.routeKey, {
        ...activeTurn,
        streamId,
        sessionId: normalizedContext.sessionId,
      });
    }

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
    const activeTurn = activeTurnByRouteKey.get(context.routeKey);
    if (activeTurn?.streamId === streamId) {
      activeTurnByRouteKey.delete(context.routeKey);
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

  const nextTurnToken = () => {
    turnTokenSeq += 1;
    return `turn-${Date.now().toString(36)}-${turnTokenSeq.toString(36)}`;
  };

  const beginRouteTurn = (routeContext = {}) => {
    const routeKey = normalizeRouteSegment(routeContext.routeKey, '');
    const token = nextTurnToken();
    if (!routeKey) {
      return token;
    }

    activeTurnByRouteKey.set(routeKey, {
      token,
      routeKey,
      sessionId: normalizeSessionId(routeContext.sessionId),
      streamId: '',
    });
    return token;
  };

  const isCurrentRouteTurn = (routeKey, token) => {
    if (!routeKey || !token) {
      return false;
    }
    return activeTurnByRouteKey.get(routeKey)?.token === token;
  };

  const finishRouteTurn = (routeKey, token) => {
    const safeRouteKey = normalizeRouteSegment(routeKey, '');
    if (!safeRouteKey || !token) {
      return false;
    }

    const current = activeTurnByRouteKey.get(safeRouteKey);
    if (!current || current.token !== token) {
      return false;
    }

    activeTurnByRouteKey.delete(safeRouteKey);
    return true;
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
    if (!safeRouteKey || activeTurnByRouteKey.has(safeRouteKey)) {
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

    const routeContext = normalizeConversationRouteContext(next.request);
    const turnToken = beginRouteTurn(routeContext);
    void startTurn(next.request, 'queue', routeContext, turnToken)
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

  const startTurn = async (request, policy, routeContext = null, turnToken = '') => {
    const sessionId = normalizeSessionId(request?.sessionId);
    const content = normalizeContent(request?.content);
    const normalizedContext = routeContext || normalizeConversationRouteContext(request);
    const safeRouteKey = normalizeRouteSegment(normalizedContext.routeKey, '');
    if (!content) {
      if (finishRouteTurn(safeRouteKey, turnToken)) {
        drainQueue(safeRouteKey);
      }
      return {
        ok: false,
        reason: 'content_required',
      };
    }

    if (typeof startChatStream !== 'function') {
      if (finishRouteTurn(safeRouteKey, turnToken)) {
        drainQueue(safeRouteKey);
      }
      return {
        ok: false,
        reason: 'chat_stream_unavailable',
      };
    }

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

    const preparedTurn =
      (await callHook(
        prepareTurn,
        {
          request: requestPayload,
          routeContext: normalizedContext,
          policy,
          emitEvent,
        },
        'prepare-turn',
      )) || null;
    if (!isCurrentRouteTurn(safeRouteKey, turnToken)) {
      return {
        ok: false,
        reason: 'superseded_by_latest',
      };
    }
    const preparedRequest =
      preparedTurn?.request && typeof preparedTurn.request === 'object'
        ? {
            ...requestPayload,
            ...preparedTurn.request,
            options: {
              ...requestPayload.options,
              ...(preparedTurn.request.options && typeof preparedTurn.request.options === 'object'
                ? preparedTurn.request.options
                : {}),
            },
          }
        : requestPayload;

    if (preparedTurn?.needsBackend === false) {
      const streamId = normalizeRouteSegment(
        preparedTurn.streamId || preparedTurn.turnId || randomUUID(),
        randomUUID(),
      );
      const syntheticContext = {
        ...normalizedContext,
        turnId: normalizeRouteSegment(preparedTurn.turnId || streamId, streamId),
      };
      const responseText =
        typeof preparedTurn.reply === 'string'
          ? preparedTurn.reply.trim()
          : typeof preparedTurn.content === 'string'
            ? preparedTurn.content.trim()
            : '';

      await callHook(
        onTurnStarted,
        {
          streamId,
          routeContext: syntheticContext,
          request: preparedRequest,
          policy,
          prepareResult: preparedTurn,
          synthetic: true,
        },
        'turn-started',
      );
      if (!isCurrentRouteTurn(safeRouteKey, turnToken)) {
        return {
          ok: false,
          reason: 'superseded_by_latest',
        };
      }

      emitEvent({
        channel: 'chat',
        type: 'stream-start',
        streamId,
        agentId: syntheticContext.agentId,
        backend: syntheticContext.backend,
        routeKey: syntheticContext.routeKey,
        sessionId: syntheticContext.sessionId,
        sessionNamespace: syntheticContext.sessionNamespace,
        profileId: syntheticContext.profileId,
        turnId: syntheticContext.turnId,
        payload: {
          sessionId: syntheticContext.sessionId,
          sessionNamespace: syntheticContext.sessionNamespace,
          routeKey: syntheticContext.routeKey,
          agentId: syntheticContext.agentId,
          backend: syntheticContext.backend,
          profileId: syntheticContext.profileId,
          source: preparedRequest?.options?.source || '',
          policy,
          synthetic: true,
          fastPath: true,
        },
      });

      if (responseText) {
        const textPayload = {
          content: responseText,
          source: preparedRequest?.options?.source || 'fast-persona',
          synthetic: true,
          fastPath: true,
        };
        emitEvent({
          channel: 'chat',
          type: 'text-delta',
          streamId,
          agentId: syntheticContext.agentId,
          backend: syntheticContext.backend,
          routeKey: syntheticContext.routeKey,
          sessionId: syntheticContext.sessionId,
          sessionNamespace: syntheticContext.sessionNamespace,
          profileId: syntheticContext.profileId,
          turnId: syntheticContext.turnId,
          payload: textPayload,
        });
        await callHook(
          onTurnEvent,
          {
            streamId,
            routeContext: syntheticContext,
            type: 'text-delta',
            payload: textPayload,
            prepareResult: preparedTurn,
            synthetic: true,
          },
          'turn-event',
        );
      }

      const donePayload = {
        source: preparedRequest?.options?.source || 'fast-persona',
        synthetic: true,
        fastPath: true,
      };
      emitEvent({
        channel: 'chat',
        type: 'done',
        streamId,
        agentId: syntheticContext.agentId,
        backend: syntheticContext.backend,
        routeKey: syntheticContext.routeKey,
        sessionId: syntheticContext.sessionId,
        sessionNamespace: syntheticContext.sessionNamespace,
        profileId: syntheticContext.profileId,
        turnId: syntheticContext.turnId,
        payload: donePayload,
      });
      await callHook(
        onTurnSettled,
        {
          streamId,
          routeContext: syntheticContext,
          type: 'done',
          payload: donePayload,
          prepareResult: preparedTurn,
          synthetic: true,
          text: responseText,
        },
        'turn-settled',
      );
      if (finishRouteTurn(safeRouteKey, turnToken)) {
        drainQueue(safeRouteKey);
      }

      return {
        ok: true,
        streamId,
        sessionId: syntheticContext.sessionId,
        routeKey: syntheticContext.routeKey,
        backend: syntheticContext.backend,
        profileId: syntheticContext.profileId,
        policy,
        synthetic: true,
      };
    }

    const startResult = await startChatStream(preparedRequest);

    if (!startResult?.ok || !startResult.streamId) {
      if (finishRouteTurn(safeRouteKey, turnToken)) {
        drainQueue(safeRouteKey);
      }
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
    await callHook(
      onTurnStarted,
      {
        streamId,
        routeContext: streamContext,
        request: preparedRequest,
        policy,
        prepareResult: preparedTurn,
        synthetic: false,
      },
      'turn-started',
    );
    if (!isCurrentRouteTurn(streamContext.routeKey, turnToken)) {
      await doAbortStream(streamId, 'superseded_before_start');
      clearActiveByStreamId(streamId);
      drainQueue(streamContext.routeKey);
      return {
        ok: false,
        reason: 'superseded_by_latest',
      };
    }

    return {
      ok: true,
      streamId,
      sessionId,
      routeKey: streamContext.routeKey,
      backend: streamContext.backend,
      profileId: streamContext.profileId,
      policy,
      synthetic: false,
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

    const activeTurn = activeTurnByRouteKey.get(routeContext.routeKey) || null;
    const activeStreamId = activeTurn?.streamId || '';
    if (policy === 'queue' && activeTurn) {
      return enqueueRequest(routeContext.routeKey, normalizedRequest);
    }

    if (policy === 'latest-wins' && activeTurn) {
      clearPendingQueue(routeContext.routeKey, 'superseded_by_latest');
      if (activeStreamId) {
        await doAbortStream(activeStreamId, 'latest_wins');
        clearActiveByStreamId(activeStreamId);
      }
    }

    const turnToken = beginRouteTurn(routeContext);
    return startTurn(normalizedRequest, policy, routeContext, turnToken);
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
    const preparingRouteKeys = [...activeTurnByRouteKey.entries()]
      .filter(([, context]) => normalizeSessionId(context.sessionId) === requestedSessionId)
      .map(([routeKey]) => routeKey);
    if (!activeStreamIds.length) {
      for (const routeKey of preparingRouteKeys) {
        activeTurnByRouteKey.delete(routeKey);
      }
      clearPendingQueuesForSession(requestedSessionId, request?.reason || 'manual');
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
    for (const routeKey of preparingRouteKeys) {
      activeTurnByRouteKey.delete(routeKey);
    }
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
    void callHook(
      onTurnEvent,
      {
        streamId,
        routeContext: context,
        type,
        payload: {
          ...rawPayload,
          streamId,
          turnId,
        },
        rawEvent: payload,
        synthetic: false,
      },
      'turn-event',
    );

    if (!streamId || (type !== 'done' && type !== 'error')) {
      return;
    }

    void callHook(
      onTurnSettled,
      {
        streamId,
        routeContext: context,
        type,
        payload: {
          ...rawPayload,
          streamId,
          turnId,
        },
        rawEvent: payload,
        synthetic: false,
      },
      'turn-settled',
    );

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
    activeTurnByRouteKey.clear();
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
