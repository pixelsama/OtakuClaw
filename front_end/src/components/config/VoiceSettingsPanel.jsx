import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { useSileroVad } from '../../hooks/voice/useSileroVad.js';
import { useVoiceSession } from '../../hooks/voice/useVoiceSession.js';
import { useVoiceTtsPlayback } from '../../hooks/voice/useVoiceTtsPlayback.js';
import { desktopBridge } from '../../services/desktopBridge.js';

const STATUS_CHIP_COLOR = {
  idle: 'default',
  listening: 'info',
  transcribing: 'warning',
  speaking: 'success',
  error: 'error',
};

function clampToInt16(sample) {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function splitFloat32ToPcmChunks(audioFloat32, frameSamples = 320) {
  if (!(audioFloat32 instanceof Float32Array) || audioFloat32.length === 0) {
    return [];
  }

  const int16 = new Int16Array(audioFloat32.length);
  for (let i = 0; i < audioFloat32.length; i += 1) {
    int16[i] = clampToInt16(audioFloat32[i]);
  }

  const chunks = [];
  for (let offset = 0; offset < int16.length; offset += frameSamples) {
    const segment = int16.slice(offset, Math.min(offset + frameSamples, int16.length));
    if (!segment.length) {
      continue;
    }

    const pcmChunk = new Uint8Array(segment.length * 2);
    const view = new DataView(pcmChunk.buffer);
    for (let i = 0; i < segment.length; i += 1) {
      view.setInt16(i * 2, segment[i], true);
    }
    chunks.push(pcmChunk);
  }

  return chunks;
}

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

function formatLogTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('zh-CN', {
    hour12: false,
  });
}

export default function VoiceSettingsPanel({ desktopMode = false }) {
  const { t } = useI18n();
  const seqRef = useRef(0);
  const chunkIdRef = useRef(0);
  const speechQueueRef = useRef(Promise.resolve());
  const runEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const stopPlaybackRef = useRef(null);
  const stopVadRef = useRef(null);
  const stopSessionRef = useRef(null);
  const downloadLogKeyRef = useRef('');
  const [capturedFrames, setCapturedFrames] = useState(0);
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  const [modelBundles, setModelBundles] = useState([]);
  const [selectedBundleId, setSelectedBundleId] = useState('');
  const [catalogItems, setCatalogItems] = useState([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [isDownloadingModels, setIsDownloadingModels] = useState(false);
  const [modelProgress, setModelProgress] = useState(null);
  const [modelFeedback, setModelFeedback] = useState('');
  const [modelError, setModelError] = useState('');
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadDetailsOpen, setDownloadDetailsOpen] = useState(false);
  const [modelInstallLogs, setModelInstallLogs] = useState([]);

  const {
    sessionId,
    status,
    active,
    lastPartialText,
    lastFinalText,
    lastError,
    flowControl,
    startSession,
    sendAudioChunk,
    commitInput,
    stopSession,
    stopTts,
    sendPlaybackAck,
    onEvent,
  } = useVoiceSession({ desktopMode });

  const {
    handleVoiceEvent,
    stopPlayback,
    isPlaying: isPlayingTts,
    bufferedMs: ttsBufferedMs,
    lastCodec: ttsCodec,
    playbackError,
  } = useVoiceTtsPlayback({
    desktopMode,
    sessionId,
    sendPlaybackAck,
  });

  const {
    isLoading: isVadLoading,
    isListening: isVadListening,
    isSpeaking: isVadSpeaking,
    vadError,
    start: startVad,
    stop: stopVad,
  } = useSileroVad();

  const statusColor = useMemo(() => STATUS_CHIP_COLOR[status] || 'default', [status]);
  const selectedBundle = useMemo(
    () => modelBundles.find((item) => item.id === selectedBundleId) || null,
    [modelBundles, selectedBundleId],
  );
  const selectedCatalogItem = useMemo(
    () => catalogItems.find((item) => item.id === selectedCatalogId) || null,
    [catalogItems, selectedCatalogId],
  );
  const isSelectedCatalogInstalled = useMemo(() => {
    if (!selectedCatalogItem?.name) {
      return false;
    }
    return modelBundles.some((bundle) => bundle.name === selectedCatalogItem.name);
  }, [modelBundles, selectedCatalogItem]);

  const loadVoiceModels = useCallback(
    async ({ silent = false } = {}) => {
      if (!desktopMode) {
        return;
      }

      if (!silent && mountedRef.current) {
        setModelsLoading(true);
      }

      try {
        const result = await desktopBridge.voiceModels.list();
        if (!mountedRef.current) {
          return;
        }

        if (!result?.ok) {
          setModelError(result?.error?.message || '读取语音模型列表失败。');
          setModelBundles([]);
          setSelectedBundleId('');
          return;
        }

        setModelBundles(Array.isArray(result.bundles) ? result.bundles : []);
        setSelectedBundleId(typeof result.selectedBundleId === 'string' ? result.selectedBundleId : '');
      } catch (error) {
        if (mountedRef.current) {
          setModelError(error?.message || '读取语音模型列表失败。');
          setModelBundles([]);
          setSelectedBundleId('');
        }
      } finally {
        if (mountedRef.current) {
          setModelsLoading(false);
        }
      }
    },
    [desktopMode],
  );

  const loadModelCatalog = useCallback(async () => {
    if (!desktopMode) {
      return;
    }

    try {
      const result = await desktopBridge.voiceModels.catalog();
      if (!mountedRef.current) {
        return;
      }

      const items = result?.ok && Array.isArray(result.items) ? result.items : [];
      if (!result?.ok) {
        setModelError(
          result?.error?.message
            || '读取内置模型列表失败。请完全退出桌面应用后重新执行 npm run desktop:dev。',
        );
      } else if (!items.length) {
        setModelError('当前没有可用的内置模型清单。请确认已拉取最新代码并重启桌面应用。');
      } else {
        setModelError('');
      }
      setCatalogItems(items);
      setSelectedCatalogId((previous) => {
        if (previous && items.some((item) => item.id === previous)) {
          return previous;
        }
        return items[0]?.id || '';
      });
    } catch (error) {
      if (mountedRef.current) {
        setCatalogItems([]);
        setSelectedCatalogId('');
        setModelError(error?.message || '读取内置模型列表失败，请重启应用后重试。');
      }
    }
  }, [desktopMode]);

  const handleRefreshModels = useCallback(async () => {
    setModelError('');
    await loadVoiceModels();
  }, [loadVoiceModels]);

  const appendModelInstallLog = useCallback((message, dedupeKey = '') => {
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) {
      return;
    }
    if (dedupeKey && downloadLogKeyRef.current === dedupeKey) {
      return;
    }
    if (dedupeKey) {
      downloadLogKeyRef.current = dedupeKey;
    }

    const line = `[${formatLogTimestamp()}] ${text}`;
    setModelInstallLogs((previous) => [...previous, line]);
  }, []);

  const handleSelectBundle = useCallback(async () => {
    if (!desktopMode) {
      return;
    }

    setModelError('');
    setModelFeedback('');

    try {
      const result = await desktopBridge.voiceModels.select(selectedBundleId);
      if (!mountedRef.current) {
        return;
      }

      if (!result?.ok) {
        setModelError(result?.error?.message || '设置语音模型失败。');
        return;
      }

      setModelBundles(Array.isArray(result.bundles) ? result.bundles : []);
      setSelectedBundleId(typeof result.selectedBundleId === 'string' ? result.selectedBundleId : '');
      setModelFeedback(selectedBundleId ? '语音模型已切换。' : '已恢复为环境变量配置。');
    } catch (error) {
      if (mountedRef.current) {
        setModelError(error?.message || '设置语音模型失败。');
      }
    }
  }, [desktopMode, selectedBundleId]);

  const handleInstallCatalog = useCallback(async () => {
    if (!desktopMode || !selectedCatalogId) {
      return;
    }

    setModelError('');
    setModelFeedback('');
    setDownloadDialogOpen(true);
    setDownloadDetailsOpen(false);
    downloadLogKeyRef.current = '';
    setModelInstallLogs([]);
    appendModelInstallLog('开始下载并安装内置语音模型。');
    setModelProgress({
      phase: 'started',
      completedTasks: 0,
      totalTasks: 0,
      currentFile: '',
      overallProgress: null,
      fileDownloadedBytes: 0,
      fileTotalBytes: 0,
    });
    setIsDownloadingModels(true);

    try {
      const result = await desktopBridge.voiceModels.installCatalog(selectedCatalogId);
      if (!mountedRef.current) {
        return;
      }

      if (!result?.ok) {
        const message = result?.error?.message || '安装内置模型失败。';
        setModelError(message);
        appendModelInstallLog(message);
        return;
      }

      setModelBundles(Array.isArray(result.bundles) ? result.bundles : []);
      setSelectedBundleId(typeof result.selectedBundleId === 'string' ? result.selectedBundleId : '');
      setModelFeedback('内置模型安装完成并已自动选中。');
      appendModelInstallLog('内置模型安装完成并已自动选中。');
    } catch (error) {
      if (mountedRef.current) {
        const message = error?.message || '安装内置模型失败。';
        setModelError(message);
        appendModelInstallLog(message);
      }
    } finally {
      if (mountedRef.current) {
        setIsDownloadingModels(false);
      }
    }
  }, [appendModelInstallLog, desktopMode, selectedCatalogId]);

  const enqueueSpeechTask = useCallback((task) => {
    speechQueueRef.current = speechQueueRef.current
      .then(async () => {
        if (!mountedRef.current) {
          return;
        }

        setIsProcessingSpeech(true);
        try {
          await task();
        } finally {
          if (mountedRef.current) {
            setIsProcessingSpeech(false);
          }
        }
      })
      .catch((error) => {
        console.error('Voice speech pipeline failed:', error);
        if (mountedRef.current) {
          setIsProcessingSpeech(false);
        }
      });

    return speechQueueRef.current;
  }, []);

  const handleSpeechEnd = useCallback(
    async (audioFloat32, epoch) =>
      enqueueSpeechTask(async () => {
        if (epoch !== runEpochRef.current) {
          return;
        }

        const chunks = splitFloat32ToPcmChunks(audioFloat32, 320);
        if (!chunks.length) {
          return;
        }

        for (const pcmChunk of chunks) {
          if (epoch !== runEpochRef.current) {
            return;
          }

          seqRef.current += 1;
          chunkIdRef.current += 1;
          if (mountedRef.current) {
            setCapturedFrames((value) => value + 1);
          }

          const sent = await sendAudioChunk({
            seq: seqRef.current,
            chunkId: chunkIdRef.current,
            pcmChunk,
            sampleRate: 16000,
            channels: 1,
            sampleFormat: 'pcm_s16le',
            isSpeech: true,
          });

          if (!sent?.ok) {
            return;
          }
        }

        if (epoch !== runEpochRef.current) {
          return;
        }

        await commitInput({
          finalSeq: seqRef.current,
        });
      }),
    [commitInput, enqueueSpeechTask, sendAudioChunk],
  );

  const handleStart = useCallback(async () => {
    await stopPlayback({
      emitFinalAck: false,
      resetSeq: true,
    });

    const started = await startSession({ mode: 'vad' });
    if (!started?.ok) {
      return;
    }

    seqRef.current = 0;
    chunkIdRef.current = 0;
    setCapturedFrames(0);
    const nextEpoch = runEpochRef.current + 1;
    runEpochRef.current = nextEpoch;

    const vadStarted = await startVad({
      onSpeechEnd: async (audioFloat32) => handleSpeechEnd(audioFloat32, nextEpoch),
    });

    if (!vadStarted?.ok) {
      runEpochRef.current += 1;
      await stopSession({ reason: 'vad_start_failed' });
    }
  }, [handleSpeechEnd, startSession, startVad, stopPlayback, stopSession]);

  const handleCommit = useCallback(async () => {
    await enqueueSpeechTask(async () => {
      if (!active) {
        return;
      }

      await commitInput({
        finalSeq: seqRef.current,
      });
    });
  }, [active, commitInput, enqueueSpeechTask]);

  const handleStop = useCallback(async () => {
    runEpochRef.current += 1;
    await stopPlayback({
      emitFinalAck: true,
      resetSeq: true,
    });
    await stopVad();
    await stopSession({ reason: 'manual' });
    seqRef.current = 0;
    chunkIdRef.current = 0;
    setCapturedFrames(0);
  }, [stopPlayback, stopSession, stopVad]);

  const handleStopTts = useCallback(async () => {
    await stopPlayback({
      emitFinalAck: true,
      resetSeq: false,
    });
    await stopTts({ reason: 'manual' });
  }, [stopPlayback, stopTts]);

  useEffect(() => {
    stopPlaybackRef.current = stopPlayback;
    stopVadRef.current = stopVad;
    stopSessionRef.current = stopSession;
  }, [stopPlayback, stopSession, stopVad]);

  useEffect(() => {
    void loadVoiceModels();
    void loadModelCatalog();
  }, [loadModelCatalog, loadVoiceModels]);

  useEffect(() => {
    if (!desktopMode) {
      return () => {};
    }

    return desktopBridge.voiceModels.onDownloadProgress((payload = {}) => {
      if (!mountedRef.current) {
        return;
      }

      setModelProgress({
        phase: payload.phase || 'running',
        completedTasks: Number.isFinite(payload.completedTasks) ? payload.completedTasks : 0,
        totalTasks: Number.isFinite(payload.totalTasks) ? payload.totalTasks : 0,
        currentFile: typeof payload.currentFile === 'string' ? payload.currentFile : '',
        overallProgress: Number.isFinite(payload.overallProgress) ? payload.overallProgress : null,
        fileDownloadedBytes: Number.isFinite(payload.fileDownloadedBytes) ? payload.fileDownloadedBytes : 0,
        fileTotalBytes: Number.isFinite(payload.fileTotalBytes) ? payload.fileTotalBytes : 0,
      });

      const phase = typeof payload.phase === 'string' ? payload.phase : 'running';
      const currentFile = typeof payload.currentFile === 'string' ? payload.currentFile.trim() : '';
      const dedupeKey = `${phase}|${currentFile}`;
      if (currentFile) {
        appendModelInstallLog(currentFile, dedupeKey);
        return;
      }
      if (phase === 'started') {
        appendModelInstallLog('准备下载...', dedupeKey);
      } else if (phase === 'extracting') {
        appendModelInstallLog('正在解压文件...', dedupeKey);
      } else if (phase === 'completed') {
        appendModelInstallLog('下载与安装流程已完成。', dedupeKey);
      } else if (phase === 'failed') {
        appendModelInstallLog('下载与安装流程失败。', dedupeKey);
      }
    });
  }, [appendModelInstallLog, desktopMode]);

  useEffect(() => {
    return onEvent(handleVoiceEvent);
  }, [handleVoiceEvent, onEvent]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runEpochRef.current += 1;
      void stopPlaybackRef.current?.({
        emitFinalAck: false,
        resetSeq: true,
      });
      void stopVadRef.current?.();
      void stopSessionRef.current?.({ reason: 'panel_unmount' });
    };
  }, []);

  const handleDownloadDialogClose = useCallback((_event, reason) => {
    if (isDownloadingModels && (reason === 'backdropClick' || reason === 'escapeKeyDown')) {
      return;
    }
    setDownloadDialogOpen(false);
  }, [isDownloadingModels]);

  return (
    <Stack spacing={2}>
      <Box sx={{ fontWeight: 600 }}>{t('voice.title')}</Box>
      <Alert severity="info">{t('voice.vadHint')}</Alert>
      {!desktopMode && <Alert severity="warning">{t('voice.desktopOnly')}</Alert>}
      {desktopMode && <Alert severity="info">{t('voice.liveCaptureHint')}</Alert>}
      {desktopMode && (
        <Stack spacing={1.5} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
          <Box sx={{ fontWeight: 600 }}>本地语音模型管理</Box>
          <TextField
            select
            label="当前模型包"
            value={selectedBundleId}
            onChange={(event) => setSelectedBundleId(event.target.value)}
            disabled={modelsLoading || isDownloadingModels}
            fullWidth
          >
            <MenuItem value="">不使用内置模型（回退环境变量）</MenuItem>
            {modelBundles.map((item) => (
              <MenuItem key={item.id} value={item.id}>
                {item.name}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Button
              variant="outlined"
              size="small"
              onClick={handleSelectBundle}
              disabled={modelsLoading || isDownloadingModels}
            >
              设为当前
            </Button>
            <Button
              variant="text"
              size="small"
              onClick={handleRefreshModels}
              disabled={modelsLoading || isDownloadingModels}
            >
              刷新列表
            </Button>
          </Stack>

          {!!selectedBundle?.asr?.modelPath && (
            <TextField label="ASR Model Path" value={selectedBundle.asr.modelPath} disabled fullWidth />
          )}
          {!!selectedBundle?.tts?.modelPath && (
            <TextField label="TTS Model Path" value={selectedBundle.tts.modelPath} disabled fullWidth />
          )}

          {catalogItems.length > 0 ? (
            <Stack spacing={1}>
              <TextField
                select
                label="内置模型包"
                value={selectedCatalogId}
                onChange={(event) => setSelectedCatalogId(event.target.value)}
                disabled={isDownloadingModels}
                fullWidth
              >
                {catalogItems.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.name}
                  </MenuItem>
                ))}
              </TextField>
              {selectedCatalogId && (
                <Alert severity="info">
                  {selectedCatalogItem?.description || ''}
                </Alert>
              )}
              <Button
                variant="contained"
                onClick={handleInstallCatalog}
                disabled={isDownloadingModels || !selectedCatalogId}
              >
                {isDownloadingModels
                  ? isSelectedCatalogInstalled
                    ? '重新安装中...'
                    : '安装中...'
                  : isSelectedCatalogInstalled
                    ? '重新安装内置模型'
                    : '一键安装内置模型'}
              </Button>
            </Stack>
          ) : (
            <Alert severity="warning">当前没有可用的内置模型清单。</Alert>
          )}

          {!!modelProgress && (
            <Button size="small" variant="outlined" onClick={() => setDownloadDialogOpen(true)}>
              查看下载进度窗口
            </Button>
          )}

          {!!modelError && <Alert severity="warning">{modelError}</Alert>}
          {!!modelFeedback && <Alert severity="success">{modelFeedback}</Alert>}
        </Stack>
      )}

      <Stack direction="row" spacing={1} alignItems="center">
        <Chip size="small" color={statusColor} label={`${t('voice.status')}: ${status}`} />
        <Chip
          size="small"
          color={isVadSpeaking ? 'warning' : isVadListening ? 'success' : 'default'}
          label={
            isVadLoading
              ? t('voice.vadLoading')
              : isVadSpeaking
                ? t('voice.vadSpeaking')
                : isVadListening
                  ? t('voice.vadListening')
                  : t('voice.vadStopped')
          }
        />
      </Stack>

      <TextField
        label={t('voice.sessionId')}
        value={sessionId}
        placeholder={t('voice.sessionIdPlaceholder')}
        disabled
        fullWidth
      />
      <TextField label={t('voice.vadModel')} value="Silero VAD v5" disabled fullWidth />
      <TextField
        label={t('voice.flowControl')}
        value={`${flowControl.action} (${flowControl.bufferedMs}ms)`}
        disabled
        fullWidth
      />
      <TextField
        label="TTS Playback"
        value={`${isPlayingTts ? 'playing' : 'idle'} (${Math.floor(ttsBufferedMs)}ms / ${ttsCodec || 'n/a'})`}
        disabled
        fullWidth
      />
      <TextField label={t('voice.capturedFrames')} value={capturedFrames} disabled fullWidth />

      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Button
          variant="contained"
          onClick={handleStart}
          disabled={!desktopMode || active || isVadLoading || isProcessingSpeech}
        >
          {t('voice.startSession')}
        </Button>
        <Button variant="outlined" onClick={handleCommit} disabled={!desktopMode || !active || isProcessingSpeech}>
          {t('voice.commitInput')}
        </Button>
        <Button variant="outlined" color="warning" onClick={handleStopTts} disabled={!desktopMode || !active}>
          {t('voice.stopTts')}
        </Button>
        <Button variant="text" color="error" onClick={handleStop} disabled={!desktopMode || !active}>
          {t('voice.stopSession')}
        </Button>
      </Stack>

      <TextField
        label={t('voice.partialText')}
        value={lastPartialText}
        placeholder={t('voice.empty')}
        disabled
        fullWidth
      />
      <TextField
        label={t('voice.finalText')}
        value={lastFinalText}
        placeholder={t('voice.empty')}
        disabled
        fullWidth
      />

      {!!lastError && <Alert severity="error">{lastError}</Alert>}
      {!!vadError && <Alert severity="warning">{vadError}</Alert>}
      {!!playbackError && <Alert severity="warning">{playbackError}</Alert>}

      <Dialog
        open={downloadDialogOpen}
        onClose={handleDownloadDialogClose}
        fullWidth
        maxWidth="sm"
        disableEscapeKeyDown={isDownloadingModels}
      >
        <DialogTitle>语音模型下载与安装</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <Box sx={{ px: 0.5 }}>
              <LinearProgress
                variant={typeof modelProgress?.overallProgress === 'number' ? 'determinate' : 'indeterminate'}
                value={typeof modelProgress?.overallProgress === 'number' ? modelProgress.overallProgress * 100 : 0}
              />
            </Box>
            <Typography variant="body2" color="text.secondary" align="center">
              {modelProgress?.currentFile || '准备下载...'} · {modelProgress?.completedTasks || 0}/
              {modelProgress?.totalTasks || '?'} · {formatBytes(modelProgress?.fileDownloadedBytes || 0)}/
              {formatBytes(modelProgress?.fileTotalBytes || 0)}
            </Typography>
            <Collapse in={downloadDetailsOpen}>
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
                {modelInstallLogs.length ? modelInstallLogs.join('\n') : '暂无日志。'}
              </Box>
            </Collapse>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDownloadDetailsOpen((previous) => !previous)}>
            {downloadDetailsOpen ? '收起详情' : '详情'}
          </Button>
          <Button onClick={() => setDownloadDialogOpen(false)}>
            {isDownloadingModels ? '后台继续' : '关闭'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
