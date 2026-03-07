import { describe, expect, it } from 'vitest';
import {
  describePttStatus,
  resolveCatalogSelectionFromBundle,
} from '../src/components/config/VoiceSettingsPanel.jsx';

function createT() {
  return (key, values = {}) => `${key}|${values.hotkey || ''}|${values.error || ''}`;
}

describe('describePttStatus', () => {
  it('returns success copy when global ptt is available', () => {
    const result = describePttStatus({
      status: { available: true, hotkey: 'SPACE', error: '' },
      fallbackHotkey: 'F8',
      t: createT(),
    });

    expect(result).toEqual({
      severity: 'success',
      message: 'voice.pttStatusReady|SPACE|',
    });
  });

  it('returns permission guidance when the hook reports a permission-like error', () => {
    const result = describePttStatus({
      status: { available: false, hotkey: 'F8', error: 'Accessibility permission denied' },
      fallbackHotkey: 'F8',
      t: createT(),
    });

    expect(result).toEqual({
      severity: 'warning',
      message: 'voice.pttStatusPermissionDenied|F8|',
    });
  });

  it('treats worker abort exits as permission-style guidance', () => {
    const result = describePttStatus({
      status: { available: false, hotkey: 'F8', error: 'ptt_worker_exited:null:SIGABRT' },
      fallbackHotkey: 'F8',
      t: createT(),
    });

    expect(result).toEqual({
      severity: 'warning',
      message: 'voice.pttStatusPermissionDenied|F8|',
    });
  });

  it('returns generic unavailable copy for non-permission errors', () => {
    const result = describePttStatus({
      status: { available: false, hotkey: 'F9', error: 'uiohook bootstrap failed' },
      fallbackHotkey: 'F8',
      t: createT(),
    });

    expect(result).toEqual({
      severity: 'warning',
      message: 'voice.pttStatusUnavailable|F9|uiohook bootstrap failed',
    });
  });
});

describe('resolveCatalogSelectionFromBundle', () => {
  it('prefers the catalog id of the active selected bundle', () => {
    const result = resolveCatalogSelectionFromBundle({
      bundles: [
        {
          id: 'tts-bundle-1',
          catalogId: 'builtin-tts-qwen3-0.6b-8bit-v1',
          runtime: {
            kind: 'python',
            ttsEngine: 'qwen3-mlx',
            ttsModelDir: '/tmp/tts-model',
          },
        },
      ],
      selectedBundleId: 'tts-bundle-1',
      catalogItems: [
        { id: 'builtin-tts-edge-v1', hasTts: true },
        { id: 'builtin-tts-qwen3-0.6b-8bit-v1', hasTts: true },
      ],
      previousCatalogId: 'builtin-tts-edge-v1',
      capability: 'tts',
    });

    expect(result).toBe('builtin-tts-qwen3-0.6b-8bit-v1');
  });

  it('keeps the previous catalog selection only when no bundle is active', () => {
    const result = resolveCatalogSelectionFromBundle({
      bundles: [],
      selectedBundleId: '',
      catalogItems: [
        { id: 'builtin-tts-edge-v1', hasTts: true },
        { id: 'builtin-tts-qwen3-0.6b-8bit-v1', hasTts: true },
      ],
      previousCatalogId: 'builtin-tts-edge-v1',
      capability: 'tts',
    });

    expect(result).toBe('builtin-tts-edge-v1');
  });

  it('clears the catalog selection when no active bundle or valid previous catalog exists', () => {
    const result = resolveCatalogSelectionFromBundle({
      bundles: [],
      selectedBundleId: '',
      catalogItems: [
        { id: 'builtin-tts-qwen3-0.6b-8bit-v1', hasTts: true },
      ],
      previousCatalogId: 'missing-catalog',
      capability: 'tts',
    });

    expect(result).toBe('');
  });
});
