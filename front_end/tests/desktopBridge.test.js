import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopBridge } from '../src/services/desktopBridge.js';

const originalWindow = globalThis.window;

afterEach(() => {
  if (typeof originalWindow === 'undefined') {
    delete globalThis.window;
    return;
  }
  globalThis.window = originalWindow;
});

describe('desktopBridge voice model selection', () => {
  it('omits undefined selection fields from the IPC payload', async () => {
    const select = vi.fn(async (payload) => ({ ok: true, payload }));
    globalThis.window = {
      desktop: {
        isElectron: true,
        voiceModels: {
          select,
        },
      },
    };

    const result = await desktopBridge.voiceModels.select({
      asrBundleId: 'asr-bundle',
    });

    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith({
      asrBundleId: 'asr-bundle',
    });
    expect(result.ok).toBe(true);
  });
});
