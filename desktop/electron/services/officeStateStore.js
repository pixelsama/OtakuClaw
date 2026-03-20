const { isDeepStrictEqual } = require('node:util');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRevision(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function cloneValue(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall back to JSON cloning below.
    }
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeAgent(agent = {}) {
  if (!isObject(agent)) {
    return null;
  }

  const id = normalizeText(agent.id || agent.agentId);
  if (!id) {
    return null;
  }

  return {
    ...agent,
    id,
  };
}

function normalizeAgents(input = []) {
  const items = Array.isArray(input) ? input : [];
  const agentsById = new Map();

  for (const item of items) {
    const agent = normalizeAgent(item);
    if (!agent) {
      continue;
    }

    agentsById.set(agent.id, agent);
  }

  return Array.from(agentsById.values());
}

function normalizeState(state = {}) {
  const source = isObject(state) ? state : {};
  return {
    revision: normalizeRevision(source.revision),
    activeAgentId: normalizeText(source.activeAgentId),
    agents: normalizeAgents(source.agents),
  };
}

function collectAgentItems(input = {}) {
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

function normalizeTopLevelPatch(input = {}) {
  const source = isObject(input) ? input : {};
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(source, 'activeAgentId')) {
    patch.activeAgentId = normalizeText(source.activeAgentId);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'revision')) {
    patch.revision = normalizeRevision(source.revision);
  }

  return patch;
}

class OfficeStateStore {
  constructor({ initialState } = {}) {
    this.state = normalizeState(initialState);
    this.listeners = new Set();
  }

  getState() {
    return cloneValue(this.state);
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    this.listeners.add(listener);
    listener(this.getState(), {
      type: 'snapshot',
      state: this.getState(),
    });

    return () => {
      this.listeners.delete(listener);
    };
  }

  nextRevision(requestedRevision = 0) {
    const normalizedRequested = normalizeRevision(requestedRevision);
    if (normalizedRequested > this.state.revision) {
      return normalizedRequested;
    }

    return this.state.revision + 1;
  }

  emitChange(mutation = {}) {
    const snapshot = this.getState();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot, mutation);
      } catch (error) {
        console.warn('Office state listener failed:', error);
      }
    }
  }

  replace(nextState = {}, mutationType = 'replace') {
    const normalized = normalizeState(nextState);
    const candidateRevision = normalizeRevision(nextState?.revision);
    normalized.revision =
      candidateRevision > this.state.revision ? candidateRevision : this.state.revision + 1;

    if (isDeepStrictEqual(this.state, normalized)) {
      return {
        ok: true,
        state: this.getState(),
        changed: false,
      };
    }

    this.state = normalized;
    const snapshot = this.getState();
    this.emitChange({
      type: mutationType,
      state: snapshot,
    });

    return {
      ok: true,
      state: snapshot,
      changed: true,
    };
  }

  upsert(input = {}) {
    const source = isObject(input) ? input : {};
    const agentItems = collectAgentItems(source);
    const topLevelPatch = normalizeTopLevelPatch(source);
    let agents = [...this.state.agents];
    let changed = false;

    for (const item of agentItems) {
      const agent = normalizeAgent(item);
      if (!agent) {
        continue;
      }

      const index = agents.findIndex((candidate) => candidate.id === agent.id);
      if (index === -1) {
        agents = [...agents, agent];
        changed = true;
        continue;
      }

      const merged = normalizeAgent({
        ...agents[index],
        ...agent,
        id: agent.id,
      });

      if (!merged || isDeepStrictEqual(agents[index], merged)) {
        continue;
      }

      agents = [...agents];
      agents[index] = merged;
      changed = true;
    }

    const nextActiveAgentId = Object.prototype.hasOwnProperty.call(topLevelPatch, 'activeAgentId')
      ? topLevelPatch.activeAgentId
      : this.state.activeAgentId;

    if (
      Object.prototype.hasOwnProperty.call(topLevelPatch, 'activeAgentId')
      && nextActiveAgentId !== this.state.activeAgentId
    ) {
      changed = true;
    }

    if (!changed) {
      return {
        ok: true,
        state: this.getState(),
        changed: false,
      };
    }

    this.state = normalizeState({
      revision: this.nextRevision(topLevelPatch.revision),
      activeAgentId: nextActiveAgentId,
      agents,
    });

    const snapshot = this.getState();
    this.emitChange({
      type: 'upsert',
      state: snapshot,
    });

    return {
      ok: true,
      state: snapshot,
      changed: true,
    };
  }

  update(input = {}) {
    const source = isObject(input) ? input : {};
    const topLevelPatch = normalizeTopLevelPatch(source);
    let agents = [...this.state.agents];
    let changed = false;

    if (
      Object.prototype.hasOwnProperty.call(topLevelPatch, 'activeAgentId')
      && topLevelPatch.activeAgentId !== this.state.activeAgentId
    ) {
      changed = true;
    }

    const agentItems = collectAgentItems(source);
    for (const item of agentItems) {
      const patch = normalizeAgent(item);
      if (!patch) {
        continue;
      }

      const index = agents.findIndex((candidate) => candidate.id === patch.id);
      if (index === -1) {
        continue;
      }

      const merged = normalizeAgent({
        ...agents[index],
        ...patch,
        id: patch.id,
      });

      if (!merged || isDeepStrictEqual(agents[index], merged)) {
        continue;
      }

      agents = [...agents];
      agents[index] = merged;
      changed = true;
    }

    if (!changed) {
      return {
        ok: true,
        state: this.getState(),
        changed: false,
      };
    }

    this.state = normalizeState({
      revision: this.nextRevision(topLevelPatch.revision),
      activeAgentId: Object.prototype.hasOwnProperty.call(topLevelPatch, 'activeAgentId')
        ? topLevelPatch.activeAgentId
        : this.state.activeAgentId,
      agents,
    });

    const snapshot = this.getState();
    this.emitChange({
      type: 'update',
      state: snapshot,
    });

    return {
      ok: true,
      state: snapshot,
      changed: true,
    };
  }

  applyConversationEvent(event = {}) {
    if (!isObject(event) || normalizeText(event.channel) !== 'office') {
      return {
        ok: false,
        reason: 'unsupported_channel',
      };
    }

    const type = normalizeText(event.type).toLowerCase();
    const payload = isObject(event.payload) ? event.payload : {};

    if (type === 'state' || type === 'snapshot' || type === 'replace') {
      return this.replace(
        payload.state && isObject(payload.state) ? payload.state : payload,
        type,
      );
    }

    if (type === 'upsert' || type === 'agent-upsert' || type === 'agent:upsert') {
      return this.upsert(payload);
    }

    if (
      type === 'update'
      || type === 'agent-update'
      || type === 'agent:update'
      || type === 'active-agent'
      || type === 'active-agent-set'
      || type === 'set-active-agent'
    ) {
      if (
        type === 'active-agent'
        || type === 'active-agent-set'
        || type === 'set-active-agent'
      ) {
        return this.update({
          activeAgentId: payload.activeAgentId || payload.agentId || payload.id || '',
          revision: payload.revision,
        });
      }

      return this.update(payload);
    }

    return {
      ok: false,
      reason: 'unsupported_office_event',
    };
  }
}

function createOfficeStateStore(options = {}) {
  return new OfficeStateStore(options);
}

module.exports = {
  OfficeStateStore,
  createOfficeStateStore,
};
