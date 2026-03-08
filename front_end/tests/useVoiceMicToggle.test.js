import { describe, expect, it, vi } from 'vitest';
import {
  shouldPreserveVoiceSessionAfterDisable,
  stopVoiceCaptureAndSubmit,
} from '../src/hooks/voice/useVoiceMicToggle.js';

describe('stopVoiceCaptureAndSubmit', () => {
  it('invalidates the active epoch only after VAD stop and flush finish', async () => {
    const steps = [];
    let epochInvalidated = false;

    const stopVad = vi.fn(async () => {
      steps.push('stop:start');
      expect(epochInvalidated).toBe(false);
      steps.push('stop:speech-end-ready');
      await Promise.resolve();
      steps.push('stop:end');
    });

    const flushPendingSpeechAndSubmit = vi.fn(async ({ reason }) => {
      steps.push(`flush:start:${reason}`);
      expect(epochInvalidated).toBe(false);
      await Promise.resolve();
      steps.push('flush:end');
      return { ok: true };
    });

    const invalidateEpoch = vi.fn(() => {
      epochInvalidated = true;
      steps.push('epoch:invalidated');
    });

    await expect(
      stopVoiceCaptureAndSubmit({
        reason: 'manual',
        stopVad,
        flushPendingSpeechAndSubmit,
        invalidateEpoch,
      }),
    ).resolves.toEqual({ ok: true });

    expect(steps).toEqual([
      'stop:start',
      'stop:speech-end-ready',
      'stop:end',
      'flush:start:manual',
      'flush:end',
      'epoch:invalidated',
    ]);
  });

  it('still invalidates the epoch when flush fails', async () => {
    let epochInvalidated = false;

    await expect(
      stopVoiceCaptureAndSubmit({
        reason: 'manual',
        stopVad: async () => {},
        flushPendingSpeechAndSubmit: async () => {
          throw new Error('flush_failed');
        },
        invalidateEpoch: () => {
          epochInvalidated = true;
        },
      }),
    ).rejects.toThrow('flush_failed');

    expect(epochInvalidated).toBe(true);
  });
});

describe('shouldPreserveVoiceSessionAfterDisable', () => {
  it('keeps the voice session alive for manual mic disable so downstream TTS can continue', () => {
    expect(shouldPreserveVoiceSessionAfterDisable('manual')).toBe(true);
    expect(shouldPreserveVoiceSessionAfterDisable('session_stop')).toBe(false);
    expect(shouldPreserveVoiceSessionAfterDisable('toggle_unmount')).toBe(false);
  });
});
