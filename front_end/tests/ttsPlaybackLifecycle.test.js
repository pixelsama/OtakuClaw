import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTtsPlaybackLifecycleTracker } from '../src/hooks/voice/ttsPlaybackLifecycle.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('createTtsPlaybackLifecycleTracker', () => {
  it('emits playback-started on actual chunk start and playback-finished after the last chunk ends', () => {
    vi.useFakeTimers();
    const events = [];
    const tracker = createTtsPlaybackLifecycleTracker({
      emitEvent: (event) => events.push(event),
      setTimer: setTimeout,
      clearTimer: clearTimeout,
    });

    tracker.markSegmentStarted({
      sessionId: 'session-1',
      turnId: 'turn-1',
      segmentId: 'turn-1:0',
      index: 0,
      text: '第一段字幕',
    });
    const finishChunk = tracker.scheduleChunkPlayback({
      sessionId: 'session-1',
      turnId: 'turn-1',
      segmentId: 'turn-1:0',
      index: 0,
      startAt: 0.25,
      currentTime: 0,
    });

    vi.advanceTimersByTime(249);
    expect(events).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(events).toEqual([
      {
        type: 'segment-playback-started',
        sessionId: 'session-1',
        turnId: 'turn-1',
        segmentId: 'turn-1:0',
        index: 0,
        text: '第一段字幕',
      },
    ]);

    tracker.markSegmentFinished({
      sessionId: 'session-1',
      turnId: 'turn-1',
      segmentId: 'turn-1:0',
      index: 0,
      text: '第一段字幕',
    });
    expect(events).toHaveLength(1);

    finishChunk();
    expect(events).toEqual([
      {
        type: 'segment-playback-started',
        sessionId: 'session-1',
        turnId: 'turn-1',
        segmentId: 'turn-1:0',
        index: 0,
        text: '第一段字幕',
      },
      {
        type: 'segment-playback-finished',
        sessionId: 'session-1',
        turnId: 'turn-1',
        segmentId: 'turn-1:0',
        index: 0,
        text: '第一段字幕',
      },
    ]);
  });

  it('does not emit playback-started when synthesis fails before the scheduled chunk begins', () => {
    vi.useFakeTimers();
    const events = [];
    const tracker = createTtsPlaybackLifecycleTracker({
      emitEvent: (event) => events.push(event),
      setTimer: setTimeout,
      clearTimer: clearTimeout,
    });

    tracker.markSegmentStarted({
      sessionId: 'session-1',
      turnId: 'turn-1',
      segmentId: 'turn-1:1',
      index: 1,
      text: '失败段落',
    });
    const finishChunk = tracker.scheduleChunkPlayback({
      sessionId: 'session-1',
      turnId: 'turn-1',
      segmentId: 'turn-1:1',
      index: 1,
      startAt: 1,
      currentTime: 0,
    });

    tracker.markSegmentFailed({
      sessionId: 'session-1',
      turnId: 'turn-1',
      segmentId: 'turn-1:1',
      index: 1,
      text: '失败段落',
    });
    finishChunk();
    vi.runAllTimers();

    expect(events).toEqual([
      {
        type: 'segment-playback-failed',
        sessionId: 'session-1',
        turnId: 'turn-1',
        segmentId: 'turn-1:1',
        index: 1,
        text: '失败段落',
      },
    ]);
  });

  it('emits playback-reset and clears queued segment timers', () => {
    vi.useFakeTimers();
    const events = [];
    const tracker = createTtsPlaybackLifecycleTracker({
      emitEvent: (event) => events.push(event),
      setTimer: setTimeout,
      clearTimer: clearTimeout,
    });

    tracker.markSegmentStarted({
      sessionId: 'session-1',
      turnId: 'turn-1',
      segmentId: 'turn-1:2',
      index: 2,
      text: '待重置段落',
    });
    tracker.scheduleChunkPlayback({
      sessionId: 'session-1',
      turnId: 'turn-1',
      segmentId: 'turn-1:2',
      index: 2,
      startAt: 1,
      currentTime: 0,
    });

    tracker.reset({ reason: 'manual_stop' });
    vi.runAllTimers();

    expect(events).toEqual([
      {
        type: 'segment-playback-reset',
        reason: 'manual_stop',
      },
    ]);
  });
});
