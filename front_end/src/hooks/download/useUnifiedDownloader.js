import { useCallback, useMemo, useRef, useState } from 'react';

function createTask(id, title = '') {
  return {
    id,
    title,
    phase: 'idle',
    completedTasks: 0,
    totalTasks: 0,
    currentFile: '',
    overallProgress: null,
    fileDownloadedBytes: 0,
    fileTotalBytes: 0,
    downloadSpeedBytesPerSec: 0,
    estimatedRemainingSeconds: null,
    logs: [],
    updatedAt: Date.now(),
  };
}

function normalizePhase(value) {
  if (typeof value !== 'string') {
    return 'running';
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return 'running';
  }
  return normalized;
}

function formatLogTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('zh-CN', {
    hour12: false,
  });
}

export function useUnifiedDownloader() {
  const [taskMap, setTaskMap] = useState({});
  const [activeTaskId, setActiveTaskId] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const dedupeMapRef = useRef(new Map());
  const mutedTaskIdsRef = useRef(new Set());

  const upsertTask = useCallback((taskId, updater) => {
    if (!taskId) {
      return;
    }
    setTaskMap((previous) => {
      const current = previous[taskId] || createTask(taskId);
      const next = updater(current);
      return {
        ...previous,
        [taskId]: next,
      };
    });
  }, []);

  const openTask = useCallback((taskId) => {
    if (!taskId) {
      return;
    }
    mutedTaskIdsRef.current.delete(taskId);
    setActiveTaskId(taskId);
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    const activeTask = activeTaskId ? taskMap[activeTaskId] : null;
    const phase = activeTask?.phase || 'idle';
    const isRunning = phase !== 'completed' && phase !== 'failed' && phase !== 'idle';
    if (activeTaskId && isRunning) {
      mutedTaskIdsRef.current.add(activeTaskId);
    }
    setDialogOpen(false);
  }, [activeTaskId, taskMap]);

  const appendLog = useCallback((taskId, message, dedupeKey = '') => {
    const text = typeof message === 'string' ? message.trim() : '';
    if (!taskId || !text) {
      return;
    }

    const normalizedDedupeKey = dedupeKey ? `${taskId}:${dedupeKey}` : '';
    if (normalizedDedupeKey) {
      if (dedupeMapRef.current.get(normalizedDedupeKey) === text) {
        return;
      }
      dedupeMapRef.current.set(normalizedDedupeKey, text);
    }

    upsertTask(taskId, (current) => ({
      ...current,
      logs: [...current.logs, `[${formatLogTimestamp()}] ${text}`].slice(-500),
      updatedAt: Date.now(),
    }));
  }, [upsertTask]);

  const ensureTask = useCallback(({ taskId, title = '' }) => {
    if (!taskId) {
      return;
    }
    upsertTask(taskId, (current) => ({
      ...current,
      id: taskId,
      title: title || current.title || taskId,
      updatedAt: Date.now(),
    }));
  }, [upsertTask]);

  const handleProgress = useCallback(({ taskId, title = '', payload = {} }) => {
    if (!taskId) {
      return;
    }

    const phase = normalizePhase(payload?.phase);
    const currentFile = typeof payload?.currentFile === 'string' ? payload.currentFile : '';
    const completedTasks = Number.isFinite(payload?.completedTasks) ? payload.completedTasks : 0;
    const totalTasks = Number.isFinite(payload?.totalTasks) ? payload.totalTasks : 0;

    upsertTask(taskId, (current) => ({
      ...current,
      id: taskId,
      title: title || current.title || taskId,
      phase,
      completedTasks,
      totalTasks,
      currentFile,
      overallProgress: Number.isFinite(payload?.overallProgress) ? payload.overallProgress : null,
      fileDownloadedBytes: Number.isFinite(payload?.fileDownloadedBytes) ? payload.fileDownloadedBytes : 0,
      fileTotalBytes: Number.isFinite(payload?.fileTotalBytes) ? payload.fileTotalBytes : 0,
      downloadSpeedBytesPerSec: Number.isFinite(payload?.downloadSpeedBytesPerSec)
        ? payload.downloadSpeedBytesPerSec
        : 0,
      estimatedRemainingSeconds: Number.isFinite(payload?.estimatedRemainingSeconds)
        ? payload.estimatedRemainingSeconds
        : null,
      logs: phase === 'started' ? [] : current.logs,
      updatedAt: Date.now(),
    }));

    if (phase === 'started') {
      appendLog(taskId, '任务开始。', `${phase}|start`);
    } else if (phase === 'extracting') {
      appendLog(taskId, '正在解压文件...', `${phase}|extracting`);
    } else if (phase === 'installing') {
      appendLog(taskId, '正在安装依赖...', `${phase}|installing`);
    } else if (phase === 'completed') {
      appendLog(taskId, '任务完成。', `${phase}|completed`);
    } else if (phase === 'failed') {
      const errorMessage = payload?.error?.message || '任务失败。';
      appendLog(taskId, errorMessage, `${phase}|failed`);
    } else if (currentFile) {
      appendLog(taskId, currentFile, `${phase}|${currentFile}`);
    }

    const isMuted = mutedTaskIdsRef.current.has(taskId);
    if (!isMuted && (!dialogOpen || activeTaskId !== taskId)) {
      openTask(taskId);
    }
  }, [activeTaskId, appendLog, dialogOpen, openTask, upsertTask]);

  const activeTask = useMemo(() => {
    if (!activeTaskId) {
      return null;
    }
    return taskMap[activeTaskId] || null;
  }, [activeTaskId, taskMap]);

  return {
    taskMap,
    activeTaskId,
    activeTask,
    dialogOpen,
    detailsOpen,
    setDetailsOpen,
    closeDialog,
    openTask,
    ensureTask,
    appendLog,
    handleProgress,
  };
}
