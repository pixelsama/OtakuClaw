import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { desktopBridge } from '../../services/desktopBridge.js';

export default function VoiceSettingsPanel({ desktopMode = false, onOpenDownloadCenter }) {
  const { t } = useI18n();
  const mountedRef = useRef(true);
  const progressEstimatorRef = useRef({
    key: '',
    lastBytes: 0,
    lastAtMs: 0,
    speedBytesPerSec: 0,
  });

  const [modelBundles, setModelBundles] = useState([]);
  const [selectedBundleId, setSelectedBundleId] = useState('');
  const [catalogItems, setCatalogItems] = useState([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [isDownloadingModels, setIsDownloadingModels] = useState(false);
  const [modelProgress, setModelProgress] = useState(null);
  const [modelFeedback, setModelFeedback] = useState('');
  const [modelError, setModelError] = useState('');

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

  const loadVoiceModels = useCallback(async () => {
    if (!desktopMode) {
      return;
    }

    if (mountedRef.current) {
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
  }, [desktopMode]);

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
    onOpenDownloadCenter?.('voice-models');
    setModelProgress({
      phase: 'started',
      completedTasks: 0,
      totalTasks: 0,
      currentFile: '',
      overallProgress: null,
      fileDownloadedBytes: 0,
      fileTotalBytes: 0,
      downloadSpeedBytesPerSec: 0,
      estimatedRemainingSeconds: null,
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
        return;
      }

      setModelBundles(Array.isArray(result.bundles) ? result.bundles : []);
      setSelectedBundleId(typeof result.selectedBundleId === 'string' ? result.selectedBundleId : '');
      setModelFeedback('内置模型安装完成并已自动选中。');
    } catch (error) {
      if (mountedRef.current) {
        const message = error?.message || '安装内置模型失败。';
        setModelError(message);
      }
    } finally {
      if (mountedRef.current) {
        setIsDownloadingModels(false);
      }
    }
  }, [desktopMode, onOpenDownloadCenter, selectedCatalogId]);

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

      const phase = typeof payload.phase === 'string' ? payload.phase : 'running';
      const currentFile = typeof payload.currentFile === 'string' ? payload.currentFile.trim() : '';
      const fileDownloadedBytes =
        Number.isFinite(payload.fileDownloadedBytes) && payload.fileDownloadedBytes > 0
          ? payload.fileDownloadedBytes
          : 0;
      const fileTotalBytes =
        Number.isFinite(payload.fileTotalBytes) && payload.fileTotalBytes > 0
          ? payload.fileTotalBytes
          : 0;
      const backendSpeed =
        Number.isFinite(payload.downloadSpeedBytesPerSec) && payload.downloadSpeedBytesPerSec > 0
          ? payload.downloadSpeedBytesPerSec
          : 0;
      const backendEta =
        Number.isFinite(payload.estimatedRemainingSeconds) && payload.estimatedRemainingSeconds >= 0
          ? payload.estimatedRemainingSeconds
          : null;

      let speedBytesPerSec = backendSpeed;
      let estimatedRemainingSeconds = backendEta;
      if (phase !== 'running' || !currentFile || fileTotalBytes <= 0) {
        progressEstimatorRef.current = {
          key: '',
          lastBytes: 0,
          lastAtMs: 0,
          speedBytesPerSec: 0,
        };
      } else if (backendSpeed <= 0) {
        const key = `${phase}|${currentFile}|${fileTotalBytes}`;
        const nowMs = Date.now();
        const previous = progressEstimatorRef.current;
        if (previous.key !== key || fileDownloadedBytes < previous.lastBytes) {
          progressEstimatorRef.current = {
            key,
            lastBytes: fileDownloadedBytes,
            lastAtMs: nowMs,
            speedBytesPerSec: 0,
          };
        } else {
          const elapsedSeconds = Math.max(0.001, (nowMs - previous.lastAtMs) / 1000);
          const deltaBytes = Math.max(0, fileDownloadedBytes - previous.lastBytes);
          const instantSpeed = deltaBytes / elapsedSeconds;
          const smoothedSpeed =
            instantSpeed > 0
              ? previous.speedBytesPerSec > 0
                ? previous.speedBytesPerSec * 0.7 + instantSpeed * 0.3
                : instantSpeed
              : previous.speedBytesPerSec;

          progressEstimatorRef.current = {
            key,
            lastBytes: fileDownloadedBytes,
            lastAtMs: nowMs,
            speedBytesPerSec: smoothedSpeed,
          };
          speedBytesPerSec = smoothedSpeed;
          if (speedBytesPerSec > 0) {
            estimatedRemainingSeconds = Math.max(0, (fileTotalBytes - fileDownloadedBytes) / speedBytesPerSec);
          }
        }
      }

      setModelProgress({
        phase,
        completedTasks: Number.isFinite(payload.completedTasks) ? payload.completedTasks : 0,
        totalTasks: Number.isFinite(payload.totalTasks) ? payload.totalTasks : 0,
        currentFile,
        overallProgress: Number.isFinite(payload.overallProgress) ? payload.overallProgress : null,
        fileDownloadedBytes,
        fileTotalBytes,
        downloadSpeedBytesPerSec: speedBytesPerSec,
        estimatedRemainingSeconds,
      });
    });
  }, [desktopMode]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return (
    <Stack spacing={2}>
      <Box sx={{ fontWeight: 600 }}>{t('voice.title')}</Box>
      {!desktopMode && <Alert severity="warning">{t('voice.desktopOnly')}</Alert>}

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
            <Button size="small" variant="outlined" onClick={() => onOpenDownloadCenter?.('voice-models')}>
              查看下载进度窗口
            </Button>
          )}

          {!!modelError && <Alert severity="warning">{modelError}</Alert>}
          {!!modelFeedback && <Alert severity="success">{modelFeedback}</Alert>}
        </Stack>
      )}
    </Stack>
  );
}
