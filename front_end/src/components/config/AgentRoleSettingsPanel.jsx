import { useMemo, useState } from 'react';
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
import { useI18n } from '../../i18n/I18nContext.jsx';
import {
  normalizeOfficeState,
  OFFICE_PRIMARY_AGENT_ID,
} from '../office/officeSceneConfig.js';

const AGENT_STATE_OPTIONS = [
  'idle',
  'writing',
  'researching',
  'executing',
  'syncing',
  'error',
];

function normalizeAgentId(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function isValidAgentId(value) {
  return /^[a-z0-9_-]+$/.test(value);
}

const DEFAULT_DRAFT = {
  agentId: '',
  displayName: '',
  role: 'support',
  businessState: 'idle',
  detail: '',
};

export default function AgentRoleSettingsPanel({
  officeState = {},
  onUpsertAgent,
  onRemoveAgent,
  onSetActiveAgent,
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(DEFAULT_DRAFT);
  const [editingAgentId, setEditingAgentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const normalizedState = useMemo(() => normalizeOfficeState(officeState), [officeState]);
  const activeAgentId = normalizedState.activeAgentId || OFFICE_PRIMARY_AGENT_ID;

  const sortedAgents = useMemo(() => {
    const sourceAgents = Array.isArray(normalizedState.agents) ? normalizedState.agents : [];
    return [...sourceAgents].sort((left, right) => {
      if (left.agentId === OFFICE_PRIMARY_AGENT_ID) {
        return -1;
      }
      if (right.agentId === OFFICE_PRIMARY_AGENT_ID) {
        return 1;
      }
      return left.displayName.localeCompare(right.displayName);
    });
  }, [normalizedState]);

  const applyEdit = (agent) => {
    if (!agent || agent.agentId === OFFICE_PRIMARY_AGENT_ID) {
      return;
    }
    setEditingAgentId(agent.agentId);
    setDraft({
      agentId: agent.agentId,
      displayName: agent.displayName || '',
      role: agent.role || 'support',
      businessState: agent.businessState || 'idle',
      detail: agent.detail || '',
    });
    setFeedback('');
    setError('');
  };

  const resetDraft = () => {
    setEditingAgentId('');
    setDraft(DEFAULT_DRAFT);
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

    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await onUpsertAgent?.({
        agentId: nextAgentId,
        id: nextAgentId,
        displayName: nextDisplayName,
        role: draft.role || 'support',
        businessState: draft.businessState || 'idle',
        detail: typeof draft.detail === 'string' ? draft.detail.trim() : '',
      });
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
    setError('');
    setFeedback('');
    try {
      await onRemoveAgent?.(agentId);
      if (editingAgentId && editingAgentId === agentId) {
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
    setError('');
    setFeedback('');
    try {
      await onSetActiveAgent?.(agentId);
      setFeedback(t('agent.role.feedback.activeUpdated'));
    } catch (activateError) {
      setError(activateError?.message || t('agent.role.error.activateFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Alert severity="info">{t('agent.role.notice.fixedStateKeys')}</Alert>
      {feedback && <Alert severity="success">{feedback}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}

      <Stack spacing={1}>
        <Typography variant="subtitle2">{t('agent.role.currentList')}</Typography>
        {sortedAgents.map((agent) => {
          const isPrimary = agent.agentId === OFFICE_PRIMARY_AGENT_ID;
          const isActive = agent.agentId === activeAgentId;
          return (
            <Box
              key={agent.agentId}
              sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 1.25, py: 1 }}
            >
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Chip size="small" label={agent.agentId} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{agent.displayName}</Typography>
                  {isPrimary && <Chip size="small" color="primary" label={t('agent.role.primary')} />}
                  {isActive && <Chip size="small" color="success" label={t('agent.role.active')} />}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {t('agent.role.stateLabel', { state: agent.businessState || 'idle' })}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {!isPrimary && (
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={busy}
                      onClick={() => applyEdit(agent)}
                    >
                      {t('common.edit')}
                    </Button>
                  )}
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
                  {!isPrimary && (
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
                  )}
                </Stack>
              </Stack>
            </Box>
          );
        })}
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
