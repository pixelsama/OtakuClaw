import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { desktopBridge } from '../../services/desktopBridge.js';
import {
  COSYVOICE_TTS_SAMPLE_RATE_OPTIONS,
  COSYVOICE_TTS_VOICE_OPTIONS,
  DASHSCOPE_ASR_LANGUAGE_OPTIONS,
  DASHSCOPE_ASR_MODEL_OPTIONS,
  DASHSCOPE_TTS_MODEL_OPTIONS,
  extendOptionsWithCustom,
  LEGACY_QWEN_TTS_SAMPLE_RATE_OPTIONS,
  QWEN_REALTIME_TTS_SAMPLE_RATE_OPTIONS,
  QWEN_REALTIME_TTS_VOICE_OPTIONS,
  QWEN3_TTS_LANGUAGE_OPTIONS,
} from '../../constants/voiceCloudCatalog.js';

const ASR_TEST_RECORD_MS = 3000;
const ASR_TEST_SAMPLE_RATE = 16000;
const VOICE_SETTINGS_AUTOSAVE_DEBOUNCE_MS = 500;
const MASKED_SECRET_VALUE = '********';
const CLOUD_ASR_DASHSCOPE_OPTION = 'cloud:dashscope:asr';
const CLOUD_TTS_DASHSCOPE_OPTION = 'cloud:dashscope:tts';
const DEFAULT_QWEN_TTS_VOICE = 'Cherry';
const DEFAULT_COSYVOICE_TTS_VOICE = 'longxiaochun_v2';

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

function getAsrTestStatusText(phase) {
  if (phase === 'warming') {
    return 'ASR 模型正在预热，请稍候...';
  }
  if (phase === 'recording') {
    return 'ASR 测试中（录音 3 秒）...';
  }
  if (phase === 'transcribing') {
    return 'ASR 正在识别录音...';
  }
  return 'ASR 延迟测试（录音 3 秒）';
}

function getAsrTestProgressMessage(phase) {
  if (phase === 'warming') {
    return '正在预热 ASR 模型。预热完成后会自动开始录音，这样测到的延迟更接近稳定状态。';
  }
  if (phase === 'recording') {
    return '正在录音 3 秒，请朗读你设置的提示词。';
  }
  if (phase === 'transcribing') {
    return '录音结束，正在执行 ASR 识别。';
  }
  return '';
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
  return Boolean(
    bundle?.hasTts
    || bundle?.tts?.modelPath
    || bundle?.runtime?.ttsModelDir
    || bundle?.runtime?.ttsEngine,
  );
}

function getCatalogSourceType(item = {}) {
  const sourceType = typeof item?.sourceType === 'string' ? item.sourceType.trim().toLowerCase() : '';
  return sourceType || 'local';
}

function isCloudNoKeyCatalogItem(item = {}) {
  return getCatalogSourceType(item) === 'cloud-no-key';
}

function resolveAsrModelPath(bundle = {}) {
  return bundle?.asr?.modelPath || bundle?.runtime?.asrModelDir || '';
}

function resolveTtsModelPath(bundle = {}) {
  return bundle?.tts?.modelPath || bundle?.runtime?.ttsModelDir || '';
}

function resolveLocalModelShortLabel(item = {}, capability = 'asr') {
  const joined = [
    item?.id || '',
    item?.name || '',
    item?.description || '',
    item?.runtime?.asrModelId || '',
    item?.runtime?.ttsModelId || '',
    item?.runtime?.ttsEngine || '',
  ].join(' ').toLowerCase();

  if (joined.includes('sherpa')) {
    return 'sherpa-onnx';
  }
  if (capability === 'asr' && joined.includes('qwen3-asr')) {
    return 'Qwen3-ASR';
  }
  if (capability === 'tts' && joined.includes('qwen3-tts')) {
    return 'Qwen3-TTS';
  }
  if (capability === 'tts' && joined.includes('edge')) {
    return 'Edge-TTS';
  }

  return capability === 'asr'
    ? (item?.asrOptionLabel || item?.name || item?.id || '')
    : (item?.ttsOptionLabel || item?.name || item?.id || '');
}

function normalizeMaskedSecretInput(rawValue, hasSavedSecret) {
  if (!hasSavedSecret) {
    return rawValue;
  }

  const value = typeof rawValue === 'string' ? rawValue : '';
  if (!value) {
    return '';
  }

  if (/^\*+$/.test(value)) {
    return '';
  }

  if (value.startsWith(MASKED_SECRET_VALUE)) {
    return value.slice(MASKED_SECRET_VALUE.length);
  }

  return value;
}

function isCosyVoiceModel(modelId = '') {
  return typeof modelId === 'string' && modelId.trim().toLowerCase().startsWith('cosyvoice-');
}

function isLegacyQwenRealtimeTtsModel(modelId = '') {
  return typeof modelId === 'string' && modelId.trim().toLowerCase().startsWith('qwen-tts-realtime');
}

function VoiceSectionAccordion({
  title = '',
  defaultExpanded = false,
  children,
}) {
  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      elevation={0}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, '&::before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ fontWeight: 600 }}>{title}</Box>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>{children}</Stack>
      </AccordionDetails>
    </Accordion>
  );
}

const defaultVoiceProviderSettings = {
  hasSecureStorage: true,
  asrProvider: 'inherit',
  ttsProvider: 'inherit',
  dashscope: {
    workspace: '',
    baseUrl: '',
    apiKey: '',
    hasApiKey: false,
    asrModel: 'qwen3-asr-flash-realtime',
    asrLanguage: 'zh',
    ttsModel: 'qwen-tts-realtime-latest',
    ttsVoice: 'Cherry',
    ttsLanguage: 'Chinese',
    ttsSampleRate: 24000,
    ttsSpeechRate: 1,
  },
};

function normalizeVoiceProviderSettings(settings = {}) {
  const voice = settings?.voice || settings || {};
  const dashscope = voice?.dashscope || {};
  return {
    hasSecureStorage: settings?.hasSecureStorage !== false,
    asrProvider: voice?.asrProvider === 'dashscope' ? 'dashscope' : 'inherit',
    ttsProvider: voice?.ttsProvider === 'dashscope' ? 'dashscope' : 'inherit',
    dashscope: {
      workspace: typeof dashscope.workspace === 'string' ? dashscope.workspace.trim() : '',
      baseUrl: typeof dashscope.baseUrl === 'string' ? dashscope.baseUrl.trim() : '',
      apiKey: '',
      hasApiKey: Boolean(dashscope.hasApiKey || (typeof dashscope.apiKey === 'string' && dashscope.apiKey.trim())),
      asrModel: typeof dashscope.asrModel === 'string' && dashscope.asrModel.trim()
        ? dashscope.asrModel.trim()
        : defaultVoiceProviderSettings.dashscope.asrModel,
      asrLanguage: typeof dashscope.asrLanguage === 'string' && dashscope.asrLanguage.trim()
        ? dashscope.asrLanguage.trim()
        : defaultVoiceProviderSettings.dashscope.asrLanguage,
      ttsModel: typeof dashscope.ttsModel === 'string' && dashscope.ttsModel.trim()
        ? dashscope.ttsModel.trim()
        : defaultVoiceProviderSettings.dashscope.ttsModel,
      ttsVoice: typeof dashscope.ttsVoice === 'string' && dashscope.ttsVoice.trim()
        ? dashscope.ttsVoice.trim()
        : defaultVoiceProviderSettings.dashscope.ttsVoice,
      ttsLanguage: typeof dashscope.ttsLanguage === 'string' && dashscope.ttsLanguage.trim()
        ? dashscope.ttsLanguage.trim()
        : defaultVoiceProviderSettings.dashscope.ttsLanguage,
      ttsSampleRate: Number.isFinite(dashscope.ttsSampleRate)
        ? dashscope.ttsSampleRate
        : defaultVoiceProviderSettings.dashscope.ttsSampleRate,
      ttsSpeechRate: Number.isFinite(dashscope.ttsSpeechRate)
        ? dashscope.ttsSpeechRate
        : defaultVoiceProviderSettings.dashscope.ttsSpeechRate,
    },
  };
}

function buildVoiceProviderSettingsSnapshot(settings = {}) {
  return {
    asrProvider: settings.asrProvider === 'dashscope' ? 'dashscope' : 'inherit',
    ttsProvider: settings.ttsProvider === 'dashscope' ? 'dashscope' : 'inherit',
    dashscope: {
      workspace: settings?.dashscope?.workspace || '',
      baseUrl: settings?.dashscope?.baseUrl || '',
      asrModel: settings?.dashscope?.asrModel || '',
      asrLanguage: settings?.dashscope?.asrLanguage || '',
      ttsModel: settings?.dashscope?.ttsModel || '',
      ttsVoice: settings?.dashscope?.ttsVoice || '',
      ttsLanguage: settings?.dashscope?.ttsLanguage || '',
      ttsSampleRate: Number.isFinite(settings?.dashscope?.ttsSampleRate) ? settings.dashscope.ttsSampleRate : 24000,
      ttsSpeechRate: Number.isFinite(settings?.dashscope?.ttsSpeechRate) ? settings.dashscope.ttsSpeechRate : 1,
    },
  };
}

function buildVoiceProviderSettingsPayload(settings = {}) {
  const payload = {
    voice: {
      asrProvider: settings.asrProvider === 'dashscope' ? 'dashscope' : 'inherit',
      ttsProvider: settings.ttsProvider === 'dashscope' ? 'dashscope' : 'inherit',
      dashscope: {
        workspace: settings?.dashscope?.workspace || '',
        baseUrl: settings?.dashscope?.baseUrl || '',
        asrModel: settings?.dashscope?.asrModel || '',
        asrLanguage: settings?.dashscope?.asrLanguage || '',
        ttsModel: settings?.dashscope?.ttsModel || '',
        ttsVoice: settings?.dashscope?.ttsVoice || '',
        ttsLanguage: settings?.dashscope?.ttsLanguage || '',
        ttsSampleRate: Number.isFinite(settings?.dashscope?.ttsSampleRate) ? settings.dashscope.ttsSampleRate : 24000,
        ttsSpeechRate: Number.isFinite(settings?.dashscope?.ttsSpeechRate) ? settings.dashscope.ttsSpeechRate : 1,
      },
    },
  };

  const apiKey = typeof settings?.dashscope?.apiKey === 'string' ? settings.dashscope.apiKey.trim() : '';
  if (apiKey) {
    payload.voice.dashscope.apiKey = apiKey;
  }

  return payload;
}

export function resolveCatalogSelectionFromBundle({
  bundles = [],
  selectedBundleId = '',
  catalogItems = [],
  previousCatalogId = '',
  capability = 'tts',
} = {}) {
  const hasCapability = capability === 'asr' ? bundleHasAsr : bundleHasTts;
  const normalizedBundleId = typeof selectedBundleId === 'string' ? selectedBundleId : '';
  const normalizedPreviousCatalogId = typeof previousCatalogId === 'string' ? previousCatalogId : '';
  const availableCatalogIds = new Set(
    Array.isArray(catalogItems)
      ? catalogItems
        .map((item) => (typeof item?.id === 'string' ? item.id : ''))
        .filter(Boolean)
      : [],
  );

  if (normalizedBundleId) {
    const selectedBundle = Array.isArray(bundles)
      ? bundles.find((bundle) => bundle?.id === normalizedBundleId && hasCapability(bundle))
      : null;
    const bundleCatalogId =
      typeof selectedBundle?.catalogId === 'string' ? selectedBundle.catalogId : '';
    return bundleCatalogId && availableCatalogIds.has(bundleCatalogId) ? bundleCatalogId : '';
  }

  return normalizedPreviousCatalogId && availableCatalogIds.has(normalizedPreviousCatalogId)
    ? normalizedPreviousCatalogId
    : '';
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

export default function VoiceSettingsPanel({
  desktopMode = false,
  onOpenDownloadCenter,
  onBuiltinTtsEnabledChange,
}) {
  const { t } = useI18n();
  const mountedRef = useRef(true);
  const progressEstimatorRef = useRef({
    key: '',
    lastBytes: 0,
    lastAtMs: 0,
    speedBytesPerSec: 0,
  });
  const ttsPreviewAudioRef = useRef(null);

  const [voiceProviderSettings, setVoiceProviderSettings] = useState(defaultVoiceProviderSettings);
  const [savedVoiceProviderSnapshot, setSavedVoiceProviderSnapshot] = useState(
    buildVoiceProviderSettingsSnapshot(defaultVoiceProviderSettings),
  );
  const [voiceProviderLoaded, setVoiceProviderLoaded] = useState(false);
  const [voiceProviderSaving, setVoiceProviderSaving] = useState(false);
  const [voiceProviderError, setVoiceProviderError] = useState('');
  const [modelBundles, setModelBundles] = useState([]);
  const [selectedAsrBundleId, setSelectedAsrBundleId] = useState('');
  const [selectedTtsBundleId, setSelectedTtsBundleId] = useState('');
  const [catalogItems, setCatalogItems] = useState([]);
  const [selectedAsrCatalogId, setSelectedAsrCatalogId] = useState('');
  const [selectedTtsCatalogId, setSelectedTtsCatalogId] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [isDownloadingModels, setIsDownloadingModels] = useState(false);
  const [isRemovingModels, setIsRemovingModels] = useState(false);
  const [modelProgress, setModelProgress] = useState(null);
  const [modelFeedback, setModelFeedback] = useState('');
  const [modelError, setModelError] = useState('');
  const [isAsrTesting, setIsAsrTesting] = useState(false);
  const [asrTestPhase, setAsrTestPhase] = useState('idle');
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
  const ttsLocalCatalogItems = useMemo(
    () => ttsCatalogItems.filter((item) => !isCloudNoKeyCatalogItem(item)),
    [ttsCatalogItems],
  );
  const ttsCloudNoKeyCatalogItems = useMemo(
    () => ttsCatalogItems.filter((item) => isCloudNoKeyCatalogItem(item)),
    [ttsCatalogItems],
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
  const isSelectedAsrCatalogActive = Boolean(
    installedAsrCatalogBundle
    && selectedAsrBundleId
    && installedAsrCatalogBundle.id === selectedAsrBundleId,
  );
  const isSelectedTtsCatalogActive = Boolean(
    installedTtsCatalogBundle
    && selectedTtsBundleId
    && installedTtsCatalogBundle.id === selectedTtsBundleId,
  );
  const effectiveActiveAsrBundle =
    selectedAsrCatalogId && !hasInstalledSelectedAsrCatalog ? null : activeAsrBundle;
  const effectiveActiveTtsBundle =
    selectedTtsCatalogId && !hasInstalledSelectedTtsCatalog ? null : activeTtsBundle;
  const asrModelOptions = useMemo(
    () => [
      { value: '', label: '跟随环境变量（自动）', source: 'inherit' },
      ...asrCatalogItems.map((item) => ({
        value: item.id,
        label: `${resolveLocalModelShortLabel(item, 'asr')}（本地）`,
        source: 'local',
      })),
      { value: CLOUD_ASR_DASHSCOPE_OPTION, label: '阿里百炼（云端）', source: 'cloud' },
    ],
    [asrCatalogItems],
  );
  const ttsModelOptions = useMemo(
    () => [
      { value: '', label: '跟随环境变量（自动）', source: 'inherit' },
      ...ttsLocalCatalogItems.map((item) => ({
        value: item.id,
        label: `${resolveLocalModelShortLabel(item, 'tts')}（本地）`,
        source: 'local',
      })),
      ...ttsCloudNoKeyCatalogItems.map((item) => ({
        value: item.id,
        label: `${resolveLocalModelShortLabel(item, 'tts')}（云端，无需配置 Key）`,
        source: 'cloud-no-key',
      })),
      { value: CLOUD_TTS_DASHSCOPE_OPTION, label: '阿里百炼（云端）', source: 'cloud' },
    ],
    [ttsCloudNoKeyCatalogItems, ttsLocalCatalogItems],
  );
  const selectedAsrModelOptionValue = selectedAsrCatalogId
    || (voiceProviderSettings.asrProvider === 'dashscope' ? CLOUD_ASR_DASHSCOPE_OPTION : '');
  const selectedTtsModelOptionValue = selectedTtsCatalogId
    || (voiceProviderSettings.ttsProvider === 'dashscope' ? CLOUD_TTS_DASHSCOPE_OPTION : '');
  const isAsrCloudSelected = selectedAsrModelOptionValue === CLOUD_ASR_DASHSCOPE_OPTION;
  const isTtsCloudSelected = selectedTtsModelOptionValue === CLOUD_TTS_DASHSCOPE_OPTION;
  const isDashscopeCosyVoiceTtsModel = isCosyVoiceModel(voiceProviderSettings.dashscope.ttsModel);
  const isDashscopeLegacyQwenTtsModel = isLegacyQwenRealtimeTtsModel(voiceProviderSettings.dashscope.ttsModel);
  const dashscopeTtsSampleRateOptions = isDashscopeCosyVoiceTtsModel
    ? COSYVOICE_TTS_SAMPLE_RATE_OPTIONS
    : (isDashscopeLegacyQwenTtsModel ? LEGACY_QWEN_TTS_SAMPLE_RATE_OPTIONS : QWEN_REALTIME_TTS_SAMPLE_RATE_OPTIONS);
  const dashscopeAsrModelOptions = useMemo(
    () => extendOptionsWithCustom(DASHSCOPE_ASR_MODEL_OPTIONS, voiceProviderSettings.dashscope.asrModel),
    [voiceProviderSettings.dashscope.asrModel],
  );
  const dashscopeAsrLanguageOptions = useMemo(
    () => extendOptionsWithCustom(DASHSCOPE_ASR_LANGUAGE_OPTIONS, voiceProviderSettings.dashscope.asrLanguage),
    [voiceProviderSettings.dashscope.asrLanguage],
  );
  const dashscopeTtsModelOptions = useMemo(
    () => extendOptionsWithCustom(DASHSCOPE_TTS_MODEL_OPTIONS, voiceProviderSettings.dashscope.ttsModel),
    [voiceProviderSettings.dashscope.ttsModel],
  );
  const dashscopeTtsVoiceOptions = useMemo(() => {
    const options = isDashscopeCosyVoiceTtsModel
      ? COSYVOICE_TTS_VOICE_OPTIONS
      : QWEN_REALTIME_TTS_VOICE_OPTIONS;
    return extendOptionsWithCustom(
      options.map((item) => ({ value: item, label: item })),
      voiceProviderSettings.dashscope.ttsVoice,
    );
  }, [isDashscopeCosyVoiceTtsModel, voiceProviderSettings.dashscope.ttsVoice]);
  const dashscopeTtsLanguageOptions = useMemo(
    () => extendOptionsWithCustom(QWEN3_TTS_LANGUAGE_OPTIONS, voiceProviderSettings.dashscope.ttsLanguage),
    [voiceProviderSettings.dashscope.ttsLanguage],
  );
  const dashscopeTtsSampleRateSelectOptions = useMemo(
    () => extendOptionsWithCustom(
      dashscopeTtsSampleRateOptions.map((item) => ({ value: String(item), label: String(item) })),
      String(voiceProviderSettings.dashscope.ttsSampleRate || ''),
    ),
    [dashscopeTtsSampleRateOptions, voiceProviderSettings.dashscope.ttsSampleRate],
  );
  const dashscopeApiKeySaved = Boolean(
    voiceProviderSettings.dashscope.hasApiKey && !(voiceProviderSettings.dashscope.apiKey || '').trim(),
  );
  const dashscopeApiKeyValue = dashscopeApiKeySaved
    ? MASKED_SECRET_VALUE
    : (voiceProviderSettings.dashscope.apiKey || '');

  const applyVoiceModelList = useCallback((result = {}) => {
    const bundles = Array.isArray(result.bundles) ? result.bundles : [];
    const nextSelectedTtsBundleId =
      typeof result.selectedTtsBundleId === 'string'
        ? result.selectedTtsBundleId
        : (typeof result.selectedBundleId === 'string' ? result.selectedBundleId : '');
    setModelBundles(bundles);
    setSelectedAsrBundleId(
      typeof result.selectedAsrBundleId === 'string'
        ? result.selectedAsrBundleId
        : (typeof result.selectedBundleId === 'string' ? result.selectedBundleId : ''),
    );
    setSelectedTtsBundleId(nextSelectedTtsBundleId);
    onBuiltinTtsEnabledChange?.({
      ...result,
      selectedTtsBundleId: nextSelectedTtsBundleId,
    });
  }, [onBuiltinTtsEnabledChange]);

  const loadVoiceProviderSettings = useCallback(async () => {
    if (!desktopMode) {
      return;
    }

    try {
      const settings = await desktopBridge.settings.get();
      if (!mountedRef.current) {
        return;
      }

      const normalized = normalizeVoiceProviderSettings(settings);
      setVoiceProviderSettings(normalized);
      setSavedVoiceProviderSnapshot(buildVoiceProviderSettingsSnapshot(normalized));
      setVoiceProviderLoaded(true);
      setVoiceProviderError('');
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      setVoiceProviderLoaded(true);
      setVoiceProviderError(error?.message || '读取云端语音供应商设置失败。');
    }
  }, [desktopMode]);

  const updateVoiceProviderSetting = useCallback((field, value) => {
    setVoiceProviderSettings((prev) => ({
      ...prev,
      [field]: value,
    }));
    setVoiceProviderError('');
  }, []);

  const updateDashscopeSetting = useCallback((field, value) => {
    setVoiceProviderSettings((prev) => ({
      ...prev,
      dashscope: {
        ...prev.dashscope,
        [field]: value,
      },
    }));
    setVoiceProviderError('');
  }, []);

  const handleClearDashscopeApiKey = useCallback(async () => {
    setVoiceProviderSaving(true);
    setVoiceProviderError('');

    try {
      const saved = await desktopBridge.settings.save({
        voice: {
          dashscope: {
            clearApiKey: true,
          },
        },
      });
      if (!mountedRef.current) {
        return;
      }

      const normalized = normalizeVoiceProviderSettings(saved);
      setVoiceProviderSettings(normalized);
      setSavedVoiceProviderSnapshot(buildVoiceProviderSettingsSnapshot(normalized));
    } catch (error) {
      if (mountedRef.current) {
        setVoiceProviderError(error?.message || '清除 DashScope API Key 失败。');
      }
    } finally {
      if (mountedRef.current) {
        setVoiceProviderSaving(false);
      }
    }
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
            || '读取内置模型列表失败。请完全退出桌面应用后重新执行 pnpm run desktop:dev。',
        );
      } else if (!items.length) {
        setModelError('当前没有可用的内置模型清单。请确认已拉取最新代码并重启桌面应用。');
      } else {
        setModelError('');
      }
      setCatalogItems(items);
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
    if (!desktopMode) {
      return;
    }

    setModelError('');
    setModelFeedback('');

    if (nextCatalogId === CLOUD_ASR_DASHSCOPE_OPTION) {
      setSelectedAsrCatalogId('');
      updateVoiceProviderSetting('asrProvider', 'dashscope');
      try {
        const clearResult = await desktopBridge.voiceModels.select({ asrBundleId: '' });
        if (!mountedRef.current) {
          return;
        }
        if (!clearResult?.ok) {
          setModelError(clearResult?.error?.message || '切换到阿里百炼 ASR 失败。');
          return;
        }
        applyVoiceModelList(clearResult);
        setModelFeedback('ASR 已切换到阿里百炼（云端）。');
      } catch (error) {
        if (mountedRef.current) {
          setModelError(error?.message || '切换到阿里百炼 ASR 失败。');
        }
      }
      return;
    }

    updateVoiceProviderSetting('asrProvider', 'inherit');
    setSelectedAsrCatalogId(nextCatalogId);

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
  }, [applyVoiceModelList, desktopMode, modelBundles, updateVoiceProviderSetting]);

  const handleChangeTtsCatalog = useCallback(async (nextCatalogId) => {
    if (!desktopMode) {
      return;
    }

    setModelError('');
    setModelFeedback('');

    if (nextCatalogId === CLOUD_TTS_DASHSCOPE_OPTION) {
      setSelectedTtsCatalogId('');
      updateVoiceProviderSetting('ttsProvider', 'dashscope');
      try {
        const clearResult = await desktopBridge.voiceModels.select({ ttsBundleId: '' });
        if (!mountedRef.current) {
          return;
        }
        if (!clearResult?.ok) {
          setModelError(clearResult?.error?.message || '切换到阿里百炼 TTS 失败。');
          return;
        }
        applyVoiceModelList(clearResult);
        setModelFeedback('TTS 已切换到阿里百炼（云端）。');
      } catch (error) {
        if (mountedRef.current) {
          setModelError(error?.message || '切换到阿里百炼 TTS 失败。');
        }
      }
      return;
    }

    updateVoiceProviderSetting('ttsProvider', 'inherit');
    setSelectedTtsCatalogId(nextCatalogId);

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
  }, [applyVoiceModelList, desktopMode, modelBundles, updateVoiceProviderSetting]);

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

  const handleRemoveAsrModel = useCallback(async () => {
    if (!desktopMode || !selectedAsrCatalogId || !installedAsrCatalogBundle?.id) {
      return;
    }

    const modelLabel = resolveLocalModelShortLabel(selectedAsrCatalogItem, 'asr');
    const confirmed = window.confirm(`确认删除 ASR 模型“${modelLabel}”吗？该操作会删除本地模型文件。`);
    if (!confirmed) {
      return;
    }

    setModelError('');
    setModelFeedback('');
    setIsRemovingModels(true);

    try {
      const result = await desktopBridge.voiceModels.remove({
        bundleId: installedAsrCatalogBundle.id,
      });
      if (!mountedRef.current) {
        return;
      }

      if (!result?.ok) {
        setModelError(result?.error?.message || '删除 ASR 模型失败。');
        return;
      }

      applyVoiceModelList(result);
      setModelFeedback(`ASR 模型“${modelLabel}”已删除。`);
    } catch (error) {
      if (mountedRef.current) {
        setModelError(error?.message || '删除 ASR 模型失败。');
      }
    } finally {
      if (mountedRef.current) {
        setIsRemovingModels(false);
      }
    }
  }, [
    applyVoiceModelList,
    desktopMode,
    installedAsrCatalogBundle,
    selectedAsrCatalogId,
    selectedAsrCatalogItem,
  ]);

  const handleRemoveTtsModel = useCallback(async () => {
    if (!desktopMode || !selectedTtsCatalogId || !installedTtsCatalogBundle?.id) {
      return;
    }

    const modelLabel = resolveLocalModelShortLabel(selectedTtsCatalogItem, 'tts');
    const confirmed = window.confirm(`确认删除 TTS 模型“${modelLabel}”吗？该操作会删除本地模型文件。`);
    if (!confirmed) {
      return;
    }

    setModelError('');
    setModelFeedback('');
    setIsRemovingModels(true);

    try {
      const result = await desktopBridge.voiceModels.remove({
        bundleId: installedTtsCatalogBundle.id,
      });
      if (!mountedRef.current) {
        return;
      }

      if (!result?.ok) {
        setModelError(result?.error?.message || '删除 TTS 模型失败。');
        return;
      }

      applyVoiceModelList(result);
      setModelFeedback(`TTS 模型“${modelLabel}”已删除。`);
    } catch (error) {
      if (mountedRef.current) {
        setModelError(error?.message || '删除 TTS 模型失败。');
      }
    } finally {
      if (mountedRef.current) {
        setIsRemovingModels(false);
      }
    }
  }, [
    applyVoiceModelList,
    desktopMode,
    installedTtsCatalogBundle,
    selectedTtsCatalogId,
    selectedTtsCatalogItem,
  ]);

  const handleRunAsrTest = useCallback(async () => {
    if (!desktopMode || isAsrTesting || isTtsTesting) {
      return;
    }

    setVoiceTestError('');
    setAsrTestResult(null);
    setIsAsrTesting(true);
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
        setVoiceTestError(warmupResult?.error?.message || warmupResult?.reason || 'ASR 预热失败。');
        return;
      }

      setAsrTestPhase('recording');
      const pcmChunk = await captureAsrTestPcm({
        durationMs: ASR_TEST_RECORD_MS,
        sampleRate: ASR_TEST_SAMPLE_RATE,
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
        setAsrTestPhase('idle');
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

      const wavBlob = result?.codec === 'pcm_s16le'
        ? createWavBlobFromPcmS16Le({
          pcmS16LeBase64: result?.pcmS16LeBase64,
          sampleRate: result?.sampleRate,
          channels: 1,
        })
        : null;
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
    void loadVoiceProviderSettings();
    void loadVoiceModels();
    void loadModelCatalog();
  }, [loadModelCatalog, loadVoiceModels, loadVoiceProviderSettings]);

  useEffect(() => {
    if (!desktopMode) {
      return;
    }

    setVoiceProviderSettings((previous) => {
      const dashscope = previous.dashscope || {};
      const modelId = (dashscope.ttsModel || '').trim().toLowerCase();
      const isCosyVoice = modelId.startsWith('cosyvoice-');
      const isLegacyQwen = modelId.startsWith('qwen-tts-realtime');
      const validSampleRates = isCosyVoice
        ? COSYVOICE_TTS_SAMPLE_RATE_OPTIONS
        : (isLegacyQwen ? LEGACY_QWEN_TTS_SAMPLE_RATE_OPTIONS : QWEN_REALTIME_TTS_SAMPLE_RATE_OPTIONS);
      const nextSampleRate = validSampleRates.includes(Number(dashscope.ttsSampleRate))
        ? Number(dashscope.ttsSampleRate)
        : validSampleRates[0];
      const nextVoice = (dashscope.ttsVoice || '').trim()
        || (isCosyVoice ? DEFAULT_COSYVOICE_TTS_VOICE : DEFAULT_QWEN_TTS_VOICE);
      const nextSpeechRate = isLegacyQwen ? 1 : dashscope.ttsSpeechRate;

      if (
        nextSampleRate === dashscope.ttsSampleRate
        && nextVoice === dashscope.ttsVoice
        && nextSpeechRate === dashscope.ttsSpeechRate
      ) {
        return previous;
      }

      return {
        ...previous,
        dashscope: {
          ...dashscope,
          ttsSampleRate: nextSampleRate,
          ttsVoice: nextVoice,
          ttsSpeechRate: nextSpeechRate,
        },
      };
    });
  }, [desktopMode, voiceProviderSettings.dashscope.ttsModel]);

  useEffect(() => {
    if (!desktopMode || !voiceProviderLoaded) {
      return () => {};
    }

    const currentSnapshot = buildVoiceProviderSettingsSnapshot(voiceProviderSettings);
    const snapshotChanged = JSON.stringify(currentSnapshot) !== JSON.stringify(savedVoiceProviderSnapshot);
    const pendingApiKey = Boolean((voiceProviderSettings.dashscope.apiKey || '').trim());
    if (!snapshotChanged && !pendingApiKey) {
      return () => {};
    }

    const timer = setTimeout(() => {
      void (async () => {
        setVoiceProviderSaving(true);
        setVoiceProviderError('');
        try {
          const payload = buildVoiceProviderSettingsPayload(voiceProviderSettings);
          const saved = await desktopBridge.settings.save(payload);
          if (!mountedRef.current) {
            return;
          }

          const normalized = normalizeVoiceProviderSettings(saved);
          setVoiceProviderSettings(normalized);
          setSavedVoiceProviderSnapshot(buildVoiceProviderSettingsSnapshot(normalized));
        } catch (error) {
          if (mountedRef.current) {
            setVoiceProviderError(error?.message || '保存云端语音供应商设置失败。');
          }
        } finally {
          if (mountedRef.current) {
            setVoiceProviderSaving(false);
          }
        }
      })();
    }, VOICE_SETTINGS_AUTOSAVE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [desktopMode, savedVoiceProviderSnapshot, voiceProviderLoaded, voiceProviderSettings]);

  useEffect(() => {
    setSelectedAsrCatalogId((previous) => resolveCatalogSelectionFromBundle({
      bundles: modelBundles,
      selectedBundleId: selectedAsrBundleId,
      catalogItems: asrCatalogItems,
      previousCatalogId: previous,
      capability: 'asr',
    }));
    setSelectedTtsCatalogId((previous) => resolveCatalogSelectionFromBundle({
      bundles: modelBundles,
      selectedBundleId: selectedTtsBundleId,
      catalogItems: ttsCatalogItems,
      previousCatalogId: previous,
      capability: 'tts',
    }));
  }, [asrCatalogItems, modelBundles, selectedAsrBundleId, selectedTtsBundleId, ttsCatalogItems]);

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
        <VoiceSectionAccordion title="语音供应商清单（本地 + 云端）">
          <Stack spacing={1.5}>
            <VoiceSectionAccordion title="ASR">
              <TextField
                select
                label="ASR 供应商列表"
                value={selectedAsrModelOptionValue}
                onChange={(event) => {
                  void handleChangeAsrCatalog(event.target.value);
                }}
                disabled={modelsLoading || isDownloadingModels || isRemovingModels}
                fullWidth
              >
                {asrModelOptions.map((option) => (
                  <MenuItem key={option.value || 'asr-auto'} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>

              {isAsrCloudSelected && (
                <Stack spacing={1}>
                  <Alert severity="success">已选择阿里百炼（云端）ASR。</Alert>
                  {!voiceProviderSettings.hasSecureStorage && (
                    <Alert severity="warning">系统密钥链不可用，DashScope API Key 将回退为本地明文存储。</Alert>
                  )}
                  <TextField
                    label="DashScope WebSocket Base URL"
                    value={voiceProviderSettings.dashscope.baseUrl}
                    onChange={(event) => updateDashscopeSetting('baseUrl', event.target.value)}
                    placeholder="wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
                    helperText="留空时自动使用默认地址；后台会依据所选模型自动走 Realtime（Qwen）或 Inference（CosyVoice）路径。"
                    disabled={voiceProviderSaving}
                    fullWidth
                  />
                  <TextField
                    label="DashScope Workspace"
                    value={voiceProviderSettings.dashscope.workspace}
                    onChange={(event) => updateDashscopeSetting('workspace', event.target.value)}
                    placeholder="可选"
                    disabled={voiceProviderSaving}
                    fullWidth
                  />
                  <TextField
                    label="DashScope API Key"
                    value={dashscopeApiKeyValue}
                    onChange={(event) => {
                      const nextApiKey = normalizeMaskedSecretInput(event.target.value, dashscopeApiKeySaved);
                      updateDashscopeSetting('apiKey', nextApiKey);
                    }}
                    type="password"
                    autoComplete="off"
                    placeholder={voiceProviderSettings.dashscope.hasApiKey ? '已保存 API Key' : ''}
                    helperText={dashscopeApiKeySaved ? '已保存 API Key' : ''}
                    disabled={voiceProviderSaving}
                    fullWidth
                  />
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: -0.5 }}>
                    <Button
                      size="small"
                      color="warning"
                      onClick={handleClearDashscopeApiKey}
                      disabled={voiceProviderSaving || !voiceProviderSettings.dashscope.hasApiKey}
                    >
                      清除 DashScope API Key
                    </Button>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <TextField
                      select
                      label="DashScope ASR Model"
                      value={voiceProviderSettings.dashscope.asrModel}
                      onChange={(event) => updateDashscopeSetting('asrModel', event.target.value)}
                      disabled={voiceProviderSaving}
                      fullWidth
                    >
                      {dashscopeAsrModelOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      label="ASR 语种"
                      value={voiceProviderSettings.dashscope.asrLanguage}
                      onChange={(event) => updateDashscopeSetting('asrLanguage', event.target.value)}
                      disabled={voiceProviderSaving}
                      fullWidth
                    >
                      {dashscopeAsrLanguageOptions.map((option) => (
                        <MenuItem key={option.value || 'asr-language-auto'} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                </Stack>
              )}

              {!!selectedAsrCatalogId && (
                <Stack spacing={1}>
                  <Alert severity="info">
                    {`ASR: ${resolveLocalModelShortLabel(selectedAsrCatalogItem, 'asr')}（本地）`}
                  </Alert>
                  <Alert
                    severity={
                      isSelectedAsrCatalogActive
                        ? 'success'
                        : (hasInstalledSelectedAsrCatalog ? 'info' : 'warning')
                    }
                  >
                    {isSelectedAsrCatalogActive
                      ? '所选 ASR 模型状态: 已下载并生效'
                      : hasInstalledSelectedAsrCatalog
                        ? '所选 ASR 模型状态: 已下载，但当前未生效'
                        : '所选 ASR 模型状态: 未下载'}
                  </Alert>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Button
                      variant="contained"
                      size="small"
                      onClick={handleInstallAsrModel}
                      disabled={isDownloadingModels || isRemovingModels}
                    >
                      {hasInstalledSelectedAsrCatalog ? '重新下载 ASR 模型' : '下载 ASR 模型'}
                    </Button>
                    {hasInstalledSelectedAsrCatalog && (
                      <Button
                        variant="outlined"
                        color="warning"
                        size="small"
                        onClick={handleRemoveAsrModel}
                        disabled={isDownloadingModels || isRemovingModels}
                      >
                        删除 ASR 模型
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
              )}
            </VoiceSectionAccordion>

            <VoiceSectionAccordion title="TTS">
              <TextField
                select
                label="TTS 供应商列表"
                value={selectedTtsModelOptionValue}
                onChange={(event) => {
                  void handleChangeTtsCatalog(event.target.value);
                }}
                disabled={modelsLoading || isDownloadingModels || isRemovingModels}
                fullWidth
              >
                {ttsModelOptions.map((option) => (
                  <MenuItem key={option.value || 'tts-auto'} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>

              {isTtsCloudSelected && (
                <Stack spacing={1}>
                  <Alert severity="success">已选择阿里百炼（云端）TTS。</Alert>
                  {!voiceProviderSettings.hasSecureStorage && (
                    <Alert severity="warning">系统密钥链不可用，DashScope API Key 将回退为本地明文存储。</Alert>
                  )}
                  <TextField
                    label="DashScope WebSocket Base URL"
                    value={voiceProviderSettings.dashscope.baseUrl}
                    onChange={(event) => updateDashscopeSetting('baseUrl', event.target.value)}
                    placeholder="wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
                    helperText="留空时自动使用默认地址；后台会依据所选模型自动走 Realtime（Qwen）或 Inference（CosyVoice）路径。"
                    disabled={voiceProviderSaving}
                    fullWidth
                  />
                  <TextField
                    label="DashScope Workspace"
                    value={voiceProviderSettings.dashscope.workspace}
                    onChange={(event) => updateDashscopeSetting('workspace', event.target.value)}
                    placeholder="可选"
                    disabled={voiceProviderSaving}
                    fullWidth
                  />
                  <TextField
                    label="DashScope API Key"
                    value={dashscopeApiKeyValue}
                    onChange={(event) => {
                      const nextApiKey = normalizeMaskedSecretInput(event.target.value, dashscopeApiKeySaved);
                      updateDashscopeSetting('apiKey', nextApiKey);
                    }}
                    type="password"
                    autoComplete="off"
                    placeholder={voiceProviderSettings.dashscope.hasApiKey ? '已保存 API Key' : ''}
                    helperText={dashscopeApiKeySaved ? '已保存 API Key' : ''}
                    disabled={voiceProviderSaving}
                    fullWidth
                  />
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: -0.5 }}>
                    <Button
                      size="small"
                      color="warning"
                      onClick={handleClearDashscopeApiKey}
                      disabled={voiceProviderSaving || !voiceProviderSettings.dashscope.hasApiKey}
                    >
                      清除 DashScope API Key
                    </Button>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <TextField
                      select
                      label="DashScope TTS Model"
                      value={voiceProviderSettings.dashscope.ttsModel}
                      onChange={(event) => updateDashscopeSetting('ttsModel', event.target.value)}
                      disabled={voiceProviderSaving}
                      fullWidth
                    >
                      {dashscopeTtsModelOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      label="TTS 音色"
                      value={voiceProviderSettings.dashscope.ttsVoice}
                      onChange={(event) => updateDashscopeSetting('ttsVoice', event.target.value)}
                      disabled={voiceProviderSaving}
                      fullWidth
                    >
                      {dashscopeTtsVoiceOptions.map((option) => (
                        <MenuItem key={option.value || 'tts-voice-default'} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                  {isDashscopeCosyVoiceTtsModel && (
                    <Alert severity="info">
                      当前 TTS 模型是 CosyVoice。后台会自动使用 Inference 协议，并按 CosyVoice 参数模板请求。
                    </Alert>
                  )}
                  {!isDashscopeCosyVoiceTtsModel && (
                    <Alert severity="info">
                      当前 TTS 模型是 Qwen Realtime TTS。后台会自动使用 Realtime 协议，并按 Qwen Realtime 参数模板请求。
                    </Alert>
                  )}
                  <Stack direction="row" spacing={1}>
                    {!isDashscopeCosyVoiceTtsModel && !isDashscopeLegacyQwenTtsModel && (
                      <TextField
                        select
                        label="TTS 语言"
                        value={voiceProviderSettings.dashscope.ttsLanguage}
                        onChange={(event) => updateDashscopeSetting('ttsLanguage', event.target.value)}
                        disabled={voiceProviderSaving}
                        fullWidth
                      >
                        {dashscopeTtsLanguageOptions.map((option) => (
                          <MenuItem key={option.value || 'tts-language-default'} value={option.value}>
                            {option.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                    <TextField
                      select
                      label="TTS Sample Rate"
                      value={String(voiceProviderSettings.dashscope.ttsSampleRate || '')}
                      onChange={(event) =>
                        updateDashscopeSetting('ttsSampleRate', Number.parseInt(event.target.value, 10) || 0)}
                      disabled={voiceProviderSaving}
                      fullWidth
                    >
                      {dashscopeTtsSampleRateSelectOptions.map((option) => (
                        <MenuItem key={option.value || 'tts-sample-rate-default'} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      label={isDashscopeCosyVoiceTtsModel ? 'CosyVoice Rate' : 'TTS Speech Rate'}
                      type="number"
                      value={voiceProviderSettings.dashscope.ttsSpeechRate}
                      onChange={(event) =>
                        updateDashscopeSetting('ttsSpeechRate', Number.parseFloat(event.target.value))}
                      inputProps={{ step: 0.1 }}
                      disabled={voiceProviderSaving || isDashscopeLegacyQwenTtsModel}
                      fullWidth
                    />
                  </Stack>
                  {isDashscopeLegacyQwenTtsModel && (
                    <Alert severity="info">
                      qwen-tts-realtime 系列仅支持固定语言/采样率模板，语速调节不可配置。
                    </Alert>
                  )}
                </Stack>
              )}

              {!!selectedTtsCatalogId && (
                <Stack spacing={1}>
                  <Alert severity="info">
                    {`TTS: ${resolveLocalModelShortLabel(selectedTtsCatalogItem, 'tts')}（${
                      isCloudNoKeyCatalogItem(selectedTtsCatalogItem) ? '云端，无需配置 Key' : '本地'
                    }）`}
                  </Alert>
                  <Alert
                    severity={
                      isSelectedTtsCatalogActive
                        ? 'success'
                        : (hasInstalledSelectedTtsCatalog ? 'info' : 'warning')
                    }
                  >
                    {isSelectedTtsCatalogActive
                      ? (
                        isCloudNoKeyCatalogItem(selectedTtsCatalogItem)
                          ? '所选 TTS 状态: 运行时已准备并生效'
                          : '所选 TTS 模型状态: 已下载并生效'
                      )
                      : hasInstalledSelectedTtsCatalog
                        ? (
                          isCloudNoKeyCatalogItem(selectedTtsCatalogItem)
                            ? '所选 TTS 状态: 运行时已准备，但当前未生效'
                            : '所选 TTS 模型状态: 已下载，但当前未生效'
                        )
                        : (
                          isCloudNoKeyCatalogItem(selectedTtsCatalogItem)
                            ? '所选 TTS 状态: 运行时未准备'
                            : '所选 TTS 模型状态: 未下载'
                        )}
                  </Alert>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Button
                      variant="contained"
                      size="small"
                      onClick={handleInstallTtsModel}
                      disabled={isDownloadingModels || isRemovingModels}
                    >
                      {isCloudNoKeyCatalogItem(selectedTtsCatalogItem)
                        ? (hasInstalledSelectedTtsCatalog ? '重新准备 TTS 运行时' : '准备 TTS 运行时')
                        : (hasInstalledSelectedTtsCatalog ? '重新下载 TTS 模型' : '下载 TTS 模型')}
                    </Button>
                    {hasInstalledSelectedTtsCatalog && (
                      <Button
                        variant="outlined"
                        color="warning"
                        size="small"
                        onClick={handleRemoveTtsModel}
                        disabled={isDownloadingModels || isRemovingModels}
                      >
                        删除 TTS 模型
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
              )}
            </VoiceSectionAccordion>

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Button
                variant="text"
                size="small"
                onClick={handleRefreshModels}
                disabled={modelsLoading || isDownloadingModels || isRemovingModels}
              >
                刷新模型状态
              </Button>
            </Stack>
          </Stack>

          {!!modelProgress && (
            <Button size="small" variant="outlined" onClick={() => onOpenDownloadCenter?.('voice-models')}>
              查看下载进度窗口
            </Button>
          )}

          {!!voiceProviderError && <Alert severity="warning">{voiceProviderError}</Alert>}
          {!!modelError && <Alert severity="warning">{modelError}</Alert>}
          {!!modelFeedback && <Alert severity="success">{modelFeedback}</Alert>}
        </VoiceSectionAccordion>
      )}

      {desktopMode && (
        <VoiceSectionAccordion title="语音延迟测试（当前生效模型）">
          <Alert severity="info">
            ASR 测试会请求麦克风并录音 3 秒，请点击后朗读你设置的提示词。
          </Alert>
          {isAsrTesting && !!getAsrTestProgressMessage(asrTestPhase) && (
            <Alert severity="info">{getAsrTestProgressMessage(asrTestPhase)}</Alert>
          )}
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
            {getAsrTestStatusText(isAsrTesting ? asrTestPhase : 'idle')}
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
              {`TTS 首包: ${formatMs(ttsTestResult.firstChunkLatencyMs)}；总耗时: ${formatMs(ttsTestResult.latencyMs)}；chunks: ${ttsTestResult.chunkCount || 0}；音频大小: ${formatBytes(ttsTestResult.totalBytes)}；codec: ${ttsTestResult.codec || 'unknown'}。`}
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
        </VoiceSectionAccordion>
      )}
    </Stack>
  );
}
