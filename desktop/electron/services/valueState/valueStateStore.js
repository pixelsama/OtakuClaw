const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const { createValueRuleEngine, cloneStats } = require('./valueRuleEngine');

const STORE_FILE_NAME = 'value-state.json';
const DEFAULT_AGENT_ID = 'main';

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function normalizeAgentId(value) {
  return normalizeText(value, DEFAULT_AGENT_ID);
}

function normalizeCharacterId(value, fallbackAgentId = DEFAULT_AGENT_ID) {
  return normalizeText(value, fallbackAgentId);
}

function normalizeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildEntityKey(agentId, characterId) {
  return `${normalizeAgentId(agentId)}::${normalizeCharacterId(characterId, agentId)}`;
}

function normalizeEntity(entity = {}, { agentId = DEFAULT_AGENT_ID, characterId = DEFAULT_AGENT_ID } = {}) {
  const safeAgentId = normalizeAgentId(entity.agentId || agentId);
  const safeCharacterId = normalizeCharacterId(entity.characterId || characterId, safeAgentId);
  return {
    agentId: safeAgentId,
    characterId: safeCharacterId,
    updatedAt: normalizeText(entity.updatedAt),
    routeKey: normalizeText(entity.routeKey),
    sessionId: normalizeText(entity.sessionId),
    turnId: normalizeText(entity.turnId),
    version: normalizeInteger(entity.version, 1),
    stats: cloneStats(entity.stats),
  };
}

class ValueStateStore {
  constructor({
    app = null,
    storeFilePath = '',
    fileName = STORE_FILE_NAME,
  } = {}) {
    this.app = app || null;
    this.storeFilePath = normalizeText(storeFilePath);
    this.fileName = normalizeText(fileName, STORE_FILE_NAME);
    this.revision = 0;
    this.entities = new Map();
    this.history = [];
    this.listeners = new Set();
    this.ruleEngine = createValueRuleEngine();
    this.persistChain = Promise.resolve();
  }

  resolveStoreFilePath() {
    if (this.storeFilePath) {
      return this.storeFilePath;
    }

    const userDataDir =
      this.app && typeof this.app.getPath === 'function'
        ? this.app.getPath('userData')
        : process.cwd();
    return path.join(userDataDir, this.fileName);
  }

  async init() {
    try {
      const raw = await fs.readFile(this.resolveStoreFilePath(), 'utf8');
      const parsed = JSON.parse(raw);
      const entities = Array.isArray(parsed.entities) ? parsed.entities : [];
      this.entities = new Map(
        entities.map((entity) => {
          const normalized = normalizeEntity(entity, {
            agentId: entity?.agentId || DEFAULT_AGENT_ID,
            characterId: entity?.characterId || entity?.agentId || DEFAULT_AGENT_ID,
          });
          return [buildEntityKey(normalized.agentId, normalized.characterId), normalized];
        }),
      );
      this.history = Array.isArray(parsed.history) ? parsed.history : [];
      this.revision = normalizeInteger(parsed.revision, this.history.length || 0);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to load value state:', error);
      }
    }
  }

  persistSoon() {
    const storeFilePath = this.resolveStoreFilePath();
    const payload = JSON.stringify(this.getState(), null, 2);
    this.persistChain = this.persistChain
      .catch(() => {})
      .then(() => fs.mkdir(path.dirname(storeFilePath), { recursive: true }))
      .then(() => fs.writeFile(storeFilePath, payload, 'utf8'))
      .catch((error) => {
        console.warn('Failed to persist value state:', error);
      });

    return this.persistChain;
  }

  waitForPendingPersistence() {
    return this.persistChain.catch(() => {});
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitChange(mutation = {}) {
    const state = this.getState({
      agentId: mutation.agentId || '',
      characterId: mutation.characterId || '',
    });
    for (const listener of [...this.listeners]) {
      try {
        listener(state, mutation);
      } catch (error) {
        console.warn('Value state listener failed:', error);
      }
    }
  }

  listEntities() {
    return [...this.entities.values()].map((entity) => ({
      ...entity,
      stats: cloneStats(entity.stats),
    }));
  }

  getEntity({ agentId = DEFAULT_AGENT_ID, characterId = '' } = {}) {
    const safeAgentId = normalizeAgentId(agentId);
    const safeCharacterId = normalizeCharacterId(characterId, safeAgentId);
    const key = buildEntityKey(safeAgentId, safeCharacterId);
    const entity = this.entities.get(key);
    if (entity) {
      return normalizeEntity(entity, {
        agentId: safeAgentId,
        characterId: safeCharacterId,
      });
    }

    return normalizeEntity({}, {
      agentId: safeAgentId,
      characterId: safeCharacterId,
    });
  }

  getState(request = {}) {
    const entity = this.getEntity(request);
    const lastEvent = [...this.history]
      .reverse()
      .find((event) => (
        normalizeAgentId(event.agentId) === entity.agentId
        && normalizeCharacterId(event.characterId, event.agentId) === entity.characterId
      )) || null;
    return {
      revision: this.revision,
      updatedAt: entity.updatedAt,
      agentId: entity.agentId,
      characterId: entity.characterId,
      routeKey: entity.routeKey,
      sessionId: entity.sessionId,
      turnId: entity.turnId,
      stats: cloneStats(entity.stats),
      lastEvent,
      entities: this.listEntities(),
      history: [...this.history],
    };
  }

  upsertEntity(request = {}) {
    const entity = normalizeEntity(request, {
      agentId: request?.agentId || DEFAULT_AGENT_ID,
      characterId: request?.characterId || request?.agentId || DEFAULT_AGENT_ID,
    });
    const key = buildEntityKey(entity.agentId, entity.characterId);
    const current = this.entities.get(key);
    const nextEntity = {
      ...(current || normalizeEntity({}, entity)),
      ...entity,
      stats: cloneStats(entity.stats || current?.stats),
      version: normalizeInteger(current?.version, 0) + 1,
      updatedAt: entity.updatedAt || new Date().toISOString(),
    };

    this.entities.set(key, nextEntity);
    this.revision += 1;
    this.persistSoon();
    this.emitChange({
      type: 'entity-upserted',
      agentId: nextEntity.agentId,
      characterId: nextEntity.characterId,
      entity: nextEntity,
    });

    return {
      ok: true,
      changed: true,
      state: this.getState({
        agentId: nextEntity.agentId,
        characterId: nextEntity.characterId,
      }),
    };
  }

  applyStatUpdates(request = {}) {
    const agentId = normalizeAgentId(request.agentId);
    const characterId = normalizeCharacterId(request.characterId, agentId);
    const current = this.getEntity({ agentId, characterId });
    const evaluation = this.ruleEngine.evaluateStatUpdates({
      entity: current,
      statUpdates: Array.isArray(request.statUpdates) ? request.statUpdates : [],
      context: {
        agentId,
        characterId,
        turnId: request.turnId,
        streamId: request.streamId,
        source: request.source,
      },
      history: this.history,
    });

    const nextStats = cloneStats(current.stats);
    for (const update of evaluation.appliedUpdates) {
      nextStats[update.stat] = {
        ...nextStats[update.stat],
        value: update.valueAfter,
        updatedAt: new Date().toISOString(),
        version: normalizeInteger(nextStats[update.stat]?.version, 0) + 1,
      };
    }

    const nextEntity = {
      ...normalizeEntity(current, { agentId, characterId }),
      routeKey: normalizeText(request.routeKey),
      sessionId: normalizeText(request.sessionId),
      turnId: normalizeText(request.turnId),
      updatedAt: new Date().toISOString(),
      version: normalizeInteger(current.version, 0) + (evaluation.hasChanges ? 1 : 0),
      stats: nextStats,
    };
    const entityKey = buildEntityKey(agentId, characterId);
    this.entities.set(entityKey, nextEntity);
    this.revision += 1;

    const appliedUpdates = evaluation.appliedUpdates.map((item) => ({
      stat: item.stat,
      requestedDelta: item.proposedDelta,
      appliedDelta: item.appliedDelta,
      reason: item.reason,
      confidence: item.confidence,
      tags: item.tags,
      ruleNotes: item.ruleNotes,
    }));

    const timestamp = new Date().toISOString();
    const historyEvents = appliedUpdates.map((update) => ({
      id: randomUUID(),
      channel: 'value',
      type: 'stat-updated',
      timestamp,
      createdAt: timestamp,
      appliedAt: timestamp,
      agentId,
      characterId,
      routeKey: normalizeText(request.routeKey),
      sessionId: normalizeText(request.sessionId),
      turnId: normalizeText(request.turnId),
      source: normalizeText(request.source, 'system'),
      stat: update.stat,
      payload: {
        agentId,
        characterId,
        routeKey: normalizeText(request.routeKey),
        sessionId: normalizeText(request.sessionId),
        turnId: normalizeText(request.turnId),
        stats: cloneStats(nextEntity.stats),
        statUpdates: Array.isArray(request.statUpdates) ? request.statUpdates : [],
        appliedUpdates,
        rejectedUpdates: evaluation.rejectedUpdates,
      },
      proposal: {
        statUpdates: Array.isArray(request.statUpdates) ? request.statUpdates : [],
      },
      applied: {
        statUpdates: appliedUpdates,
      },
      rejected: evaluation.rejectedUpdates,
      result: {
        appliedUpdates,
      },
    }));
    this.history.push(...historyEvents);
    this.history = this.history.slice(-500);

    this.persistSoon();
    this.emitChange({
      type: 'stat-updated',
      agentId,
      characterId,
      event: historyEvents[historyEvents.length - 1] || null,
    });

    return {
      ok: true,
      changed: evaluation.hasChanges,
      state: this.getState({ agentId, characterId }),
      result: {
        appliedUpdates,
        rejectedUpdates: evaluation.rejectedUpdates,
      },
    };
  }
}

function createValueStateStore(options = {}) {
  return new ValueStateStore(options);
}

module.exports = {
  ValueStateStore,
  createValueStateStore,
};
