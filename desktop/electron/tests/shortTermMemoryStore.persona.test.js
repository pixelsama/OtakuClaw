const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  applyMemoryPatch,
  createShortTermMemoryStore,
  normalizeMemoryKey,
  normalizeMemorySnapshot,
  resolveMemoryFilePath,
} = require('../services/persona/shortTermMemoryStore');

test('short term memory store isolates by agent, backend, route key, and session id', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'persona-memory-test-'));
  const store = createShortTermMemoryStore({
    baseDir,
    maxTurns: 4,
    keepTurns: 2,
    maxChars: 300,
  });

  const keyA = {
    agentId: 'agent-a',
    backend: 'nanobot',
    routeKey: 'route/a',
    sessionId: 'session-1',
  };

  const keyB = {
    agentId: 'agent-b',
    backend: 'nanobot',
    routeKey: 'route/a',
    sessionId: 'session-1',
  };

  const writeA = await store.appendTurn(keyA, {
    role: 'user',
    content: '你好，我叫小橙。',
  });
  const writeB = await store.appendTurn(keyB, {
    role: 'user',
    content: '这是另一个会话。',
  });

  assert.equal(writeA.ok, true);
  assert.equal(writeB.ok, true);

  const readA = await store.read(keyA);
  const readB = await store.read(keyB);
  assert.equal(readA.turns.length, 1);
  assert.equal(readB.turns.length, 1);
  assert.equal(readA.turns[0].content.includes('小橙'), true);
  assert.equal(readB.turns[0].content.includes('另一个会话'), true);

  const pathA = resolveMemoryFilePath(baseDir, keyA);
  const pathB = resolveMemoryFilePath(baseDir, keyB);
  assert.notEqual(pathA, pathB);
  await assert.doesNotReject(fs.stat(pathA));
  await assert.doesNotReject(fs.stat(pathB));
});

test('short term memory store compacts old turns into summary while preserving recent context', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'persona-memory-compact-test-'));
  const store = createShortTermMemoryStore({
    baseDir,
    maxTurns: 4,
    keepTurns: 2,
    maxChars: 120,
    summaryMaxChars: 240,
  });

  const key = {
    agentId: 'agent-a',
    backend: 'nanobot',
    routeKey: 'route-b',
    sessionId: 'session-2',
  };

  for (let index = 0; index < 6; index += 1) {
    await store.appendTurn(key, {
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: index === 0
        ? '你要记住我喜欢蓝色，也请记住我叫小橙。'
        : `第 ${index + 1} 轮对话内容，带一点上下文信息。`,
    });
  }

  const snapshot = await store.read(key);
  assert.equal(snapshot.turns.length <= 3, true);
  assert.equal(snapshot.summary.compacted, true);
  assert.equal(snapshot.summary.text.includes('喜欢蓝色'), true);
  assert.equal(snapshot.summary.highlights.length > 0, true);
  assert.equal(snapshot.summary.sourceTurnCount >= 3, true);
  assert.equal(snapshot.metadata.compactedAt.length > 0, true);
});

test('memory patch helper merges state and appended turns without losing existing data', () => {
  const snapshot = normalizeMemorySnapshot({
    key: {
      agentId: 'agent-a',
      backend: 'nanobot',
      routeKey: 'route-c',
      sessionId: 'session-3',
    },
    state: {
      mood: 'calm',
      affinity: 2,
    },
    turns: [
      {
        role: 'user',
        content: '以前我们聊过猫。',
      },
    ],
  });

  const result = applyMemoryPatch(snapshot, {
    appendTurns: [
      {
        role: 'assistant',
        content: '我记得。',
      },
    ],
    state: {
      affinity: 4,
    },
    metadata: {
      lastReason: 'unit-test',
    },
    compact: false,
  });

  assert.equal(result.changed, true);
  assert.equal(result.snapshot.turns.length, 2);
  assert.equal(result.snapshot.state.mood, 'calm');
  assert.equal(result.snapshot.state.affinity, 4);
  assert.equal(result.snapshot.metadata.lastReason, 'unit-test');
});

test('short term memory store rejects missing agent ids instead of defaulting to main', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'persona-memory-agent-required-'));
  const store = createShortTermMemoryStore({ baseDir });

  assert.throws(() => normalizeMemoryKey({ backend: 'nanobot' }), { code: 'agent_required' });
  await assert.rejects(
    () => store.appendTurn(
      {
        backend: 'nanobot',
        routeKey: 'route-missing-agent',
        sessionId: 'session-1',
      },
      {
        role: 'user',
        content: '这次没有 agent。',
      },
    ),
    { code: 'agent_required' },
  );
});

test('short term memory store preserves explicit key when reading legacy snapshot payloads', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'persona-memory-legacy-read-'));
  const store = createShortTermMemoryStore({ baseDir });
  const key = {
    agentId: 'agent-a',
    backend: 'nanobot',
    routeKey: 'route-legacy',
    sessionId: 'session-1',
  };
  const filePath = resolveMemoryFilePath(baseDir, key);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({
    version: 1,
    key: {
      backend: 'nanobot',
      routeKey: 'route-legacy',
      sessionId: 'session-1',
    },
    state: {
      mood: 'warm',
      affinity: 3,
    },
    turns: [
      {
        role: 'user',
        content: '请记住我是旧格式快照。',
      },
    ],
  }), 'utf8');

  const snapshot = await store.read(key);

  assert.equal(snapshot.key.agentId, 'agent-a');
  assert.equal(snapshot.key.routeKey, 'route-legacy');
  assert.equal(snapshot.turns.length, 1);
  assert.equal(snapshot.state.affinity, 3);
});
