const {
  applyMemoryPatch,
  createEmptyMemorySnapshot,
  createShortTermMemoryStore,
  normalizeMemoryKey,
  normalizeMemorySnapshot,
  normalizeText,
} = require('./shortTermMemoryStore');
const { buildFastPersonaPrompt } = require('./personaPromptBuilder');
const { createPersonaResponseRewriter, rewritePersonaResponse } = require('./personaResponseRewriter');

const TOOL_TRIGGER_PATTERNS = [
  /(?:帮我|请帮|帮忙).*(?:查|找|搜|看|执行|运行|下载|安装|打开|创建|修改|修复|分析)/,
  /(?:搜索|查找|查询|执行|运行|下载|安装|打开|创建|修改|修复|分析|编译|测试|调试|部署|读取|写入|删除|同步|导出|导入|上传|抓取|抓图|截图|文件|代码|脚本|命令)/,
  /(?:复杂|详细|深入|长篇|完整|全面|全量|历史|以前|更早|回忆|记得)/,
];

const POSITIVE_PATTERNS = [
  /(?:谢谢|感谢|喜欢|棒|可爱|厉害|好呀|太好了|开心|爱你|赞)/,
];

const NEGATIVE_PATTERNS = [
  /(?:讨厌|生气|难过|烦|糟糕|失败|错误|不行|不要|不喜欢|失望)/,
];

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

function normalizeStatValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) {
    return 0;
  }

  return Math.max(-5, Math.min(5, parsed));
}

function normalizeStatUpdates(input = []) {
  const items = Array.isArray(input) ? input : [];
  const updates = [];
  const seen = new Set();

  for (const item of items) {
    if (!isObject(item)) {
      continue;
    }

    const stat = normalizeText(item.stat || item.metric || item.key || '', '');
    const delta = normalizeStatValue(item.delta ?? item.value ?? item.amount ?? 0);
    const reason = normalizeText(item.reason || item.note || '');
    if (!stat || delta === 0) {
      continue;
    }

    const signature = `${stat}:${delta}:${reason}`;
    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    updates.push({
      stat,
      delta,
      reason,
    });
  }

  return updates;
}

function normalizeReason(value) {
  return normalizeText(value, '');
}

function normalizeDirectResult(result) {
  if (typeof result === 'string') {
    return {
      reply: result,
      raw: result,
    };
  }

  if (!isObject(result)) {
    return {
      reply: '',
      raw: result,
    };
  }

  const candidate = result.result || result.output || result.response || result.data || result;
  const content = typeof candidate === 'string'
    ? candidate
    : normalizeText(candidate?.content || candidate?.text || candidate?.message || '');

  let parsedObject = null;
  if (content) {
    const trimmed = content.trim();
    const fenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const firstBrace = fenced.indexOf('{');
    const lastBrace = fenced.lastIndexOf('}');
    const parseTarget = firstBrace >= 0 && lastBrace > firstBrace
      ? fenced.slice(firstBrace, lastBrace + 1)
      : fenced;

    try {
      parsedObject = JSON.parse(parseTarget);
    } catch {
      parsedObject = null;
    }
  }

  const source = parsedObject && isObject(parsedObject) ? parsedObject : candidate;

  return {
    reply: normalizeText(
      source.reply || source.text || source.content || source.message || content,
      '',
    ),
    needsEscalation: typeof source.needsEscalation === 'boolean' ? source.needsEscalation : undefined,
    reason: normalizeReason(source.reason || source.explanation || result.reason || ''),
    confidence: Number.isFinite(Number(source.confidence)) ? Number(source.confidence) : undefined,
    statUpdates: normalizeStatUpdates(source.statUpdates || source.stats || result.statUpdates || []),
    memoryPatch: isObject(source.memoryPatch) ? cloneValue(source.memoryPatch) : null,
    raw: result,
  };
}

function detectToolNeed(userInput = '') {
  const text = normalizeText(userInput);
  if (!text) {
    return false;
  }

  return TOOL_TRIGGER_PATTERNS.some((pattern) => pattern.test(text));
}

function detectSentiment(userInput = '') {
  const text = normalizeText(userInput);
  if (!text) {
    return 'neutral';
  }

  if (NEGATIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'negative';
  }

  if (POSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'positive';
  }

  return 'neutral';
}

function evaluateHeuristicResponse({ userInput, mood, affinity, memorySnapshot }) {
  const normalizedInput = normalizeText(userInput);
  const sentiment = detectSentiment(normalizedInput);
  const toolNeed = detectToolNeed(normalizedInput);
  const memory = normalizeMemorySnapshot(memorySnapshot || {});
  const recentContextMissing = memory.turns.length === 0 && !normalizeText(memory.summary.text);
  const askForRecall = /(?:记得|还记得|上次|以前|之前|更早|回忆|回想|忘了)/.test(normalizedInput);
  const questionLike = /[？?]$/.test(normalizedInput) || /(?:怎么|如何|为什么|能否|可以吗|行吗|好吗)/.test(normalizedInput);
  const longRequest = normalizedInput.length >= 120;
  const needsEscalation = Boolean(toolNeed || (askForRecall && recentContextMissing) || (longRequest && questionLike));

  let reply = '我在呀。';
  let reason = 'fast_persona_reply';
  let confidence = 0.62;
  const statUpdates = [];

  if (!normalizedInput) {
    reply = '嗯，我在。';
    reason = 'empty_input';
    confidence = 0.2;
  } else if (needsEscalation) {
    reply = '这件事我先认真处理一下，可能需要升级给后端。';
    reason = toolNeed ? 'tool_request' : askForRecall ? 'memory_gap' : 'complex_request';
    confidence = 0.36;
  } else if (/^(?:你好|嗨|哈喽|hello|hi|hey)/i.test(normalizedInput)) {
    reply = '你好呀，我在这里。';
    reason = 'greeting';
    confidence = 0.88;
  } else if (/(?:谢谢|感谢)/.test(normalizedInput)) {
    reply = '不客气，我会继续陪着你。';
    reason = 'gratitude';
    confidence = 0.84;
  } else if (sentiment === 'positive') {
    reply = '嗯嗯，我也有点开心。';
    reason = 'positive_tone';
    confidence = 0.74;
  } else if (sentiment === 'negative') {
    reply = '我听到了，我们慢慢来。';
    reason = 'negative_tone';
    confidence = 0.7;
  } else if (questionLike) {
    reply = '我先想想这个问题。';
    reason = 'simple_question';
    confidence = 0.68;
  }

  const moodLabel = normalizeText(isObject(mood) ? mood.label : mood, 'neutral').toLowerCase();
  const affinityValue = Number(affinity);
  if (sentiment === 'positive') {
    statUpdates.push({
      stat: 'mood',
      delta: 1,
      reason: 'positive_tone',
    });
    statUpdates.push({
      stat: 'affinity',
      delta: 1,
      reason: 'positive_tone',
    });
  } else if (sentiment === 'negative') {
    statUpdates.push({
      stat: 'mood',
      delta: -1,
      reason: 'negative_tone',
    });
  } else if (/^(?:happy|warm|excited|cheerful|pleasant)$/.test(moodLabel)) {
    statUpdates.push({
      stat: 'mood',
      delta: 1,
      reason: 'current_mood_bias',
    });
  }

  if (Number.isFinite(affinityValue) && affinityValue >= 4 && !needsEscalation) {
    confidence = Math.min(0.94, confidence + 0.05);
  }

  return {
    reply,
    needsEscalation,
    reason,
    confidence,
    statUpdates,
    memoryPatch: {
      summaryHint: needsEscalation ? 'Need richer context from backend.' : 'Lightweight persona turn handled locally.',
      tags: needsEscalation ? ['escalation'] : ['fast-response'],
      note: reason,
    },
  };
}

function mergeStatUpdates(primary = [], secondary = []) {
  const updates = [...normalizeStatUpdates(primary), ...normalizeStatUpdates(secondary)];
  const deduped = [];
  const seen = new Set();

  for (const update of updates) {
    const signature = `${update.stat}:${update.delta}:${update.reason}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    deduped.push(update);
  }

  return deduped;
}

function mergeMemoryPatch(primary = {}, secondary = {}) {
  const result = {
    summaryHint: normalizeText(primary.summaryHint || secondary.summaryHint || ''),
    tags: Array.from(
      new Set([
        ...(Array.isArray(primary.tags) ? primary.tags : []),
        ...(Array.isArray(secondary.tags) ? secondary.tags : []),
      ].map((tag) => normalizeText(tag)).filter(Boolean)),
    ).slice(0, 8),
    note: normalizeText(primary.note || secondary.note || ''),
  };

  if (isObject(primary.state) || isObject(secondary.state)) {
    result.state = {
      ...(isObject(secondary.state) ? cloneValue(secondary.state) : {}),
      ...(isObject(primary.state) ? cloneValue(primary.state) : {}),
    };
  }

  if (Array.isArray(primary.appendTurns) || Array.isArray(secondary.appendTurns)) {
    result.appendTurns = [
      ...(Array.isArray(secondary.appendTurns) ? secondary.appendTurns : []),
      ...(Array.isArray(primary.appendTurns) ? primary.appendTurns : []),
    ];
  }

  return result;
}

function normalizeEvaluateInput(input = {}) {
  const source = isObject(input) ? input : {};
  const key = normalizeMemoryKey(source);
  const userInput = normalizeText(source.userInput || source.input || source.text || '');
  const mood = source.mood || source.personaMood || source.state?.mood || 'neutral';
  const affinity = source.affinity ?? source.personaAffinity ?? source.state?.affinity ?? 0;
  const memorySnapshot = source.memorySnapshot || source.memory || null;

  return {
    key,
    userInput,
    mood,
    affinity,
    memorySnapshot,
    personaName: source.personaName || source.name || '',
    personaDescription: source.personaDescription || source.description || '',
    personaTraits: source.personaTraits || [],
    channel: source.channel || 'chat',
    directModelRunner: source.directModelRunner,
    rewriteOptions: source.rewriteOptions || {},
    statePatch: isObject(source.statePatch) ? cloneValue(source.statePatch) : null,
    metadata: isObject(source.metadata) ? cloneValue(source.metadata) : {},
    skipMemoryWrite: Boolean(source.skipMemoryWrite),
    persistMemory: source.persistMemory !== false,
    now: normalizeText(source.now || new Date().toISOString()),
  };
}

function createFastPersonaService({
  memoryStore = createShortTermMemoryStore(),
  promptBuilder = buildFastPersonaPrompt,
  responseRewriter = createPersonaResponseRewriter(),
  directModelRunner = null,
  fallbackEvaluator = evaluateHeuristicResponse,
  memoryStoreOptions = {},
} = {}) {
  const store = memoryStore && typeof memoryStore.read === 'function' ? memoryStore : null;
  const builder = typeof promptBuilder === 'function' ? promptBuilder : buildFastPersonaPrompt;
  const rewriter = responseRewriter && typeof responseRewriter.rewrite === 'function'
    ? responseRewriter
    : createPersonaResponseRewriter();
  const baseRunner = typeof directModelRunner === 'function' ? directModelRunner : null;
  const evaluateFallback = typeof fallbackEvaluator === 'function'
    ? fallbackEvaluator
    : evaluateHeuristicResponse;

  return new FastPersonaService({
    memoryStore: store,
    promptBuilder: builder,
    responseRewriter: rewriter,
    directModelRunner: baseRunner,
    fallbackEvaluator: evaluateFallback,
    memoryStoreOptions,
  });
}

class FastPersonaService {
  constructor({
    memoryStore = null,
    promptBuilder = buildFastPersonaPrompt,
    responseRewriter = createPersonaResponseRewriter(),
    directModelRunner = null,
    fallbackEvaluator = evaluateHeuristicResponse,
    memoryStoreOptions = {},
  } = {}) {
    this.memoryStore = memoryStore;
    this.promptBuilder = promptBuilder;
    this.responseRewriter = responseRewriter;
    this.directModelRunner = directModelRunner;
    this.fallbackEvaluator = fallbackEvaluator;
    this.memoryStoreOptions = memoryStoreOptions;
  }

  async prepareTurn(input = {}) {
    const normalized = normalizeEvaluateInput(input);
    const memorySnapshot = normalized.memorySnapshot
      ? normalizeMemorySnapshot(normalized.memorySnapshot)
      : this.memoryStore
        ? await this.memoryStore.read(normalized.key)
        : createEmptyMemorySnapshot(normalized.key, normalized.now);

    const prompt = this.promptBuilder({
      ...normalized,
      memorySnapshot,
    });

    return {
      ok: true,
      key: normalized.key,
      input: normalized,
      memorySnapshot,
      prompt,
    };
  }

  async evaluateTurn(input = {}) {
    const prepared = await this.prepareTurn(input);
    const normalized = prepared.input;
    const fallbackResult = this.fallbackEvaluator({
      userInput: normalized.userInput,
      mood: normalized.mood,
      affinity: normalized.affinity,
      memorySnapshot: prepared.memorySnapshot,
    });

    const runner = normalized.directModelRunner || this.directModelRunner;
    let modelResult = null;
    let mode = 'fallback';

    if (typeof runner === 'function') {
      try {
        const rawResult = await runner({
          ...prepared,
          prompt: prepared.prompt.prompt,
          promptBundle: prepared.prompt,
          input: normalized,
          memorySnapshot: prepared.memorySnapshot,
          outputSchema: prepared.prompt.outputSchema,
        });
        modelResult = normalizeDirectResult(rawResult);
        mode = 'direct';
      } catch (error) {
        modelResult = {
          reply: '',
          needsEscalation: undefined,
          reason: normalizeText(error?.message || '', ''),
          confidence: undefined,
          statUpdates: [],
          memoryPatch: null,
          raw: error,
        };
        mode = 'fallback';
      }
    }

    const merged = modelResult
      ? {
          reply: normalizeText(modelResult.reply || fallbackResult.reply, fallbackResult.reply),
          needsEscalation: typeof modelResult.needsEscalation === 'boolean'
            ? modelResult.needsEscalation
            : fallbackResult.needsEscalation,
          reason: normalizeReason(modelResult.reason || fallbackResult.reason),
          confidence: Number.isFinite(modelResult.confidence) ? modelResult.confidence : fallbackResult.confidence,
          statUpdates: mergeStatUpdates(fallbackResult.statUpdates, modelResult.statUpdates),
          memoryPatch: mergeMemoryPatch(fallbackResult.memoryPatch, modelResult.memoryPatch || {}),
          raw: modelResult.raw,
        }
      : {
          ...fallbackResult,
          raw: null,
        };

    const rewritten = this.responseRewriter.rewrite(merged.reply, {
      ...normalized.rewriteOptions,
      channel: normalized.channel,
      personaName: normalized.personaName,
      mood: normalized.mood,
      affinity: normalized.affinity,
      maxChars: normalized.rewriteOptions?.maxChars || 0,
    });
    const finalReply = normalizeText(rewritten.reply, merged.reply);
    const finalStatePatch = isObject(normalized.statePatch)
      ? cloneValue(normalized.statePatch)
      : {};
    const statUpdates = mergeStatUpdates(merged.statUpdates, normalized.statUpdates || []);

    for (const update of statUpdates) {
      if (update.stat === 'mood') {
        const currentMood = normalizeText(finalStatePatch.mood || normalized.mood || 'neutral', 'neutral');
        finalStatePatch.mood = currentMood;
      } else if (update.stat === 'affinity') {
        const currentAffinity = Number(finalStatePatch.affinity ?? normalized.affinity ?? 0);
        finalStatePatch.affinity = Number.isFinite(currentAffinity) ? currentAffinity + update.delta : update.delta;
      } else {
        finalStatePatch[update.stat] = update.delta;
      }
    }

    const appendTurns = [
      {
        role: 'user',
        content: normalized.userInput,
        metadata: {
          channel: normalized.channel,
          turnKind: 'user',
        },
      },
      {
        role: 'assistant',
        content: finalReply,
        metadata: {
          channel: normalized.channel,
          turnKind: 'assistant',
          needsEscalation: merged.needsEscalation,
          reason: merged.reason,
        },
      },
    ].filter((turn) => normalizeText(turn.content));

    const memoryWritePatch = {
      appendTurns,
      ...(Object.keys(finalStatePatch).length > 0 ? { state: finalStatePatch } : {}),
      metadata: {
        lastReason: merged.reason,
        lastMode: mode,
        lastNeedsEscalation: Boolean(merged.needsEscalation),
        ...normalized.metadata,
      },
      ...(normalizeText(merged.memoryPatch?.summaryHint || '') || (Array.isArray(merged.memoryPatch?.tags) && merged.memoryPatch.tags.length > 0)
        ? {
            summary: {
              text: normalizeText(merged.memoryPatch?.summaryHint || ''),
              highlights: Array.isArray(merged.memoryPatch?.tags) ? merged.memoryPatch.tags : [],
              compacted: false,
            },
          }
        : {}),
      compact: true,
    };

    let memoryCommit = {
      ok: true,
      changed: false,
      snapshot: prepared.memorySnapshot,
      patch: memoryWritePatch,
    };

    if (this.memoryStore && normalized.persistMemory && !normalized.skipMemoryWrite) {
      memoryCommit = await this.memoryStore.commit(prepared.key, memoryWritePatch);
    } else {
      const applied = applyMemoryPatch(prepared.memorySnapshot, memoryWritePatch, {
        ...this.memoryStoreOptions,
      });
      memoryCommit = {
        ok: true,
        changed: applied.changed,
        snapshot: applied.snapshot,
        patch: memoryWritePatch,
      };
    }

    const normalizedRewritten = isObject(rewritten)
      ? rewritten
      : {
          reply: finalReply,
          changed: false,
          reason: 'noop',
          originalReply: finalReply,
          metadata: {},
        };

    return {
      ok: true,
      mode,
      reply: finalReply,
      rewrittenReply: normalizedRewritten,
      needsEscalation: Boolean(merged.needsEscalation),
      reason: merged.reason,
      confidence: merged.confidence,
      statUpdates,
      prompt: prepared.prompt,
      memoryKey: prepared.key,
      memorySnapshotBefore: prepared.memorySnapshot,
      memorySnapshot: memoryCommit.snapshot,
      memoryPatch: memoryWritePatch,
      memoryCommit,
      raw: merged.raw,
      directModelUsed: mode === 'direct',
    };
  }

  async rewriteResponse(input = {}, context = {}) {
    return rewritePersonaResponse(input, context);
  }
}

module.exports = {
  FastPersonaService,
  TOOL_TRIGGER_PATTERNS,
  createFastPersonaService,
  detectSentiment,
  detectToolNeed,
  evaluateHeuristicResponse,
  mergeMemoryPatch,
  mergeStatUpdates,
  normalizeDirectResult,
  normalizeEvaluateInput,
  normalizeReason,
  normalizeStatUpdates,
};
