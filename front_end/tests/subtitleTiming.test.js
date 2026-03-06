import { describe, expect, it } from 'vitest';
import {
  computeSyntheticSubtitleDurationMs,
  estimateSubtitlePauseMs,
  estimateSubtitleUnits,
} from '../src/hooks/chat/subtitleTiming.js';

describe('subtitleTiming', () => {
  it('counts mixed-language subtitle units conservatively', () => {
    const units = estimateSubtitleUnits('你好，welcome back 2026 😊');

    expect(units).toBeGreaterThan(3);
    expect(units).toBeLessThan(5);
  });

  it('adds pause compensation for punctuation and line breaks', () => {
    const pauseMs = estimateSubtitlePauseMs('你好，世界！\n现在继续……');

    expect(pauseMs).toBe(980);
  });

  it('keeps very short subtitles visible for a minimum duration', () => {
    expect(computeSyntheticSubtitleDurationMs('你好')).toBe(900);
    expect(computeSyntheticSubtitleDurationMs('😊')).toBe(900);
  });

  it('caps extremely long subtitles to avoid lingering forever', () => {
    const longText = '这是一个很长的字幕片段'.repeat(30);

    expect(computeSyntheticSubtitleDurationMs(longText)).toBe(4200);
  });
});

