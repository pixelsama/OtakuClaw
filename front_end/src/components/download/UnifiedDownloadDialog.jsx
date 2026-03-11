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
import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext.jsx';
import {
  resolveTaskProgressValue,
  resolveTaskStatsText,
  resolveTaskStatusText,
} from './taskPresentation.js';

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
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!open || !isRunning) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRunning, open]);

  const progressValue = resolveTaskProgressValue(task);
  const statusText = resolveTaskStatusText(task, t);
  const statsText = resolveTaskStatsText({ ...(task || {}), nowMs }, t);

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
