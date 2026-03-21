const DEFAULT_VALUE_DEFINITIONS = {
  mood: {
    baseline: 0,
    min: -100,
    max: 100,
    turnCap: 8,
    cooldownMs: 5_000,
    repeatDecay: 0.5,
    minConfidence: 0.2,
  },
  affinity: {
    baseline: 100,
    min: 0,
    max: 1_000,
    turnCap: 3,
    cooldownMs: 30_000,
    repeatDecay: 0.35,
    minConfidence: 0.2,
  },
};

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

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function cloneValue(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to JSON cloning.
    }
  }

  return JSON.parse(JSON.stringify(value));
}

function cloneStats(stats = {}) {
  const cloned = {};
  for (const [stat, definition] of Object.entries(DEFAULT_VALUE_DEFINITIONS)) {
    const source = isObject(stats?.[stat]) ? stats[stat] : {};
    cloned[stat] = {
      value: clamp(normalizeNumber(source.value, definition.baseline), definition.min, definition.max),
      baseline: normalizeNumber(source.baseline, definition.baseline),
      min: normalizeNumber(source.min, definition.min),
      max: normalizeNumber(source.max, definition.max),
      updatedAt: normalizeText(source.updatedAt),
      version: Math.max(0, normalizeInteger(source.version, 0)),
    };
  }

  return cloned;
}

function normalizeStatDefinition(stat, definition = {}) {
  const source = isObject(definition) ? definition : {};
  const baseline = normalizeNumber(source.baseline, 0);
  const min = normalizeNumber(source.min, baseline);
  const max = normalizeNumber(source.max, baseline);
  const turnCap = Math.max(1, Math.abs(normalizeInteger(source.turnCap, 1)));

  return {
    stat,
    baseline,
    min: Math.min(min, max),
    max: Math.max(min, max),
    turnCap,
    cooldownMs: Math.max(0, normalizeInteger(source.cooldownMs, 0)),
    repeatDecay: clamp(normalizeNumber(source.repeatDecay, 0.5), 0, 1),
    minConfidence: clamp(normalizeNumber(source.minConfidence, 0.2), 0, 1),
  };
}

function normalizeDefinitions(input = {}) {
  const source = isObject(input) ? input : {};
  const merged = {
    ...DEFAULT_VALUE_DEFINITIONS,
    ...source,
  };
  const definitions = {};

  for (const [stat, definition] of Object.entries(merged)) {
    definitions[stat] = normalizeStatDefinition(stat, definition);
  }

  return definitions;
}

function normalizeStatUpdate(input = {}) {
  const source = isObject(input) ? input : {};
  const stat = normalizeText(source.stat || source.key || source.name);
  const delta = normalizeInteger(source.delta, 0);
  const reason = normalizeText(source.reason);
  const confidence = clamp(normalizeNumber(source.confidence, 1), 0, 1);
  const tags = Array.isArray(source.tags)
    ? [...new Set(source.tags.map((tag) => normalizeText(tag)).filter(Boolean))]
    : [];

  return {
    stat,
    delta,
    reason,
    confidence,
    tags,
  };
}

function normalizeCurrentStatState(source = {}, definition) {
  const statState = isObject(source) ? source : {};
  const value = clamp(normalizeNumber(statState.value, definition.baseline), definition.min, definition.max);

  return {
    value,
    baseline: normalizeNumber(statState.baseline, definition.baseline),
    min: normalizeNumber(statState.min, definition.min),
    max: normalizeNumber(statState.max, definition.max),
    updatedAt: normalizeText(statState.updatedAt),
    version: Math.max(0, normalizeInteger(statState.version, 0)),
  };
}

function createValueRuleEngine({ definitions } = {}) {
  const statDefinitions = normalizeDefinitions(definitions);

  const getStatDefinition = (stat) => statDefinitions[stat] || null;

  const evaluateStatUpdates = ({
    entity = {},
    statUpdates = [],
    context = {},
    history = [],
    now = Date.now(),
  } = {}) => {
    const sourceEntity = isObject(entity) ? entity : {};
    const normalizedUpdates = (Array.isArray(statUpdates) ? statUpdates : [])
      .map((item) => normalizeStatUpdate(item))
      .filter((item) => item.stat);
    const appliedUpdates = [];
    const rejectedUpdates = [];
    const seenTurnStatKeys = new Set();
    const currentStats = isObject(sourceEntity.stats) ? sourceEntity.stats : {};
    const agentId = normalizeText(context.agentId || sourceEntity.agentId);
    const characterId = normalizeText(context.characterId || sourceEntity.characterId);
    const turnId = normalizeText(context.turnId || context.streamId);
    const source = normalizeText(context.source || sourceEntity.source || 'proposal');

    for (const update of normalizedUpdates) {
      const turnKey = `${turnId || 'turn'}:${update.stat}`;
      if (seenTurnStatKeys.has(turnKey)) {
        rejectedUpdates.push({
          ...update,
          ruleNotes: ['duplicate_in_turn'],
        });
        continue;
      }
      seenTurnStatKeys.add(turnKey);

      const definition = getStatDefinition(update.stat);
      if (!definition) {
        rejectedUpdates.push({
          ...update,
          ruleNotes: ['unknown_stat'],
        });
        continue;
      }

      if (update.confidence < definition.minConfidence) {
        rejectedUpdates.push({
          ...update,
          ruleNotes: ['low_confidence'],
        });
        continue;
      }

      const currentStat = normalizeCurrentStatState(currentStats[update.stat], definition);
      let proposalDelta = clamp(update.delta, -definition.turnCap, definition.turnCap);
      const notes = [];

      if (proposalDelta !== update.delta) {
        notes.push('turn_cap');
      }

      if (definition.cooldownMs > 0 && Array.isArray(history)) {
        for (let index = history.length - 1; index >= 0; index -= 1) {
          const entry = history[index];
          if (!isObject(entry)) {
            continue;
          }

          if (normalizeText(entry.agentId || entry.entityAgentId) !== agentId) {
            continue;
          }
          if (normalizeText(entry.characterId || entry.entityCharacterId) !== characterId) {
            continue;
          }
          if (normalizeText(entry.stat) !== update.stat) {
            continue;
          }

          const appliedAt = Date.parse(entry.appliedAt || entry.createdAt || entry.updatedAt || '');
          if (!Number.isFinite(appliedAt)) {
            continue;
          }

          if (now - appliedAt < definition.cooldownMs) {
            proposalDelta = Math.round(proposalDelta * definition.repeatDecay);
            notes.push('cooldown_decay');
          }
          break;
        }
      }

      if (proposalDelta === 0) {
        rejectedUpdates.push({
          ...update,
          ruleNotes: notes.length ? notes : ['no_effect'],
        });
        continue;
      }

      const valueBefore = currentStat.value;
      const valueAfter = clamp(valueBefore + proposalDelta, definition.min, definition.max);
      const appliedDelta = valueAfter - valueBefore;

      if (appliedDelta === 0) {
        rejectedUpdates.push({
          ...update,
          ruleNotes: [...notes, 'value_clamped'],
        });
        continue;
      }

      if (appliedDelta !== proposalDelta) {
        notes.push('value_clamped');
      }

      appliedUpdates.push({
        stat: update.stat,
        proposedDelta: update.delta,
        appliedDelta,
        valueBefore,
        valueAfter,
        reason: update.reason,
        confidence: update.confidence,
        tags: update.tags,
        ruleNotes: notes,
        definition,
      });
    }

    return {
      ok: true,
      appliedUpdates,
      rejectedUpdates,
      hasChanges: appliedUpdates.length > 0,
      definitions: statDefinitions,
      context: {
        agentId,
        characterId,
        turnId,
        source,
      },
    };
  };

  return {
    definitions: statDefinitions,
    getStatDefinition,
    evaluateStatUpdates,
    normalizeStatUpdate,
    cloneStats,
    cloneValue,
  };
}

module.exports = {
  DEFAULT_VALUE_DEFINITIONS,
  createValueRuleEngine,
  normalizeStatUpdate,
  cloneStats,
  cloneValue,
};
