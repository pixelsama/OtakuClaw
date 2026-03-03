import { describe, expect, it } from 'vitest';
import { MODE_PET, MODE_WINDOW } from '../src/mode/ModeContext.jsx';
import { normalizePetCursorContext } from '../src/hooks/pet/usePetCursorTracking.js';

describe('normalizePetCursorContext', () => {
  it('returns null when context is invalid', () => {
    expect(normalizePetCursorContext(null)).toBeNull();
    expect(normalizePetCursorContext({ ok: false, mode: MODE_PET })).toBeNull();
    expect(
      normalizePetCursorContext({
        ok: true,
        mode: MODE_WINDOW,
        cursor: { x: 0, y: 0 },
        desktopBounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ).toBeNull();
  });

  it('converts desktop cursor to normalized live2d pointer', () => {
    const normalized = normalizePetCursorContext({
      ok: true,
      mode: MODE_PET,
      cursor: { x: 150, y: 70 },
      desktopBounds: { x: 50, y: 20, width: 200, height: 100 },
    });

    expect(normalized?.normalizedX).toBe(0);
    expect(normalized?.normalizedY).toBeCloseTo(0);
  });

  it('maps top-left corner to (-1, 1)', () => {
    const normalized = normalizePetCursorContext({
      ok: true,
      mode: MODE_PET,
      cursor: { x: 50, y: 20 },
      desktopBounds: { x: 50, y: 20, width: 200, height: 100 },
    });

    expect(normalized).toEqual({ normalizedX: -1, normalizedY: 1 });
  });
});
