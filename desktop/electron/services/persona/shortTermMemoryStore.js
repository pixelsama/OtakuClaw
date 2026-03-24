const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const MEMORY_VERSION = 1;
const DEFAULT_MAX_TURNS = 12;
const DEFAULT_KEEP_TURNS = 4;
const DEFAULT_MAX_CHARS = 6000;
const DEFAULT_SUMMARY_MAX_CHARS = 1200;
const DEFAULT_STATE = Object.freeze({
  mood: 'neutral',
  affinity: 0,
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

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

function normalizeBackendName(value) {
  const normalized = normalizeText(value, 'nanobot').toLowerCase();
  if (normalized === 'claude code' || normalized === 'claudecode' || normalized === 'claude_code') {
    return 'claude-code';
  }
  if (normalized === 'openclaw') {
    return 'nanobot';
  }
  return normalized || 'nanobot';
}

function normalizeSessionId(value) {
  return normalizeText(value, 'default');
}

function normalizeMemoryKey(input = {}) {
  const source = isObject(input) ? input : {};
  const agentId = normalizeText(source.agentId, 'main');
  const backend = normalizeBackendName(source.backend);
  const routeKey = normalizeText(source.routeKey, `${agentId}:${backend}`);
  const sessionId = normalizeSessionId(source.sessionId);

  return {
    agentId,
    backend,
    routeKey,
    sessionId,
  };
}

function safePathSegment(value, fallback = 'default') {
  const normalized = normalizeText(value, fallback);
  const slug = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');

  if (slug && slug === normalized && slug.length <= 64) {
    return slug;
  }

  const base = slug.slice(0, 40) || fallback;
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  return `${base}__${hash}`;
}

function resolveMemoryFilePath(baseDir, keyInput = {}) {
  const key = normalizeMemoryKey(keyInput);
  return path.join(
    baseDir,
    'persona-short-term',
    safePathSegment(key.agentId, 'main'),
    safePathSegment(key.backend, 'nanobot'),
    safePathSegment(key.routeKey, 'default'),
    `${safePathSegment(key.sessionId, 'default')}.json`,
  );
}

function normalizeState(input = {}) {
  if (!isObject(input)) {
    return { ...DEFAULT_STATE };
  }

  const state = {
    ...DEFAULT_STATE,
    ...cloneValue(input),
  };

  if (!Object.prototype.hasOwnProperty.call(state, 'mood')) {
    state.mood = DEFAULT_STATE.mood;
  } else {
    state.mood = normalizeText(state.mood, DEFAULT_STATE.mood);
  }

  const affinity = Number(state.affinity);
  state.affinity = Number.isFinite(affinity) ? affinity : DEFAULT_STATE.affinity;

  return state;
}

function normalizeSummary(input = {}) {
  const source = isObject(input) ? input : {};
  const highlights = Array.isArray(source.highlights)
    ? source.highlights.map((item) => normalizeText(item)).filter(Boolean)
    : [];

  return {
    text: normalizeText(source.text),
    highlights: Array.from(new Set(highlights)).slice(0, 8),
    sourceTurnCount: Math.max(0, Number.parseInt(source.sourceTurnCount, 10) || 0),
    sourceCharCount: Math.max(0, Number.parseInt(source.sourceCharCount, 10) || 0),
    updatedAt: normalizeText(source.updatedAt),
    compacted: Boolean(source.compacted),
  };
}

function normalizeTurn(input = {}, index = 0) {
  const source = isObject(input) ? input : {};
  const role = normalizeText(source.role, 'user').toLowerCase();
  const content = normalizeText(source.content);
  const tags = Array.isArray(source.tags)
    ? Array.from(new Set(source.tags.map((tag) => normalizeText(tag)).filter(Boolean))).slice(0, 8)
    : [];
  const metadata = isObject(source.metadata) ? cloneValue(source.metadata) : {};
  const createdAt = normalizeText(source.createdAt, new Date().toISOString());
  const idSeed = `${createdAt}|${role}|${content}|${index}`;
  const id = normalizeText(source.id, crypto.createHash('sha1').update(idSeed).digest('hex').slice(0, 16));

  return {
    id,
    role: ['assistant', 'system', 'tool', 'user'].includes(role) ? role : 'user',
    content,
    tags,
    metadata,
    createdAt,
  };
}

function normalizeTurns(input = []) {
  const items = Array.isArray(input) ? input : [];
  const turns = [];
  const seenIds = new Set();

  items.forEach((item, index) => {
    const turn = normalizeTurn(item, index);
    if (!turn.content && Object.keys(turn.metadata).length === 0 && turn.tags.length === 0) {
      return;
    }

    if (seenIds.has(turn.id)) {
      return;
    }

    seenIds.add(turn.id);
    turns.push(turn);
  });

  return turns;
}

function normalizeMemorySnapshot(input = {}) {
  const source = isObject(input) ? input : {};
  const key = normalizeMemoryKey(source.key || source.memoryKey || source.context || source);
  const createdAt = normalizeText(source.createdAt, new Date().toISOString());
  const updatedAt = normalizeText(source.updatedAt, createdAt);

  return {
    version: MEMORY_VERSION,
    key,
    createdAt,
    updatedAt,
    state: normalizeState(source.state || source.personaState || source.stats),
    summary: normalizeSummary(source.summary),
    turns: normalizeTurns(source.turns),
    metadata: isObject(source.metadata) ? cloneValue(source.metadata) : {},
  };
}

function createEmptyMemorySnapshot(keyInput = {}, now = new Date().toISOString()) {
  return {
    version: MEMORY_VERSION,
    key: normalizeMemoryKey(keyInput),
    createdAt: now,
    updatedAt: now,
    state: { ...DEFAULT_STATE },
    summary: normalizeSummary({
      text: '',
      highlights: [],
      sourceTurnCount: 0,
      sourceCharCount: 0,
      updatedAt: now,
      compacted: false,
    }),
    turns: [],
    metadata: {},
  };
}

function truncateText(value, maxChars = 240) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function firstSentence(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }

  const match = normalized.match(/[^。！？!?]+[。！？!?]?/);
  return normalizeText(match ? match[0] : normalized);
}

function buildSummaryCandidate(turns = []) {
  const highlights = [];
  const keywords = [
    '记住',
    '喜欢',
    '讨厌',
    '名字',
    '称呼',
    '以后',
    '下次',
    '上次',
    '今天',
    '关系',
    'mood',
    'affinity',
    '情绪',
    '偏好',
    '偏爱',
    '习惯',
    '约定',
  ];

  for (const turn of Array.isArray(turns) ? turns : []) {
    const text = normalizeText(turn?.content);
    if (!text) {
      continue;
    }

    const role = normalizeText(turn?.role, 'user').toLowerCase();
    const sentence = truncateText(firstSentence(text), 220);
    const matchedKeyword = keywords.find((keyword) => text.includes(keyword));
    if (matchedKeyword || role === 'assistant' || role === 'user') {
      const prefix = role === 'assistant' ? '助手' : role === 'system' ? '系统' : role === 'tool' ? '工具' : '用户';
      highlights.push(`${prefix}：${sentence}`);
    }
  }

  const uniqueHighlights = Array.from(new Set(highlights)).filter(Boolean);
  return {
    highlights: uniqueHighlights.slice(0, 6),
    text: truncateText(uniqueHighlights.join('；'), DEFAULT_SUMMARY_MAX_CHARS),
  };
}

function combineSummaryTexts(existingText, newText, maxChars = DEFAULT_SUMMARY_MAX_CHARS) {
  const combined = [normalizeText(existingText), normalizeText(newText)]
    .filter(Boolean)
    .join(' | ');
  return truncateText(combined, maxChars);
}

function compactMemorySnapshot(snapshot = {}, options = {}) {
  const current = normalizeMemorySnapshot(snapshot);
  const maxTurns = Math.max(2, Number.parseInt(options.maxTurns, 10) || DEFAULT_MAX_TURNS);
  const keepTurns = Math.max(1, Number.parseInt(options.keepTurns, 10) || DEFAULT_KEEP_TURNS);
  const maxChars = Math.max(500, Number.parseInt(options.maxChars, 10) || DEFAULT_MAX_CHARS);
  const summaryMaxChars = Math.max(200, Number.parseInt(options.summaryMaxChars, 10) || DEFAULT_SUMMARY_MAX_CHARS);
  const totalChars = current.turns.reduce((sum, turn) => sum + normalizeText(turn.content).length, 0)
    + normalizeText(current.summary.text).length;

  const shouldCompact = current.turns.length > maxTurns || totalChars > maxChars;
  if (!shouldCompact) {
    return {
      snapshot: current,
      compacted: false,
    };
  }

  const keepCount = Math.min(Math.max(1, keepTurns), current.turns.length);
  const retainedTurns = current.turns.slice(-keepCount);
  const discardedTurns = current.turns.slice(0, Math.max(0, current.turns.length - keepCount));
  const summaryCandidate = buildSummaryCandidate(discardedTurns);
  const now = new Date().toISOString();
  const sourceTurnCount = (current.summary.sourceTurnCount || 0) + discardedTurns.length;
  const sourceCharCount = (current.summary.sourceCharCount || 0)
    + discardedTurns.reduce((sum, turn) => sum + normalizeText(turn.content).length, 0);

  const nextSummary = normalizeSummary({
    text: combineSummaryTexts(current.summary.text, summaryCandidate.text, summaryMaxChars),
    highlights: Array.from(
      new Set([
        ...(Array.isArray(current.summary.highlights) ? current.summary.highlights : []),
        ...summaryCandidate.highlights,
      ]),
    ).slice(0, 8),
    sourceTurnCount,
    sourceCharCount,
    updatedAt: now,
    compacted: true,
  });

  return {
    snapshot: {
      ...current,
      updatedAt: now,
      summary: nextSummary,
      turns: retainedTurns,
      metadata: {
        ...current.metadata,
        compactedAt: now,
        retainedTurnCount: retainedTurns.length,
        discardedTurnCount: discardedTurns.length,
      },
    },
    compacted: true,
  };
}

function normalizeMemoryPatch(input = {}) {
  const source = isObject(input) ? input : {};
  const appendTurns = Array.isArray(source.appendTurns)
    ? normalizeTurns(source.appendTurns)
    : [];
  const replaceTurns = Array.isArray(source.replaceTurns)
    ? normalizeTurns(source.replaceTurns)
    : null;
  const state = isObject(source.state) ? cloneValue(source.state) : null;
  const metadata = isObject(source.metadata) ? cloneValue(source.metadata) : null;
  const summary = isObject(source.summary) ? normalizeSummary(source.summary) : null;

  return {
    appendTurns,
    replaceTurns,
    state,
    metadata,
    summary,
    resetTurns: Boolean(source.resetTurns),
    compact: source.compact !== false,
  };
}

function applyMemoryPatch(snapshot = {}, patchInput = {}, options = {}) {
  const current = normalizeMemorySnapshot(snapshot);
  const patch = normalizeMemoryPatch(patchInput);
  const now = new Date().toISOString();
  let next = current;
  let changed = false;

  if (patch.resetTurns) {
    next = {
      ...next,
      turns: [],
      summary: normalizeSummary({
        ...next.summary,
        text: '',
        highlights: [],
        sourceTurnCount: 0,
        sourceCharCount: 0,
        updatedAt: now,
        compacted: false,
      }),
    };
    changed = true;
  }

  if (Array.isArray(patch.replaceTurns)) {
    next = {
      ...next,
      turns: patch.replaceTurns,
    };
    changed = true;
  }

  if (patch.appendTurns.length > 0) {
    next = {
      ...next,
      turns: [...next.turns, ...patch.appendTurns],
    };
    changed = true;
  }

  if (patch.state) {
    const mergedState = normalizeState({
      ...next.state,
      ...patch.state,
    });
    if (!isDeepStrictEqual(next.state, mergedState)) {
      next = {
        ...next,
        state: mergedState,
      };
      changed = true;
    }
  }

  if (patch.metadata) {
    const mergedMetadata = {
      ...next.metadata,
      ...cloneValue(patch.metadata),
    };
    if (!isDeepStrictEqual(next.metadata, mergedMetadata)) {
      next = {
        ...next,
        metadata: mergedMetadata,
      };
      changed = true;
    }
  }

  if (patch.summary) {
    const mergedSummary = normalizeSummary({
      ...next.summary,
      ...patch.summary,
      updatedAt: now,
    });
    if (!isDeepStrictEqual(next.summary, mergedSummary)) {
      next = {
        ...next,
        summary: mergedSummary,
      };
      changed = true;
    }
  }

  if (patch.compact) {
    const compacted = compactMemorySnapshot(next, options);
    next = compacted.snapshot;
    changed = changed || compacted.compacted;
  } else {
    next = {
      ...next,
      updatedAt: now,
    };
  }

  next = {
    ...next,
    version: MEMORY_VERSION,
    updatedAt: changed ? now : next.updatedAt,
  };

  return {
    snapshot: next,
    changed,
    patch,
  };
}

class ShortTermMemoryStore {
  constructor({
    baseDir = path.join(process.cwd(), '.persona'),
    maxTurns = DEFAULT_MAX_TURNS,
    keepTurns = DEFAULT_KEEP_TURNS,
    maxChars = DEFAULT_MAX_CHARS,
    summaryMaxChars = DEFAULT_SUMMARY_MAX_CHARS,
  } = {}) {
    this.baseDir = baseDir;
    this.maxTurns = maxTurns;
    this.keepTurns = keepTurns;
    this.maxChars = maxChars;
    this.summaryMaxChars = summaryMaxChars;
    this.writeQueueByKey = new Map();
  }

  getFilePath(keyInput = {}) {
    return resolveMemoryFilePath(this.baseDir, keyInput);
  }

  async read(keyInput = {}) {
    const filePath = this.getFilePath(keyInput);
    const key = normalizeMemoryKey(keyInput);

    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return normalizeMemorySnapshot({
        ...parsed,
        key,
      });
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        return createEmptyMemorySnapshot(key);
      }

      return createEmptyMemorySnapshot(key);
    }
  }

  async write(keyInput = {}, snapshot = {}) {
    const key = normalizeMemoryKey(keyInput);
    const filePath = this.getFilePath(key);
    const normalized = normalizeMemorySnapshot({
      ...snapshot,
      key,
    });

    return this.enqueueForKey(key, async () => {
      await this.persistSnapshot(filePath, normalized);
      return {
        ok: true,
        changed: true,
        snapshot: cloneValue(normalized),
      };
    });
  }

  async commit(keyInput = {}, patchInput = {}) {
    const key = normalizeMemoryKey(keyInput);
    return this.enqueueForKey(key, async () => {
      const current = await this.read(key);
      const result = applyMemoryPatch(current, patchInput, {
        maxTurns: this.maxTurns,
        keepTurns: this.keepTurns,
        maxChars: this.maxChars,
        summaryMaxChars: this.summaryMaxChars,
      });

      if (!result.changed) {
        return {
          ok: true,
          changed: false,
          snapshot: cloneValue(current),
          patch: result.patch,
        };
      }

      const filePath = this.getFilePath(key);
      await this.persistSnapshot(filePath, result.snapshot);
      return {
        ok: true,
        changed: true,
        snapshot: cloneValue(result.snapshot),
        patch: result.patch,
      };
    });
  }

  async appendTurn(keyInput = {}, turnInput = {}, options = {}) {
    return this.commit(keyInput, {
      appendTurns: [turnInput],
      compact: options.compact !== false,
    });
  }

  async patch(keyInput = {}, patchInput = {}) {
    return this.commit(keyInput, {
      ...patchInput,
      compact: patchInput.compact !== false,
    });
  }

  async clear(keyInput = {}) {
    const key = normalizeMemoryKey(keyInput);
    const filePath = this.getFilePath(key);

    return this.enqueueForKey(key, async () => {
      await fs.rm(filePath, { force: true });
      return {
        ok: true,
        changed: true,
      };
    });
  }

  enqueueForKey(keyInput = {}, task) {
    const key = normalizeMemoryKey(keyInput);
    const queueKey = `${key.agentId}|${key.backend}|${key.routeKey}|${key.sessionId}`;
    const previous = this.writeQueueByKey.get(queueKey) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => task());
    this.writeQueueByKey.set(queueKey, current.catch(() => {}));
    return current;
  }

  async persistSnapshot(filePath, snapshot) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
    await fs.rename(tempPath, filePath);
  }
}

function createShortTermMemoryStore(options) {
  return new ShortTermMemoryStore(options);
}

module.exports = {
  MEMORY_VERSION,
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_TURNS,
  DEFAULT_KEEP_TURNS,
  DEFAULT_SUMMARY_MAX_CHARS,
  ShortTermMemoryStore,
  applyMemoryPatch,
  buildSummaryCandidate,
  combineSummaryTexts,
  compactMemorySnapshot,
  createEmptyMemorySnapshot,
  createShortTermMemoryStore,
  normalizeBackendName,
  normalizeMemoryKey,
  normalizeMemoryPatch,
  normalizeMemorySnapshot,
  normalizeState,
  normalizeSummary,
  normalizeText,
  normalizeTurn,
  normalizeTurns,
  resolveMemoryFilePath,
  safePathSegment,
  truncateText,
};
