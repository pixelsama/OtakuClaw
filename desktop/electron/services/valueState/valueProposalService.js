function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function normalizeStatUpdates(input = []) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      stat: normalizeText(item.stat).toLowerCase(),
      delta: Number.isFinite(Number(item.delta)) ? Math.round(Number(item.delta)) : 0,
      reason: normalizeText(item.reason),
      confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 1,
      tags: Array.isArray(item.tags)
        ? item.tags.map((tag) => normalizeText(tag).toLowerCase()).filter(Boolean)
        : [],
    }))
    .filter((item) => item.stat);
}

function buildInteractionStatUpdates(actionType = '') {
  const normalizedAction = normalizeText(actionType).toLowerCase();
  if (normalizedAction === 'feed') {
    return normalizeStatUpdates([
      {
        stat: 'mood',
        delta: 4,
        reason: 'Immersive feed interaction succeeded.',
        confidence: 1,
        tags: ['feed', 'care'],
      },
      {
        stat: 'affinity',
        delta: 2,
        reason: 'Repeated care improves affinity.',
        confidence: 0.9,
        tags: ['feed', 'trust'],
      },
    ]);
  }

  if (normalizedAction === 'interaction') {
    return normalizeStatUpdates([
      {
        stat: 'mood',
        delta: 2,
        reason: 'Positive immersive interaction action.',
        confidence: 0.95,
        tags: ['interaction', 'play'],
      },
      {
        stat: 'affinity',
        delta: 1,
        reason: 'Small positive interaction improves affinity.',
        confidence: 0.8,
        tags: ['interaction', 'trust'],
      },
    ]);
  }

  return [];
}

class ValueProposalService {
  constructor({ valueStateStore } = {}) {
    this.valueStateStore = valueStateStore || null;
  }

  requireStore() {
    if (!this.valueStateStore) {
      throw new Error('value_state_store_unavailable');
    }

    return this.valueStateStore;
  }

  applyProposal(request = {}) {
    const store = this.requireStore();
    const statUpdates = normalizeStatUpdates(request.statUpdates || request.stat_updates);
    return store.applyStatUpdates({
      ...request,
      statUpdates,
      source: normalizeText(request.source, 'proposal'),
    });
  }

  applyConversationEvent(event = {}) {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    const statUpdates = normalizeStatUpdates(
      payload.statUpdates
      || payload.stat_updates
      || payload.proposal?.statUpdates
      || payload.proposal?.stat_updates,
    );
    if (!statUpdates.length) {
      return {
        ok: true,
        changed: false,
        reason: 'no_stat_updates',
        state: this.requireStore().getState({
          agentId: payload.agentId || event.agentId || 'main',
          characterId: payload.characterId || event.characterId || payload.agentId || event.agentId || 'main',
        }),
      };
    }

    return this.applyProposal({
      agentId: payload.agentId || event.agentId || 'main',
      characterId: payload.characterId || event.characterId || payload.agentId || event.agentId || 'main',
      routeKey: payload.routeKey || event.routeKey || '',
      sessionId: payload.sessionId || event.sessionId || '',
      turnId: payload.turnId || event.turnId || event.streamId || '',
      source: normalizeText(event.channel || payload.source, 'chat'),
      statUpdates,
    });
  }

  applyInteraction(request = {}) {
    const statUpdates = buildInteractionStatUpdates(request.actionType || request.action || '');
    if (!statUpdates.length) {
      return {
        ok: false,
        error: {
          code: 'value_interaction_unsupported',
          message: 'Unsupported interaction action.',
        },
      };
    }

    return this.applyProposal({
      agentId: request.agentId || 'main',
      characterId: request.characterId || request.agentId || 'main',
      routeKey: request.routeKey || '',
      sessionId: request.sessionId || '',
      turnId: request.turnId || '',
      source: 'interaction',
      statUpdates,
    });
  }
}

function createValueProposalService(options = {}) {
  return new ValueProposalService(options);
}

module.exports = {
  ValueProposalService,
  createValueProposalService,
};
