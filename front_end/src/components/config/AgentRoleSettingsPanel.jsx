import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import StaticAvatarControls from '../avatar/StaticAvatarControls.jsx';
import AvatarRenderer from '../avatar/AvatarRenderer.jsx';
import AgentRoleLive2DPreviewEditor from './AgentRoleLive2DPreviewEditor.jsx';
import { desktopBridge } from '../../services/desktopBridge.js';
import { useI18n } from '../../i18n/I18nContext.jsx';

const AGENT_STATE_OPTIONS = ['idle', 'writing', 'researching', 'executing', 'syncing', 'error'];
const AGENT_BACKEND_OPTIONS = ['nanobot', 'claude-code', 'codex'];
const CREATE_SECTION_ID = 'create-agent';
const DELETE_CONFIRM_TIMEOUT_MS = 5000;
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

function buildAgentSectionId(agentId = '') {
  const normalizedAgentId = normalizeAgentId(agentId);
  return normalizedAgentId ? `agent:${normalizedAgentId}` : '';
}

function AgentDraftForm({
  t,
  busy = false,
  draft,
  setDraft,
  isCreateMode = false,
  desktopMode = false,
  selectedStaticPack = null,
  editingAgentId = '',
  updateDraftAvatarRenderMode,
  updateDraftStaticAvatar,
  updateDraftLive2dAvatar,
  onStaticAvatarPacksChange,
  setAvailableStaticPacks,
  onSave,
  onCancel,
}) {
  const live2dEditorKey = editingAgentId || normalizeAgentId(draft.agentId) || 'draft-agent';

  return (
    <Stack spacing={1.5}>
      <TextField
        label={t('agent.role.agentId')}
        value={draft.agentId}
        onChange={(event) => setDraft((current) => ({ ...current, agentId: event.target.value }))}
        placeholder="agent-dev"
        fullWidth
        disabled={busy || !isCreateMode}
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
        <Button variant="contained" disabled={busy} onClick={() => { void onSave(); }}>
          {isCreateMode ? t('agent.role.addAgent') : t('common.save')}
        </Button>
        <Button variant="outlined" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </Stack>
    </Stack>
  );
}

export default function AgentRoleSettingsPanel({
  agentRoleConfig = {},
  defaultBackend = 'nanobot',
  onUpsertAgent,
  onRemoveAgent,
  onStaticAvatarPacksChange,
}) {
  const { t } = useI18n();
  const desktopMode = desktopBridge.isDesktop();
  const normalizedDefaultBackend = normalizeAgentBackend(defaultBackend, 'nanobot');
  const [draft, setDraft] = useState(() => createEmptyDraft(normalizedDefaultBackend));
  const [editingAgentId, setEditingAgentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [availableStaticPacks, setAvailableStaticPacks] = useState([]);
  const [expandedSectionId, setExpandedSectionId] = useState('');
  const [deleteMode, setDeleteMode] = useState(false);
  const [pendingDeleteAgentId, setPendingDeleteAgentId] = useState('');
  const sectionRefMap = useRef(new Map());
  const deleteConfirmTimeoutRef = useRef(null);

  const configuredAgents = useMemo(() => {
    const sourceAgents = Array.isArray(agentRoleConfig?.agents) ? agentRoleConfig.agents : [];
    return sourceAgents
      .map((entry, index) => normalizeConfiguredAgent(entry, index, normalizedDefaultBackend))
      .filter(Boolean)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }, [agentRoleConfig?.agents, normalizedDefaultBackend]);

  const selectedStaticPack = useMemo(
    () => availableStaticPacks.find((pack) => pack?.packId === draft.avatar.static.selectedPackId) || null,
    [availableStaticPacks, draft.avatar.static.selectedPackId],
  );

  const clearDeleteConfirmTimeout = useCallback(() => {
    if (deleteConfirmTimeoutRef.current) {
      clearTimeout(deleteConfirmTimeoutRef.current);
      deleteConfirmTimeoutRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearDeleteConfirmTimeout();
    },
    [clearDeleteConfirmTimeout],
  );

  useEffect(() => {
    clearDeleteConfirmTimeout();
    if (!pendingDeleteAgentId) {
      return () => {};
    }
    deleteConfirmTimeoutRef.current = setTimeout(() => {
      setPendingDeleteAgentId('');
      deleteConfirmTimeoutRef.current = null;
    }, DELETE_CONFIRM_TIMEOUT_MS);
    return () => {
      clearDeleteConfirmTimeout();
    };
  }, [clearDeleteConfirmTimeout, pendingDeleteAgentId]);

  const resetDraft = useCallback(() => {
    setEditingAgentId('');
    setDraft(createEmptyDraft(normalizedDefaultBackend));
  }, [normalizedDefaultBackend]);

  const resetDeleteModeState = useCallback(() => {
    clearDeleteConfirmTimeout();
    setPendingDeleteAgentId('');
  }, [clearDeleteConfirmTimeout]);

  const registerSectionRef = useCallback(
    (sectionId) => (node) => {
      if (!sectionId) {
        return;
      }
      if (node) {
        sectionRefMap.current.set(sectionId, node);
      } else {
        sectionRefMap.current.delete(sectionId);
      }
    },
    [],
  );

  const scrollToSection = useCallback((sectionId) => {
    if (!sectionId || typeof window === 'undefined') {
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const node = sectionRefMap.current.get(sectionId);
        node?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      });
    });
  }, []);

  const applyEdit = useCallback((agent) => {
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
  }, [normalizedDefaultBackend]);

  const openCreateSection = useCallback(() => {
    setDeleteMode(false);
    resetDeleteModeState();
    resetDraft();
    setExpandedSectionId(CREATE_SECTION_ID);
    setFeedback('');
    setError('');
    scrollToSection(CREATE_SECTION_ID);
  }, [resetDeleteModeState, resetDraft, scrollToSection]);

  const handleCancelEditor = useCallback(() => {
    setExpandedSectionId('');
    resetDraft();
  }, [resetDraft]);

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
    if (nextAgentId === 'main') {
      setError(t('agent.role.error.primaryReserved'));
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
      const sectionId = buildAgentSectionId(normalizedAgent.agentId);
      setFeedback(t('agent.role.feedback.saved', { name: nextDisplayName }));
      setDeleteMode(false);
      resetDeleteModeState();
      setEditingAgentId(normalizedAgent.agentId);
      setDraft({
        agentId: normalizedAgent.agentId,
        displayName: normalizedAgent.displayName,
        role: normalizedAgent.role,
        businessState: normalizedAgent.businessState,
        detail: normalizedAgent.detail,
        backend: normalizedAgent.backend,
        avatar: normalizeAvatar(normalizedAgent.avatar, normalizedAgent.live2dModelPath),
      });
      setExpandedSectionId(sectionId);
      scrollToSection(sectionId);
    } catch (saveError) {
      setError(saveError?.message || t('agent.role.error.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = useCallback(async (agentId) => {
    setBusy(true);
    setFeedback('');
    setError('');
    try {
      await onRemoveAgent?.(agentId);
      if (editingAgentId === agentId) {
        resetDraft();
      }
      setExpandedSectionId((current) => (current === buildAgentSectionId(agentId) ? '' : current));
      setPendingDeleteAgentId('');
      setFeedback(t('agent.role.feedback.removed'));
    } catch (removeError) {
      setError(removeError?.message || t('agent.role.error.removeFailed'));
    } finally {
      setBusy(false);
    }
  }, [editingAgentId, onRemoveAgent, resetDraft, t]);

  const handleDeleteAction = useCallback((agentId) => {
    if (!deleteMode || busy) {
      return;
    }
    if (pendingDeleteAgentId === agentId) {
      resetDeleteModeState();
      void handleRemove(agentId);
      return;
    }
    setPendingDeleteAgentId(agentId);
  }, [busy, deleteMode, handleRemove, pendingDeleteAgentId, resetDeleteModeState]);

  const handleToggleDeleteMode = useCallback(() => {
    setDeleteMode((current) => {
      const nextDeleteMode = !current;
      setExpandedSectionId('');
      resetDeleteModeState();
      return nextDeleteMode;
    });
  }, [resetDeleteModeState]);

  const draftSectionIsCreate = !editingAgentId;
  const emptyAndCollapsed = configuredAgents.length === 0 && expandedSectionId !== CREATE_SECTION_ID;

  return (
    <Stack spacing={2}>
      <Alert severity="info">{t('agent.role.notice.fixedStateKeys')}</Alert>
      {feedback && <Alert severity="success">{feedback}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Typography variant="subtitle2">{t('agent.role.currentList')}</Typography>
        {configuredAgents.length > 0 && (
          <Button
            size="small"
            variant={deleteMode ? 'contained' : 'outlined'}
            color={deleteMode ? 'warning' : 'inherit'}
            onClick={handleToggleDeleteMode}
            disabled={busy}
          >
            {deleteMode ? t('agent.role.deleteModeExit') : t('agent.role.deleteModeEnter')}
          </Button>
        )}
      </Stack>

      {deleteMode && configuredAgents.length > 0 && (
        <Alert severity="warning">{t('agent.role.deleteModeHint')}</Alert>
      )}

      {emptyAndCollapsed && (
        <Button
          data-testid="agent-role-create-first-button"
          variant="contained"
          onClick={openCreateSection}
          disabled={busy}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('agent.role.addAgent')}
        </Button>
      )}

      {(configuredAgents.length > 0 || expandedSectionId === CREATE_SECTION_ID) && (
        <Accordion
          expanded={!deleteMode && expandedSectionId === CREATE_SECTION_ID}
          onChange={(_event, nextExpanded) => {
            if (deleteMode) {
              return;
            }
            if (nextExpanded) {
              openCreateSection();
            } else {
              setExpandedSectionId('');
              resetDraft();
            }
          }}
          disableGutters
          ref={registerSectionRef(CREATE_SECTION_ID)}
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1, '&::before': { display: 'none' } }}
        >
          <AccordionSummary expandIcon={deleteMode ? null : <ExpandMoreIcon />}>
            <Typography sx={{ fontWeight: 600 }}>{t('agent.role.createTitle')}</Typography>
          </AccordionSummary>
          {!deleteMode && (
            <AccordionDetails>
              <AgentDraftForm
                t={t}
                busy={busy}
                draft={draft}
                setDraft={setDraft}
                isCreateMode={draftSectionIsCreate}
                desktopMode={desktopMode}
                selectedStaticPack={selectedStaticPack}
                editingAgentId={editingAgentId}
                updateDraftAvatarRenderMode={updateDraftAvatarRenderMode}
                updateDraftStaticAvatar={updateDraftStaticAvatar}
                updateDraftLive2dAvatar={updateDraftLive2dAvatar}
                onStaticAvatarPacksChange={onStaticAvatarPacksChange}
                setAvailableStaticPacks={setAvailableStaticPacks}
                onSave={handleSave}
                onCancel={handleCancelEditor}
              />
            </AccordionDetails>
          )}
        </Accordion>
      )}

      {configuredAgents.map((agent) => {
        const sectionId = buildAgentSectionId(agent.agentId);
        const isExpanded = !deleteMode && expandedSectionId === sectionId;
        return (
          <Accordion
            key={agent.agentId}
            expanded={isExpanded}
            onChange={(_event, nextExpanded) => {
              if (deleteMode) {
                return;
              }
              if (!nextExpanded) {
                setExpandedSectionId('');
                resetDraft();
                return;
              }
              resetDeleteModeState();
              setExpandedSectionId(sectionId);
              applyEdit(agent);
            }}
            disableGutters
            ref={registerSectionRef(sectionId)}
            sx={{ border: 1, borderColor: 'divider', borderRadius: 1, '&::before': { display: 'none' } }}
          >
            <AccordionSummary expandIcon={deleteMode ? null : <ExpandMoreIcon />}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ width: '100%' }}>
                <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                  <Typography sx={{ fontWeight: 600 }}>{agent.displayName}</Typography>
                  <Chip size="small" label={agent.agentId} />
                  <Chip size="small" variant="outlined" label={agent.businessState} />
                </Stack>
                {deleteMode && (
                  <Button
                    size="small"
                    color="error"
                    variant={pendingDeleteAgentId === agent.agentId ? 'contained' : 'outlined'}
                    disabled={busy}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleDeleteAction(agent.agentId);
                    }}
                  >
                    {pendingDeleteAgentId === agent.agentId ? t('agent.role.deleteConfirm') : t('common.delete')}
                  </Button>
                )}
              </Stack>
            </AccordionSummary>
            {!deleteMode && (
              <AccordionDetails>
                <AgentDraftForm
                  t={t}
                  busy={busy}
                  draft={draft}
                  setDraft={setDraft}
                  isCreateMode={false}
                  desktopMode={desktopMode}
                  selectedStaticPack={selectedStaticPack}
                  editingAgentId={editingAgentId}
                  updateDraftAvatarRenderMode={updateDraftAvatarRenderMode}
                  updateDraftStaticAvatar={updateDraftStaticAvatar}
                  updateDraftLive2dAvatar={updateDraftLive2dAvatar}
                  onStaticAvatarPacksChange={onStaticAvatarPacksChange}
                  setAvailableStaticPacks={setAvailableStaticPacks}
                  onSave={handleSave}
                  onCancel={handleCancelEditor}
                />
              </AccordionDetails>
            )}
          </Accordion>
        );
      })}
    </Stack>
  );
}
