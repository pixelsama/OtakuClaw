function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTimestamp(value, fallback) {
  const text = normalizeText(value);
  return text || fallback;
}

function normalizeAgentId(value) {
  return normalizeText(value);
}

function collectPresenceAgents(input = {}) {
  if (Array.isArray(input)) {
    return input;
  }

  if (!isObject(input)) {
    return [];
  }

  if (Array.isArray(input.agents)) {
    return input.agents;
  }

  if (isObject(input.agent)) {
    return [input.agent];
  }

  return [];
}

function collectPresenceAgentIds(input = {}) {
  const ids = new Set();
  const addId = (value) => {
    const normalized = normalizeAgentId(value);
    if (normalized) {
      ids.add(normalized);
    }
  };

  for (const item of collectPresenceAgents(input)) {
    if (isObject(item)) {
      addId(item.id || item.agentId);
    } else {
      addId(item);
    }
  }

  if (isObject(input)) {
    addId(input.agentId || input.id);

    if (Array.isArray(input.agentIds)) {
      for (const item of input.agentIds) {
        addId(item);
      }
    }

    if (Array.isArray(input.removeAgentIds)) {
      for (const item of input.removeAgentIds) {
        addId(item);
      }
    }

    addId(input.removeAgentId);
  }

  return Array.from(ids.values());
}

function normalizePresenceAgents(agents = [], fallbackTimestamp = '') {
  return (Array.isArray(agents) ? agents : [])
    .map((agent) => {
      if (!isObject(agent)) {
        return null;
      }

      const agentId = normalizeAgentId(agent.id || agent.agentId);
      if (!agentId) {
        return null;
      }

      return {
        ...agent,
        id: agentId,
        agentId,
        updatedAt: normalizeTimestamp(agent.updatedAt, fallbackTimestamp),
      };
    })
    .filter(Boolean);
}

class OfficePresenceProducer {
  constructor({
    officeStateStore,
    now = () => Date.now(),
    setIntervalFn = globalThis.setInterval,
    clearIntervalFn = globalThis.clearInterval,
    cleanupIntervalMs = 5000,
  } = {}) {
    this.officeStateStore = officeStateStore || null;
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.setIntervalFn =
      setIntervalFn === null ? null : (typeof setIntervalFn === 'function' ? setIntervalFn : globalThis.setInterval);
    this.clearIntervalFn =
      clearIntervalFn === null ? null : (typeof clearIntervalFn === 'function' ? clearIntervalFn : globalThis.clearInterval);
    this.cleanupIntervalMs = Math.max(500, normalizeInteger(cleanupIntervalMs, 5000));
    this.presenceLeases = new Map();
    this.cleanupTimer = null;

    if (this.officeStateStore && this.setIntervalFn && this.clearIntervalFn) {
      this.cleanupTimer = this.setIntervalFn(() => {
        try {
          this.cleanupExpiredPresence();
        } catch (error) {
          console.warn('Office presence cleanup failed:', error);
        }
      }, this.cleanupIntervalMs);
    }
  }

  dispose() {
    if (this.cleanupTimer && this.clearIntervalFn) {
      this.clearIntervalFn(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  ensureStore() {
    if (!this.officeStateStore) {
      throw new Error('office_presence_store_unavailable');
    }
    return this.officeStateStore;
  }

  syncLease(agentIds = [], ttlMs = null, source = '') {
    const normalizedIds = (Array.isArray(agentIds) ? agentIds : [])
      .map((agentId) => normalizeAgentId(agentId))
      .filter(Boolean);
    if (!normalizedIds.length) {
      return;
    }

    const normalizedTtlMs = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0
      ? Number(ttlMs)
      : null;
    if (!normalizedTtlMs) {
      for (const agentId of normalizedIds) {
        this.presenceLeases.delete(agentId);
      }
      return;
    }

    const nextExpiresAt = this.now() + normalizedTtlMs;
    const normalizedSource = normalizeText(source);
    for (const agentId of normalizedIds) {
      this.presenceLeases.set(agentId, {
        agentId,
        source: normalizedSource,
        expiresAt: nextExpiresAt,
      });
    }
  }

  publishPresence(request = {}) {
    const store = this.ensureStore();
    const nowIso = new Date(this.now()).toISOString();
    const normalizedRequest = isObject(request) ? request : {};
    const agents = normalizePresenceAgents(collectPresenceAgents(normalizedRequest), nowIso);
    const activeAgentId = normalizeAgentId(normalizedRequest.activeAgentId);
    const activateIfUnset = Object.prototype.hasOwnProperty.call(normalizedRequest, 'activateIfUnset')
      ? Boolean(normalizedRequest.activateIfUnset)
      : true;

    const result = store.upsertAgents(
      {
        revision: normalizedRequest.revision,
        agents,
        ...(activeAgentId ? { activeAgentId } : {}),
      },
      {
        ...(activeAgentId ? { activeAgentId } : {}),
        activateIfUnset,
        revision: normalizedRequest.revision,
      },
    );

    this.syncLease(
      agents.map((agent) => agent.agentId),
      normalizedRequest.ttlMs,
      normalizedRequest.source || normalizedRequest.sourceId,
    );

    return result;
  }

  heartbeat(request = {}) {
    const store = this.ensureStore();
    const normalizedRequest = isObject(request) ? request : {};
    const nowIso = new Date(this.now()).toISOString();
    const agentIds = collectPresenceAgentIds(normalizedRequest);
    if (!agentIds.length) {
      return {
        ok: true,
        state: store.getState(),
        changed: false,
      };
    }

    this.syncLease(
      agentIds,
      normalizedRequest.ttlMs,
      normalizedRequest.source || normalizedRequest.sourceId,
    );

    return store.update({
      revision: normalizedRequest.revision,
      agents: agentIds.map((agentId) => ({
        id: agentId,
        updatedAt: nowIso,
      })),
    });
  }

  removePresence(request = {}) {
    const store = this.ensureStore();
    const normalizedRequest = isObject(request) ? request : {};
    const agentIds = collectPresenceAgentIds(normalizedRequest);
    for (const agentId of agentIds) {
      this.presenceLeases.delete(agentId);
    }

    return store.update({
      revision: normalizedRequest.revision,
      ...(normalizeAgentId(normalizedRequest.activeAgentId) ? { activeAgentId: normalizedRequest.activeAgentId } : {}),
      removeAgentIds: agentIds,
    });
  }

  setActiveAgent(request = {}, options = {}) {
    const store = this.ensureStore();
    const normalizedRequest = isObject(request) ? request : {};
    const agentId = normalizeAgentId(
      normalizedRequest.agentId
      || normalizedRequest.activeAgentId
      || normalizedRequest.id
      || request,
    );
    const normalizedOptions = isObject(options) ? options : {};
    return store.setActiveAgent(agentId, {
      revision: normalizedRequest.revision || normalizedOptions.revision,
    });
  }

  cleanupExpiredPresence() {
    const store = this.ensureStore();
    const now = this.now();
    const expiredAgentIds = [];

    for (const [agentId, lease] of this.presenceLeases.entries()) {
      if (!lease || !Number.isFinite(lease.expiresAt) || lease.expiresAt > now) {
        continue;
      }

      expiredAgentIds.push(agentId);
      this.presenceLeases.delete(agentId);
    }

    if (!expiredAgentIds.length) {
      return {
        ok: true,
        state: store.getState(),
        changed: false,
      };
    }

    return store.update({
      removeAgentIds: expiredAgentIds,
    });
  }

  applyConversationEvent(event = {}) {
    const normalizedEvent = isObject(event) ? event : {};
    if (normalizeText(normalizedEvent.channel).toLowerCase() !== 'office') {
      return {
        ok: false,
        reason: 'unsupported_office_channel',
      };
    }

    const type = normalizeText(normalizedEvent.type).toLowerCase();
    const payload = isObject(normalizedEvent.payload) ? normalizedEvent.payload : {};

    if (
      type === 'presence'
      || type === 'presence-upsert'
      || type === 'agent-presence'
      || type === 'agent:presence'
      || type === 'agents-upsert'
      || type === 'agents:upsert'
    ) {
      return this.publishPresence(payload);
    }

    if (
      type === 'heartbeat'
      || type === 'presence-heartbeat'
      || type === 'agent-heartbeat'
      || type === 'agent:heartbeat'
    ) {
      return this.heartbeat(payload);
    }

    if (
      type === 'remove'
      || type === 'remove-agent'
      || type === 'agent-remove'
      || type === 'agent:remove'
      || type === 'presence-remove'
      || type === 'agent-delete'
      || type === 'agent:delete'
    ) {
      return this.removePresence(payload);
    }

    if (
      type === 'active-agent'
      || type === 'active-agent-set'
      || type === 'set-active-agent'
    ) {
      return this.setActiveAgent(payload);
    }

    return this.officeStateStore?.applyConversationEvent?.(normalizedEvent) || {
      ok: false,
      reason: 'unsupported_office_event',
    };
  }
}

function createOfficePresenceProducer(options = {}) {
  return new OfficePresenceProducer(options);
}

module.exports = {
  OfficePresenceProducer,
  createOfficePresenceProducer,
};
