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

function collectAgentRemovalIds(input = {}) {
  const source = isObject(input) ? input : {};
  const removalIds = new Set();
  const addRemovalId = (value) => {
    const id = normalizeText(value);
    if (id) {
      removalIds.add(id);
    }
  };

  if (Object.prototype.hasOwnProperty.call(source, 'removeAgentId')) {
    addRemovalId(source.removeAgentId);
  }

  if (Array.isArray(source.removeAgentIds)) {
    for (const value of source.removeAgentIds) {
      addRemovalId(value);
    }
  }

  if (isObject(source.removeAgent)) {
    addRemovalId(source.removeAgent.id || source.removeAgent.agentId);
  }

  if (Array.isArray(source.removedAgents)) {
    for (const item of source.removedAgents) {
      if (isObject(item)) {
        addRemovalId(item.id || item.agentId);
      }
    }
  }

  return Array.from(removalIds.values());
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

function mergeAgentList(currentAgents = [], incomingAgents = [], { allowAdd = true } = {}) {
  let agents = Array.isArray(currentAgents) ? [...currentAgents] : [];
  let changed = false;

  for (const item of Array.isArray(incomingAgents) ? incomingAgents : []) {
    const agent = normalizeAgent(item);
    if (!agent) {
      continue;
    }

    const index = agents.findIndex((candidate) => candidate.id === agent.id);
    if (index === -1) {
      if (!allowAdd) {
        continue;
      }

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

  return {
    agents,
    changed,
  };
}

function removeAgentList(currentAgents = [], removalIds = []) {
  const removalIdSet = new Set(
    (Array.isArray(removalIds) ? removalIds : [])
      .map((value) => normalizeText(value))
      .filter(Boolean),
  );

  if (removalIdSet.size === 0) {
    return {
      agents: Array.isArray(currentAgents) ? [...currentAgents] : [],
      changed: false,
      removedIds: [],
    };
  }

  const nextAgents = [];
  const removedIds = [];
  for (const agent of Array.isArray(currentAgents) ? currentAgents : []) {
    if (removalIdSet.has(agent.id)) {
      removedIds.push(agent.id);
      continue;
    }

    nextAgents.push(agent);
  }

  return {
    agents: nextAgents,
    changed: removedIds.length > 0,
    removedIds,
  };
}

function resolveActiveAgentId({
  currentActiveAgentId = '',
  explicitActiveAgentId = '',
  hasExplicitActiveAgentId = false,
  nextAgents = [],
  activateIfUnset = true,
} = {}) {
  if (hasExplicitActiveAgentId) {
    return normalizeText(explicitActiveAgentId);
  }

  const normalizedCurrentActiveAgentId = normalizeText(currentActiveAgentId);
  if (normalizedCurrentActiveAgentId) {
    return normalizedCurrentActiveAgentId;
  }

  if (!activateIfUnset) {
    return '';
  }

  return normalizeText(nextAgents[0]?.id || nextAgents[0]?.agentId);
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

  upsertAgents(input = {}, options = {}) {
    const source = isObject(input) ? input : {};
    const agentItems = collectAgentItems(input);
    const topLevelPatch = normalizeTopLevelPatch(source);
    const normalizedOptions = isObject(options) ? options : {};
    const hasExplicitActiveAgentId =
      Object.prototype.hasOwnProperty.call(normalizedOptions, 'activeAgentId')
      || Object.prototype.hasOwnProperty.call(topLevelPatch, 'activeAgentId');
    const explicitActiveAgentId = Object.prototype.hasOwnProperty.call(normalizedOptions, 'activeAgentId')
      ? normalizedOptions.activeAgentId
      : topLevelPatch.activeAgentId;
    const activateIfUnset =
      Object.prototype.hasOwnProperty.call(normalizedOptions, 'activateIfUnset')
        ? Boolean(normalizedOptions.activateIfUnset)
        : true;

    const merged = mergeAgentList(this.state.agents, agentItems, { allowAdd: true });
    const nextActiveAgentId = resolveActiveAgentId({
      currentActiveAgentId: this.state.activeAgentId,
      explicitActiveAgentId,
      hasExplicitActiveAgentId,
      nextAgents: merged.agents,
      activateIfUnset,
    });
    let changed = merged.changed;
    if (nextActiveAgentId !== this.state.activeAgentId) {
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
      revision: this.nextRevision(
        Object.prototype.hasOwnProperty.call(normalizedOptions, 'revision')
          ? normalizedOptions.revision
          : topLevelPatch.revision,
      ),
      activeAgentId: nextActiveAgentId,
      agents: merged.agents,
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

  upsert(input = {}) {
    return this.upsertAgents(input);
  }

  setActiveAgent(agentId = '', options = {}) {
    const nextActiveAgentId = normalizeText(agentId);
    const normalizedOptions = isObject(options) ? options : {};

    if (nextActiveAgentId === this.state.activeAgentId) {
      return {
        ok: true,
        state: this.getState(),
        changed: false,
      };
    }

    this.state = normalizeState({
      revision: this.nextRevision(normalizedOptions.revision),
      activeAgentId: nextActiveAgentId,
      agents: this.state.agents,
    });

    const snapshot = this.getState();
    this.emitChange({
      type: 'active-agent',
      state: snapshot,
    });

    return {
      ok: true,
      state: snapshot,
      changed: true,
    };
  }

  removeAgent(agentId = '', options = {}) {
    const removalId = normalizeText(agentId);
    if (!removalId) {
      return {
        ok: true,
        state: this.getState(),
        changed: false,
      };
    }

    const normalizedOptions = isObject(options) ? options : {};
    const removed = removeAgentList(this.state.agents, [removalId]);
    if (!removed.changed) {
      return {
        ok: true,
        state: this.getState(),
        changed: false,
      };
    }

    const nextActiveAgentId = resolveActiveAgentId({
      currentActiveAgentId: this.state.activeAgentId === removalId ? '' : this.state.activeAgentId,
      explicitActiveAgentId: Object.prototype.hasOwnProperty.call(normalizedOptions, 'activeAgentId')
        ? normalizedOptions.activeAgentId
        : '',
      hasExplicitActiveAgentId: Object.prototype.hasOwnProperty.call(normalizedOptions, 'activeAgentId'),
      nextAgents: removed.agents,
      activateIfUnset: Object.prototype.hasOwnProperty.call(normalizedOptions, 'activateIfUnset')
        ? Boolean(normalizedOptions.activateIfUnset)
        : true,
    });

    this.state = normalizeState({
      revision: this.nextRevision(normalizedOptions.revision),
      activeAgentId: nextActiveAgentId,
      agents: removed.agents,
    });

    const snapshot = this.getState();
    this.emitChange({
      type: 'agent-remove',
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
    const removalIds = collectAgentRemovalIds(source);
    const removed = removeAgentList(this.state.agents, removalIds);
    let agents = removed.agents;
    let changed = removed.changed;
    const activeWasRemoved = removed.removedIds.includes(this.state.activeAgentId);

    const merged = mergeAgentList(agents, collectAgentItems(source), { allowAdd: false });
    if (merged.changed) {
      changed = true;
    }
    agents = merged.agents;

    if (
      Object.prototype.hasOwnProperty.call(topLevelPatch, 'activeAgentId')
      && topLevelPatch.activeAgentId !== this.state.activeAgentId
    ) {
      changed = true;
    }

    const nextActiveAgentId = Object.prototype.hasOwnProperty.call(topLevelPatch, 'activeAgentId')
      ? topLevelPatch.activeAgentId
      : activeWasRemoved
        ? resolveActiveAgentId({
            currentActiveAgentId: '',
            nextAgents: agents,
            activateIfUnset: true,
          })
        : this.state.activeAgentId;

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
      type: 'update',
      state: snapshot,
    });

    return {
      ok: true,
      state: snapshot,
      changed: true,
    };
  }

  setPresence(input = {}) {
    return this.upsertAgents(input);
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

    if (
      type === 'presence'
      || type === 'presence-upsert'
      || type === 'agent-presence'
      || type === 'agent:presence'
      || type === 'agents-upsert'
      || type === 'agents:upsert'
    ) {
      return this.setPresence(payload);
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

    if (
      type === 'remove'
      || type === 'remove-agent'
      || type === 'agent-remove'
      || type === 'agent:remove'
      || type === 'presence-remove'
      || type === 'agent-delete'
      || type === 'agent:delete'
    ) {
      return this.removeAgent(payload.agentId || payload.id || payload.agent?.id || payload.agent?.agentId, payload);
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
