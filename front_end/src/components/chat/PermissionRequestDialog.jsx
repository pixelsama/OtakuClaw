import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useI18n } from '../../i18n/I18nContext.jsx';

function renderValue(value = '', fallback = '-') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function FieldRow({ label, value }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 88 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {renderValue(value)}
      </Typography>
    </Box>
  );
}

export default function PermissionRequestDialog({
  open = false,
  request = null,
  pendingCount = 0,
  submitting = false,
  onAllow,
  onDeny,
} = {}) {
  const { t } = useI18n();
  const safeRequest = request && typeof request === 'object' ? request : {};
  const timeoutSeconds =
    Number.isFinite(safeRequest.askTimeoutMs) && safeRequest.askTimeoutMs > 0
      ? Math.max(1, Math.ceil(safeRequest.askTimeoutMs / 1000))
      : 8;

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
      disableEscapeKeyDown={submitting}
    >
      <DialogTitle>{t('permission.dialog.title')}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('permission.dialog.description')}
        </Typography>
        <Box sx={{ display: 'grid', gap: 1.2 }}>
          <FieldRow label={t('permission.dialog.backend')} value={safeRequest.backend} />
          <FieldRow label={t('permission.dialog.tool')} value={safeRequest.toolName} />
          <FieldRow label={t('permission.dialog.permission')} value={safeRequest.permission} />
          <FieldRow label={t('permission.dialog.reason')} value={safeRequest.reason} />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          {t('permission.dialog.timeoutHint', { seconds: timeoutSeconds })}
        </Typography>
        {pendingCount > 1 ? (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {t('permission.dialog.queueHint', { count: pendingCount })}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button
          variant="outlined"
          color="inherit"
          disabled={submitting}
          onClick={onDeny}
          autoFocus
        >
          {t('common.deny')}
        </Button>
        <Button
          variant="contained"
          color="primary"
          disabled={submitting}
          onClick={onAllow}
        >
          {t('common.allow')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
