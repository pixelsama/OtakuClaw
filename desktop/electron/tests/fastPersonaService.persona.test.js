const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createFastPersonaService } = require('../services/persona/fastPersonaService');
const { createShortTermMemoryStore } = require('../services/persona/shortTermMemoryStore');
const { rewritePersonaResponse } = require('../services/persona/personaResponseRewriter');

test('fast persona service falls back heuristically when no direct runner is provided', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-persona-fallback-test-'));
  const memoryStore = createShortTermMemoryStore({ baseDir, maxTurns: 8, keepTurns: 3 });
  const service = createFastPersonaService({
    memoryStore,
  });

  const result = await service.evaluateTurn({
    agentId: 'agent-a',
    backend: 'nanobot',
    routeKey: 'route-1',
    sessionId: 'session-1',
    userInput: '你能帮我执行一个文件搜索任务吗？',
    mood: {
      label: 'neutral',
    },
    affinity: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'fallback');
  assert.equal(result.needsEscalation, true);
  assert.equal(result.reason, 'tool_request');
  assert.equal(result.statUpdates.length >= 0, true);
  assert.match(result.reply, /升级给后端/);
  assert.equal(result.memorySnapshot.turns.length, 1);
  assert.equal(result.memorySnapshot.turns[0].role, 'user');
  assert.equal(result.memoryPatch.appendTurns.length, 1);
});

test('fast persona service accepts a direct runner and normalizes structured JSON output', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-persona-direct-test-'));
  const memoryStore = createShortTermMemoryStore({ baseDir, maxTurns: 8, keepTurns: 3 });
  const service = createFastPersonaService({
    memoryStore,
    directModelRunner: async ({ promptBundle }) => ({
      content: JSON.stringify({
        reply: '我已经帮你记好了。',
        needsEscalation: false,
        reason: 'direct_runner',
        confidence: 0.93,
        statUpdates: [
          {
            stat: 'affinity',
            delta: 2,
            reason: '用户提出明确需求',
          },
        ],
        memoryPatch: {
          summaryHint: '用户提出了记忆请求。',
          tags: ['memory', 'direct'],
        },
      }),
      promptLength: promptBundle.prompt.length,
    }),
  });

  const result = await service.evaluateTurn({
    agentId: 'agent-a',
    backend: 'nanobot',
    routeKey: 'route-2',
    sessionId: 'session-1',
    userInput: '请记住我喜欢猫。下次可以提醒我。',
    mood: {
      label: 'warm',
    },
    affinity: 4,
  });

  assert.equal(result.mode, 'direct');
  assert.equal(result.directModelUsed, true);
  assert.equal(result.needsEscalation, false);
  assert.equal(result.reason, 'direct_runner');
  assert.equal(result.statUpdates.some((item) => item.stat === 'affinity' && item.delta === 2), true);
  assert.match(result.reply, /我已经帮你记好了/);
  assert.equal(result.memorySnapshot.state.affinity >= 6, true);
  assert.equal(result.memorySnapshot.turns.length >= 2, true);
  assert.equal(result.memoryPatch.summary.text, '用户提出了记忆请求。');
  assert.equal(result.memoryPatch.summary.highlights.includes('memory'), true);
  assert.equal(result.rewrittenReply.changed, false);
});

test('persona response rewriter can act as a small normalization wrapper', () => {
  const rewritten = rewritePersonaResponse('  我来了  ', {
    prefix: '嗯，',
    suffix: '。',
    maxChars: 20,
  });

  assert.equal(rewritten.reply, '嗯，我来了。');
  assert.equal(rewritten.changed, true);
  assert.equal(rewritten.originalReply, '我来了');
});
