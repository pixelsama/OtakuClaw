const assert = require('node:assert/strict');
const test = require('node:test');

const { createTtsService } = require('../services/voice/ttsService');

test('createTtsService warmup delegates to resolved provider', async () => {
  let warmupCalls = 0;
  let synthesizeCalls = 0;
  let disposeCalls = 0;

  const service = createTtsService({
    provider: {
      async warmup() {
        warmupCalls += 1;
      },
      async synthesize() {
        synthesizeCalls += 1;
        return {
          sampleRate: 24000,
          sampleCount: 0,
        };
      },
      async dispose() {
        disposeCalls += 1;
      },
    },
  });

  await service.warmup();
  await service.synthesize({ text: 'hello', onChunk: () => {} });
  await service.dispose();

  assert.equal(warmupCalls, 1);
  assert.equal(synthesizeCalls, 1);
  assert.equal(disposeCalls, 1);
});
