import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import { desktopBridge } from '../../services/desktopBridge.js';

const ASR_TEST_RECORD_MS = 3000;
const ASR_TEST_SAMPLE_RATE = 16000;

const DEFAULT_DASHSCOPE_SETTINGS = {
  workspace: '',
  baseUrl: '',
  apiKey: '',
  asrModel: 'qwen3-asr-flash-realtime',
  asrLanguage: 'zh',
  ttsModel: 'qwen-tts-realtime-latest',
  ttsVoice: 'Cherry',
  ttsLanguage: 'Chinese',
  ttsSampleRate: 24000,
  ttsSpeechRate: 1,
};

function bundleHasAsr(bundle = {}) {
  return Boolean(bundle?.hasAsr || bundle?.asr?.modelPath || bundle?.runtime?.asrModelDir);
}

function bundleHasTts(bundle = {}) {
  return Boolean(
    bundle?.hasTts
      || bundle?.tts?.modelPath
      || bundle?.runtime?.ttsModelDir
      || bundle?.runtime?.ttsEngine,
  );
}

function findInstalledBundleByCatalogId({ bundles = [], catalogId = '', capability = 'asr' }) {
  if (!catalogId) {
    return null;
  }
  const supportsCapability = capability === 'tts' ? bundleHasTts : bundleHasAsr;
  return bundles.find((bundle) => bundle?.catalogId === catalogId && supportsCapability(bundle)) || null;
}

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

function formatMs(value) {
  if (!Number.isFinite(value) || value < 0) {
    return '-';
  }
  return `${Math.round(value)} ms`;
}

const STEP_LABELS = ['推理后端', 'ASR', 'TTS'];

export default function FirstRunOnboardingDialog({
  open = false,
  desktopMode = false,
  chatBackendSettings = {},
  settingsSaving = false,
  settingsTesting = false,
  settingsFeedback = '',
  settingsError = '',
  onChatBackendChange,
  onOpenClawSettingChange,
  onNanobotSettingChange,
  onPickNanobotWorkspace,
  onTestChatBackendSettings,
  nanobotRuntimeStatus = {},
  nanobotRuntimeInstalling = false,
  onInstallNanobotRuntime,
  onOpenDownloadCenter,
  onFinish,
}) {
  const mountedRef = useRef(true);
  const [activeStep, setActiveStep] = useState(0);

  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [voiceFeedback, setVoiceFeedback] = useState('');
  const [dashscopeApiKeySaved, setDashscopeApiKeySaved] = useState(false);

  const [catalogItems, setCatalogItems] = useState([]);
  const [modelBundles, setModelBundles] = useState([]);

  const [dashscopeSettings, setDashscopeSettings] = useState(DEFAULT_DASHSCOPE_SETTINGS);

  const [asrSource, setAsrSource] = useState('skip');
  const [ttsSource, setTtsSource] = useState('skip');
  const [selectedAsrCatalogId, setSelectedAsrCatalogId] = useState('');
  const [selectedTtsCatalogId, setSelectedTtsCatalogId] = useState('');

  const [isInstallingAsr, setIsInstallingAsr] = useState(false);
  const [isInstallingTts, setIsInstallingTts] = useState(false);

  const [asrPrompt, setAsrPrompt] = useState('请朗读这一句用于测试 ASR。');
  const [ttsText, setTtsText] = useState('你好，这是一条 TTS 延迟测试语句。');
  const [asrTesting, setAsrTesting] = useState(false);
  const [ttsTesting, setTtsTesting] = useState(false);
  const [asrResult, setAsrResult] = useState(null);
  const [ttsResult, setTtsResult] = useState(null);

  const selectedBackend = chatBackendSettings?.chatBackend === 'nanobot' ? 'nanobot' : 'openclaw';
  const openClawSettings = chatBackendSettings?.openclaw || {};
  const nanobotSettings = chatBackendSettings?.nanobot || {};
  const isBusy = settingsSaving
    || settingsTesting
    || nanobotRuntimeInstalling
    || voiceLoading
    || voiceSaving
    || isInstallingAsr
    || isInstallingTts
    || asrTesting
    || ttsTesting;

  const asrCatalogItems = useMemo(
    () => (Array.isArray(catalogItems) ? catalogItems.filter((item) => item?.hasAsr) : []),
    [catalogItems],
  );
  const ttsCatalogItems = useMemo(
    () => (Array.isArray(catalogItems) ? catalogItems.filter((item) => item?.hasTts) : []),
    [catalogItems],
  );

  const installedAsrBundle = useMemo(
    () => findInstalledBundleByCatalogId({ bundles: modelBundles, catalogId: selectedAsrCatalogId, capability: 'asr' }),
    [modelBundles, selectedAsrCatalogId],
  );
  const installedTtsBundle = useMemo(
    () => findInstalledBundleByCatalogId({ bundles: modelBundles, catalogId: selectedTtsCatalogId, capability: 'tts' }),
    [modelBundles, selectedTtsCatalogId],
  );

  const loadVoiceContext = useCallback(async () => {
    if (!desktopMode) {
      return;
    }

    setVoiceLoading(true);
    setVoiceError('');
    try {
      const [settingsResult, catalogResult, listResult] = await Promise.all([
        desktopBridge.settings.get(),
        desktopBridge.voiceModels.catalog(),
        desktopBridge.voiceModels.list(),
      ]);
      if (!mountedRef.current) {
        return;
      }

      const voice = settingsResult?.voice || {};
      const dashscope = voice?.dashscope || {};
      const bundles = Array.isArray(listResult?.bundles) ? listResult.bundles : [];
      const items = catalogResult?.ok && Array.isArray(catalogResult.items) ? catalogResult.items : [];

      const selectedAsrBundleId =
        typeof listResult?.selectedAsrBundleId === 'string'
          ? listResult.selectedAsrBundleId
          : (typeof listResult?.selectedBundleId === 'string' ? listResult.selectedBundleId : '');
      const selectedTtsBundleId =
        typeof listResult?.selectedTtsBundleId === 'string'
          ? listResult.selectedTtsBundleId
          : (typeof listResult?.selectedBundleId === 'string' ? listResult.selectedBundleId : '');

      const selectedAsrBundle = bundles.find((bundle) => bundle?.id === selectedAsrBundleId && bundleHasAsr(bundle)) || null;
      const selectedTtsBundle = bundles.find((bundle) => bundle?.id === selectedTtsBundleId && bundleHasTts(bundle)) || null;

      setCatalogItems(items);
      setModelBundles(bundles);
      setDashscopeSettings({
        workspace: typeof dashscope.workspace === 'string' ? dashscope.workspace : DEFAULT_DASHSCOPE_SETTINGS.workspace,
        baseUrl: typeof dashscope.baseUrl === 'string' ? dashscope.baseUrl : DEFAULT_DASHSCOPE_SETTINGS.baseUrl,
        apiKey: '',
        asrModel: typeof dashscope.asrModel === 'string' && dashscope.asrModel
          ? dashscope.asrModel
          : DEFAULT_DASHSCOPE_SETTINGS.asrModel,
        asrLanguage: typeof dashscope.asrLanguage === 'string' && dashscope.asrLanguage
          ? dashscope.asrLanguage
          : DEFAULT_DASHSCOPE_SETTINGS.asrLanguage,
        ttsModel: typeof dashscope.ttsModel === 'string' && dashscope.ttsModel
          ? dashscope.ttsModel
          : DEFAULT_DASHSCOPE_SETTINGS.ttsModel,
        ttsVoice: typeof dashscope.ttsVoice === 'string' && dashscope.ttsVoice
          ? dashscope.ttsVoice
          : DEFAULT_DASHSCOPE_SETTINGS.ttsVoice,
        ttsLanguage: typeof dashscope.ttsLanguage === 'string' && dashscope.ttsLanguage
          ? dashscope.ttsLanguage
          : DEFAULT_DASHSCOPE_SETTINGS.ttsLanguage,
        ttsSampleRate: Number.isFinite(dashscope.ttsSampleRate)
          ? dashscope.ttsSampleRate
          : DEFAULT_DASHSCOPE_SETTINGS.ttsSampleRate,
        ttsSpeechRate: Number.isFinite(dashscope.ttsSpeechRate)
          ? dashscope.ttsSpeechRate
          : DEFAULT_DASHSCOPE_SETTINGS.ttsSpeechRate,
      });
      setDashscopeApiKeySaved(Boolean(dashscope?.hasApiKey));

      setAsrSource(voice?.asrProvider === 'dashscope' ? 'cloud' : (selectedAsrBundle ? 'local' : 'skip'));
      setTtsSource(voice?.ttsProvider === 'dashscope' ? 'cloud' : (selectedTtsBundle ? 'local' : 'skip'));

      const firstAsrCatalog = items.find((item) => item?.hasAsr) || null;
      const firstTtsCatalog = items.find((item) => item?.hasTts) || null;
      setSelectedAsrCatalogId(selectedAsrBundle?.catalogId || firstAsrCatalog?.id || '');
      setSelectedTtsCatalogId(selectedTtsBundle?.catalogId || firstTtsCatalog?.id || '');
    } catch (error) {
      if (mountedRef.current) {
        setVoiceError(error?.message || '加载语音配置失败。');
      }
    } finally {
      if (mountedRef.current) {
        setVoiceLoading(false);
      }
    }
  }, [desktopMode]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setActiveStep(0);
      return;
    }
    void loadVoiceContext();
  }, [loadVoiceContext, open]);

  useEffect(() => {
    if (!open || selectedBackend !== 'nanobot' || nanobotSettings.enabled) {
      return;
    }
    onNanobotSettingChange?.('enabled', true);
  }, [nanobotSettings.enabled, onNanobotSettingChange, open, selectedBackend]);

  const saveVoiceSettings = useCallback(
    async (payload) => {
      setVoiceSaving(true);
      setVoiceError('');
      try {
        await desktopBridge.settings.save(payload);
        return true;
      } catch (error) {
        if (mountedRef.current) {
          setVoiceError(error?.message || '保存语音配置失败。');
        }
        return false;
      } finally {
        if (mountedRef.current) {
          setVoiceSaving(false);
        }
      }
    },
    [],
  );

  const applyAsrConfig = useCallback(async () => {
    setVoiceError('');
    setVoiceFeedback('');

    if (asrSource === 'skip') {
      setVoiceFeedback('已跳过 ASR 配置。');
      return true;
    }

    if (asrSource === 'cloud') {
      const hasApiKey = Boolean((dashscopeSettings.apiKey || '').trim()) || dashscopeApiKeySaved;
      if (!hasApiKey) {
        setVoiceError('请填写 DashScope API Key。');
        return false;
      }

      const saved = await saveVoiceSettings({
        voice: {
          asrProvider: 'dashscope',
          dashscope: {
            workspace: dashscopeSettings.workspace,
            baseUrl: dashscopeSettings.baseUrl,
            apiKey: dashscopeSettings.apiKey,
            asrModel: dashscopeSettings.asrModel,
            asrLanguage: dashscopeSettings.asrLanguage,
          },
        },
      });
      if (!saved) {
        return false;
      }
      setDashscopeApiKeySaved(true);

      const selected = await desktopBridge.voiceModels.select({ asrBundleId: '' });
      if (!selected?.ok) {
        setVoiceError(selected?.error?.message || '切换 ASR 至云端失败。');
        return false;
      }
      setModelBundles(Array.isArray(selected?.bundles) ? selected.bundles : []);
      setVoiceFeedback('ASR 云端配置已生效。');
      return true;
    }

    if (asrSource === 'local') {
      const installedBundle = findInstalledBundleByCatalogId({
        bundles: modelBundles,
        catalogId: selectedAsrCatalogId,
        capability: 'asr',
      });
      if (!installedBundle?.id) {
        setVoiceError('请先下载所选 ASR 本地模型。');
        return false;
      }

      const saved = await saveVoiceSettings({
        voice: {
          asrProvider: 'inherit',
        },
      });
      if (!saved) {
        return false;
      }

      const selected = await desktopBridge.voiceModels.select({
        asrBundleId: installedBundle.id,
      });
      if (!selected?.ok) {
        setVoiceError(selected?.error?.message || '切换 ASR 本地模型失败。');
        return false;
      }
      setModelBundles(Array.isArray(selected?.bundles) ? selected.bundles : []);
      setVoiceFeedback('ASR 本地模型已生效。');
      return true;
    }

    return false;
  }, [asrSource, dashscopeApiKeySaved, dashscopeSettings, modelBundles, saveVoiceSettings, selectedAsrCatalogId]);

  const applyTtsConfig = useCallback(async () => {
    setVoiceError('');
    setVoiceFeedback('');

    if (ttsSource === 'skip') {
      setVoiceFeedback('已跳过 TTS 配置。');
      return true;
    }

    if (ttsSource === 'cloud') {
      const hasApiKey = Boolean((dashscopeSettings.apiKey || '').trim()) || dashscopeApiKeySaved;
      if (!hasApiKey) {
        setVoiceError('请填写 DashScope API Key。');
        return false;
      }

      const saved = await saveVoiceSettings({
        voice: {
          ttsProvider: 'dashscope',
          dashscope: {
            workspace: dashscopeSettings.workspace,
            baseUrl: dashscopeSettings.baseUrl,
            apiKey: dashscopeSettings.apiKey,
            ttsModel: dashscopeSettings.ttsModel,
            ttsVoice: dashscopeSettings.ttsVoice,
            ttsLanguage: dashscopeSettings.ttsLanguage,
            ttsSampleRate: dashscopeSettings.ttsSampleRate,
            ttsSpeechRate: dashscopeSettings.ttsSpeechRate,
          },
        },
      });
      if (!saved) {
        return false;
      }
      setDashscopeApiKeySaved(true);

      const selected = await desktopBridge.voiceModels.select({ ttsBundleId: '' });
      if (!selected?.ok) {
        setVoiceError(selected?.error?.message || '切换 TTS 至云端失败。');
        return false;
      }
      setModelBundles(Array.isArray(selected?.bundles) ? selected.bundles : []);
      setVoiceFeedback('TTS 云端配置已生效。');
      return true;
    }

    if (ttsSource === 'local') {
      const installedBundle = findInstalledBundleByCatalogId({
        bundles: modelBundles,
        catalogId: selectedTtsCatalogId,
        capability: 'tts',
      });
      if (!installedBundle?.id) {
        setVoiceError('请先下载所选 TTS 本地模型。');
        return false;
      }

      const saved = await saveVoiceSettings({
        voice: {
          ttsProvider: 'inherit',
        },
      });
      if (!saved) {
        return false;
      }

      const selected = await desktopBridge.voiceModels.select({
        ttsBundleId: installedBundle.id,
      });
      if (!selected?.ok) {
        setVoiceError(selected?.error?.message || '切换 TTS 本地模型失败。');
        return false;
      }
      setModelBundles(Array.isArray(selected?.bundles) ? selected.bundles : []);
      setVoiceFeedback('TTS 本地模型已生效。');
      return true;
    }

    return false;
  }, [dashscopeApiKeySaved, dashscopeSettings, modelBundles, saveVoiceSettings, selectedTtsCatalogId, ttsSource]);

  const handleInstallAsr = useCallback(async () => {
    if (!selectedAsrCatalogId) {
      setVoiceError('请先选择一个 ASR 本地模型。');
      return;
    }

    setVoiceError('');
    setVoiceFeedback('');
    setIsInstallingAsr(true);
    onOpenDownloadCenter?.('voice-models');
    try {
      const result = await desktopBridge.voiceModels.installCatalog(selectedAsrCatalogId, {
        installAsr: true,
        installTts: false,
      });
      if (!result?.ok) {
        setVoiceError(result?.error?.message || '下载 ASR 模型失败。');
        return;
      }
      setVoiceFeedback('ASR 本地模型下载完成。');
      await loadVoiceContext();
      setAsrSource('local');
    } catch (error) {
      setVoiceError(error?.message || '下载 ASR 模型失败。');
    } finally {
      if (mountedRef.current) {
        setIsInstallingAsr(false);
      }
    }
  }, [loadVoiceContext, onOpenDownloadCenter, selectedAsrCatalogId]);

  const handleInstallTts = useCallback(async () => {
    if (!selectedTtsCatalogId) {
      setVoiceError('请先选择一个 TTS 本地模型。');
      return;
    }

    setVoiceError('');
    setVoiceFeedback('');
    setIsInstallingTts(true);
    onOpenDownloadCenter?.('voice-models');
    try {
      const result = await desktopBridge.voiceModels.installCatalog(selectedTtsCatalogId, {
        installAsr: false,
        installTts: true,
      });
      if (!result?.ok) {
        setVoiceError(result?.error?.message || '下载 TTS 模型失败。');
        return;
      }
      setVoiceFeedback('TTS 本地模型下载完成。');
      await loadVoiceContext();
      setTtsSource('local');
    } catch (error) {
      setVoiceError(error?.message || '下载 TTS 模型失败。');
    } finally {
      if (mountedRef.current) {
        setIsInstallingTts(false);
      }
    }
  }, [loadVoiceContext, onOpenDownloadCenter, selectedTtsCatalogId]);

  const handleRunAsrTest = useCallback(async () => {
    if (asrTesting || ttsTesting) {
      return;
    }

    const applied = await applyAsrConfig();
    if (!applied) {
      return;
    }

    setVoiceError('');
    setAsrResult(null);
    setAsrTesting(true);
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
        setVoiceError(result?.error?.message || result?.reason || 'ASR 测试失败。');
        return;
      }

      setAsrResult({
        ...result,
        prompt: asrPrompt,
      });
    } catch (error) {
      if (mountedRef.current) {
        setVoiceError(error?.message || 'ASR 测试失败。');
      }
    } finally {
      if (mountedRef.current) {
        setAsrTesting(false);
      }
    }
  }, [applyAsrConfig, asrPrompt, asrTesting, ttsTesting]);

  const handleRunTtsTest = useCallback(async () => {
    if (asrTesting || ttsTesting) {
      return;
    }

    const text = typeof ttsText === 'string' ? ttsText.trim() : '';
    if (!text) {
      setVoiceError('请输入 TTS 测试文本。');
      return;
    }

    const applied = await applyTtsConfig();
    if (!applied) {
      return;
    }

    setVoiceError('');
    setTtsResult(null);
    setTtsTesting(true);
    try {
      const result = await desktopBridge.voice.runTtsDiagnostics({
        text,
        includeAudio: false,
      });
      if (!mountedRef.current) {
        return;
      }

      if (!result?.ok) {
        setVoiceError(result?.error?.message || result?.reason || 'TTS 测试失败。');
        return;
      }

      setTtsResult({
        ...result,
        text,
      });
    } catch (error) {
      if (mountedRef.current) {
        setVoiceError(error?.message || 'TTS 测试失败。');
      }
    } finally {
      if (mountedRef.current) {
        setTtsTesting(false);
      }
    }
  }, [applyTtsConfig, asrTesting, ttsTesting, ttsText]);

  const handleSkipStep = useCallback(async () => {
    setVoiceError('');
    setVoiceFeedback('');

    if (activeStep === 1) {
      setAsrSource('skip');
    }
    if (activeStep === 2) {
      setTtsSource('skip');
    }

    if (activeStep >= STEP_LABELS.length - 1) {
      await onFinish?.();
      return;
    }
    setActiveStep((current) => Math.min(STEP_LABELS.length - 1, current + 1));
  }, [activeStep, onFinish]);

  const handleNext = useCallback(async () => {
    if (activeStep === 1) {
      const ok = await applyAsrConfig();
      if (!ok) {
        return;
      }
    }

    if (activeStep === 2) {
      const ok = await applyTtsConfig();
      if (!ok) {
        return;
      }
    }

    if (activeStep >= STEP_LABELS.length - 1) {
      await onFinish?.();
      return;
    }
    setActiveStep((current) => Math.min(STEP_LABELS.length - 1, current + 1));
  }, [activeStep, applyAsrConfig, applyTtsConfig, onFinish]);

  const handleBack = useCallback(() => {
    setActiveStep((current) => Math.max(0, current - 1));
  }, []);

  const renderBackendStep = () => {
    const testDisabled = settingsSaving || settingsTesting || (selectedBackend === 'nanobot' && !nanobotSettings.enabled);

    return (
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          第一步先配置推理后端。你可以随时跳过，稍后在设置里继续。
        </Typography>

        <TextField
          select
          label="推理后端"
          value={selectedBackend}
          onChange={(event) => onChatBackendChange?.(event.target.value)}
          fullWidth
        >
          <MenuItem value="openclaw">OpenClaw</MenuItem>
          <MenuItem value="nanobot">Nanobot</MenuItem>
        </TextField>

        {selectedBackend === 'openclaw' && (
          <Stack spacing={1}>
            <TextField
              label="OpenClaw Base URL"
              value={openClawSettings.baseUrl || ''}
              onChange={(event) => onOpenClawSettingChange?.('baseUrl', event.target.value)}
              placeholder="http://127.0.0.1:18789"
              fullWidth
            />
            <TextField
              label="Agent ID"
              value={openClawSettings.agentId || ''}
              onChange={(event) => onOpenClawSettingChange?.('agentId', event.target.value)}
              placeholder="main"
              fullWidth
            />
            <TextField
              label="Token"
              value={openClawSettings.token || ''}
              onChange={(event) => onOpenClawSettingChange?.('token', event.target.value)}
              type="password"
              autoComplete="off"
              fullWidth
            />
          </Stack>
        )}

        {selectedBackend === 'nanobot' && (
          <Stack spacing={1}>
            <Alert severity={nanobotRuntimeStatus.installed ? 'success' : 'warning'}>
              {nanobotRuntimeStatus.installed ? 'Nanobot 运行时已安装。' : '未安装 Nanobot 运行时。'}
            </Alert>
            <Button
              variant="outlined"
              size="small"
              disabled={nanobotRuntimeInstalling}
              onClick={() => onInstallNanobotRuntime?.()}
            >
              {nanobotRuntimeInstalling ? '下载中...' : '下载/更新 Nanobot 运行时'}
            </Button>
            <TextField
              select
              label="启用 Nanobot"
              value={nanobotSettings.enabled ? 'enabled' : 'disabled'}
              onChange={(event) => onNanobotSettingChange?.('enabled', event.target.value === 'enabled')}
              fullWidth
            >
              <MenuItem value="enabled">启用</MenuItem>
              <MenuItem value="disabled">禁用</MenuItem>
            </TextField>
            <TextField
              label="Workspace"
              value={nanobotSettings.workspace || ''}
              onChange={(event) => onNanobotSettingChange?.('workspace', event.target.value)}
              fullWidth
            />
            <Button size="small" variant="outlined" onClick={() => onPickNanobotWorkspace?.()}>
              选择 Workspace 目录
            </Button>
            <TextField
              label="Provider"
              value={nanobotSettings.provider || ''}
              onChange={(event) => onNanobotSettingChange?.('provider', event.target.value)}
              fullWidth
            />
            <TextField
              label="Model"
              value={nanobotSettings.model || ''}
              onChange={(event) => onNanobotSettingChange?.('model', event.target.value)}
              fullWidth
            />
            <TextField
              label="API Base"
              value={nanobotSettings.apiBase || ''}
              onChange={(event) => onNanobotSettingChange?.('apiBase', event.target.value)}
              placeholder="可选"
              fullWidth
            />
            <TextField
              label="API Key"
              value={nanobotSettings.apiKey || ''}
              onChange={(event) => onNanobotSettingChange?.('apiKey', event.target.value)}
              type="password"
              autoComplete="off"
              fullWidth
            />
          </Stack>
        )}

        <Stack direction="row" spacing={1}>
          <Button variant="contained" disabled={testDisabled} onClick={() => onTestChatBackendSettings?.()}>
            {settingsTesting ? '测试中...' : '测试后端连接'}
          </Button>
        </Stack>

        {!!settingsFeedback && <Alert severity="success">{settingsFeedback}</Alert>}
        {!!settingsError && <Alert severity="warning">{settingsError}</Alert>}
      </Stack>
    );
  };

  const renderAsrStep = () => {
    return (
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          选择 ASR 来源。云端可配置 DashScope，本地可直接下载模型并测试延迟。
        </Typography>

        <TextField
          select
          label="ASR 来源"
          value={asrSource}
          onChange={(event) => setAsrSource(event.target.value)}
          fullWidth
        >
          <MenuItem value="skip">稍后配置（Skip）</MenuItem>
          <MenuItem value="cloud">云端（DashScope）</MenuItem>
          <MenuItem value="local">本地模型</MenuItem>
        </TextField>

        {asrSource === 'cloud' && (
          <Stack spacing={1}>
            <TextField
              label="DashScope API Key"
              value={dashscopeSettings.apiKey}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, apiKey: event.target.value }))}
              type="password"
              autoComplete="off"
              fullWidth
            />
            <TextField
              label="DashScope Base URL"
              value={dashscopeSettings.baseUrl}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, baseUrl: event.target.value }))}
              placeholder="wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
              fullWidth
            />
            <TextField
              label="Workspace（可选）"
              value={dashscopeSettings.workspace}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, workspace: event.target.value }))}
              fullWidth
            />
            <TextField
              label="ASR Model"
              value={dashscopeSettings.asrModel}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, asrModel: event.target.value }))}
              fullWidth
            />
            <TextField
              label="ASR Language"
              value={dashscopeSettings.asrLanguage}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, asrLanguage: event.target.value }))}
              fullWidth
            />
            <Button
              variant="outlined"
              onClick={() => {
                void applyAsrConfig();
              }}
              disabled={voiceSaving}
            >
              应用 ASR 云端配置
            </Button>
          </Stack>
        )}

        {asrSource === 'local' && (
          <Stack spacing={1}>
            <TextField
              select
              label="ASR 本地模型"
              value={selectedAsrCatalogId}
              onChange={(event) => setSelectedAsrCatalogId(event.target.value)}
              fullWidth
            >
              {asrCatalogItems.map((item) => (
                <MenuItem key={item.id} value={item.id}>{item.name || item.id}</MenuItem>
              ))}
            </TextField>

            <Alert severity={installedAsrBundle ? 'success' : 'warning'}>
              {installedAsrBundle ? '当前模型已下载。' : '当前模型未下载。'}
            </Alert>

            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                onClick={() => {
                  void handleInstallAsr();
                }}
                disabled={isInstallingAsr || !selectedAsrCatalogId}
              >
                {isInstallingAsr ? '下载中...' : (installedAsrBundle ? '重新下载' : '下载模型')}
              </Button>
              <Button
                variant="outlined"
                onClick={() => {
                  void applyAsrConfig();
                }}
                disabled={!installedAsrBundle || voiceSaving}
              >
                设为当前 ASR
              </Button>
            </Stack>
          </Stack>
        )}

        <TextField
          label="ASR 测试提示词"
          value={asrPrompt}
          onChange={(event) => setAsrPrompt(event.target.value)}
          fullWidth
        />
        <Button
          variant="outlined"
          onClick={() => {
            void handleRunAsrTest();
          }}
          disabled={asrTesting || ttsTesting || voiceLoading}
        >
          {asrTesting ? 'ASR 测试中（录音 3 秒）...' : 'ASR 延迟测试'}
        </Button>

        {!!asrResult && (
          <Alert severity="success">
            {`ASR 耗时 ${formatMs(asrResult.latencyMs)}；识别结果：${asrResult.text || '（空）'}`}
          </Alert>
        )}
      </Stack>
    );
  };

  const renderTtsStep = () => {
    return (
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          选择 TTS 来源。云端可配置 DashScope，本地可下载后直接测试首包和总延迟。
        </Typography>

        <TextField
          select
          label="TTS 来源"
          value={ttsSource}
          onChange={(event) => setTtsSource(event.target.value)}
          fullWidth
        >
          <MenuItem value="skip">稍后配置（Skip）</MenuItem>
          <MenuItem value="cloud">云端（DashScope）</MenuItem>
          <MenuItem value="local">本地模型</MenuItem>
        </TextField>

        {ttsSource === 'cloud' && (
          <Stack spacing={1}>
            <TextField
              label="DashScope API Key"
              value={dashscopeSettings.apiKey}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, apiKey: event.target.value }))}
              type="password"
              autoComplete="off"
              fullWidth
            />
            <TextField
              label="DashScope Base URL"
              value={dashscopeSettings.baseUrl}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, baseUrl: event.target.value }))}
              placeholder="wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
              fullWidth
            />
            <TextField
              label="Workspace（可选）"
              value={dashscopeSettings.workspace}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, workspace: event.target.value }))}
              fullWidth
            />
            <TextField
              label="TTS Model"
              value={dashscopeSettings.ttsModel}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, ttsModel: event.target.value }))}
              fullWidth
            />
            <TextField
              label="TTS Voice"
              value={dashscopeSettings.ttsVoice}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, ttsVoice: event.target.value }))}
              fullWidth
            />
            <Stack direction="row" spacing={1}>
              <TextField
                label="TTS Language"
                value={dashscopeSettings.ttsLanguage}
                onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, ttsLanguage: event.target.value }))}
                fullWidth
              />
              <TextField
                label="Sample Rate"
                type="number"
                value={dashscopeSettings.ttsSampleRate}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  setDashscopeSettings((prev) => ({
                    ...prev,
                    ttsSampleRate: Number.isFinite(parsed) ? parsed : DEFAULT_DASHSCOPE_SETTINGS.ttsSampleRate,
                  }));
                }}
                fullWidth
              />
              <TextField
                label="Speech Rate"
                type="number"
                value={dashscopeSettings.ttsSpeechRate}
                onChange={(event) => {
                  const parsed = Number.parseFloat(event.target.value);
                  setDashscopeSettings((prev) => ({
                    ...prev,
                    ttsSpeechRate: Number.isFinite(parsed) ? parsed : DEFAULT_DASHSCOPE_SETTINGS.ttsSpeechRate,
                  }));
                }}
                fullWidth
              />
            </Stack>
            <Button
              variant="outlined"
              onClick={() => {
                void applyTtsConfig();
              }}
              disabled={voiceSaving}
            >
              应用 TTS 云端配置
            </Button>
          </Stack>
        )}

        {ttsSource === 'local' && (
          <Stack spacing={1}>
            <TextField
              select
              label="TTS 本地模型"
              value={selectedTtsCatalogId}
              onChange={(event) => setSelectedTtsCatalogId(event.target.value)}
              fullWidth
            >
              {ttsCatalogItems.map((item) => (
                <MenuItem key={item.id} value={item.id}>{item.name || item.id}</MenuItem>
              ))}
            </TextField>

            <Alert severity={installedTtsBundle ? 'success' : 'warning'}>
              {installedTtsBundle ? '当前模型已下载。' : '当前模型未下载。'}
            </Alert>

            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                onClick={() => {
                  void handleInstallTts();
                }}
                disabled={isInstallingTts || !selectedTtsCatalogId}
              >
                {isInstallingTts ? '下载中...' : (installedTtsBundle ? '重新下载' : '下载模型')}
              </Button>
              <Button
                variant="outlined"
                onClick={() => {
                  void applyTtsConfig();
                }}
                disabled={!installedTtsBundle || voiceSaving}
              >
                设为当前 TTS
              </Button>
            </Stack>
          </Stack>
        )}

        <TextField
          label="TTS 测试文本"
          value={ttsText}
          onChange={(event) => setTtsText(event.target.value)}
          multiline
          minRows={2}
          fullWidth
        />
        <Button
          variant="outlined"
          onClick={() => {
            void handleRunTtsTest();
          }}
          disabled={asrTesting || ttsTesting || voiceLoading}
        >
          {ttsTesting ? 'TTS 测试中...' : 'TTS 延迟测试'}
        </Button>

        {!!ttsResult && (
          <Alert severity="success">
            {`TTS 首包 ${formatMs(ttsResult.firstChunkLatencyMs)}；总耗时 ${formatMs(ttsResult.latencyMs)}；分片 ${ttsResult.chunkCount || 0}`}
          </Alert>
        )}
      </Stack>
    );
  };

  if (!desktopMode) {
    return null;
  }

  return (
    <Dialog open={open} fullWidth maxWidth="sm" disableEscapeKeyDown>
      <DialogTitle>首次使用引导</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Box>
            <Typography variant="body2" color="text.secondary">
              每一步都可跳过；之后可在设置中继续完成配置。
            </Typography>
          </Box>

          <Stepper activeStep={activeStep} alternativeLabel>
            {STEP_LABELS.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {activeStep === 0 && renderBackendStep()}
          {activeStep === 1 && renderAsrStep()}
          {activeStep === 2 && renderTtsStep()}

          {(voiceLoading || voiceSaving) && (
            <Typography variant="caption" color="text.secondary">
              正在同步语音配置...
            </Typography>
          )}

          {!!voiceFeedback && <Alert severity="success">{voiceFeedback}</Alert>}
          {!!voiceError && <Alert severity="warning">{voiceError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => { void handleSkipStep(); }} disabled={isBusy}>
          Skip this step
        </Button>
        <Button onClick={handleBack} disabled={activeStep === 0 || isBusy}>上一步</Button>
        <Button onClick={handleNext} variant="contained" disabled={isBusy}>
          {activeStep >= STEP_LABELS.length - 1 ? '完成引导' : '下一步'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
