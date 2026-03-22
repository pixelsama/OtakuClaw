const { normalizeMemoryKey, normalizeMemorySnapshot, normalizeText, truncateText } = require('./shortTermMemoryStore');

const DEFAULT_MAX_RECENT_TURNS = 6;
const DEFAULT_MAX_MEMORY_CHARS = 2200;
const DEFAULT_OUTPUT_SCHEMA = Object.freeze({
  reply: 'string',
  needsEscalation: 'boolean',
  reason: 'string',
  confidence: 'number',
  statUpdates: [
    {
      stat: 'mood',
      delta: 0,
      reason: 'string',
    },
  ],
  memoryPatch: {
    summaryHint: 'string',
    tags: ['string'],
    note: 'string',
  },
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fallback to JSON cloning below.
    }
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeMood(input = {}) {
  if (typeof input === 'string') {
    return {
      label: normalizeText(input, 'neutral'),
      score: 0,
      note: '',
    };
  }

  if (!isObject(input)) {
    return {
      label: 'neutral',
      score: 0,
      note: '',
    };
  }

  const score = Number(input.score ?? input.value ?? input.level ?? 0);
  return {
    label: normalizeText(input.label || input.name || input.mood, 'neutral'),
    score: Number.isFinite(score) ? score : 0,
    note: normalizeText(input.note || input.reason || ''),
  };
}

function normalizeAffinity(input = {}) {
  if (typeof input === 'number') {
    return input;
  }

  if (typeof input === 'string' && input.trim()) {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (isObject(input)) {
    const parsed = Number(input.value ?? input.score ?? input.level ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizePersonaContext(input = {}) {
  const source = isObject(input) ? input : {};
  const memorySnapshot = normalizeMemorySnapshot(source.memorySnapshot || source.memory || {});
  const key = normalizeMemoryKey(source);
  const mood = normalizeMood(source.mood || memorySnapshot.state?.mood);
  const affinity = normalizeAffinity(source.affinity ?? memorySnapshot.state?.affinity ?? 0);
  const recentTurns = Array.isArray(source.recentTurns) && source.recentTurns.length > 0
    ? source.recentTurns
    : memorySnapshot.turns;
  const personaName = normalizeText(source.personaName || source.name || source.persona || '', '');
  const personaDescription = normalizeText(
    source.personaDescription || source.description || source.personaPrompt || '',
    '',
  );
  const personaTraits = Array.isArray(source.personaTraits)
    ? source.personaTraits.map((item) => normalizeText(item)).filter(Boolean)
    : [];

  return {
    key,
    userInput: normalizeText(source.userInput || source.input || source.text || ''),
    mood,
    affinity,
    memorySnapshot,
    recentTurns,
    personaName,
    personaDescription,
    personaTraits,
    channel: normalizeText(source.channel || 'chat', 'chat'),
    now: normalizeText(source.now || new Date().toISOString()),
  };
}

function summarizeTurnsForPrompt(turns = [], maxTurns = DEFAULT_MAX_RECENT_TURNS) {
  const items = Array.isArray(turns) ? turns : [];
  const selected = items.slice(-Math.max(1, maxTurns));
  return selected.map((turn) => {
    const role = normalizeText(turn?.role, 'user').toLowerCase();
    const content = truncateText(normalizeText(turn?.content), 320);
    return {
      role: ['assistant', 'system', 'tool', 'user'].includes(role) ? role : 'user',
      content,
      createdAt: normalizeText(turn?.createdAt, ''),
      id: normalizeText(turn?.id, ''),
    };
  });
}

function summarizeMemoryForPrompt(memorySnapshot = {}, options = {}) {
  const snapshot = normalizeMemorySnapshot(memorySnapshot);
  const recentTurns = summarizeTurnsForPrompt(snapshot.turns, options.maxRecentTurns || DEFAULT_MAX_RECENT_TURNS);
  const summaryText = truncateText(snapshot.summary.text, options.maxSummaryChars || DEFAULT_MAX_MEMORY_CHARS);

  return {
    key: snapshot.key,
    state: cloneValue(snapshot.state),
    summary: {
      text: summaryText,
      highlights: Array.isArray(snapshot.summary.highlights)
        ? snapshot.summary.highlights.slice(0, 6)
        : [],
      sourceTurnCount: snapshot.summary.sourceTurnCount,
      sourceCharCount: snapshot.summary.sourceCharCount,
      updatedAt: snapshot.summary.updatedAt,
    },
    recentTurns,
    metadata: cloneValue(snapshot.metadata),
  };
}

function buildOutputSchema() {
  return cloneValue(DEFAULT_OUTPUT_SCHEMA);
}

function buildFastPersonaPrompt(input = {}) {
  const context = normalizePersonaContext(input);
  const memory = summarizeMemoryForPrompt(context.memorySnapshot, input);
  const personaHeader = [
    'You are the fast persona layer for a vtuber companion.',
    'Keep the reply short, warm, in-character, and low latency.',
    'Return JSON only. Do not wrap the answer in markdown or code fences.',
    'If the request needs tools, deeper reasoning, or more memory than the short-term snapshot can support, set needsEscalation to true.',
    'When unsure, prefer a safe escalation over inventing facts.',
  ];

  if (context.personaName) {
    personaHeader.push(`Persona name: ${context.personaName}.`);
  }

  if (context.personaDescription) {
    personaHeader.push(`Persona description: ${context.personaDescription}.`);
  }

  if (context.personaTraits.length > 0) {
    personaHeader.push(`Persona traits: ${context.personaTraits.join(', ')}.`);
  }

  const systemPrompt = personaHeader.join(' ');
  const userContext = {
    agentId: context.key.agentId,
    backend: context.key.backend,
    routeKey: context.key.routeKey,
    sessionId: context.key.sessionId,
    channel: context.channel,
    mood: context.mood,
    affinity: context.affinity,
    userInput: context.userInput,
    memory,
    outputSchema: buildOutputSchema(),
  };

  const userPrompt = [
    'Use the following context to produce the next turn.',
    'Context JSON:',
    JSON.stringify(userContext, null, 2),
  ].join('\n');

  return {
    context,
    memory,
    systemPrompt,
    userPrompt,
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    prompt: `${systemPrompt}\n\n${userPrompt}`,
    outputSchema: buildOutputSchema(),
  };
}

module.exports = {
  DEFAULT_MAX_MEMORY_CHARS,
  DEFAULT_MAX_RECENT_TURNS,
  DEFAULT_OUTPUT_SCHEMA,
  buildFastPersonaPrompt,
  buildOutputSchema,
  normalizeAffinity,
  normalizeMood,
  normalizePersonaContext,
  summarizeMemoryForPrompt,
  summarizeTurnsForPrompt,
};
