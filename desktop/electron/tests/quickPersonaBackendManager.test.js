const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createQuickPersonaBackendManager,
} = require('../services/persona/quickPersonaBackendManager');

test('quick persona backend manager uses independent openai-compatible direct call', async () => {
  const requests = [];
  const manager = createQuickPersonaBackendManager({
    fetchImpl: async (url, init = {}) => {
      requests.push({
        url,
        init,
      });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"reply":"你好呀","needsEscalation":false}',
                },
              },
            ],
          });
        },
      };
    },
  });

  const result = await manager.runDirect({
    settings: {
      fastPersona: {
        enabled: true,
        configMode: 'custom',
        provider: 'openai',
        model: 'gpt-fast',
        apiBase: 'https://api.example.com/v1',
        apiKey: 'fast-secret',
        maxTokens: 256,
        temperature: 0.1,
        timeoutMs: 5000,
      },
    },
    promptBundle: {
      messages: [
        { role: 'system', content: 'Return JSON only.' },
        { role: 'user', content: 'Say hi.' },
      ],
    },
  });

  assert.equal(result, '{"reply":"你好呀","needsEscalation":false}');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.example.com/v1/chat/completions');
  const parsedBody = JSON.parse(requests[0].init.body);
  assert.equal(parsedBody.model, 'gpt-fast');
  assert.equal(parsedBody.messages.length, 2);
});

test('quick persona backend manager can inherit llm config without using chat backend adapter', async () => {
  const manager = createQuickPersonaBackendManager({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          choices: [
            {
              message: {
                content: '{"reply":"已收到","needsEscalation":true}',
              },
            },
          ],
        });
      },
    }),
  });

  const resolved = manager.resolveConfig({
    nanobot: {
      provider: 'openrouter',
      model: 'anthropic/claude-opus-4-5',
      apiBase: 'https://openrouter.ai/api/v1',
      apiKey: 'shared-key',
    },
    fastPersona: {
      enabled: true,
      configMode: 'inherit',
      maxTokens: 300,
      temperature: 0.25,
    },
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.config.inheritedFrom, 'nanobot');
  assert.equal(resolved.config.model, 'anthropic/claude-opus-4-5');
  assert.equal(resolved.config.apiKey, 'shared-key');
});
