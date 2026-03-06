import {
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useI18n } from '../../i18n/I18nContext.jsx';

function formatBytes(value) {
  const bytes = Number.isFinite(value) ? value : 0;
  if (bytes <= 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatBytesPerSecond(value) {
  const bytesPerSecond = Number.isFinite(value) ? value : 0;
  if (bytesPerSecond <= 0) {
    return '0 B/s';
  }
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatEta(value) {
  if (!Number.isFinite(value) || value < 0) {
    return '--';
  }

  const totalSeconds = Math.max(0, Math.round(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export default function UnifiedDownloadDialog({
  open = false,
  task = null,
  detailsOpen = false,
  onToggleDetails,
  onClose,
}) {
  const { t } = useI18n();
  const phase = task?.phase || 'idle';
  const isRunning = phase !== 'completed' && phase !== 'failed' && phase !== 'idle';
  const title = task?.title || t('download.defaultTitle');
  const progressValue = typeof task?.overallProgress === 'number' ? Math.min(100, Math.max(0, task.overallProgress * 100)) : 0;
  const statusText =
    task?.currentFile
    || (phase === 'completed'
      ? '任务完成。'
      : phase === 'failed'
        ? '任务失败。'
        : t('download.preparing'));
  const statsText =
    phase === 'completed'
      ? '下载与安装已完成。'
      : phase === 'failed'
        ? '下载或安装未完成。'
        : Number.isFinite(task?.fileTotalBytes) && task.fileTotalBytes > 0
          ? `${formatBytes(task?.fileDownloadedBytes || 0)} / ${formatBytes(task?.fileTotalBytes || 0)} · ${formatBytesPerSecond(task?.downloadSpeedBytesPerSec || 0)} · ${t('download.eta')} ${formatEta(task?.estimatedRemainingSeconds)}`
          : t('download.waitingStats');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      disableEscapeKeyDown={isRunning}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Box sx={{ px: 0.5 }}>
            <LinearProgress
              variant={typeof task?.overallProgress === 'number' ? 'determinate' : 'indeterminate'}
              value={progressValue}
            />
          </Box>
          <Typography variant="body2" color="text.secondary" align="center">
            {statusText}
            {' '}· {task?.completedTasks || 0}/{task?.totalTasks || '?'}
          </Typography>
          <Typography variant="caption" color="text.secondary" align="center">
            {statsText}
          </Typography>
          <Collapse in={detailsOpen}>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.5,
                maxHeight: 220,
                overflow: 'auto',
                borderRadius: 1,
                bgcolor: 'action.hover',
                color: 'text.primary',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {task?.logs?.length ? task.logs.join('\n') : t('download.noLogs')}
            </Box>
          </Collapse>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onToggleDetails}>
          {detailsOpen ? t('download.hideDetails') : t('download.showDetails')}
        </Button>
        <Button onClick={onClose}>
          {isRunning ? t('download.backgroundContinue') : t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
