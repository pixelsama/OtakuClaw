const assert = require('node:assert/strict');
const test = require('node:test');

const { buildFastPersonaPrompt } = require('../services/persona/personaPromptBuilder');

test('persona prompt builder creates structured JSON-only instructions from memory and mood', () => {
  const prompt = buildFastPersonaPrompt({
    agentId: 'agent-a',
    backend: 'nanobot',
    routeKey: 'route-1',
    sessionId: 'session-1',
    userInput: '你还记得我喜欢什么吗？',
    mood: {
      label: 'warm',
      score: 2,
    },
    affinity: 5,
    personaName: 'Claw',
    personaDescription: '温柔但反应很快。',
    personaTraits: ['warm', 'playful'],
    memorySnapshot: {
      state: {
        mood: 'warm',
        affinity: 5,
      },
      summary: {
        text: '用户喜欢蓝色，名字叫小橙。',
        highlights: ['喜欢蓝色'],
        sourceTurnCount: 4,
        sourceCharCount: 42,
        updatedAt: '2026-03-22T00:00:00.000Z',
      },
      turns: [
        {
          role: 'user',
          content: '我喜欢蓝色。',
          createdAt: '2026-03-21T23:00:00.000Z',
        },
        {
          role: 'assistant',
          content: '我记住啦。',
          createdAt: '2026-03-21T23:00:01.000Z',
        },
      ],
    },
  });

  assert.match(prompt.systemPrompt, /Return JSON only/);
  assert.match(prompt.systemPrompt, /Claw/);
  assert.equal(prompt.messages.length, 2);
  assert.equal(prompt.outputSchema.reply, 'string');
  assert.match(prompt.userPrompt, /"userInput": "你还记得我喜欢什么吗？"/);
  assert.match(prompt.userPrompt, /"summary":/);
  assert.equal(prompt.memory.recentTurns.length, 2);
  assert.equal(prompt.memory.summary.text.includes('用户喜欢蓝色'), true);
});
