import { describe, expect, it } from 'vitest';
import { resolveCatalogSelectionFromBundle } from '../src/components/config/VoiceSettingsPanel.jsx';

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
