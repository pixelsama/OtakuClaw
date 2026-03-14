export const DASHSCOPE_ASR_MODEL_OPTIONS = [
  { value: '', label: '默认（qwen3-asr-flash-realtime）' },
  { value: 'qwen3-asr-flash-realtime', label: 'Qwen3 ASR Flash Realtime' },
  { value: 'qwen3-asr-realtime', label: 'Qwen3 ASR Realtime' },
  { value: 'qwen3-asr-realtime-beta', label: 'Qwen3 ASR Realtime Beta' },
];

export const DASHSCOPE_ASR_LANGUAGE_OPTIONS = [
  { value: 'auto', label: '自动识别（auto）' },
  { value: 'zh', label: '中文（zh）' },
  { value: 'en', label: '英语（en）' },
  { value: 'yue', label: '粤语（yue）' },
  { value: 'ja', label: '日语（ja）' },
  { value: 'ko', label: '韩语（ko）' },
  { value: 'de', label: '德语（de）' },
  { value: 'fr', label: '法语（fr）' },
  { value: 'ru', label: '俄语（ru）' },
  { value: 'es', label: '西班牙语（es）' },
];

export const DASHSCOPE_TTS_MODEL_OPTIONS = [
  { value: '', label: '默认（qwen-tts-realtime-latest）' },
  { value: 'qwen3-tts-flash-realtime', label: 'Qwen3 TTS Flash Realtime（Qwen Realtime）' },
  { value: 'qwen3-tts-instruct-flash-realtime', label: 'Qwen3 TTS Instruct Flash Realtime（Qwen Realtime）' },
  { value: 'qwen-tts-realtime-latest', label: 'Qwen TTS Realtime Latest（Qwen Realtime）' },
  { value: 'qwen-tts-realtime', label: 'Qwen TTS Realtime（Qwen Realtime）' },
  { value: 'qwen-tts-realtime-2025-07-15', label: 'Qwen TTS Realtime 2025-07-15（Qwen Realtime）' },
  { value: 'cosyvoice-v3-plus', label: 'CosyVoice V3 Plus' },
  { value: 'cosyvoice-v3', label: 'CosyVoice V3' },
  { value: 'cosyvoice-v3-flash', label: 'CosyVoice V3 Flash' },
  { value: 'cosyvoice-v2', label: 'CosyVoice V2' },
  { value: 'cosyvoice-v1', label: 'CosyVoice V1' },
];

export const QWEN_REALTIME_TTS_VOICE_OPTIONS = [
  'Cherry',
  'Chelsie',
  'Ethan',
  'Serena',
  'Dylan',
  'Jada',
  'Sunny',
];

export const COSYVOICE_TTS_VOICE_OPTIONS = [
  'longxiaochun_v2',
  'longwan_v2',
  'longcheng_v2',
  'longhua_v2',
];

export const QWEN3_TTS_LANGUAGE_OPTIONS = [
  { value: 'Chinese', label: 'Chinese' },
  { value: 'English', label: 'English' },
  { value: 'Japanese', label: 'Japanese' },
];

export const QWEN_REALTIME_TTS_SAMPLE_RATE_OPTIONS = [8000, 16000, 24000, 48000];
export const COSYVOICE_TTS_SAMPLE_RATE_OPTIONS = [8000, 16000, 22050, 24000, 32000, 44100, 48000];
export const LEGACY_QWEN_TTS_SAMPLE_RATE_OPTIONS = [24000];

export function extendOptionsWithCustom(options = [], currentValue = '') {
  const normalized = typeof currentValue === 'string' ? currentValue.trim() : '';
  if (!normalized) {
    return options;
  }
  if (options.some((item) => item?.value === normalized)) {
    return options;
  }
  return [{ value: normalized, label: `${normalized}（自定义）` }, ...options];
}
