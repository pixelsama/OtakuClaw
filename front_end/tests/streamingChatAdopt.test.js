import { describe, expect, it } from 'vitest';
import { shouldAutoAdoptDesktopStreamEvent } from '../src/hooks/useStreamingChat.js';

describe('shouldAutoAdoptDesktopStreamEvent', () => {
  it('rejects unknown text stream events to avoid stale reply adoption', () => {
    const result = shouldAutoAdoptDesktopStreamEvent({
      streamId: 'stale-text-stream',
      type: 'text-delta',
      payload: {
        inputSource: 'text-composer',
      },
      hasPending: false,
      activeStreamId: null,
    });

    expect(result).toBe(false);
  });

  it('accepts voice-asr background events when no active stream exists', () => {
    const result = shouldAutoAdoptDesktopStreamEvent({
      streamId: 'voice-stream',
      type: 'segment-ready',
      payload: {
        inputSource: 'voice-asr',
      },
      hasPending: false,
      activeStreamId: null,
    });

    expect(result).toBe(true);
  });

  it('rejects adoption when another active stream exists', () => {
    const result = shouldAutoAdoptDesktopStreamEvent({
      streamId: 'voice-stream-b',
      type: 'segment-ready',
      payload: {
        inputSource: 'voice-asr',
      },
      hasPending: false,
      activeStreamId: 'voice-stream-a',
    });

    expect(result).toBe(false);
  });
});

