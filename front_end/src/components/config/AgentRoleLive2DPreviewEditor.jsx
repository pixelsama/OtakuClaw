import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Stack,
  Typography,
} from '@mui/material';
import AvatarRenderer from '../avatar/AvatarRenderer.jsx';
import Live2DControls from '../controls/Live2DControls.jsx';

const DEFAULT_LIVE2D_DRAFT = {
  selectedModelPath: '',
  modelScale: 1,
  autoEyeBlink: true,
  autoBreath: true,
  eyeTracking: true,
  motions: [],
  expressions: [],
  background: {
    hasBackground: false,
    opacity: 1,
    imageDataUrl: '',
    imageName: '',
  },
};

function clamp(value, min, max, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numericValue));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBackground(background = {}) {
  const source = isPlainObject(background) ? background : {};
  return {
    hasBackground: Boolean(source.hasBackground),
    opacity: clamp(source.opacity, 0, 1, DEFAULT_LIVE2D_DRAFT.background.opacity),
    imageDataUrl:
      typeof source.imageDataUrl === 'string' && source.imageDataUrl.trim()
        ? source.imageDataUrl
        : '',
    imageName: typeof source.imageName === 'string' ? source.imageName.trim() : '',
  };
}

function normalizeAssetEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({ ...entry }));
}

function normalizeValue(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    selectedModelPath:
      typeof source.selectedModelPath === 'string' ? source.selectedModelPath.trim() : '',
    modelScale: clamp(source.modelScale, 0.1, 3, DEFAULT_LIVE2D_DRAFT.modelScale),
    autoEyeBlink:
      typeof source.autoEyeBlink === 'boolean'
        ? source.autoEyeBlink
        : DEFAULT_LIVE2D_DRAFT.autoEyeBlink,
    autoBreath:
      typeof source.autoBreath === 'boolean' ? source.autoBreath : DEFAULT_LIVE2D_DRAFT.autoBreath,
    eyeTracking:
      typeof source.eyeTracking === 'boolean' ? source.eyeTracking : DEFAULT_LIVE2D_DRAFT.eyeTracking,
    motions: normalizeAssetEntries(source.motions),
    expressions: normalizeAssetEntries(source.expressions),
    background: normalizeBackground(source.background),
  };
}

async function fileLikeToDataUrl(fileLike) {
  if (!fileLike) {
    return '';
  }

  if (typeof fileLike === 'string') {
    return fileLike;
  }

  if (!(fileLike instanceof Blob)) {
    return '';
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('background_read_failed'));
    reader.readAsDataURL(fileLike);
  });
}

async function dataUrlToFile(dataUrl, fallbackName = 'background.png') {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return null;
  }

  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fallbackName, { type: blob.type || 'image/png' });
}

export default function AgentRoleLive2DPreviewEditor({
  agentKey = 'draft-agent',
  value,
  onChange,
}) {
  const normalizedValue = useMemo(() => normalizeValue(value), [value]);
  const live2dViewerRef = useRef(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [backgroundError, setBackgroundError] = useState('');

  useEffect(() => {
    setModelLoaded(false);
  }, [normalizedValue.selectedModelPath]);

  useEffect(() => {
    let cancelled = false;

    const applyBackground = async () => {
      const manager = live2dViewerRef.current?.getManager?.();
      if (!manager) {
        return;
      }

      try {
        if (!normalizedValue.background.hasBackground || !normalizedValue.background.imageDataUrl) {
          manager.clearBackground?.();
          manager.setBackgroundOpacity?.(normalizedValue.background.opacity);
          if (!cancelled) {
            setBackgroundError('');
          }
          return;
        }

        const file = await dataUrlToFile(
          normalizedValue.background.imageDataUrl,
          normalizedValue.background.imageName || 'background.png',
        );
        if (!file || cancelled) {
          return;
        }

        const loaded = await manager.loadBackgroundImage?.(file);
        if (cancelled) {
          return;
        }

        manager.setBackgroundOpacity?.(normalizedValue.background.opacity);
        setBackgroundError(loaded === false ? 'Failed to restore draft background.' : '');
      } catch (error) {
        if (!cancelled) {
          setBackgroundError(error?.message || 'Failed to restore draft background.');
        }
      }
    };

    void applyBackground();

    return () => {
      cancelled = true;
    };
  }, [normalizedValue.background]);

  const controlledLive2dState = useMemo(() => ({
    selectedModelPath: normalizedValue.selectedModelPath,
    modelScale: normalizedValue.modelScale,
    autoEyeBlink: normalizedValue.autoEyeBlink,
    autoBreath: normalizedValue.autoBreath,
    eyeTracking: normalizedValue.eyeTracking,
    motions: normalizedValue.motions,
    expressions: normalizedValue.expressions,
  }), [
    normalizedValue.autoBreath,
    normalizedValue.autoEyeBlink,
    normalizedValue.expressions,
    normalizedValue.eyeTracking,
    normalizedValue.modelScale,
    normalizedValue.motions,
    normalizedValue.selectedModelPath,
  ]);

  const handleBackgroundChange = useCallback(
    async (backgroundConfig = {}) => {
      try {
        const source = Array.isArray(backgroundConfig.image) ? backgroundConfig.image[0] : null;
        const imageDataUrl =
          backgroundConfig.hasBackground && source ? await fileLikeToDataUrl(source) : '';
        onChange?.({
          background: {
            hasBackground: Boolean(backgroundConfig.hasBackground),
            opacity: clamp(backgroundConfig.opacity, 0, 1, normalizedValue.background.opacity),
            imageDataUrl,
            imageName: source?.name || '',
          },
        });
        setBackgroundError('');
      } catch (error) {
        setBackgroundError(error?.message || 'Failed to store draft background.');
      }
    },
    [normalizedValue.background.opacity, onChange],
  );

  return (
    <Stack spacing={1.5}>
      <Box
        sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          minHeight: 320,
          overflow: 'hidden',
          background:
            'radial-gradient(circle at top, rgba(255,255,255,0.92), rgba(240,245,250,0.75) 38%, rgba(226,232,240,0.65) 100%)',
        }}
      >
        <Stack sx={{ height: '100%' }}>
          <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2">Live2D Preview</Typography>
            <Typography variant="caption" color="text.secondary">
              Draft-only preview for the agent currently being edited.
            </Typography>
          </Box>
          <Box sx={{ flex: 1, minHeight: 260 }}>
            <AvatarRenderer
              ref={live2dViewerRef}
              renderMode="live2d"
              modelPath={normalizedValue.selectedModelPath}
              motions={normalizedValue.motions}
              expressions={normalizedValue.expressions}
              width={320}
              height={320}
              onModelLoaded={() => {
                setModelLoaded(true);
              }}
              onModelError={() => {
                setModelLoaded(false);
              }}
            />
          </Box>
        </Stack>
      </Box>

      {backgroundError ? <Alert severity="warning">{backgroundError}</Alert> : null}

      <Live2DControls
        key={agentKey}
        live2dViewerRef={live2dViewerRef}
        modelLoaded={modelLoaded}
        isPetMode={false}
        live2dState={controlledLive2dState}
        onLive2dStateChange={(nextState) => {
          onChange?.({
            selectedModelPath: nextState.selectedModelPath || '',
            modelScale: clamp(nextState.modelScale, 0.1, 3, normalizedValue.modelScale),
            autoEyeBlink: Boolean(nextState.autoEyeBlink),
            autoBreath: Boolean(nextState.autoBreath),
            eyeTracking: Boolean(nextState.eyeTracking),
            motions: normalizeAssetEntries(nextState.motions),
            expressions: normalizeAssetEntries(nextState.expressions),
          });
        }}
        persistState={false}
        onBackgroundChange={(backgroundConfig) => {
          void handleBackgroundChange(backgroundConfig);
        }}
      />
    </Stack>
  );
}
