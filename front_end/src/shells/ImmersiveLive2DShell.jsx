import { useMemo, useState } from 'react';
import { Button, Chip, Stack } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import RestaurantOutlinedIcon from '@mui/icons-material/RestaurantOutlined';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import Live2DViewer from '../components/live2d/Live2DViewer.jsx';
import { resolveOfficeSceneAsset } from '../components/office/officeSceneAssets.js';
import './ImmersiveLive2DShell.css';

const IMMERSIVE_BACKGROUND_PRESETS = {
  default: {
    id: 'studio-default',
    label: 'Studio Default',
    subtitle: 'Focus layer',
    backdropAssetKey: 'starOfficeBackdrop',
    accent: '#78b8ff',
    accentSoft: 'rgba(90, 151, 255, 0.26)',
    glow: 'rgba(127, 188, 255, 0.26)',
  },
  desk: {
    id: 'studio-workbench',
    label: 'Workbench',
    subtitle: 'Deep desk focus',
    backdropAssetKey: 'starOfficeBackdrop',
    accent: '#ffd27d',
    accentSoft: 'rgba(255, 207, 123, 0.22)',
    glow: 'rgba(255, 202, 104, 0.24)',
  },
  coffee: {
    id: 'studio-cafe',
    label: 'Cafe',
    subtitle: 'Soft exchange layer',
    backdropAssetKey: 'starOfficeBackdrop',
    accent: '#86e1c6',
    accentSoft: 'rgba(122, 232, 197, 0.2)',
    glow: 'rgba(124, 221, 193, 0.22)',
  },
  sofa: {
    id: 'studio-lounge',
    label: 'Lounge',
    subtitle: 'Rest and talk',
    backdropAssetKey: 'starOfficeBackdrop',
    accent: '#d69cff',
    accentSoft: 'rgba(214, 156, 255, 0.2)',
    glow: 'rgba(202, 150, 255, 0.22)',
  },
  lounge: {
    id: 'studio-lounge',
    label: 'Lounge',
    subtitle: 'Rest and talk',
    backdropAssetKey: 'starOfficeBackdrop',
    accent: '#d69cff',
    accentSoft: 'rgba(214, 156, 255, 0.2)',
    glow: 'rgba(202, 150, 255, 0.22)',
  },
  syncdock: {
    id: 'studio-sync',
    label: 'Sync Dock',
    subtitle: 'Asset sync and handoff',
    backdropAssetKey: 'starOfficeBackdrop',
    accent: '#7ee1ff',
    accentSoft: 'rgba(126, 225, 255, 0.2)',
    glow: 'rgba(97, 196, 255, 0.24)',
  },
  serverroom: {
    id: 'studio-tech',
    label: 'Server Room',
    subtitle: 'System intelligence',
    backdropAssetKey: 'starOfficeBackdrop',
    accent: '#95f0a1',
    accentSoft: 'rgba(149, 240, 161, 0.2)',
    glow: 'rgba(122, 230, 137, 0.24)',
  },
  bugnook: {
    id: 'studio-alert',
    label: 'Alert Corner',
    subtitle: 'Something needs attention',
    backdropAssetKey: 'starOfficeBackdrop',
    accent: '#ff9c91',
    accentSoft: 'rgba(255, 156, 145, 0.2)',
    glow: 'rgba(255, 150, 139, 0.24)',
  },
};

function normalizeText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function resolveStatValue(source = {}, statKey = '') {
  if (!source || typeof source !== 'object') {
    return null;
  }

  const stat = source[statKey];
  if (typeof stat === 'number' && Number.isFinite(stat)) {
    return stat;
  }

  if (typeof stat === 'string' && stat.trim()) {
    const parsed = Number(stat);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (stat && typeof stat === 'object') {
    if (typeof stat.value === 'number' && Number.isFinite(stat.value)) {
      return stat.value;
    }

    if (typeof stat.current === 'number' && Number.isFinite(stat.current)) {
      return stat.current;
    }
  }

  return null;
}

function resolveValueSource(valueSnapshot = null, agent = null) {
  return [
    valueSnapshot?.stats,
    valueSnapshot?.payload?.stats,
    valueSnapshot?.lastEvent?.payload?.stats,
    agent?.stats,
    agent?.valueState?.stats,
  ].find((candidate) => candidate && typeof candidate === 'object' && Object.keys(candidate).length > 0) || null;
}

export function resolveImmersiveBackgroundPreset(areaId = '') {
  const normalizedAreaId = normalizeText(areaId, '').toLowerCase();
  return IMMERSIVE_BACKGROUND_PRESETS[normalizedAreaId] || IMMERSIVE_BACKGROUND_PRESETS.default;
}

function ValueChip({ label, value, tone }) {
  const displayValue = value === null ? '--' : value;
  return (
    <Chip
      className={`immersive-live2d-shell__value-chip tone-${tone}`.trim()}
      label={`${label} ${displayValue}`}
      size="small"
      variant="outlined"
    />
  );
}

export default function ImmersiveLive2DShell({
  desktopMode = false,
  platform = '',
  live2dViewerRef = null,
  currentModelPath = '',
  motions = [],
  expressions = [],
  onModelLoaded,
  onModelError,
  immersiveContext = null,
  valueSnapshot = null,
  onOpenChatPanel,
  onBackToRoom,
  onActionRequested,
}) {
  const [statusText, setStatusText] = useState('');
  const sourceAreaId = normalizeText(immersiveContext?.sourceAreaId || immersiveContext?.areaId, '');
  const agent = immersiveContext?.agent || null;
  const background = useMemo(() => resolveImmersiveBackgroundPreset(sourceAreaId), [sourceAreaId]);
  const backgroundAsset = useMemo(() => resolveOfficeSceneAsset(background.backdropAssetKey), [background.backdropAssetKey]);
  const valueStats = resolveValueSource(valueSnapshot, agent);
  const mood = resolveStatValue(valueStats, 'mood');
  const affinity = resolveStatValue(valueStats, 'affinity');
  const areaLabel = background.label;

  const handleAction = (actionType, feedbackText, handler) => {
    setStatusText(feedbackText);
    handler?.(actionType, {
      immersiveContext,
      agent,
      sourceAreaId,
      valueSnapshot,
    });
  };

  return (
    <section
      className={`immersive-live2d-shell platform-${desktopMode ? platform : 'web'}`.trim()}
      style={{
        '--immersive-accent': background.accent,
        '--immersive-accent-soft': background.accentSoft,
        '--immersive-glow': background.glow,
      }}
    >
      <div
        className="immersive-live2d-shell__backdrop"
        style={{
          backgroundImage: [
            'radial-gradient(circle at top left, rgba(255, 255, 255, 0.18), transparent 36%)',
            'radial-gradient(circle at 80% 20%, rgba(255, 214, 143, 0.18), transparent 28%)',
            'radial-gradient(circle at 26% 64%, rgba(255, 255, 255, 0.06), transparent 46%)',
            `linear-gradient(180deg, ${background.accentSoft}, rgba(20, 34, 82, 0.3) 72%)`,
            backgroundAsset?.url ? `url(${backgroundAsset.url})` : 'none',
          ].join(', '),
        }}
        aria-hidden="true"
      />

      <div className="immersive-live2d-shell__frame">
        <Button
          className="immersive-live2d-shell__back-button"
          variant="text"
          startIcon={<ArrowBackRoundedIcon />}
          onClick={() => {
            onBackToRoom?.();
          }}
        >
          返回房间
        </Button>

        <div className="immersive-live2d-shell__meta">
          <Chip className="immersive-live2d-shell__area-chip" label={areaLabel} size="small" />
          <ValueChip label="Mood" value={mood} tone="mood" />
          <ValueChip label="Affinity" value={affinity} tone="affinity" />
        </div>

        <div className="immersive-live2d-shell__content">
          <div className="immersive-live2d-shell__stage">
            <div className="immersive-live2d-shell__viewer-shell">
              <Live2DViewer
                ref={live2dViewerRef}
                modelPath={currentModelPath}
                motions={motions}
                expressions={expressions}
                width={560}
                height={760}
                onModelLoaded={onModelLoaded}
                onModelError={onModelError}
                className="immersive-live2d-shell__viewer"
              />
            </div>
          </div>

          <aside className="immersive-live2d-shell__rail" aria-label="互动操作">
            <Stack spacing={1.25}>
              <Button
                className="immersive-live2d-shell__action-button"
                variant="contained"
                startIcon={<ChatBubbleOutlineRoundedIcon />}
                onClick={() => {
                  handleAction('conversation', '已打开对话', () => {
                    onOpenChatPanel?.();
                  });
                }}
              >
                对话
              </Button>
              <Button
                className="immersive-live2d-shell__action-button"
                variant="outlined"
                startIcon={<AutoAwesomeRoundedIcon />}
                onClick={() => {
                  handleAction('interaction', '已执行互动动作', onActionRequested);
                }}
              >
                互动动作
              </Button>
              <Button
                className="immersive-live2d-shell__action-button"
                variant="outlined"
                startIcon={<RestaurantOutlinedIcon />}
                onClick={() => {
                  handleAction('feed', '已安排喂食', onActionRequested);
                }}
              >
                喂食
              </Button>
            </Stack>

            {statusText ? <div className="immersive-live2d-shell__feedback">{statusText}</div> : null}
          </aside>
        </div>
      </div>
    </section>
  );
}
