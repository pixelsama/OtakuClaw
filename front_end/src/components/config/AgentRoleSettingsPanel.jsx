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
import { desktopBridge } from '../../services/desktopBridge.js';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { normalizeOfficeState, OFFICE_PRIMARY_AGENT_ID } from '../office/officeSceneConfig.js';

const AGENT_STATE_OPTIONS = ['idle', 'writing', 'researching', 'executing', 'syncing', 'error'];
const AGENT_BACKEND_OPTIONS = ['nanobot', 'claude-code', 'codex'];

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
    live2dModelPath: '',
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
  if (!agentId || agentId === OFFICE_PRIMARY_AGENT_ID) {
    return null;
  }
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
    live2dModelPath: typeof source.live2dModelPath === 'string' ? source.live2dModelPath.trim() : '',
  };
}

export default function AgentRoleSettingsPanel({
  officeState = {},
  agentRoleConfig = {},
  defaultBackend = 'nanobot',
  onUpsertAgent,
  onRemoveAgent,
  onSetActiveAgent,
}) {
  const { t } = useI18n();
  const normalizedOfficeState = useMemo(() => normalizeOfficeState(officeState), [officeState]);
  const normalizedDefaultBackend = normalizeAgentBackend(defaultBackend, 'nanobot');
  const [draft, setDraft] = useState(() => createEmptyDraft(normalizedDefaultBackend));
  const [editingAgentId, setEditingAgentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isImportingModel, setIsImportingModel] = useState(false);
  const [modelLibraryError, setModelLibraryError] = useState('');

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

  const loadAvailableModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      if (!desktopBridge.isDesktop()) {
        setAvailableModels([]);
        setModelLibraryError(t('controls.unsupportedModelImport'));
        return;
      }
      const result = await desktopBridge.models.list();
      setAvailableModels(Array.isArray(result?.models) ? result.models : []);
      setModelLibraryError('');
    } catch (loadError) {
      setAvailableModels([]);
      setModelLibraryError(loadError?.message || t('controls.loadModelLibraryFailed'));
    } finally {
      setIsLoadingModels(false);
    }
  }, [t]);

  useEffect(() => {
    void loadAvailableModels();
  }, [loadAvailableModels]);

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
      live2dModelPath: agent.live2dModelPath || '',
    });
    setFeedback('');
    setError('');
  };

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
    if (nextAgentId === OFFICE_PRIMARY_AGENT_ID) {
      setError(t('agent.role.error.primaryReserved'));
      return;
    }
    if (!editingAgentId && configuredAgents.some((agent) => agent.agentId === nextAgentId)) {
      setError(t('agent.role.error.agentExists'));
      return;
    }

    const normalizedAgent = {
      agentId: nextAgentId,
      id: nextAgentId,
      displayName: nextDisplayName,
      role: draft.role || 'support',
      businessState: normalizeBusinessState(draft.businessState, 'idle'),
      detail: typeof draft.detail === 'string' ? draft.detail.trim() : '',
      backend: normalizeAgentBackend(draft.backend, normalizedDefaultBackend),
      live2dModelPath: typeof draft.live2dModelPath === 'string' ? draft.live2dModelPath.trim() : '',
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

  const handleImportModelZip = async () => {
    setIsImportingModel(true);
    setFeedback('');
    setError('');
    try {
      const result = await desktopBridge.models.importZip();
      if (!result?.ok) {
        throw new Error(result?.error?.message || t('agent.role.error.importModelFailed'));
      }
      await loadAvailableModels();
      setFeedback(t('agent.role.feedback.modelImported'));
    } catch (importError) {
      setError(importError?.message || t('agent.role.error.importModelFailed'));
    } finally {
      setIsImportingModel(false);
    }
  };

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
            const modelLabel = agent.live2dModelPath
              ? (modelNameByPath.get(agent.live2dModelPath) || agent.live2dModelPath)
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
                    {isActive && <Chip size="small" color="success" label={t('agent.role.active')} />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {t('agent.role.stateLabel', { state: agent.businessState })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('agent.role.backendLabel', { backend: resolveBackendLabel(t, agent.backend) })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('agent.role.modelLabel', { model: modelLabel })}
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

      <Stack spacing={1}>
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

        <TextField
          select
          label={t('agent.role.live2dModel')}
          value={draft.live2dModelPath}
          onChange={(event) => setDraft((current) => ({ ...current, live2dModelPath: event.target.value }))}
          fullWidth
          disabled={busy || isLoadingModels}
        >
          <MenuItem value="">{t('agent.role.modelNone')}</MenuItem>
          {availableModels.map((model) => {
            const modelPath = typeof model?.path === 'string' ? model.path : '';
            if (!modelPath) {
              return null;
            }
            const modelName = typeof model?.name === 'string' && model.name.trim() ? model.name.trim() : modelPath;
            return (
              <MenuItem key={modelPath} value={modelPath}>{modelName}</MenuItem>
            );
          })}
        </TextField>

        <Stack direction="row" spacing={1}>
          <Button variant="outlined" disabled={busy || isLoadingModels} onClick={() => { void loadAvailableModels(); }}>
            {isLoadingModels ? t('agent.role.loadingModels') : t('agent.role.refreshModels')}
          </Button>
          <Button
            variant="outlined"
            disabled={busy || isImportingModel}
            onClick={() => {
              void handleImportModelZip();
            }}
          >
            {isImportingModel ? t('modelSettings.importing') : t('modelSettings.importZip')}
          </Button>
        </Stack>

        {modelLibraryError && (
          <Typography variant="caption" color="error">{modelLibraryError}</Typography>
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
