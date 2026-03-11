import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import { desktopBridge } from '../../services/desktopBridge.js';
import { useI18n, LANGUAGE_EN_US, LANGUAGE_ZH_CN } from '../../i18n/I18nContext.jsx';
import {
  resolveTaskProgressValue,
  resolveTaskStatsText,
  resolveTaskStatusText,
} from '../download/taskPresentation.js';

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

function getCatalogSourceType(item = {}) {
  const sourceType = typeof item?.sourceType === 'string' ? item.sourceType.trim().toLowerCase() : '';
  return sourceType || 'local';
}

function isCloudNoKeyCatalogItem(item = {}) {
  return getCatalogSourceType(item) === 'cloud-no-key';
}

function getAsrTestStatusText(t, phase) {
  if (phase === 'warming') {
    return t('onboarding.asr.test.warming');
  }
  if (phase === 'recording') {
    return t('onboarding.asr.test.recording');
  }
  if (phase === 'transcribing') {
    return t('onboarding.asr.test.transcribing');
  }
  return t('onboarding.asr.test.action');
}

function getAsrTestProgressMessage(t, phase) {
  if (phase === 'warming') {
    return t('onboarding.asr.test.warmingHint');
  }
  if (phase === 'recording') {
    return t('onboarding.asr.test.recordingHint');
  }
  if (phase === 'transcribing') {
    return t('onboarding.asr.test.transcribingHint');
  }
  return '';
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

async function captureAsrTestPcm({
  durationMs = ASR_TEST_RECORD_MS,
  sampleRate = ASR_TEST_SAMPLE_RATE,
  messages = {},
} = {}) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error(messages.microphoneUnsupported || 'Microphone capture is unavailable.');
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error(messages.audioContextUnsupported || 'AudioContext is unavailable.');
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
    throw new Error(messages.emptyRecording || 'Recording is empty.');
  }

  return bytes;
}

function formatMs(value) {
  if (!Number.isFinite(value) || value < 0) {
    return '-';
  }
  return `${Math.round(value)} ms`;
}

function isDownloadRunningPhase(phase) {
  const value = typeof phase === 'string' ? phase.trim().toLowerCase() : '';
  return Boolean(value && value !== 'idle' && value !== 'completed' && value !== 'failed');
}

function shouldAutoExpandDownloadDetails(task = {}, nowMs = Date.now()) {
  const phase = typeof task?.phase === 'string' ? task.phase.trim().toLowerCase() : '';
  if (phase !== 'installing' && phase !== 'extracting') {
    return false;
  }

  const totalBytes = Number.isFinite(task?.fileTotalBytes) ? task.fileTotalBytes : 0;
  const downloadedBytes = Number.isFinite(task?.fileDownloadedBytes) ? task.fileDownloadedBytes : 0;
  if (totalBytes > 0 || downloadedBytes > 0) {
    return false;
  }

  const phaseStartedAtMs = Number.isFinite(task?.phaseStartedAtMs) && task.phaseStartedAtMs > 0
    ? task.phaseStartedAtMs
    : (Number.isFinite(task?.startedAtMs) ? task.startedAtMs : 0);
  if (phaseStartedAtMs <= 0) {
    return false;
  }

  return nowMs - phaseStartedAtMs >= AUTO_EXPAND_DETAILS_DELAY_MS;
}

function findVoiceDownloadTaskByCapability({
  taskMap = {},
  capability = 'asr',
  preferredCatalogId = '',
} = {}) {
  if (!taskMap || typeof taskMap !== 'object') {
    return null;
  }

  const normalizedCapability = capability === 'tts' ? 'tts' : 'asr';
  const targetSuffixes = normalizedCapability === 'asr' ? new Set(['asr', 'asr-tts']) : new Set(['tts', 'asr-tts']);
  const normalizedCatalogId = typeof preferredCatalogId === 'string' ? preferredCatalogId.trim() : '';
  let winner = null;

  for (const [taskId, task] of Object.entries(taskMap)) {
    if (typeof taskId !== 'string' || !taskId.startsWith('voice-models:') || !task || typeof task !== 'object') {
      continue;
    }

    const taskInstallTarget = typeof task.installTarget === 'string' ? task.installTarget.trim().toLowerCase() : '';
    const taskIdSuffix = (taskId.split(':').at(-1) || '').trim().toLowerCase();
    const taskTarget = taskInstallTarget || taskIdSuffix;
    if (!targetSuffixes.has(taskTarget)) {
      continue;
    }

    const phase = typeof task.phase === 'string' ? task.phase.trim().toLowerCase() : 'idle';
    const phaseRank = isDownloadRunningPhase(phase) ? 3 : (phase === 'completed' ? 2 : (phase === 'failed' ? 1 : 0));
    const updatedAt = Number.isFinite(task.updatedAt) ? task.updatedAt : 0;
    const taskCatalogId = typeof task.catalogId === 'string' ? task.catalogId.trim() : '';
    const catalogMatched = Boolean(
      normalizedCatalogId
      && (taskCatalogId === normalizedCatalogId || taskId.includes(`:${normalizedCatalogId}:`)),
    );

    if (!winner) {
      winner = { task, phaseRank, updatedAt, catalogMatched };
      continue;
    }

    if (catalogMatched !== winner.catalogMatched) {
      if (catalogMatched) {
        winner = { task, phaseRank, updatedAt, catalogMatched };
      }
      continue;
    }

    if (phaseRank !== winner.phaseRank) {
      if (phaseRank > winner.phaseRank) {
        winner = { task, phaseRank, updatedAt, catalogMatched };
      }
      continue;
    }

    if (updatedAt > winner.updatedAt) {
      winner = { task, phaseRank, updatedAt, catalogMatched };
    }
  }

  return winner?.task || null;
}

const BACKEND_SUB_STEP_COUNT = 3;
const AUTO_EXPAND_DETAILS_DELAY_MS = 6000;
const BACKEND_SUB_STEP_LABEL_KEYS = [
  'onboarding.backend.subStep.source',
  'onboarding.backend.subStep.config',
  'onboarding.backend.subStep.enableTest',
];
const TOTAL_STEPS = 4;

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
  voiceDownloadTasks = {},
  nanobotRuntimeStatus = {},
  nanobotRuntimeDownloadTask = null,
  nanobotRuntimeInstalling = false,
  onInstallNanobotRuntime,
  onFinish,
}) {
  const { t, language, setLanguage } = useI18n();
  const mountedRef = useRef(true);
  const [activeStep, setActiveStep] = useState(0);
  const [backendSubStep, setBackendSubStep] = useState(0);
  const [backendDownloadDetailsOpen, setBackendDownloadDetailsOpen] = useState(false);
  const [asrDownloadDetailsOpen, setAsrDownloadDetailsOpen] = useState(false);
  const [ttsDownloadDetailsOpen, setTtsDownloadDetailsOpen] = useState(false);

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
  const [asrTestPhase, setAsrTestPhase] = useState('idle');
  const [ttsTesting, setTtsTesting] = useState(false);
  const [asrResult, setAsrResult] = useState(null);
  const [ttsResult, setTtsResult] = useState(null);
  const stepLabels = useMemo(
    () => [
      t('language.label'),
      t('onboarding.step.backend'),
      t('onboarding.step.asr'),
      t('onboarding.step.tts'),
    ],
    [t],
  );
  const currentBackendSubStepLabel = t(
    BACKEND_SUB_STEP_LABEL_KEYS[Math.min(BACKEND_SUB_STEP_COUNT - 1, Math.max(0, backendSubStep))],
  );
  const backendSubStepProgressText = t('onboarding.backend.subStepProgress', {
    current: Math.min(BACKEND_SUB_STEP_COUNT, Math.max(1, backendSubStep + 1)),
    total: BACKEND_SUB_STEP_COUNT,
    name: currentBackendSubStepLabel,
  });
  const nextBackendSubStepLabel = backendSubStep < BACKEND_SUB_STEP_COUNT - 1
    ? t(BACKEND_SUB_STEP_LABEL_KEYS[backendSubStep + 1])
    : '';

  const selectedBackend = chatBackendSettings?.chatBackend === 'nanobot' ? 'nanobot' : 'openclaw';
  const openClawSettings = chatBackendSettings?.openclaw || {};
  const nanobotSettings = chatBackendSettings?.nanobot || {};
  const nanobotDownloadPhase = typeof nanobotRuntimeDownloadTask?.phase === 'string'
    ? nanobotRuntimeDownloadTask.phase
    : 'idle';
  const nanobotRuntimeDownloading = isDownloadRunningPhase(nanobotDownloadPhase);
  const asrDownloadTask = useMemo(
    () => findVoiceDownloadTaskByCapability({
      taskMap: voiceDownloadTasks,
      capability: 'asr',
      preferredCatalogId: selectedAsrCatalogId,
    }),
    [selectedAsrCatalogId, voiceDownloadTasks],
  );
  const ttsDownloadTask = useMemo(
    () => findVoiceDownloadTaskByCapability({
      taskMap: voiceDownloadTasks,
      capability: 'tts',
      preferredCatalogId: selectedTtsCatalogId,
    }),
    [selectedTtsCatalogId, voiceDownloadTasks],
  );
  const asrDownloadPhase = typeof asrDownloadTask?.phase === 'string' ? asrDownloadTask.phase : 'idle';
  const ttsDownloadPhase = typeof ttsDownloadTask?.phase === 'string' ? ttsDownloadTask.phase : 'idle';
  const asrDownloadRunning = isInstallingAsr || isDownloadRunningPhase(asrDownloadPhase);
  const ttsDownloadRunning = isInstallingTts || isDownloadRunningPhase(ttsDownloadPhase);
  const hasRunningInlineDownload = nanobotRuntimeDownloading
    || asrDownloadRunning
    || ttsDownloadRunning;
  const [downloadNowMs, setDownloadNowMs] = useState(() => Date.now());
  const shouldShowAsrDownloadCard = asrSource === 'local'
    && (asrDownloadRunning
      || asrDownloadPhase === 'completed'
      || asrDownloadPhase === 'failed'
      || (Array.isArray(asrDownloadTask?.logs) && asrDownloadTask.logs.length > 0));
  const shouldShowTtsDownloadCard = (ttsSource === 'cloud-no-key' || ttsSource === 'local')
    && (ttsDownloadRunning
      || ttsDownloadPhase === 'completed'
      || ttsDownloadPhase === 'failed'
      || (Array.isArray(ttsDownloadTask?.logs) && ttsDownloadTask.logs.length > 0));
  const shouldShowNanobotDownloadCard = selectedBackend === 'nanobot'
    && (nanobotRuntimeDownloading
      || nanobotDownloadPhase === 'completed'
      || nanobotDownloadPhase === 'failed'
      || (Array.isArray(nanobotRuntimeDownloadTask?.logs) && nanobotRuntimeDownloadTask.logs.length > 0));

  useEffect(() => {
    if (!open || !hasRunningInlineDownload) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setDownloadNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasRunningInlineDownload, open]);

  const shouldAutoExpandBackendDetails = shouldAutoExpandDownloadDetails(
    nanobotRuntimeDownloadTask,
    downloadNowMs,
  );
  const shouldAutoExpandAsrDetails = shouldAutoExpandDownloadDetails(asrDownloadTask, downloadNowMs);
  const shouldAutoExpandTtsDetails = shouldAutoExpandDownloadDetails(ttsDownloadTask, downloadNowMs);

  useEffect(() => {
    if (!open || backendDownloadDetailsOpen || !shouldAutoExpandBackendDetails) {
      return;
    }
    setBackendDownloadDetailsOpen(true);
  }, [backendDownloadDetailsOpen, open, shouldAutoExpandBackendDetails]);

  useEffect(() => {
    if (!open || asrDownloadDetailsOpen || !shouldAutoExpandAsrDetails) {
      return;
    }
    setAsrDownloadDetailsOpen(true);
  }, [asrDownloadDetailsOpen, open, shouldAutoExpandAsrDetails]);

  useEffect(() => {
    if (!open || ttsDownloadDetailsOpen || !shouldAutoExpandTtsDetails) {
      return;
    }
    setTtsDownloadDetailsOpen(true);
  }, [open, shouldAutoExpandTtsDetails, ttsDownloadDetailsOpen]);

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
  const ttsLocalCatalogItems = useMemo(
    () => ttsCatalogItems.filter((item) => !isCloudNoKeyCatalogItem(item)),
    [ttsCatalogItems],
  );
  const ttsCloudNoKeyCatalogItems = useMemo(
    () => ttsCatalogItems.filter((item) => isCloudNoKeyCatalogItem(item)),
    [ttsCatalogItems],
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

      const firstAsrCatalog = items.find((item) => item?.hasAsr) || null;
      const firstTtsCatalog = items.find((item) => item?.hasTts) || null;
      const selectedTtsCatalogItem = items.find((item) => item?.id === selectedTtsBundle?.catalogId) || null;
      setAsrSource(voice?.asrProvider === 'dashscope' ? 'cloud' : (selectedAsrBundle ? 'local' : 'skip'));
      setTtsSource(
        voice?.ttsProvider === 'dashscope'
          ? 'cloud'
          : (
            selectedTtsBundle
              ? (isCloudNoKeyCatalogItem(selectedTtsCatalogItem) ? 'cloud-no-key' : 'local')
              : 'skip'
          ),
      );
      setSelectedAsrCatalogId(selectedAsrBundle?.catalogId || firstAsrCatalog?.id || '');
      setSelectedTtsCatalogId(selectedTtsBundle?.catalogId || firstTtsCatalog?.id || '');
    } catch (error) {
      if (mountedRef.current) {
        setVoiceError(error?.message || t('onboarding.voice.loadFailed'));
      }
    } finally {
      if (mountedRef.current) {
        setVoiceLoading(false);
      }
    }
  }, [desktopMode, t]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setActiveStep(0);
      setBackendSubStep(0);
      setBackendDownloadDetailsOpen(false);
      setAsrDownloadDetailsOpen(false);
      setTtsDownloadDetailsOpen(false);
      return;
    }
    void loadVoiceContext();
  }, [loadVoiceContext, open]);

  const saveVoiceSettings = useCallback(
    async (payload) => {
      setVoiceSaving(true);
      setVoiceError('');
      try {
        await desktopBridge.settings.save(payload);
        return true;
      } catch (error) {
        if (mountedRef.current) {
          setVoiceError(error?.message || t('onboarding.voice.saveFailed'));
        }
        return false;
      } finally {
        if (mountedRef.current) {
          setVoiceSaving(false);
        }
      }
    },
    [t],
  );

  const applyAsrConfig = useCallback(async () => {
    setVoiceError('');
    setVoiceFeedback('');

    if (asrSource === 'skip') {
      setVoiceFeedback(t('onboarding.asr.skipped'));
      return true;
    }

    if (asrSource === 'cloud') {
      const hasApiKey = Boolean((dashscopeSettings.apiKey || '').trim()) || dashscopeApiKeySaved;
      if (!hasApiKey) {
        setVoiceError(t('onboarding.dashscope.apiKeyRequired'));
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
        setVoiceError(selected?.error?.message || t('onboarding.asr.cloudApplyFailed'));
        return false;
      }
      setModelBundles(Array.isArray(selected?.bundles) ? selected.bundles : []);
      setVoiceFeedback(t('onboarding.asr.cloudApplied'));
      return true;
    }

    if (asrSource === 'local') {
      const installedBundle = findInstalledBundleByCatalogId({
        bundles: modelBundles,
        catalogId: selectedAsrCatalogId,
        capability: 'asr',
      });
      if (!installedBundle?.id) {
        setVoiceError(t('onboarding.asr.downloadRequired'));
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
        setVoiceError(selected?.error?.message || t('onboarding.asr.localApplyFailed'));
        return false;
      }
      setModelBundles(Array.isArray(selected?.bundles) ? selected.bundles : []);
      setVoiceFeedback(t('onboarding.asr.localApplied'));
      return true;
    }

    return false;
  }, [asrSource, dashscopeApiKeySaved, dashscopeSettings, modelBundles, saveVoiceSettings, selectedAsrCatalogId, t]);

  const applyTtsConfig = useCallback(async () => {
    setVoiceError('');
    setVoiceFeedback('');

    if (ttsSource === 'skip') {
      setVoiceFeedback(t('onboarding.tts.skipped'));
      return true;
    }

    if (ttsSource === 'cloud') {
      const hasApiKey = Boolean((dashscopeSettings.apiKey || '').trim()) || dashscopeApiKeySaved;
      if (!hasApiKey) {
        setVoiceError(t('onboarding.dashscope.apiKeyRequired'));
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
        setVoiceError(selected?.error?.message || t('onboarding.tts.cloudApplyFailed'));
        return false;
      }
      setModelBundles(Array.isArray(selected?.bundles) ? selected.bundles : []);
      setVoiceFeedback(t('onboarding.tts.cloudApplied'));
      return true;
    }

    if (ttsSource === 'local' || ttsSource === 'cloud-no-key') {
      const installedBundle = findInstalledBundleByCatalogId({
        bundles: modelBundles,
        catalogId: selectedTtsCatalogId,
        capability: 'tts',
      });
      if (!installedBundle?.id) {
        setVoiceError(ttsSource === 'cloud-no-key' ? t('onboarding.tts.cloudNoKeyPrepareRequired') : t('onboarding.tts.downloadRequired'));
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
        setVoiceError(
          selected?.error?.message
            || (ttsSource === 'cloud-no-key' ? t('onboarding.tts.cloudNoKeyApplyFailed') : t('onboarding.tts.localApplyFailed')),
        );
        return false;
      }
      setModelBundles(Array.isArray(selected?.bundles) ? selected.bundles : []);
      setVoiceFeedback(ttsSource === 'cloud-no-key' ? t('onboarding.tts.cloudNoKeyApplied') : t('onboarding.tts.localApplied'));
      return true;
    }

    return false;
  }, [dashscopeApiKeySaved, dashscopeSettings, modelBundles, saveVoiceSettings, selectedTtsCatalogId, ttsSource, t]);

  const handleInstallAsr = useCallback(async () => {
    if (!selectedAsrCatalogId) {
      setVoiceError(t('onboarding.asr.selectModel'));
      return;
    }

    setVoiceError('');
    setVoiceFeedback('');
    setIsInstallingAsr(true);
    try {
      const result = await desktopBridge.voiceModels.installCatalog(selectedAsrCatalogId, {
        installAsr: true,
        installTts: false,
      });
      if (!result?.ok) {
        setVoiceError(result?.error?.message || t('onboarding.asr.downloadFailed'));
        return;
      }
      setVoiceFeedback(t('onboarding.asr.downloadCompleted'));
      await loadVoiceContext();
      setAsrSource('local');
    } catch (error) {
      setVoiceError(error?.message || t('onboarding.asr.downloadFailed'));
    } finally {
      if (mountedRef.current) {
        setIsInstallingAsr(false);
      }
    }
  }, [loadVoiceContext, selectedAsrCatalogId, t]);

  const handleInstallTts = useCallback(async () => {
    if (!selectedTtsCatalogId) {
      setVoiceError(t('onboarding.tts.selectOption'));
      return;
    }

    const selectedCatalogItem = ttsCatalogItems.find((item) => item?.id === selectedTtsCatalogId) || null;
    const isCloudNoKey = isCloudNoKeyCatalogItem(selectedCatalogItem);

    setVoiceError('');
    setVoiceFeedback('');
    setIsInstallingTts(true);
    try {
      const result = await desktopBridge.voiceModels.installCatalog(selectedTtsCatalogId, {
        installAsr: false,
        installTts: true,
      });
      if (!result?.ok) {
        setVoiceError(result?.error?.message || (isCloudNoKey ? t('onboarding.tts.cloudNoKeyPrepareFailed') : t('onboarding.tts.downloadFailed')));
        return;
      }
      setVoiceFeedback(isCloudNoKey ? t('onboarding.tts.cloudNoKeyPrepared') : t('onboarding.tts.downloadCompleted'));
      await loadVoiceContext();
      setTtsSource(isCloudNoKey ? 'cloud-no-key' : 'local');
    } catch (error) {
      setVoiceError(error?.message || (isCloudNoKey ? t('onboarding.tts.cloudNoKeyPrepareFailed') : t('onboarding.tts.downloadFailed')));
    } finally {
      if (mountedRef.current) {
        setIsInstallingTts(false);
      }
    }
  }, [loadVoiceContext, selectedTtsCatalogId, ttsCatalogItems, t]);

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
      setAsrTestPhase('warming');
      const warmupResult = await desktopBridge.voice.warmup({
        warmAsr: true,
        warmTts: false,
      });
      if (!mountedRef.current) {
        return;
      }
      if (!warmupResult?.ok) {
        setVoiceError(warmupResult?.error?.message || warmupResult?.reason || t('onboarding.asr.warmupFailed'));
        return;
      }

      setAsrTestPhase('recording');
      const pcmChunk = await captureAsrTestPcm({
        durationMs: ASR_TEST_RECORD_MS,
        sampleRate: ASR_TEST_SAMPLE_RATE,
        messages: {
          microphoneUnsupported: t('onboarding.asr.microphoneUnsupported'),
          audioContextUnsupported: t('onboarding.asr.audioContextUnsupported'),
          emptyRecording: t('onboarding.asr.emptyRecording'),
        },
      });

      if (!mountedRef.current) {
        return;
      }

      setAsrTestPhase('transcribing');
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
        setVoiceError(result?.error?.message || result?.reason || t('onboarding.asr.testFailed'));
        return;
      }

      setAsrResult({
        ...result,
        prompt: asrPrompt,
      });
    } catch (error) {
      if (mountedRef.current) {
        setVoiceError(error?.message || t('onboarding.asr.testFailed'));
      }
    } finally {
      if (mountedRef.current) {
        setAsrTestPhase('idle');
        setAsrTesting(false);
      }
    }
  }, [applyAsrConfig, asrPrompt, asrTesting, ttsTesting, t]);

  const handleRunTtsTest = useCallback(async () => {
    if (asrTesting || ttsTesting) {
      return;
    }

    const text = typeof ttsText === 'string' ? ttsText.trim() : '';
    if (!text) {
      setVoiceError(t('onboarding.tts.testTextRequired'));
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
        setVoiceError(result?.error?.message || result?.reason || t('onboarding.tts.testFailed'));
        return;
      }

      setTtsResult({
        ...result,
        text,
      });
    } catch (error) {
      if (mountedRef.current) {
        setVoiceError(error?.message || t('onboarding.tts.testFailed'));
      }
    } finally {
      if (mountedRef.current) {
        setTtsTesting(false);
      }
    }
  }, [applyTtsConfig, asrTesting, ttsTesting, ttsText, t]);

  const handleSkipStep = useCallback(async () => {
    setVoiceError('');
    setVoiceFeedback('');

    if (activeStep === 0) {
      setActiveStep(1);
      return;
    }

    if (activeStep === 1 && backendSubStep < BACKEND_SUB_STEP_COUNT - 1) {
      setBackendSubStep((current) => Math.min(BACKEND_SUB_STEP_COUNT - 1, current + 1));
      return;
    }

    if (activeStep === 2) {
      setAsrSource('skip');
    }
    if (activeStep === 3) {
      setTtsSource('skip');
    }

    if (activeStep >= TOTAL_STEPS - 1) {
      await onFinish?.();
      return;
    }
    if (activeStep === 1) {
      setBackendSubStep(0);
    }
    setActiveStep((current) => Math.min(TOTAL_STEPS - 1, current + 1));
  }, [activeStep, backendSubStep, onFinish]);

  const handleNext = useCallback(async () => {
    if (activeStep === 0) {
      setActiveStep(1);
      return;
    }

    if (activeStep === 1 && backendSubStep < BACKEND_SUB_STEP_COUNT - 1) {
      setBackendSubStep((current) => Math.min(BACKEND_SUB_STEP_COUNT - 1, current + 1));
      return;
    }

    if (activeStep === 2) {
      const ok = await applyAsrConfig();
      if (!ok) {
        return;
      }
    }

    if (activeStep === 3) {
      const ok = await applyTtsConfig();
      if (!ok) {
        return;
      }
    }

    if (activeStep >= TOTAL_STEPS - 1) {
      await onFinish?.();
      return;
    }
    if (activeStep === 1) {
      setBackendSubStep(0);
    }
    setActiveStep((current) => Math.min(TOTAL_STEPS - 1, current + 1));
  }, [activeStep, applyAsrConfig, applyTtsConfig, backendSubStep, onFinish]);

  const handleBack = useCallback(() => {
    if (activeStep === 1 && backendSubStep > 0) {
      setBackendSubStep((current) => Math.max(0, current - 1));
      return;
    }
    setActiveStep((current) => Math.max(0, current - 1));
  }, [activeStep, backendSubStep]);

  const renderNanobotDownloadCard = () => {
    if (!shouldShowNanobotDownloadCard) {
      return null;
    }

    return renderInlineDownloadCard({
      title: t('download.nanobotRuntimeTitle'),
      task: nanobotRuntimeDownloadTask,
      detailsOpen: backendDownloadDetailsOpen,
      onToggleDetails: () => setBackendDownloadDetailsOpen((current) => !current),
    });
  };

  const renderInlineDownloadCard = ({ title = '', task = null, detailsOpen = false, onToggleDetails = null } = {}) => {
    const normalizedTask = task || {};
    const progressValue = resolveTaskProgressValue(normalizedTask);
    const statusText = resolveTaskStatusText(normalizedTask, t);
    const statsText = resolveTaskStatsText({ ...normalizedTask, nowMs: downloadNowMs }, t);

    return (
      <Stack
        spacing={1}
        sx={{
          p: 1.5,
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="subtitle2">{title || t('download.defaultTitle')}</Typography>
        <LinearProgress
          variant={typeof normalizedTask.overallProgress === 'number' ? 'determinate' : 'indeterminate'}
          value={progressValue}
        />
        <Typography variant="body2" color="text.secondary">
          {statusText}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {statsText}
        </Typography>
        <Button
          variant="text"
          size="small"
          sx={{ alignSelf: 'flex-end' }}
          onClick={onToggleDetails}
        >
          {detailsOpen ? t('download.hideDetails') : t('download.showDetails')}
        </Button>
        <Collapse in={detailsOpen}>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1.5,
              maxHeight: 180,
              overflow: 'auto',
              borderRadius: 1,
              bgcolor: 'action.hover',
              color: 'text.primary',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {Array.isArray(normalizedTask.logs) && normalizedTask.logs.length ? normalizedTask.logs.join('\n') : t('download.noLogs')}
          </Box>
        </Collapse>
      </Stack>
    );
  };

  const renderBackendSourceSubStep = () => (
    <Stack spacing={1.5}>
      <TextField
        select
        label={t('onboarding.backend.label')}
        value={selectedBackend}
        onChange={(event) => onChatBackendChange?.(event.target.value)}
        fullWidth
      >
        <MenuItem value="openclaw">{t('app.backend.openclaw')}</MenuItem>
        <MenuItem value="nanobot">{t('app.backend.nanobot')}</MenuItem>
      </TextField>

      {selectedBackend === 'nanobot' && (
        <Stack spacing={1}>
          <Alert severity={nanobotRuntimeStatus.installed ? 'success' : 'warning'}>
            {nanobotRuntimeStatus.installed ? t('onboarding.backend.nanobotInstalled') : t('onboarding.backend.nanobotMissing')}
          </Alert>
          <Button
            variant="outlined"
            size="small"
            disabled={nanobotRuntimeInstalling}
            onClick={() => onInstallNanobotRuntime?.()}
          >
            {nanobotRuntimeInstalling ? t('app.nanobotRuntimeInstalling') : t('onboarding.backend.downloadNanobot')}
          </Button>
          {renderNanobotDownloadCard()}
        </Stack>
      )}
    </Stack>
  );

  const renderBackendConfigSubStep = () => (
    <Stack spacing={1.5}>
      {selectedBackend === 'openclaw' ? (
        <Stack spacing={1}>
          <TextField
            label={t('onboarding.backend.openclawBaseUrl')}
            value={openClawSettings.baseUrl || ''}
            onChange={(event) => onOpenClawSettingChange?.('baseUrl', event.target.value)}
            placeholder="http://127.0.0.1:18789"
            fullWidth
          />
          <TextField
            label={t('onboarding.backend.agentId')}
            value={openClawSettings.agentId || ''}
            onChange={(event) => onOpenClawSettingChange?.('agentId', event.target.value)}
            placeholder="main"
            fullWidth
          />
          <TextField
            label={t('onboarding.backend.token')}
            value={openClawSettings.token || ''}
            onChange={(event) => onOpenClawSettingChange?.('token', event.target.value)}
            type="password"
            autoComplete="off"
            fullWidth
          />
        </Stack>
      ) : (
        <Stack spacing={1}>
          <TextField
            label={t('onboarding.backend.workspace')}
            value={nanobotSettings.workspace || ''}
            onChange={(event) => onNanobotSettingChange?.('workspace', event.target.value)}
            fullWidth
          />
          <Button size="small" variant="outlined" onClick={() => onPickNanobotWorkspace?.()}>
            {t('onboarding.backend.pickWorkspace')}
          </Button>
          <TextField
            label={t('onboarding.backend.provider')}
            value={nanobotSettings.provider || ''}
            onChange={(event) => onNanobotSettingChange?.('provider', event.target.value)}
            fullWidth
          />
          <TextField
            label={t('onboarding.backend.model')}
            value={nanobotSettings.model || ''}
            onChange={(event) => onNanobotSettingChange?.('model', event.target.value)}
            fullWidth
          />
          <TextField
            label={t('onboarding.backend.apiBase')}
            value={nanobotSettings.apiBase || ''}
            onChange={(event) => onNanobotSettingChange?.('apiBase', event.target.value)}
            placeholder={t('onboarding.optional')}
            fullWidth
          />
          <TextField
            label={t('onboarding.backend.apiKey')}
            value={nanobotSettings.apiKey || ''}
            onChange={(event) => onNanobotSettingChange?.('apiKey', event.target.value)}
            type="password"
            autoComplete="off"
            fullWidth
          />
        </Stack>
      )}
    </Stack>
  );

  const renderBackendEnableAndTestSubStep = () => {
    if (selectedBackend !== 'nanobot') {
      return (
        <Stack spacing={1.5}>
          <Alert severity="info">
            {t('onboarding.backend.openclawReady')}
          </Alert>
        </Stack>
      );
    }

    const testDisabled = settingsSaving || settingsTesting || !nanobotSettings.enabled;

    return (
      <Stack spacing={1.5}>
        <TextField
          select
          label={t('app.nanobotEnabled')}
          value={nanobotSettings.enabled ? 'enabled' : 'disabled'}
          onChange={(event) => onNanobotSettingChange?.('enabled', event.target.value === 'enabled')}
          fullWidth
        >
          <MenuItem value="enabled">{t('common.enabled')}</MenuItem>
          <MenuItem value="disabled">{t('common.disabled')}</MenuItem>
        </TextField>

        <Alert severity={nanobotRuntimeStatus.installed ? 'success' : 'warning'}>
          {nanobotRuntimeStatus.installed ? t('onboarding.backend.nanobotReady') : t('onboarding.backend.nanobotNotReady')}
        </Alert>

        <Stack direction="row" spacing={1}>
          <Button variant="contained" disabled={testDisabled} onClick={() => onTestChatBackendSettings?.()}>
            {settingsTesting ? t('app.testingConnection') : t('app.connectionTest')}
          </Button>
        </Stack>
      </Stack>
    );
  };

  const renderBackendStep = () => {
    return (
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {t('onboarding.backend.description')}
        </Typography>

        {backendSubStep === 0 && renderBackendSourceSubStep()}
        {backendSubStep === 1 && renderBackendConfigSubStep()}
        {backendSubStep === 2 && renderBackendEnableAndTestSubStep()}
      </Stack>
    );
  };

  const renderLanguageStep = () => (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {t('onboarding.language.description')}
      </Typography>
      <TextField
        select
        label={t('language.label')}
        value={language}
        onChange={(event) => setLanguage(event.target.value)}
        fullWidth
      >
        <MenuItem value={LANGUAGE_ZH_CN}>{t('language.zh')}</MenuItem>
        <MenuItem value={LANGUAGE_EN_US}>{t('language.en')}</MenuItem>
      </TextField>
    </Stack>
  );

  const renderAsrStep = () => {
    return (
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {t('onboarding.asr.description')}
        </Typography>

        <TextField
          select
          label={t('onboarding.asr.source')}
          value={asrSource === 'skip' ? 'cloud' : asrSource}
          onChange={(event) => setAsrSource(event.target.value)}
          fullWidth
        >
          <MenuItem value="cloud">{t('onboarding.source.cloudDashscope')}</MenuItem>
          <MenuItem value="local">{t('onboarding.source.local')}</MenuItem>
        </TextField>

        {asrSource === 'cloud' && (
          <Stack spacing={1}>
            <TextField
              label={t('onboarding.dashscope.apiKey')}
              value={dashscopeSettings.apiKey}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, apiKey: event.target.value }))}
              type="password"
              autoComplete="off"
              fullWidth
            />
            <TextField
              label={t('onboarding.dashscope.baseUrl')}
              value={dashscopeSettings.baseUrl}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, baseUrl: event.target.value }))}
              placeholder="wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
              fullWidth
            />
            <TextField
              label={t('onboarding.dashscope.workspaceOptional')}
              value={dashscopeSettings.workspace}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, workspace: event.target.value }))}
              fullWidth
            />
            <TextField
              label={t('onboarding.asr.model')}
              value={dashscopeSettings.asrModel}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, asrModel: event.target.value }))}
              fullWidth
            />
            <TextField
              label={t('onboarding.asr.language')}
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
              {t('onboarding.asr.applyCloud')}
            </Button>
          </Stack>
        )}

        {asrSource === 'local' && (
          <Stack spacing={1}>
            <TextField
              select
              label={t('onboarding.asr.localModel')}
              value={selectedAsrCatalogId}
              onChange={(event) => setSelectedAsrCatalogId(event.target.value)}
              fullWidth
            >
              {asrCatalogItems.map((item) => (
                <MenuItem key={item.id} value={item.id}>{item.name || item.id}</MenuItem>
              ))}
            </TextField>

            <Alert severity={installedAsrBundle ? 'success' : (asrDownloadRunning ? 'info' : 'warning')}>
              {installedAsrBundle
                ? t('onboarding.model.installed')
                : (asrDownloadRunning ? t('onboarding.model.downloadingNotInstalled') : t('onboarding.model.notInstalled'))}
            </Alert>

            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                onClick={() => {
                  void handleInstallAsr();
                }}
                disabled={isInstallingAsr || !selectedAsrCatalogId}
              >
                {isInstallingAsr ? t('onboarding.download.inProgress') : (installedAsrBundle ? t('onboarding.download.redownload') : t('onboarding.download.model'))}
              </Button>
              <Button
                variant="outlined"
                onClick={() => {
                  void applyAsrConfig();
                }}
                disabled={!installedAsrBundle || voiceSaving}
              >
                {t('onboarding.asr.setCurrent')}
              </Button>
            </Stack>
            {shouldShowAsrDownloadCard && renderInlineDownloadCard({
              title: t('onboarding.asr.downloadCardTitle'),
              task: asrDownloadTask,
              detailsOpen: asrDownloadDetailsOpen,
              onToggleDetails: () => setAsrDownloadDetailsOpen((current) => !current),
            })}
          </Stack>
        )}

        <TextField
          label={t('onboarding.asr.prompt')}
          value={asrPrompt}
          onChange={(event) => setAsrPrompt(event.target.value)}
          fullWidth
        />
        {asrTesting && !!getAsrTestProgressMessage(t, asrTestPhase) && (
          <Alert severity="info">{getAsrTestProgressMessage(t, asrTestPhase)}</Alert>
        )}
        <Button
          variant="outlined"
          onClick={() => {
            void handleRunAsrTest();
          }}
          disabled={asrTesting || ttsTesting || voiceLoading}
        >
          {getAsrTestStatusText(t, asrTesting ? asrTestPhase : 'idle')}
        </Button>

        {!!asrResult && (
          <Alert severity="success">
            {t('onboarding.asr.test.result', {
              latency: formatMs(asrResult.latencyMs),
              text: asrResult.text || t('voice.empty'),
            })}
          </Alert>
        )}
      </Stack>
    );
  };

  const renderTtsStep = () => {
    return (
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {t('onboarding.tts.description')}
        </Typography>

        <TextField
          select
          label={t('onboarding.tts.source')}
          value={ttsSource}
          onChange={(event) => setTtsSource(event.target.value)}
          fullWidth
        >
          <MenuItem value="skip">{t('onboarding.source.skipLater')}</MenuItem>
          <MenuItem value="cloud">{t('onboarding.source.cloudDashscope')}</MenuItem>
          <MenuItem value="cloud-no-key">{t('onboarding.source.cloudNoKey')}</MenuItem>
          <MenuItem value="local">{t('onboarding.source.local')}</MenuItem>
        </TextField>

        {ttsSource === 'cloud' && (
          <Stack spacing={1}>
            <TextField
              label={t('onboarding.dashscope.apiKey')}
              value={dashscopeSettings.apiKey}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, apiKey: event.target.value }))}
              type="password"
              autoComplete="off"
              fullWidth
            />
            <TextField
              label={t('onboarding.dashscope.baseUrl')}
              value={dashscopeSettings.baseUrl}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, baseUrl: event.target.value }))}
              placeholder="wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
              fullWidth
            />
            <TextField
              label={t('onboarding.dashscope.workspaceOptional')}
              value={dashscopeSettings.workspace}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, workspace: event.target.value }))}
              fullWidth
            />
            <TextField
              label={t('onboarding.tts.model')}
              value={dashscopeSettings.ttsModel}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, ttsModel: event.target.value }))}
              fullWidth
            />
            <TextField
              label={t('onboarding.tts.voice')}
              value={dashscopeSettings.ttsVoice}
              onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, ttsVoice: event.target.value }))}
              fullWidth
            />
            <Stack direction="row" spacing={1}>
              <TextField
                label={t('onboarding.tts.language')}
                value={dashscopeSettings.ttsLanguage}
                onChange={(event) => setDashscopeSettings((prev) => ({ ...prev, ttsLanguage: event.target.value }))}
                fullWidth
              />
              <TextField
                label={t('onboarding.tts.sampleRate')}
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
                label={t('onboarding.tts.speechRate')}
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
              {t('onboarding.tts.applyCloud')}
            </Button>
          </Stack>
        )}

        {ttsSource === 'cloud-no-key' && (
          <Stack spacing={1}>
            <TextField
              select
              label={t('onboarding.tts.cloudNoKey')}
              value={selectedTtsCatalogId}
              onChange={(event) => setSelectedTtsCatalogId(event.target.value)}
              fullWidth
            >
              {ttsCloudNoKeyCatalogItems.map((item) => (
                <MenuItem key={item.id} value={item.id}>{item.name || item.id}</MenuItem>
              ))}
            </TextField>

            <Alert severity={installedTtsBundle ? 'success' : 'warning'}>
              {installedTtsBundle ? t('onboarding.tts.cloudNoKeyReady') : t('onboarding.tts.cloudNoKeyNotReady')}
            </Alert>

            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                onClick={() => {
                  void handleInstallTts();
                }}
                disabled={isInstallingTts || !selectedTtsCatalogId}
              >
                {isInstallingTts ? t('onboarding.download.preparingRuntime') : (installedTtsBundle ? t('onboarding.download.reprepareRuntime') : t('onboarding.download.prepareRuntime'))}
              </Button>
              <Button
                variant="outlined"
                onClick={() => {
                  void applyTtsConfig();
                }}
                disabled={!installedTtsBundle || voiceSaving}
              >
                {t('onboarding.tts.setCurrent')}
              </Button>
            </Stack>
            {shouldShowTtsDownloadCard && renderInlineDownloadCard({
              title: t('onboarding.tts.downloadCardTitle'),
              task: ttsDownloadTask,
              detailsOpen: ttsDownloadDetailsOpen,
              onToggleDetails: () => setTtsDownloadDetailsOpen((current) => !current),
            })}
          </Stack>
        )}

        {ttsSource === 'local' && (
          <Stack spacing={1}>
            <TextField
              select
              label={t('onboarding.tts.localModel')}
              value={selectedTtsCatalogId}
              onChange={(event) => setSelectedTtsCatalogId(event.target.value)}
              fullWidth
            >
              {ttsLocalCatalogItems.map((item) => (
                <MenuItem key={item.id} value={item.id}>{item.name || item.id}</MenuItem>
              ))}
            </TextField>

            <Alert severity={installedTtsBundle ? 'success' : (ttsDownloadRunning ? 'info' : 'warning')}>
              {installedTtsBundle
                ? t('onboarding.model.installed')
                : (ttsDownloadRunning ? t('onboarding.model.downloadingNotInstalled') : t('onboarding.model.notInstalled'))}
            </Alert>

            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                onClick={() => {
                  void handleInstallTts();
                }}
                disabled={isInstallingTts || !selectedTtsCatalogId}
              >
                {isInstallingTts ? t('onboarding.download.inProgress') : (installedTtsBundle ? t('onboarding.download.redownload') : t('onboarding.download.model'))}
              </Button>
              <Button
                variant="outlined"
                onClick={() => {
                  void applyTtsConfig();
                }}
                disabled={!installedTtsBundle || voiceSaving}
              >
                {t('onboarding.tts.setCurrent')}
              </Button>
            </Stack>
            {shouldShowTtsDownloadCard && renderInlineDownloadCard({
              title: t('onboarding.tts.downloadCardTitle'),
              task: ttsDownloadTask,
              detailsOpen: ttsDownloadDetailsOpen,
              onToggleDetails: () => setTtsDownloadDetailsOpen((current) => !current),
            })}
          </Stack>
        )}

        <TextField
          label={t('onboarding.tts.testText')}
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
          {ttsTesting ? t('onboarding.tts.test.running') : t('onboarding.tts.test.action')}
        </Button>

        {!!ttsResult && (
          <Alert severity="success">
            {t('onboarding.tts.test.result', {
              firstChunk: formatMs(ttsResult.firstChunkLatencyMs),
              latency: formatMs(ttsResult.latencyMs),
              chunkCount: ttsResult.chunkCount || 0,
            })}
          </Alert>
        )}
      </Stack>
    );
  };

  if (!desktopMode) {
    return null;
  }

  const backDisabled = activeStep === 0 || isBusy;
  const nextButtonText = activeStep >= TOTAL_STEPS - 1
    ? t('onboarding.finish')
    : (
      activeStep === 1 && backendSubStep < BACKEND_SUB_STEP_COUNT - 1
        ? t('onboarding.backend.nextSubStep', { name: nextBackendSubStepLabel })
        : t('common.next')
    );

  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="sm"
      disableEscapeKeyDown
      sx={{ '& .MuiButton-root': { textTransform: 'none' } }}
    >
      <DialogTitle>{t('onboarding.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Box>
            <Typography variant="body2" color="text.secondary">
              {t('onboarding.subtitle')}
            </Typography>
          </Box>

          <Stepper activeStep={activeStep} alternativeLabel>
            {stepLabels.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
          {activeStep === 1 && (
            <Typography variant="caption" color="text.secondary">
              {backendSubStepProgressText}
            </Typography>
          )}

          {activeStep === 0 && renderLanguageStep()}
          {activeStep === 1 && renderBackendStep()}
          {activeStep === 2 && renderAsrStep()}
          {activeStep === 3 && renderTtsStep()}

          {(voiceLoading || voiceSaving) && (
            <Typography variant="caption" color="text.secondary">
              {t('onboarding.voice.syncing')}
            </Typography>
          )}

          {!!settingsFeedback && <Alert severity="success">{settingsFeedback}</Alert>}
          {!!settingsError && <Alert severity="warning">{settingsError}</Alert>}
          {!!voiceFeedback && <Alert severity="success">{voiceFeedback}</Alert>}
          {!!voiceError && <Alert severity="warning">{voiceError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => { void handleSkipStep(); }} disabled={isBusy}>
          {t('common.skip')}
        </Button>
        <Button onClick={handleBack} disabled={backDisabled}>{t('common.back')}</Button>
        <Button onClick={handleNext} variant="contained" disabled={isBusy}>
          {nextButtonText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
