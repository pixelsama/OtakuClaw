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

function formatElapsedSeconds(value) {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

export function resolveTaskProgressValue(task = {}) {
  return typeof task?.overallProgress === 'number'
    ? Math.min(100, Math.max(0, task.overallProgress * 100))
    : 0;
}

export function resolveTaskStatusText(task = {}, t) {
  const phase = task?.phase || 'idle';
  return task?.currentFile
    || (phase === 'completed'
      ? t('download.completed')
      : phase === 'failed'
        ? t('download.failed')
        : t('download.preparing'));
}

export function resolveTaskStatsText(task = {}, t) {
  const nowMs = Number.isFinite(task?.nowMs) ? task.nowMs : Date.now();
  const phase = task?.phase || 'idle';
  if (phase === 'completed') {
    return t('download.completedStats');
  }
  if (phase === 'failed') {
    return t('download.failedStats');
  }

  const totalBytes = Number.isFinite(task?.fileTotalBytes) ? task.fileTotalBytes : 0;
  const downloadedBytes = Number.isFinite(task?.fileDownloadedBytes) ? task.fileDownloadedBytes : 0;
  const speedBytesPerSec = Number.isFinite(task?.downloadSpeedBytesPerSec) ? task.downloadSpeedBytesPerSec : 0;

  if (totalBytes > 0) {
    return `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)} · ${formatBytesPerSecond(speedBytesPerSec)} · ${t('download.eta')} ${formatEta(task?.estimatedRemainingSeconds)}`;
  }

  if (speedBytesPerSec > 0) {
    const etaPart = Number.isFinite(task?.estimatedRemainingSeconds) && task.estimatedRemainingSeconds >= 0
      ? ` · ${t('download.eta')} ${formatEta(task.estimatedRemainingSeconds)}`
      : '';
    return `${formatBytesPerSecond(speedBytesPerSec)}${etaPart}`;
  }

  const startedAtMs = Number.isFinite(task?.startedAtMs) ? task.startedAtMs : 0;
  if (startedAtMs > 0 && phase !== 'idle') {
    const elapsedSeconds = formatElapsedSeconds((nowMs - startedAtMs) / 1000);
    return t('download.elapsedStats', { seconds: elapsedSeconds });
  }

  return t('download.waitingStats');
}
