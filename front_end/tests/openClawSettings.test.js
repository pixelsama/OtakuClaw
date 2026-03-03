import { describe, expect, it } from 'vitest';
import {
  buildOpenClawSettingsPayload,
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
