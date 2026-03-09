import { describe, expect, it } from 'vitest';
import {
  buildDesktopConversationRequest,
  shouldAutoAdoptDesktopStreamEvent,
} from '../src/hooks/useStreamingChat.js';

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

describe('buildDesktopConversationRequest', () => {
  it('keeps legacy top-level attachments when routing desktop requests', () => {
    const result = buildDesktopConversationRequest('text-composer', '请问网站是？', {
      attachments: [{ kind: 'capture-image', captureId: 'cap-1' }],
    });

    expect(result).toEqual({
      sessionId: 'text-composer',
      content: '请问网站是？',
      policy: 'latest-wins',
      options: {
        attachments: [{ kind: 'capture-image', captureId: 'cap-1' }],
      },
    });
  });

  it('merges nested options over legacy desktop extras', () => {
    const result = buildDesktopConversationRequest('text-composer', 'hello', {
      attachments: [{ kind: 'capture-image', captureId: 'cap-1' }],
      options: {
        source: 'voice-asr',
      },
      policy: 'queue',
    });

    expect(result).toEqual({
      sessionId: 'text-composer',
      content: 'hello',
      policy: 'queue',
      options: {
        attachments: [{ kind: 'capture-image', captureId: 'cap-1' }],
        source: 'voice-asr',
      },
    });
  });
});
