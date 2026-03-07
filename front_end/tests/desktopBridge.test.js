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

describe('desktopBridge conversation-only routing', () => {
  it('returns unavailable when conversation submit API is missing', async () => {
    globalThis.window = {
      desktop: {
        isElectron: true,
      },
    };

    const result = await desktopBridge.conversation.submitUserText({
      sessionId: 's1',
      content: 'hello',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'desktop_conversation_unavailable',
    });
  });

  it('routes chat.onEvent through conversation:event channel=chat', () => {
    const unsubscribe = vi.fn();
    let listener = null;
    globalThis.window = {
      desktop: {
        isElectron: true,
        conversation: {
          onEvent: vi.fn((handler) => {
            listener = handler;
            return unsubscribe;
          }),
        },
      },
    };

    const chatHandler = vi.fn();
    const off = desktopBridge.chat.onEvent(chatHandler);
    listener?.({
      channel: 'voice',
      type: 'asr-final',
      text: 'ignored',
    });
    listener?.({
      channel: 'chat',
      streamId: 'stream-1',
      type: 'text-delta',
      payload: { content: 'hello' },
    });

    expect(chatHandler).toHaveBeenCalledTimes(1);
    expect(chatHandler).toHaveBeenCalledWith({
      streamId: 'stream-1',
      type: 'text-delta',
      payload: { content: 'hello' },
    });
    off();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('routes voice.onEvent through conversation:event channel=voice', () => {
    const unsubscribe = vi.fn();
    let listener = null;
    globalThis.window = {
      desktop: {
        isElectron: true,
        conversation: {
          onEvent: vi.fn((handler) => {
            listener = handler;
            return unsubscribe;
          }),
        },
      },
    };

    const voiceHandler = vi.fn();
    const off = desktopBridge.voice.onEvent(voiceHandler);
    listener?.({
      channel: 'chat',
      streamId: 'stream-2',
      type: 'text-delta',
      payload: { content: 'ignored' },
    });
    listener?.({
      channel: 'voice',
      type: 'asr-final',
      sessionId: 'voice-session-1',
      text: 'hello',
      timestamp: '2026-03-07T00:00:00.000Z',
    });

    expect(voiceHandler).toHaveBeenCalledTimes(1);
    expect(voiceHandler).toHaveBeenCalledWith({
      type: 'asr-final',
      sessionId: 'voice-session-1',
      text: 'hello',
      timestamp: '2026-03-07T00:00:00.000Z',
    });
    off();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('routes voice.onPttCommand through dedicated channel', () => {
    const unsubscribe = vi.fn();
    let listener = null;
    globalThis.window = {
      desktop: {
        isElectron: true,
        voice: {
          onPttCommand: vi.fn((handler) => {
            listener = handler;
            return unsubscribe;
          }),
        },
      },
    };

    const handler = vi.fn();
    const off = desktopBridge.voice.onPttCommand(handler);
    listener?.({ action: 'start', hotkey: 'F8' });

    expect(handler).toHaveBeenCalledWith({ action: 'start', hotkey: 'F8' });
    off();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('routes voice.onPttStatus through dedicated channel and exposes getPttStatus', async () => {
    const unsubscribe = vi.fn();
    const getPttStatus = vi.fn(async () => ({ available: true, hotkey: 'SPACE', error: '' }));
    let listener = null;
    globalThis.window = {
      desktop: {
        isElectron: true,
        voice: {
          getPttStatus,
          onPttStatus: vi.fn((handler) => {
            listener = handler;
            return unsubscribe;
          }),
        },
      },
    };

    await expect(desktopBridge.voice.getPttStatus()).resolves.toEqual({
      available: true,
      hotkey: 'SPACE',
      error: '',
    });

    const handler = vi.fn();
    const off = desktopBridge.voice.onPttStatus(handler);
    listener?.({ available: false, hotkey: 'F8', error: 'permission denied' });

    expect(handler).toHaveBeenCalledWith({ available: false, hotkey: 'F8', error: 'permission denied' });
    off();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
