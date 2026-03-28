import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import StaticAvatarControls from '../avatar/StaticAvatarControls.jsx';
import AvatarRenderer from '../avatar/AvatarRenderer.jsx';
import AgentRoleLive2DPreviewEditor from './AgentRoleLive2DPreviewEditor.jsx';
import { desktopBridge } from '../../services/desktopBridge.js';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { normalizeOfficeState } from '../office/officeSceneConfig.js';

const AGENT_STATE_OPTIONS = ['idle', 'writing', 'researching', 'executing', 'syncing', 'error'];
const AGENT_BACKEND_OPTIONS = ['nanobot', 'claude-code', 'codex'];
const DEFAULT_AGENT_AVATAR = {
  renderMode: 'live2d',
  live2d: {
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
  },
  static: {
    selectedPackId: '',
    scale: 1,
    hitTest: {
      mode: 'alpha',
      alphaThreshold: 10,
    },
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

function normalizeAgentId(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function normalizeAgentBackend(value, fallback = 'nanobot') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return AGENT_BACKEND_OPTIONS.includes(normalized) ? normalized : fallback;
}

function normalizeBusinessState(value, fallback = 'idle') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return AGENT_STATE_OPTIONS.includes(normalized) ? normalized : fallback;
}

function normalizeAvatarRenderMode(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'static' ? 'static' : 'live2d';
}

function normalizeStaticHitTest(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    mode: source.mode === 'rect' ? 'rect' : 'alpha',
    alphaThreshold: clamp(source.alphaThreshold, 0, 255, DEFAULT_AGENT_AVATAR.static.hitTest.alphaThreshold),
  };
}

function normalizeStaticAvatar(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    selectedPackId: typeof source.selectedPackId === 'string' ? source.selectedPackId.trim() : '',
    scale: clamp(source.scale, 0.1, 3, DEFAULT_AGENT_AVATAR.static.scale),
    hitTest: normalizeStaticHitTest(source.hitTest),
  };
}

function normalizeLive2dBackground(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    hasBackground: Boolean(source.hasBackground),
    opacity: clamp(source.opacity, 0, 1, DEFAULT_AGENT_AVATAR.live2d.background.opacity),
    imageDataUrl:
      typeof source.imageDataUrl === 'string' && source.imageDataUrl.trim()
        ? source.imageDataUrl
        : '',
    imageName: typeof source.imageName === 'string' ? source.imageName.trim() : '',
  };
}

function normalizeLive2dAssets(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ ...item }));
}

function normalizeLive2dAvatar(value = {}, legacyModelPath = '') {
  const source = isPlainObject(value) ? value : {};
  return {
    selectedModelPath:
      typeof source.selectedModelPath === 'string' && source.selectedModelPath.trim()
        ? source.selectedModelPath.trim()
        : (typeof legacyModelPath === 'string' ? legacyModelPath.trim() : ''),
    modelScale: clamp(source.modelScale, 0.1, 3, DEFAULT_AGENT_AVATAR.live2d.modelScale),
    autoEyeBlink:
      typeof source.autoEyeBlink === 'boolean'
        ? source.autoEyeBlink
        : DEFAULT_AGENT_AVATAR.live2d.autoEyeBlink,
    autoBreath:
      typeof source.autoBreath === 'boolean' ? source.autoBreath : DEFAULT_AGENT_AVATAR.live2d.autoBreath,
    eyeTracking:
      typeof source.eyeTracking === 'boolean' ? source.eyeTracking : DEFAULT_AGENT_AVATAR.live2d.eyeTracking,
    motions: normalizeLive2dAssets(source.motions),
    expressions: normalizeLive2dAssets(source.expressions),
    background: normalizeLive2dBackground(source.background),
  };
}

function normalizeAvatar(value = {}, legacyModelPath = '') {
  const source = isPlainObject(value) ? value : {};
  return {
    renderMode: normalizeAvatarRenderMode(source.renderMode),
    live2d: normalizeLive2dAvatar(source.live2d, legacyModelPath),
    static: normalizeStaticAvatar(source.static),
  };
}

function isValidAgentId(value) {
  return /^[a-z0-9_-]+$/.test(value);
}

function createEmptyDraft(defaultBackend = 'nanobot') {
  return {
    agentId: '',
    displayName: '',
    role: 'support',
    businessState: 'idle',
    detail: '',
    backend: normalizeAgentBackend(defaultBackend, 'nanobot'),
    avatar: normalizeAvatar(DEFAULT_AGENT_AVATAR),
  };
}

function resolveBackendLabel(t, backend = '') {
  if (backend === 'codex') {
    return t('app.backend.codex');
  }
  if (backend === 'claude-code') {
    return t('app.backend.claudeCode');
  }
  return t('app.backend.nanobot');
}

function normalizeConfiguredAgent(entry = {}, index = 0, defaultBackend = 'nanobot') {
  const source = entry && typeof entry === 'object' ? entry : {};
  const agentId = normalizeAgentId(source.agentId || source.id || `agent-${index + 1}`);
  if (!agentId) {
    return null;
  }

  const avatar = normalizeAvatar(source.avatar, source.live2dModelPath);
  return {
    agentId,
    id: agentId,
    displayName: typeof source.displayName === 'string' && source.displayName.trim()
      ? source.displayName.trim()
      : agentId,
    role: typeof source.role === 'string' && source.role.trim() ? source.role.trim() : 'support',
    businessState: normalizeBusinessState(source.businessState, 'idle'),
    detail: typeof source.detail === 'string' ? source.detail.trim() : '',
    backend: normalizeAgentBackend(source.backend, defaultBackend),
    avatar,
    live2dModelPath: avatar.live2d.selectedModelPath,
  };
}

export default function AgentRoleSettingsPanel({
  officeState = {},
  agentRoleConfig = {},
  defaultBackend = 'nanobot',
  onUpsertAgent,
  onRemoveAgent,
  onSetActiveAgent,
  onStaticAvatarPacksChange,
}) {
  const { t } = useI18n();
  const desktopMode = desktopBridge.isDesktop();
  const normalizedOfficeState = useMemo(() => normalizeOfficeState(officeState), [officeState]);
  const normalizedDefaultBackend = normalizeAgentBackend(defaultBackend, 'nanobot');
  const [draft, setDraft] = useState(() => createEmptyDraft(normalizedDefaultBackend));
  const [editingAgentId, setEditingAgentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [availableStaticPacks, setAvailableStaticPacks] = useState([]);

  const activeAgentId = typeof normalizedOfficeState.activeAgentId === 'string'
    ? normalizedOfficeState.activeAgentId.trim()
    : '';

  const configuredAgents = useMemo(() => {
    const sourceAgents = Array.isArray(agentRoleConfig?.agents) ? agentRoleConfig.agents : [];
    return sourceAgents
      .map((entry, index) => normalizeConfiguredAgent(entry, index, normalizedDefaultBackend))
      .filter(Boolean)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }, [agentRoleConfig?.agents, normalizedDefaultBackend]);

  const modelNameByPath = useMemo(() => {
    const byPath = new Map();
    for (const model of availableModels) {
      if (typeof model?.path === 'string' && model.path.trim()) {
        byPath.set(model.path.trim(), typeof model?.name === 'string' && model.name.trim() ? model.name.trim() : model.path.trim());
      }
    }
    return byPath;
  }, [availableModels]);

  const staticPackNameById = useMemo(() => {
    const byId = new Map();
    for (const pack of availableStaticPacks) {
      if (typeof pack?.packId === 'string' && pack.packId.trim()) {
        byId.set(pack.packId.trim(), typeof pack?.name === 'string' && pack.name.trim() ? pack.name.trim() : pack.packId.trim());
      }
    }
    return byId;
  }, [availableStaticPacks]);

  const loadAvailableModels = useCallback(async () => {
    try {
      if (!desktopMode) {
        setAvailableModels([]);
        return;
      }
      const result = await desktopBridge.models.list();
      setAvailableModels(Array.isArray(result?.models) ? result.models : []);
    } catch {
      setAvailableModels([]);
    }
  }, [desktopMode]);

  useEffect(() => {
    void loadAvailableModels();
  }, [loadAvailableModels]);

  const selectedStaticPack = useMemo(
    () => availableStaticPacks.find((pack) => pack?.packId === draft.avatar.static.selectedPackId) || null,
    [availableStaticPacks, draft.avatar.static.selectedPackId],
  );

  const resetDraft = useCallback(() => {
    setEditingAgentId('');
    setDraft(createEmptyDraft(normalizedDefaultBackend));
  }, [normalizedDefaultBackend]);

  const applyEdit = (agent) => {
    if (!agent || typeof agent !== 'object') {
      return;
    }
    setEditingAgentId(agent.agentId);
    setDraft({
      agentId: agent.agentId,
      displayName: agent.displayName || '',
      role: agent.role || 'support',
      businessState: normalizeBusinessState(agent.businessState, 'idle'),
      detail: agent.detail || '',
      backend: normalizeAgentBackend(agent.backend, normalizedDefaultBackend),
      avatar: normalizeAvatar(agent.avatar, agent.live2dModelPath),
    });
    setFeedback('');
    setError('');
  };

  const updateDraftAvatarRenderMode = useCallback((renderMode) => {
    setDraft((current) => ({
      ...current,
      avatar: {
        ...current.avatar,
        renderMode: normalizeAvatarRenderMode(renderMode),
      },
    }));
  }, []);

  const updateDraftStaticAvatar = useCallback((patch = {}) => {
    setDraft((current) => ({
      ...current,
      avatar: {
        ...current.avatar,
        static: normalizeStaticAvatar({
          ...current.avatar.static,
          ...patch,
          ...(isPlainObject(patch.hitTest)
            ? {
                hitTest: {
                  ...current.avatar.static.hitTest,
                  ...patch.hitTest,
                },
              }
            : {}),
        }),
      },
    }));
  }, []);

  const updateDraftLive2dAvatar = useCallback((patch = {}) => {
    setDraft((current) => ({
      ...current,
      avatar: {
        ...current.avatar,
        live2d: normalizeLive2dAvatar({
          ...current.avatar.live2d,
          ...patch,
          ...(isPlainObject(patch.background)
            ? {
                background: {
                  ...current.avatar.live2d.background,
                  ...patch.background,
                },
              }
            : {}),
        }, current.avatar.live2d.selectedModelPath),
      },
    }));
  }, []);

  const handleSave = async () => {
    const nextAgentId = normalizeAgentId(draft.agentId);
    const nextDisplayName = typeof draft.displayName === 'string' ? draft.displayName.trim() : '';
    if (!nextAgentId) {
      setError(t('agent.role.error.agentIdRequired'));
      return;
    }
    if (!isValidAgentId(nextAgentId)) {
      setError(t('agent.role.error.agentIdInvalid'));
      return;
    }
    if (!nextDisplayName) {
      setError(t('agent.role.error.displayNameRequired'));
      return;
    }
    if (!editingAgentId && configuredAgents.some((agent) => agent.agentId === nextAgentId)) {
      setError(t('agent.role.error.agentExists'));
      return;
    }

    const normalizedAvatar = normalizeAvatar(draft.avatar, draft.avatar?.live2d?.selectedModelPath);
    const normalizedAgent = {
      agentId: nextAgentId,
      id: nextAgentId,
      displayName: nextDisplayName,
      role: draft.role || 'support',
      businessState: normalizeBusinessState(draft.businessState, 'idle'),
      detail: typeof draft.detail === 'string' ? draft.detail.trim() : '',
      backend: normalizeAgentBackend(draft.backend, normalizedDefaultBackend),
      avatar: normalizedAvatar,
      live2dModelPath: normalizedAvatar.live2d.selectedModelPath,
    };

    setBusy(true);
    setFeedback('');
    setError('');
    try {
      await onUpsertAgent?.(normalizedAgent);
      setFeedback(t('agent.role.feedback.saved', { name: nextDisplayName }));
      resetDraft();
    } catch (saveError) {
      setError(saveError?.message || t('agent.role.error.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (agentId) => {
    setBusy(true);
    setFeedback('');
    setError('');
    try {
      await onRemoveAgent?.(agentId);
      if (editingAgentId === agentId) {
        resetDraft();
      }
      setFeedback(t('agent.role.feedback.removed'));
    } catch (removeError) {
      setError(removeError?.message || t('agent.role.error.removeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleActivate = async (agentId) => {
    setBusy(true);
    setFeedback('');
    setError('');
    try {
      await onSetActiveAgent?.(agentId);
      setFeedback(t('agent.role.feedback.activeUpdated'));
    } catch (activateError) {
      setError(activateError?.message || t('agent.role.error.activateFailed'));
    } finally {
      setBusy(false);
    }
  };

  const live2dEditorKey = editingAgentId || normalizeAgentId(draft.agentId) || 'draft-agent';

  return (
    <Stack spacing={2}>
      <Alert severity="info">{t('agent.role.notice.fixedStateKeys')}</Alert>
      {feedback && <Alert severity="success">{feedback}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}

      <Stack spacing={1}>
        <Typography variant="subtitle2">{t('agent.role.currentList')}</Typography>
        {configuredAgents.length === 0 ? (
          <Alert severity="warning">{t('agent.role.noAgentsYet')}</Alert>
        ) : (
          configuredAgents.map((agent) => {
            const isActive = agent.agentId === activeAgentId;
            const isStaticAvatar = agent.avatar.renderMode === 'static';
            const live2dModelLabel = agent.live2dModelPath
              ? (modelNameByPath.get(agent.live2dModelPath) || agent.live2dModelPath)
              : t('agent.role.modelNone');
            const staticPackId = agent.avatar.static.selectedPackId;
            const staticPackLabel = staticPackId
              ? (staticPackNameById.get(staticPackId) || staticPackId)
              : t('agent.role.modelNone');
            return (
              <Box
                key={agent.agentId}
                sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 1.25, py: 1 }}
              >
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Chip size="small" label={agent.agentId} />
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{agent.displayName}</Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={isStaticAvatar ? t('avatar.controls.renderModeStatic') : t('avatar.controls.renderModeLive2d')}
                    />
                    {isActive && <Chip size="small" color="success" label={t('agent.role.active')} />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {t('agent.role.stateLabel', { state: agent.businessState })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('agent.role.backendLabel', { backend: resolveBackendLabel(t, agent.backend) })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {isStaticAvatar
                      ? `${t('avatar.controls.packLabel')}: ${staticPackLabel}`
                      : t('agent.role.modelLabel', { model: live2dModelLabel })}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Button size="small" variant="outlined" disabled={busy} onClick={() => applyEdit(agent)}>
                      {t('common.edit')}
                    </Button>
                    {!isActive && (
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={busy}
                        onClick={() => {
                          void handleActivate(agent.agentId);
                        }}
                      >
                        {t('agent.role.setActive')}
                      </Button>
                    )}
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      disabled={busy}
                      onClick={() => {
                        void handleRemove(agent.agentId);
                      }}
                    >
                      {t('common.remove')}
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            );
          })
        )}
      </Stack>

      <Divider />

      <Stack spacing={1.5}>
        <Typography variant="subtitle2">
          {editingAgentId ? t('agent.role.editTitle') : t('agent.role.createTitle')}
        </Typography>

        <TextField
          label={t('agent.role.agentId')}
          value={draft.agentId}
          onChange={(event) => setDraft((current) => ({ ...current, agentId: event.target.value }))}
          placeholder="agent-dev"
          fullWidth
          disabled={busy || Boolean(editingAgentId)}
          helperText={t('agent.role.agentIdHelper')}
        />

        <TextField
          label={t('agent.role.displayName')}
          value={draft.displayName}
          onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
          fullWidth
          disabled={busy}
        />

        <TextField
          select
          label={t('agent.role.role')}
          value={draft.role}
          onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))}
          fullWidth
          disabled={busy}
        >
          <MenuItem value="support">{t('agent.role.roleSupport')}</MenuItem>
          <MenuItem value="lead">{t('agent.role.roleLead')}</MenuItem>
          <MenuItem value="specialist">{t('agent.role.roleSpecialist')}</MenuItem>
        </TextField>

        <TextField
          select
          label={t('agent.role.defaultState')}
          value={draft.businessState}
          onChange={(event) => setDraft((current) => ({ ...current, businessState: event.target.value }))}
          fullWidth
          disabled={busy}
        >
          {AGENT_STATE_OPTIONS.map((state) => (
            <MenuItem key={state} value={state}>{state}</MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label={t('agent.role.backend')}
          value={draft.backend}
          onChange={(event) => setDraft((current) => ({ ...current, backend: event.target.value }))}
          fullWidth
          disabled={busy}
        >
          <MenuItem value="nanobot">{t('app.backend.nanobot')}</MenuItem>
          <MenuItem value="claude-code">{t('app.backend.claudeCode')}</MenuItem>
          <MenuItem value="codex">{t('app.backend.codex')}</MenuItem>
        </TextField>

        <Divider />

        <Typography variant="subtitle2">{t('agent.role.live2dModel')}</Typography>

        <StaticAvatarControls
          desktopMode={desktopMode}
          renderMode={draft.avatar.renderMode}
          onRenderModeChange={updateDraftAvatarRenderMode}
          selectedPackId={draft.avatar.static.selectedPackId}
          onSelectedPackIdChange={(selectedPackId) => {
            updateDraftStaticAvatar({ selectedPackId });
          }}
          staticScale={draft.avatar.static.scale}
          onStaticScaleChange={(scale) => {
            updateDraftStaticAvatar({ scale });
          }}
          staticHitTest={draft.avatar.static.hitTest}
          onStaticHitTestChange={(hitTestPatch) => {
            updateDraftStaticAvatar({ hitTest: hitTestPatch });
          }}
          onPacksChange={(packs) => {
            const nextPacks = Array.isArray(packs) ? packs : [];
            setAvailableStaticPacks(nextPacks);
            onStaticAvatarPacksChange?.(nextPacks);
          }}
        />

        {draft.avatar.renderMode === 'static' ? (
          <Stack spacing={1.5}>
            <Box
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                minHeight: 280,
                overflow: 'hidden',
                background:
                  'linear-gradient(180deg, rgba(250,251,245,0.95) 0%, rgba(230,236,230,0.92) 100%)',
              }}
            >
              <Stack sx={{ height: '100%' }}>
                <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="subtitle2">Static Avatar Preview</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Preview follows the draft agent only and will not switch the active stage avatar.
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, minHeight: 220 }}>
                  <AvatarRenderer
                    renderMode="static"
                    staticPack={selectedStaticPack}
                    staticBusinessState={draft.businessState}
                    staticScale={draft.avatar.static.scale}
                    staticHitTest={draft.avatar.static.hitTest}
                  />
                </Box>
              </Stack>
            </Box>
            {!selectedStaticPack && (
              <Alert severity="info">{t('avatar.noStaticAvatarSelected')}</Alert>
            )}
          </Stack>
        ) : (
          <AgentRoleLive2DPreviewEditor
            agentKey={live2dEditorKey}
            value={draft.avatar.live2d}
            onChange={(live2dPatch) => {
              updateDraftLive2dAvatar(live2dPatch);
              void loadAvailableModels();
            }}
          />
        )}

        <TextField
          label={t('agent.role.detail')}
          value={draft.detail}
          onChange={(event) => setDraft((current) => ({ ...current, detail: event.target.value }))}
          fullWidth
          multiline
          minRows={2}
          disabled={busy}
        />

        <Stack direction="row" spacing={1}>
          <Button variant="contained" disabled={busy} onClick={() => { void handleSave(); }}>
            {editingAgentId ? t('common.save') : t('agent.role.addAgent')}
          </Button>
          {editingAgentId && (
            <Button variant="outlined" disabled={busy} onClick={resetDraft}>
              {t('common.cancel')}
            </Button>
          )}
        </Stack>
      </Stack>
    </Stack>
  );
}
