import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyWithHandshake } from '../src/mode/useModeHandshake.js';

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

afterEach(() => {
  vi.useRealTimers();
  if (typeof originalRequestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  } else {
    delete globalThis.requestAnimationFrame;
  }
});

describe('mode handshake', () => {
  it('notifies after two animation frames', () => {
    const frames = [];
    globalThis.requestAnimationFrame = (callback) => {
      frames.push(callback);
      return frames.length;
    };

    const notify = vi.fn();
    notifyWithHandshake(notify, 'pet');

    expect(notify).not.toHaveBeenCalled();
    frames[0]?.(0);
    expect(notify).not.toHaveBeenCalled();
    frames[1]?.(16);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('pet');
  });

  it('falls back to timeout when animation frames are suspended', () => {
    vi.useFakeTimers();
    globalThis.requestAnimationFrame = () => 1;

    const notify = vi.fn();
    notifyWithHandshake(notify, 'window');

    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(121);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('window');
  });
});
