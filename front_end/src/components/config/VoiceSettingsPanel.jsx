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

const ASR_TEST_RECORD_MS = 3000;
const ASR_TEST_SAMPLE_RATE = 16000;

function clampToInt16(sample) {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function downsampleFloat32(input, inputSampleRate, outputSampleRate) {
  if (!(input instanceof Float32Array) || !input.length) {
    return new Int16Array(0);
  }

  if (inputSampleRate <= outputSampleRate) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      output[i] = clampToInt16(input[i]);
    }
    return output;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);

  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < outputLength) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accumulator = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i += 1) {
      accumulator += input[i];
      count += 1;
    }
    const average = count > 0 ? accumulator / count : 0;
    output[offsetResult] = clampToInt16(average);
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return output;
}

function mergeFloat32Frames(frames = []) {
  if (!Array.isArray(frames) || !frames.length) {
    return new Float32Array(0);
  }

  const totalLength = frames.reduce((sum, frame) => sum + frame.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const frame of frames) {
    merged.set(frame, offset);
    offset += frame.length;
  }
  return merged;
}

function int16ToUint8(int16Samples) {
  const out = new Uint8Array(int16Samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < int16Samples.length; i += 1) {
    view.setInt16(i * 2, int16Samples[i], true);
  }
  return out;
}

function formatMs(value) {
  if (!Number.isFinite(value) || value < 0) {
    return '-';
  }
  return `${Math.round(value)} ms`;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }
  if (value < 1024) {
    return `${Math.round(value)} B`;
  }
  const kib = value / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KiB`;
  }
  return `${(kib / 1024).toFixed(2)} MiB`;
}

function decodeBase64ToUint8(base64Value) {
  const raw = typeof base64Value === 'string' ? base64Value.trim() : '';
  if (!raw) {
    return new Uint8Array(0);
  }

  const binary = window.atob(raw);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function createWavBlobFromPcmS16Le({
  pcmS16LeBase64,
  sampleRate = 24000,
  channels = 1,
} = {}) {
  const pcmBytes = decodeBase64ToUint8(pcmS16LeBase64);
  if (!pcmBytes.length) {
    return null;
  }

  const safeChannels = Math.max(1, Math.floor(channels) || 1);
  const safeSampleRate = Math.max(1, Math.floor(sampleRate) || 24000);
  const blockAlign = safeChannels * 2;
  const byteRate = safeSampleRate * blockAlign;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, safeChannels, true);
  view.setUint32(24, safeSampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcmBytes.length, true);

  const wavBytes = new Uint8Array(44 + pcmBytes.length);
  wavBytes.set(new Uint8Array(header), 0);
  wavBytes.set(pcmBytes, 44);
  return new Blob([wavBytes], { type: 'audio/wav' });
}

function bundleHasAsr(bundle = {}) {
  return Boolean(bundle?.hasAsr || bundle?.asr?.modelPath || bundle?.runtime?.asrModelDir);
}

function bundleHasTts(bundle = {}) {
  return Boolean(bundle?.hasTts || bundle?.tts?.modelPath || bundle?.runtime?.ttsModelDir);
}

function resolveAsrModelPath(bundle = {}) {
  return bundle?.asr?.modelPath || bundle?.runtime?.asrModelDir || '';
}

function resolveTtsModelPath(bundle = {}) {
  return bundle?.tts?.modelPath || bundle?.runtime?.ttsModelDir || '';
}

async function captureAsrTestPcm({ durationMs = ASR_TEST_RECORD_MS, sampleRate = ASR_TEST_SAMPLE_RATE } = {}) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前环境不支持麦克风采集。');
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('当前环境不支持 AudioContext。');
  }

  let stream = null;
  let audioContext = null;
  let sourceNode = null;
  let scriptNode = null;
  let gainNode = null;
  const capturedFrames = [];

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    audioContext = new AudioContextCtor();
    sourceNode = audioContext.createMediaStreamSource(stream);
    scriptNode = audioContext.createScriptProcessor(2048, 1, 1);
    gainNode = audioContext.createGain();
    gainNode.gain.value = 0;

    scriptNode.onaudioprocess = (event) => {
      const frame = event.inputBuffer.getChannelData(0);
      capturedFrames.push(new Float32Array(frame));
    };

    sourceNode.connect(scriptNode);
    scriptNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    await new Promise((resolve) => {
      setTimeout(resolve, Math.max(500, Math.floor(durationMs)));
    });
  } finally {
    if (scriptNode) {
      try {
        scriptNode.disconnect();
      } catch {
        // noop
      }
    }
    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch {
        // noop
      }
    }
    if (gainNode) {
      try {
        gainNode.disconnect();
      } catch {
        // noop
      }
    }
    if (audioContext) {
      await audioContext.close().catch(() => {});
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  }

  const merged = mergeFloat32Frames(capturedFrames);
  const pcm = downsampleFloat32(merged, audioContext?.sampleRate || 48000, sampleRate);
  const bytes = int16ToUint8(pcm);
  if (!bytes.length) {
    throw new Error('录音为空，请重试并确认麦克风输入。');
  }

  return bytes;
}

export default function VoiceSettingsPanel({ desktopMode = false, onOpenDownloadCenter }) {
  const { t } = useI18n();
  const mountedRef = useRef(true);
  const progressEstimatorRef = useRef({
    key: '',
    lastBytes: 0,
    lastAtMs: 0,
    speedBytesPerSec: 0,
  });
  const ttsPreviewAudioRef = useRef(null);

  const [modelBundles, setModelBundles] = useState([]);
  const [selectedAsrBundleId, setSelectedAsrBundleId] = useState('');
  const [selectedTtsBundleId, setSelectedTtsBundleId] = useState('');
  const [catalogItems, setCatalogItems] = useState([]);
  const [selectedAsrCatalogId, setSelectedAsrCatalogId] = useState('');
  const [selectedTtsCatalogId, setSelectedTtsCatalogId] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [isDownloadingModels, setIsDownloadingModels] = useState(false);
  const [modelProgress, setModelProgress] = useState(null);
  const [modelFeedback, setModelFeedback] = useState('');
  const [modelError, setModelError] = useState('');
  const [isAsrTesting, setIsAsrTesting] = useState(false);
  const [isTtsTesting, setIsTtsTesting] = useState(false);
  const [asrPromptText, setAsrPromptText] = useState('我正在测试 ASR 延迟。');
  const [ttsTestText, setTtsTestText] = useState('你好，这是一条 TTS 延迟测试语句。');
  const [asrTestResult, setAsrTestResult] = useState(null);
  const [ttsTestResult, setTtsTestResult] = useState(null);
  const [voiceTestError, setVoiceTestError] = useState('');
  const [ttsTestAudioUrl, setTtsTestAudioUrl] = useState('');

  const activeAsrBundle = useMemo(
    () => modelBundles.find((item) => item.id === selectedAsrBundleId) || null,
    [modelBundles, selectedAsrBundleId],
  );
  const activeTtsBundle = useMemo(
    () => modelBundles.find((item) => item.id === selectedTtsBundleId) || null,
    [modelBundles, selectedTtsBundleId],
  );
  const asrCatalogItems = useMemo(
    () => catalogItems.filter((item) => item?.hasAsr),
    [catalogItems],
  );
  const ttsCatalogItems = useMemo(
    () => catalogItems.filter((item) => item?.hasTts),
    [catalogItems],
  );
  const selectedAsrCatalogItem = useMemo(
    () => asrCatalogItems.find((item) => item.id === selectedAsrCatalogId) || null,
    [asrCatalogItems, selectedAsrCatalogId],
  );
  const selectedTtsCatalogItem = useMemo(
    () => ttsCatalogItems.find((item) => item.id === selectedTtsCatalogId) || null,
    [ttsCatalogItems, selectedTtsCatalogId],
  );
  const installedAsrCatalogBundle = useMemo(() => {
    if (!selectedAsrCatalogId) {
      return null;
    }
    return (
      modelBundles.find(
        (bundle) => bundle.catalogId === selectedAsrCatalogId && bundleHasAsr(bundle),
      ) || null
    );
  }, [modelBundles, selectedAsrCatalogId]);
  const installedTtsCatalogBundle = useMemo(() => {
    if (!selectedTtsCatalogId) {
      return null;
    }
    return (
      modelBundles.find(
        (bundle) => bundle.catalogId === selectedTtsCatalogId && bundleHasTts(bundle),
      ) || null
    );
  }, [modelBundles, selectedTtsCatalogId]);
  const hasInstalledSelectedAsrCatalog = Boolean(selectedAsrCatalogId && installedAsrCatalogBundle);
  const hasInstalledSelectedTtsCatalog = Boolean(selectedTtsCatalogId && installedTtsCatalogBundle);
  const effectiveActiveAsrBundle =
    selectedAsrCatalogId && !hasInstalledSelectedAsrCatalog ? null : activeAsrBundle;
  const effectiveActiveTtsBundle =
    selectedTtsCatalogId && !hasInstalledSelectedTtsCatalog ? null : activeTtsBundle;

  const applyVoiceModelList = useCallback((result = {}) => {
    const bundles = Array.isArray(result.bundles) ? result.bundles : [];
    setModelBundles(bundles);
    setSelectedAsrBundleId(
      typeof result.selectedAsrBundleId === 'string'
        ? result.selectedAsrBundleId
        : (typeof result.selectedBundleId === 'string' ? result.selectedBundleId : ''),
    );
    setSelectedTtsBundleId(
      typeof result.selectedTtsBundleId === 'string'
        ? result.selectedTtsBundleId
        : (typeof result.selectedBundleId === 'string' ? result.selectedBundleId : ''),
    );
  }, []);

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
        setSelectedAsrBundleId('');
        setSelectedTtsBundleId('');
        return;
      }

      applyVoiceModelList(result);
    } catch (error) {
      if (mountedRef.current) {
        setModelError(error?.message || '读取语音模型列表失败。');
        setModelBundles([]);
        setSelectedAsrBundleId('');
        setSelectedTtsBundleId('');
      }
    } finally {
      if (mountedRef.current) {
        setModelsLoading(false);
      }
    }
  }, [applyVoiceModelList, desktopMode]);

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
      const asrItems = items.filter((item) => item?.hasAsr);
      const ttsItems = items.filter((item) => item?.hasTts);
      setSelectedAsrCatalogId((previous) => {
        if (previous && asrItems.some((item) => item.id === previous)) {
          return previous;
        }
        return asrItems[0]?.id || '';
      });
      setSelectedTtsCatalogId((previous) => {
        if (previous && ttsItems.some((item) => item.id === previous)) {
          return previous;
        }
        return ttsItems[0]?.id || '';
      });
    } catch (error) {
      if (mountedRef.current) {
        setCatalogItems([]);
        setSelectedAsrCatalogId('');
        setSelectedTtsCatalogId('');
        setModelError(error?.message || '读取内置模型列表失败，请重启应用后重试。');
      }
    }
  }, [desktopMode]);

  const handleRefreshModels = useCallback(async () => {
    setModelError('');
    await loadVoiceModels();
  }, [loadVoiceModels]);

  const handleChangeAsrCatalog = useCallback(async (nextCatalogId) => {
    setSelectedAsrCatalogId(nextCatalogId);
    if (!desktopMode) {
      return;
    }

    setModelError('');
    setModelFeedback('');

    const asrBundleId = nextCatalogId
      ? modelBundles.find((bundle) => bundle.catalogId === nextCatalogId && bundleHasAsr(bundle))?.id || ''
      : '';
    if (nextCatalogId && !asrBundleId) {
      setSelectedAsrBundleId('');
      try {
        const clearResult = await desktopBridge.voiceModels.select({ asrBundleId: '' });
        if (!mountedRef.current) {
          return;
        }
        if (!clearResult?.ok) {
          setModelError(clearResult?.error?.message || '切换 ASR 空状态失败。');
          return;
        }
        applyVoiceModelList(clearResult);
        setModelFeedback('该 ASR 模型未下载；ASR 已切换为空状态（不生效）。');
      } catch (error) {
        if (mountedRef.current) {
          setModelError(error?.message || '切换 ASR 空状态失败。');
        }
      }
      return;
    }

    try {
      const result = await desktopBridge.voiceModels.select({ asrBundleId });
      if (!mountedRef.current) {
        return;
      }

      if (!result?.ok) {
        setModelError(result?.error?.message || '切换 ASR 模型失败。');
        return;
      }

      applyVoiceModelList(result);
      setModelFeedback(nextCatalogId ? 'ASR 模型已生效。' : 'ASR 已恢复为环境变量配置。');
    } catch (error) {
      if (mountedRef.current) {
        setModelError(error?.message || '切换 ASR 模型失败。');
      }
    }
  }, [applyVoiceModelList, desktopMode, modelBundles]);

  const handleChangeTtsCatalog = useCallback(async (nextCatalogId) => {
    setSelectedTtsCatalogId(nextCatalogId);
    if (!desktopMode) {
      return;
    }

    setModelError('');
    setModelFeedback('');

    const ttsBundleId = nextCatalogId
      ? modelBundles.find((bundle) => bundle.catalogId === nextCatalogId && bundleHasTts(bundle))?.id || ''
      : '';
    if (nextCatalogId && !ttsBundleId) {
      setSelectedTtsBundleId('');
      try {
        const clearResult = await desktopBridge.voiceModels.select({ ttsBundleId: '' });
        if (!mountedRef.current) {
          return;
        }
        if (!clearResult?.ok) {
          setModelError(clearResult?.error?.message || '切换 TTS 空状态失败。');
          return;
        }
        applyVoiceModelList(clearResult);
        setModelFeedback('该 TTS 模型未下载；TTS 已切换为空状态（不生效）。');
      } catch (error) {
        if (mountedRef.current) {
          setModelError(error?.message || '切换 TTS 空状态失败。');
        }
      }
      return;
    }

    try {
      const result = await desktopBridge.voiceModels.select({ ttsBundleId });
      if (!mountedRef.current) {
        return;
      }

      if (!result?.ok) {
        setModelError(result?.error?.message || '切换 TTS 模型失败。');
        return;
      }

      applyVoiceModelList(result);
      setModelFeedback(nextCatalogId ? 'TTS 模型已生效。' : 'TTS 已恢复为环境变量配置。');
    } catch (error) {
      if (mountedRef.current) {
        setModelError(error?.message || '切换 TTS 模型失败。');
      }
    }
  }, [applyVoiceModelList, desktopMode, modelBundles]);

  const handleInstallAsrModel = useCallback(async () => {
    if (!desktopMode || !selectedAsrCatalogId) {
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
      const result = await desktopBridge.voiceModels.installCatalog(selectedAsrCatalogId, {
        installAsr: true,
        installTts: false,
      });
      if (!mountedRef.current) {
        return;
      }

      if (!result?.ok) {
        const message = result?.error?.message || '下载 ASR 模型失败。';
        setModelError(message);
        return;
      }

      applyVoiceModelList(result);
      setModelFeedback('ASR 模型下载完成并已自动选中。');
    } catch (error) {
      if (mountedRef.current) {
        const message = error?.message || '下载 ASR 模型失败。';
        setModelError(message);
      }
    } finally {
      if (mountedRef.current) {
        setIsDownloadingModels(false);
      }
    }
  }, [applyVoiceModelList, desktopMode, onOpenDownloadCenter, selectedAsrCatalogId]);

  const handleInstallTtsModel = useCallback(async () => {
    if (!desktopMode || !selectedTtsCatalogId) {
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
      const result = await desktopBridge.voiceModels.installCatalog(selectedTtsCatalogId, {
        installAsr: false,
        installTts: true,
      });
      if (!mountedRef.current) {
        return;
      }

      if (!result?.ok) {
        const message = result?.error?.message || '下载 TTS 模型失败。';
        setModelError(message);
        return;
      }

      applyVoiceModelList(result);
      setModelFeedback('TTS 模型下载完成并已自动选中。');
    } catch (error) {
      if (mountedRef.current) {
        const message = error?.message || '下载 TTS 模型失败。';
        setModelError(message);
      }
    } finally {
      if (mountedRef.current) {
        setIsDownloadingModels(false);
      }
    }
  }, [applyVoiceModelList, desktopMode, onOpenDownloadCenter, selectedTtsCatalogId]);

  const handleRunAsrTest = useCallback(async () => {
    if (!desktopMode || isAsrTesting || isTtsTesting) {
      return;
    }

    setVoiceTestError('');
    setAsrTestResult(null);
    setIsAsrTesting(true);
    try {
      const pcmChunk = await captureAsrTestPcm({
        durationMs: ASR_TEST_RECORD_MS,
        sampleRate: ASR_TEST_SAMPLE_RATE,
      });

      if (!mountedRef.current) {
        return;
      }

      const result = await desktopBridge.voice.runAsrDiagnostics({
        pcmChunk,
        sampleRate: ASR_TEST_SAMPLE_RATE,
        channels: 1,
        sampleFormat: 'pcm_s16le',
      });
      if (!mountedRef.current) {
        return;
      }

      if (!result?.ok) {
        setVoiceTestError(result?.error?.message || result?.reason || 'ASR 测试失败。');
        return;
      }

      setAsrTestResult({
        ...result,
        promptText: asrPromptText,
      });
    } catch (error) {
      if (mountedRef.current) {
        setVoiceTestError(error?.message || 'ASR 测试失败。');
      }
    } finally {
      if (mountedRef.current) {
        setIsAsrTesting(false);
      }
    }
  }, [desktopMode, asrPromptText, isAsrTesting, isTtsTesting]);

  const handleRunTtsTest = useCallback(async () => {
    if (!desktopMode || isAsrTesting || isTtsTesting) {
      return;
    }

    const text = typeof ttsTestText === 'string' ? ttsTestText.trim() : '';
    if (!text) {
      setVoiceTestError('请输入 TTS 测试文本。');
      return;
    }

    setVoiceTestError('');
    setTtsTestResult(null);
    if (ttsPreviewAudioRef.current) {
      ttsPreviewAudioRef.current.pause();
      ttsPreviewAudioRef.current = null;
    }
    setTtsTestAudioUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return '';
    });
    setIsTtsTesting(true);
    try {
      const result = await desktopBridge.voice.runTtsDiagnostics({
        text,
        includeAudio: true,
      });
      if (!mountedRef.current) {
        return;
      }

      if (!result?.ok) {
        setVoiceTestError(result?.error?.message || result?.reason || 'TTS 测试失败。');
        return;
      }

      setTtsTestResult({
        ...result,
        text,
      });

      const wavBlob = createWavBlobFromPcmS16Le({
        pcmS16LeBase64: result?.pcmS16LeBase64,
        sampleRate: result?.sampleRate,
        channels: 1,
      });
      if (wavBlob) {
        const objectUrl = URL.createObjectURL(wavBlob);
        setTtsTestAudioUrl(objectUrl);
      }
    } catch (error) {
      if (mountedRef.current) {
        setVoiceTestError(error?.message || 'TTS 测试失败。');
      }
    } finally {
      if (mountedRef.current) {
        setIsTtsTesting(false);
      }
    }
  }, [desktopMode, isAsrTesting, isTtsTesting, ttsTestText]);

  const handlePlayTtsTestAudio = useCallback(async () => {
    if (!ttsTestAudioUrl) {
      setVoiceTestError('暂无可播放的 TTS 测试音频，请先执行一次 TTS 测试。');
      return;
    }

    setVoiceTestError('');
    try {
      if (ttsPreviewAudioRef.current) {
        ttsPreviewAudioRef.current.pause();
      }

      const audio = new Audio(ttsTestAudioUrl);
      ttsPreviewAudioRef.current = audio;
      await audio.play();
    } catch (error) {
      setVoiceTestError(error?.message || '播放 TTS 测试音频失败。');
    }
  }, [ttsTestAudioUrl]);

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
      if (ttsPreviewAudioRef.current) {
        ttsPreviewAudioRef.current.pause();
        ttsPreviewAudioRef.current = null;
      }
    };
  }, []);

  useEffect(
    () => () => {
      if (ttsTestAudioUrl) {
        URL.revokeObjectURL(ttsTestAudioUrl);
      }
    },
    [ttsTestAudioUrl],
  );

  return (
    <Stack spacing={2}>
      <Box sx={{ fontWeight: 600 }}>{t('voice.title')}</Box>
      {!desktopMode && <Alert severity="warning">{t('voice.desktopOnly')}</Alert>}

      {desktopMode && (
        <Stack spacing={1.5} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
          <Box sx={{ fontWeight: 600 }}>本地语音模型管理</Box>
          {catalogItems.length > 0 ? (
            <Stack spacing={1.5}>
              <Stack spacing={1}>
                <Box sx={{ fontWeight: 600 }}>ASR</Box>
                <TextField
                  select
                  label="ASR 模型列表"
                  value={selectedAsrCatalogId}
                  onChange={(event) => {
                    void handleChangeAsrCatalog(event.target.value);
                  }}
                  disabled={modelsLoading || isDownloadingModels}
                  fullWidth
                >
                  <MenuItem value="">不使用内置模型（回退环境变量）</MenuItem>
                  {asrCatalogItems.map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.asrOptionLabel || item.name}
                    </MenuItem>
                  ))}
                </TextField>
                {!!selectedAsrCatalogId && (
                  <Alert severity="info">
                    {`ASR: ${selectedAsrCatalogItem?.asrOptionLabel || selectedAsrCatalogItem?.name || ''}`}
                  </Alert>
                )}
                {selectedAsrCatalogId ? (
                  <Alert severity={hasInstalledSelectedAsrCatalog ? 'success' : 'warning'}>
                    {hasInstalledSelectedAsrCatalog
                      ? '所选 ASR 模型状态: 已下载'
                      : '所选 ASR 模型状态: 未下载'}
                  </Alert>
                ) : (
                  <Alert severity="info">所选 ASR 模型状态: 使用环境变量（未选择内置模型）</Alert>
                )}
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {!!selectedAsrCatalogId && (
                    <Button
                      variant="contained"
                      size="small"
                      onClick={handleInstallAsrModel}
                      disabled={isDownloadingModels}
                    >
                      {hasInstalledSelectedAsrCatalog ? '重新下载 ASR 模型' : '下载 ASR 模型'}
                    </Button>
                  )}
                </Stack>
                {!!resolveAsrModelPath(effectiveActiveAsrBundle) && (
                  <TextField
                    label="ASR Model Path"
                    value={resolveAsrModelPath(effectiveActiveAsrBundle)}
                    disabled
                    fullWidth
                  />
                )}
              </Stack>

              <Stack spacing={1}>
                <Box sx={{ fontWeight: 600 }}>TTS</Box>
                <TextField
                  select
                  label="TTS 模型列表"
                  value={selectedTtsCatalogId}
                  onChange={(event) => {
                    void handleChangeTtsCatalog(event.target.value);
                  }}
                  disabled={modelsLoading || isDownloadingModels}
                  fullWidth
                >
                  <MenuItem value="">不使用内置模型（回退环境变量）</MenuItem>
                  {ttsCatalogItems.map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.ttsOptionLabel || item.name}
                    </MenuItem>
                  ))}
                </TextField>
                {!!selectedTtsCatalogId && (
                  <Alert severity="info">
                    {`TTS: ${selectedTtsCatalogItem?.ttsOptionLabel || selectedTtsCatalogItem?.name || ''}`}
                  </Alert>
                )}
                {selectedTtsCatalogId ? (
                  <Alert severity={hasInstalledSelectedTtsCatalog ? 'success' : 'warning'}>
                    {hasInstalledSelectedTtsCatalog
                      ? '所选 TTS 模型状态: 已下载'
                      : '所选 TTS 模型状态: 未下载'}
                  </Alert>
                ) : (
                  <Alert severity="info">所选 TTS 模型状态: 使用环境变量（未选择内置模型）</Alert>
                )}
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {!!selectedTtsCatalogId && (
                    <Button
                      variant="contained"
                      size="small"
                      onClick={handleInstallTtsModel}
                      disabled={isDownloadingModels}
                    >
                      {hasInstalledSelectedTtsCatalog ? '重新下载 TTS 模型' : '下载 TTS 模型'}
                    </Button>
                  )}
                </Stack>
                {!!resolveTtsModelPath(effectiveActiveTtsBundle) && (
                  <TextField
                    label="TTS Model Path"
                    value={resolveTtsModelPath(effectiveActiveTtsBundle)}
                    disabled
                    fullWidth
                  />
                )}
              </Stack>

              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Button
                  variant="text"
                  size="small"
                  onClick={handleRefreshModels}
                  disabled={modelsLoading || isDownloadingModels}
                >
                  刷新模型状态
                </Button>
              </Stack>
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

      {desktopMode && (
        <Stack spacing={1.5} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
          <Box sx={{ fontWeight: 600 }}>语音延迟测试（当前生效模型）</Box>
          <Alert severity="info">
            ASR 测试会请求麦克风并录音 3 秒，请点击后朗读你设置的提示词。
          </Alert>
          <TextField
            label="ASR 朗读提示词"
            value={asrPromptText}
            onChange={(event) => setAsrPromptText(event.target.value)}
            disabled={isAsrTesting || isTtsTesting}
            fullWidth
          />
          <Button
            variant="outlined"
            onClick={handleRunAsrTest}
            disabled={isAsrTesting || isTtsTesting}
          >
            {isAsrTesting ? 'ASR 测试中（录音 3 秒）...' : 'ASR 延迟测试（录音 3 秒）'}
          </Button>
          {!!asrTestResult && (
            <Alert severity="success">
              {`ASR 耗时: ${formatMs(asrTestResult.latencyMs)}；识别结果: ${asrTestResult.text || '（空）'}；采样: ${asrTestResult.sampleRate || ASR_TEST_SAMPLE_RATE}Hz；音频大小: ${formatBytes(asrTestResult.audioBytes)}。`}
            </Alert>
          )}

          <TextField
            label="TTS 测试文本"
            value={ttsTestText}
            onChange={(event) => setTtsTestText(event.target.value)}
            disabled={isAsrTesting || isTtsTesting}
            fullWidth
            multiline
            minRows={2}
          />
          <Button
            variant="outlined"
            onClick={handleRunTtsTest}
            disabled={isAsrTesting || isTtsTesting}
          >
            {isTtsTesting ? 'TTS 测试中...' : 'TTS 延迟测试'}
          </Button>
          {!!ttsTestResult && (
            <Alert severity="success">
              {`TTS 首包: ${formatMs(ttsTestResult.firstChunkLatencyMs)}；总耗时: ${formatMs(ttsTestResult.latencyMs)}；chunks: ${ttsTestResult.chunkCount || 0}；音频大小: ${formatBytes(ttsTestResult.totalBytes)}。`}
            </Alert>
          )}
          <Button
            variant="outlined"
            onClick={handlePlayTtsTestAudio}
            disabled={!ttsTestAudioUrl || isAsrTesting || isTtsTesting}
          >
            播放最新 TTS 测试音频
          </Button>

          {!!voiceTestError && <Alert severity="warning">{voiceTestError}</Alert>}
        </Stack>
      )}
    </Stack>
  );
}
