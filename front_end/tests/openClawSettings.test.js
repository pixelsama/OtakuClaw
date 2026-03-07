import { describe, expect, it } from 'vitest';
import {
  buildChatBackendSettingsPayload,
  buildOpenClawSettingsPayload,
  formatChatBackendSettingsError,
  formatOpenClawSettingsError,
} from '../src/hooks/settings/useOpenClawSettings.js';

describe('buildOpenClawSettingsPayload', () => {
  it('keeps base fields and trims token', () => {
    const payload = buildOpenClawSettingsPayload({
      baseUrl: 'http://127.0.0.1:18789',
      agentId: 'main',
      token: '  secret-token  ',
    });

    expect(payload).toEqual({
      baseUrl: 'http://127.0.0.1:18789',
      agentId: 'main',
      token: 'secret-token',
    });
  });

  it('omits token when token is empty after trim', () => {
    const payload = buildOpenClawSettingsPayload({
      baseUrl: 'http://127.0.0.1:18789',
      agentId: 'main',
      token: '   ',
    });

    expect(payload).toEqual({
      baseUrl: 'http://127.0.0.1:18789',
      agentId: 'main',
    });
  });
});

describe('formatOpenClawSettingsError', () => {
  const t = (key) => (key === 'common.requestFailed' ? 'REQUEST_FAILED' : key);

  it('uses normalizeError when provided', () => {
    const result = formatOpenClawSettingsError({
      error: { code: 'x' },
      normalizeError: () => 'NORMALIZED',
      t,
    });

    expect(result).toBe('NORMALIZED');
  });

  it('falls back to string / message / translated fallback', () => {
    expect(formatOpenClawSettingsError({ error: 'TEXT_ERROR', t })).toBe('TEXT_ERROR');
    expect(formatOpenClawSettingsError({ error: { message: 'MESSAGE_ERROR' }, t })).toBe('MESSAGE_ERROR');
    expect(formatOpenClawSettingsError({ error: {}, t })).toBe('REQUEST_FAILED');
  });
});

describe('buildChatBackendSettingsPayload', () => {
  it('builds payload for nanobot backend and trims api key', () => {
    const payload = buildChatBackendSettingsPayload({
      chatBackend: 'nanobot',
      openclaw: {
        baseUrl: 'http://127.0.0.1:18789',
        agentId: 'main',
      },
      nanobot: {
        enabled: true,
        workspace: '/tmp/nanobot-workspace',
        provider: 'openrouter',
        model: 'anthropic/claude-opus-4-5',
        apiBase: 'https://openrouter.ai/api/v1',
        apiKey: '  sk-or-v1-demo  ',
        maxTokens: 2048,
        temperature: 0.4,
        reasoningEffort: 'medium',
      },
    });

    expect(payload.chatBackend).toBe('nanobot');
    expect(payload.nanobot.apiKey).toBe('sk-or-v1-demo');
    expect(payload.nanobot.maxTokens).toBe(2048);
    expect(payload.voice.pttHotkey).toBe('F8');
  });

  it('includes voice ptt hotkey when provided', () => {
    const payload = buildChatBackendSettingsPayload({
      voice: {
        pttHotkey: 'space',
      },
    });

    expect(payload.voice).toEqual({
      pttHotkey: 'SPACE',
    });
  });
});

describe('formatChatBackendSettingsError', () => {
  const t = (key) => (key === 'common.requestFailed' ? 'REQUEST_FAILED' : key);

  it('uses normalized error message and fallback contract', () => {
    expect(
      formatChatBackendSettingsError({
        error: { code: 'x' },
        normalizeError: () => 'NORMALIZED',
        t,
      }),
    ).toBe('NORMALIZED');

    expect(formatChatBackendSettingsError({ error: {}, t })).toBe('REQUEST_FAILED');
  });
});
