import { useCallback, useMemo, useRef, useState } from 'react';

function createTask(id, title = '') {
  return {
    id,
    title,
    catalogId: '',
    installTarget: '',
    phase: 'idle',
    completedTasks: 0,
    totalTasks: 0,
    currentFile: '',
    overallProgress: null,
    fileDownloadedBytes: 0,
    fileTotalBytes: 0,
    downloadSpeedBytesPerSec: 0,
    estimatedRemainingSeconds: null,
    startedAtMs: 0,
    phaseStartedAtMs: 0,
    logs: [],
    updatedAt: Date.now(),
  };
}

function decodeDisplayText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || !/%[0-9a-f]{2}/i.test(text)) {
    return text;
  }

  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
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
    const text = decodeDisplayText(message);
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

  const handleProgress = useCallback(({ taskId, title = '', payload = {}, suppressAutoOpen = false }) => {
    if (!taskId) {
      return;
    }

    const phase = normalizePhase(payload?.phase);
    const hasCurrentFile = Object.prototype.hasOwnProperty.call(payload, 'currentFile');
    const hasCompletedTasks = Object.prototype.hasOwnProperty.call(payload, 'completedTasks');
    const hasTotalTasks = Object.prototype.hasOwnProperty.call(payload, 'totalTasks');
    const hasOverallProgress = Object.prototype.hasOwnProperty.call(payload, 'overallProgress');
    const hasDownloadedBytes = Object.prototype.hasOwnProperty.call(payload, 'fileDownloadedBytes');
    const hasTotalBytes = Object.prototype.hasOwnProperty.call(payload, 'fileTotalBytes');
    const hasSpeed = Object.prototype.hasOwnProperty.call(payload, 'downloadSpeedBytesPerSec');
    const hasEta = Object.prototype.hasOwnProperty.call(payload, 'estimatedRemainingSeconds');
    const catalogId = typeof payload?.catalogId === 'string' ? payload.catalogId.trim() : '';
    const installTarget = typeof payload?.installTarget === 'string' ? payload.installTarget.trim().toLowerCase() : '';
    const nowMs = Date.now();

    upsertTask(taskId, (current) => {
      const currentPhase = normalizePhase(current?.phase);
      const phaseChanged = phase !== currentPhase;
      const fallbackStartedAtMs = Number.isFinite(current.startedAtMs) && current.startedAtMs > 0
        ? current.startedAtMs
        : nowMs;

      return {
        ...current,
        id: taskId,
        title: title || current.title || taskId,
        catalogId: catalogId || current.catalogId || '',
        installTarget: installTarget || current.installTarget || '',
        phase,
        completedTasks:
          hasCompletedTasks && Number.isFinite(payload?.completedTasks)
            ? payload.completedTasks
            : (phase === 'started' ? 0 : current.completedTasks),
        totalTasks:
          hasTotalTasks && Number.isFinite(payload?.totalTasks)
            ? payload.totalTasks
            : (phase === 'started' ? 0 : current.totalTasks),
        currentFile:
          hasCurrentFile
            ? decodeDisplayText(payload?.currentFile)
            : (phase === 'started' ? '' : current.currentFile),
        overallProgress:
          hasOverallProgress && Number.isFinite(payload?.overallProgress)
            ? payload.overallProgress
            : (phase === 'started' ? 0 : current.overallProgress),
        fileDownloadedBytes:
          hasDownloadedBytes && Number.isFinite(payload?.fileDownloadedBytes)
            ? payload.fileDownloadedBytes
            : (phase === 'started' ? 0 : current.fileDownloadedBytes),
        fileTotalBytes:
          hasTotalBytes && Number.isFinite(payload?.fileTotalBytes)
            ? payload.fileTotalBytes
            : (phase === 'started' ? 0 : current.fileTotalBytes),
        downloadSpeedBytesPerSec: Number.isFinite(payload?.downloadSpeedBytesPerSec)
          ? payload.downloadSpeedBytesPerSec
          : (phase === 'started' || (hasSpeed && !Number.isFinite(payload?.downloadSpeedBytesPerSec))
            ? 0
            : current.downloadSpeedBytesPerSec),
        estimatedRemainingSeconds: hasEta && Number.isFinite(payload?.estimatedRemainingSeconds)
          ? payload.estimatedRemainingSeconds
          : (phase === 'started' || (hasEta && !Number.isFinite(payload?.estimatedRemainingSeconds))
            ? null
            : current.estimatedRemainingSeconds),
        startedAtMs: phase === 'started' ? nowMs : fallbackStartedAtMs,
        phaseStartedAtMs: (phase === 'started' || phaseChanged)
          ? nowMs
          : (
            Number.isFinite(current.phaseStartedAtMs) && current.phaseStartedAtMs > 0
              ? current.phaseStartedAtMs
              : fallbackStartedAtMs
          ),
        logs: phase === 'started' ? [] : current.logs,
        updatedAt: nowMs,
      };
    });

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
    } else {
      const currentFileForLog = hasCurrentFile ? decodeDisplayText(payload?.currentFile) : '';
      if (currentFileForLog) {
        appendLog(taskId, currentFileForLog, `${phase}|${currentFileForLog}`);
      }
    }

    const isMuted = mutedTaskIdsRef.current.has(taskId);
    if (!suppressAutoOpen && !isMuted && (!dialogOpen || activeTaskId !== taskId)) {
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
