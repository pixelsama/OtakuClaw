import { describe, expect, it } from 'vitest';
import { normalizeErrorMessage } from '../src/utils/normalizeErrorMessage.js';

function createTranslator() {
  return (key, params = {}) => {
    if (key === 'common.requestFailed') {
      return 'REQUEST_FAILED';
    }
    if (key === 'error.streamRequestFailed') {
      return `STREAM_${params.status}`;
    }
    if (key === 'error.openclawMissingConfig') {
      return 'MISSING_CONFIG';
    }
    if (key === 'error.openclawUnreachable') {
      return 'UNREACHABLE';
    }
    return key;
  };
}

describe('normalizeErrorMessage', () => {
  it('returns fallback when error is empty', () => {
    const t = createTranslator();
    expect(normalizeErrorMessage(null, t)).toBe('REQUEST_FAILED');
  });

  it('maps streaming status text into translated message', () => {
    const t = createTranslator();
    expect(normalizeErrorMessage('流式接口请求失败: 503', t)).toBe('STREAM_503');
  });

  it('maps openclaw error codes into translated message', () => {
    const t = createTranslator();
    expect(normalizeErrorMessage({ code: 'openclaw_missing_config' }, t)).toBe('MISSING_CONFIG');
    expect(normalizeErrorMessage({ payload: { code: 'openclaw_unreachable' } }, t)).toBe('UNREACHABLE');
  });

  it('keeps explicit message when provided', () => {
    const t = createTranslator();
    expect(normalizeErrorMessage(new Error('boom'), t)).toBe('boom');
    expect(normalizeErrorMessage({ payload: { message: 'payload boom' } }, t)).toBe('payload boom');
  });
});
