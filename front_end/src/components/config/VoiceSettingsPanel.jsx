import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, LinearProgress, MenuItem, Stack, TextField } from '@mui/material';
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

const DEFAULT_DOWNLOAD_FORM = {
  bundleName: '',
  asrModelUrl: '',
  asrTokensUrl: '',
  asrModelKind: 'zipformerctc',
  asrExecutionProvider: '',
  ttsModelUrl: '',
  ttsVoicesUrl: '',
  ttsTokensUrl: '',
  ttsModelKind: 'kokoro',
  ttsExecutionProvider: '',
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

export default function VoiceSettingsPanel({ desktopMode = false }) {
  const { t } = useI18n();
  const seqRef = useRef(0);
  const chunkIdRef = useRef(0);
  const speechQueueRef = useRef(Promise.resolve());
  const runEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const [capturedFrames, setCapturedFrames] = useState(0);
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  const [modelBundles, setModelBundles] = useState([]);
  const [selectedBundleId, setSelectedBundleId] = useState('');
  const [catalogItems, setCatalogItems] = useState([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [downloadForm, setDownloadForm] = useState(DEFAULT_DOWNLOAD_FORM);
  const [showAdvancedDownload, setShowAdvancedDownload] = useState(false);
  const [isDownloadingModels, setIsDownloadingModels] = useState(false);
  const [modelProgress, setModelProgress] = useState(null);
  const [modelFeedback, setModelFeedback] = useState('');
  const [modelError, setModelError] = useState('');

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

        setModelError('');
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
        setModelError(error?.message || '读取内置模型列表失败。');
      }
    }
  }, [desktopMode]);

  const handleDownloadFormChange = useCallback((field, value) => {
    setDownloadForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  }, []);

  const handleRefreshModels = useCallback(async () => {
    setModelError('');
    await loadVoiceModels();
  }, [loadVoiceModels]);

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

  const handleDownloadModels = useCallback(async () => {
    if (!desktopMode) {
      return;
    }

    setModelError('');
    setModelFeedback('');
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

    const payload = {
      bundleName: downloadForm.bundleName,
      asr: {
        modelUrl: downloadForm.asrModelUrl,
        tokensUrl: downloadForm.asrTokensUrl,
        modelKind: downloadForm.asrModelKind,
        executionProvider: downloadForm.asrExecutionProvider,
      },
      tts: {
        modelUrl: downloadForm.ttsModelUrl,
        voicesUrl: downloadForm.ttsVoicesUrl,
        tokensUrl: downloadForm.ttsTokensUrl,
        modelKind: downloadForm.ttsModelKind,
        executionProvider: downloadForm.ttsExecutionProvider,
      },
    };

    try {
      const result = await desktopBridge.voiceModels.download(payload);
      if (!mountedRef.current) {
        return;
      }

      if (!result?.ok) {
        setModelError(result?.error?.message || '下载语音模型失败。');
        return;
      }

      setModelBundles(Array.isArray(result.bundles) ? result.bundles : []);
      setSelectedBundleId(typeof result.selectedBundleId === 'string' ? result.selectedBundleId : '');
      setModelFeedback('语音模型下载完成并已自动选中。');
      setDownloadForm((previous) => ({
        ...previous,
        bundleName: '',
      }));
    } catch (error) {
      if (mountedRef.current) {
        setModelError(error?.message || '下载语音模型失败。');
      }
    } finally {
      if (mountedRef.current) {
        setIsDownloadingModels(false);
      }
    }
  }, [desktopMode, downloadForm]);

  const handleInstallCatalog = useCallback(async () => {
    if (!desktopMode || !selectedCatalogId) {
      return;
    }

    setModelError('');
    setModelFeedback('');
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
        setModelError(result?.error?.message || '安装内置模型失败。');
        return;
      }

      setModelBundles(Array.isArray(result.bundles) ? result.bundles : []);
      setSelectedBundleId(typeof result.selectedBundleId === 'string' ? result.selectedBundleId : '');
      setModelFeedback('内置模型安装完成并已自动选中。');
    } catch (error) {
      if (mountedRef.current) {
        setModelError(error?.message || '安装内置模型失败。');
      }
    } finally {
      if (mountedRef.current) {
        setIsDownloadingModels(false);
      }
    }
  }, [desktopMode, selectedCatalogId]);

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
    });
  }, [desktopMode]);

  useEffect(() => {
    return onEvent(handleVoiceEvent);
  }, [handleVoiceEvent, onEvent]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      runEpochRef.current += 1;
      void stopPlayback({
        emitFinalAck: false,
        resetSeq: true,
      });
      void stopVad();
      void stopSession({ reason: 'panel_unmount' });
    },
    [stopPlayback, stopSession, stopVad],
  );

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
                  {catalogItems.find((item) => item.id === selectedCatalogId)?.description || ''}
                </Alert>
              )}
              <Button
                variant="contained"
                onClick={handleInstallCatalog}
                disabled={isDownloadingModels || !selectedCatalogId}
              >
                {isDownloadingModels ? '安装中...' : '一键安装内置模型'}
              </Button>
            </Stack>
          ) : (
            <Alert severity="warning">当前没有可用的内置模型清单。</Alert>
          )}

          <Button
            variant="text"
            size="small"
            onClick={() => setShowAdvancedDownload((value) => !value)}
            disabled={isDownloadingModels}
          >
            {showAdvancedDownload ? '隐藏高级下载（自定义 URL）' : '显示高级下载（自定义 URL）'}
          </Button>

          {showAdvancedDownload && (
            <Stack spacing={1}>
              <TextField
                label="模型包名称（可选）"
                value={downloadForm.bundleName}
                onChange={(event) => handleDownloadFormChange('bundleName', event.target.value)}
                placeholder="例如：zh-en + kokoro"
                disabled={isDownloadingModels}
                fullWidth
              />
              <TextField
                label="ASR 模型 URL（.onnx）"
                value={downloadForm.asrModelUrl}
                onChange={(event) => handleDownloadFormChange('asrModelUrl', event.target.value)}
                disabled={isDownloadingModels}
                fullWidth
              />
              <TextField
                label="ASR tokens URL（tokens.txt）"
                value={downloadForm.asrTokensUrl}
                onChange={(event) => handleDownloadFormChange('asrTokensUrl', event.target.value)}
                disabled={isDownloadingModels}
                fullWidth
              />
              <Stack direction="row" spacing={1}>
                <TextField
                  label="ASR Model Kind"
                  value={downloadForm.asrModelKind}
                  onChange={(event) => handleDownloadFormChange('asrModelKind', event.target.value)}
                  disabled={isDownloadingModels}
                  fullWidth
                />
                <TextField
                  label="ASR Provider"
                  value={downloadForm.asrExecutionProvider}
                  onChange={(event) => handleDownloadFormChange('asrExecutionProvider', event.target.value)}
                  placeholder="cpu/coreml/cuda"
                  disabled={isDownloadingModels}
                  fullWidth
                />
              </Stack>
              <TextField
                label="TTS 模型 URL（.onnx）"
                value={downloadForm.ttsModelUrl}
                onChange={(event) => handleDownloadFormChange('ttsModelUrl', event.target.value)}
                disabled={isDownloadingModels}
                fullWidth
              />
              <TextField
                label="TTS voices URL（voices.bin）"
                value={downloadForm.ttsVoicesUrl}
                onChange={(event) => handleDownloadFormChange('ttsVoicesUrl', event.target.value)}
                disabled={isDownloadingModels}
                fullWidth
              />
              <TextField
                label="TTS tokens URL（tokens.txt）"
                value={downloadForm.ttsTokensUrl}
                onChange={(event) => handleDownloadFormChange('ttsTokensUrl', event.target.value)}
                disabled={isDownloadingModels}
                fullWidth
              />
              <Stack direction="row" spacing={1}>
                <TextField
                  label="TTS Model Kind"
                  value={downloadForm.ttsModelKind}
                  onChange={(event) => handleDownloadFormChange('ttsModelKind', event.target.value)}
                  disabled={isDownloadingModels}
                  fullWidth
                />
                <TextField
                  label="TTS Provider"
                  value={downloadForm.ttsExecutionProvider}
                  onChange={(event) => handleDownloadFormChange('ttsExecutionProvider', event.target.value)}
                  placeholder="cpu/coreml/cuda"
                  disabled={isDownloadingModels}
                  fullWidth
                />
              </Stack>
              <Button
                variant="outlined"
                onClick={handleDownloadModels}
                disabled={isDownloadingModels || modelsLoading}
              >
                {isDownloadingModels ? '下载中...' : '下载并安装模型'}
              </Button>
            </Stack>
          )}

          {!!modelProgress && (
            <Stack spacing={0.5}>
              <LinearProgress
                variant={typeof modelProgress.overallProgress === 'number' ? 'determinate' : 'indeterminate'}
                value={typeof modelProgress.overallProgress === 'number' ? modelProgress.overallProgress * 100 : 0}
              />
              <Box sx={{ color: 'text.secondary', fontSize: 12 }}>
                {modelProgress.currentFile || '准备下载...'} · {modelProgress.completedTasks}/
                {modelProgress.totalTasks || '?'} · {formatBytes(modelProgress.fileDownloadedBytes)}/
                {formatBytes(modelProgress.fileTotalBytes)}
              </Box>
            </Stack>
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
    </Stack>
  );
}
