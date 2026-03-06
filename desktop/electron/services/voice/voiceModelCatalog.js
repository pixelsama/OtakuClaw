const { getDefaultPythonVersion, getPythonRuntimePackages } = require('../python/pythonRuntimeCatalog');

const DEFAULT_PYTHON_VERSION = getDefaultPythonVersion();
const DEFAULT_PYTHON_PACKAGES = getPythonRuntimePackages(DEFAULT_PYTHON_VERSION);

const BUILT_IN_VOICE_MODEL_CATALOG = [
  {
    id: 'builtin-asr-zh-int8-zipformer-v1',
    name: '中文 ASR（Sherpa Zipformer）',
    description: 'sherpa-onnx streaming zipformer-ctc-zh-int8-2025-06-30（稳定优先）',
    hasAsr: true,
    hasTts: false,
    asr: {
      archiveUrl:
        'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30.tar.bz2',
      extractedDir: 'sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30',
      modelRelativePath: 'model.int8.onnx',
      tokensRelativePath: 'tokens.txt',
      modelKind: 'zipformer2ctc',
      executionProvider: 'auto',
    },
  },
  {
    id: 'builtin-asr-qwen3-0.6b-4bit-v1',
    name: 'Qwen3-ASR-0.6B-4bit（MLX）',
    description:
      '共享 Python 3.12 + 隔离 env + mlx-audio + mlx-community/Qwen3-ASR-0.6B-4bit（Apple Silicon 本地 ASR）',
    hasAsr: true,
    hasTts: false,
    runtime: {
      kind: 'python',
      pythonVersion: DEFAULT_PYTHON_VERSION,
      packages: DEFAULT_PYTHON_PACKAGES,
      pythonEnvProfile: 'asr-qwen3-mlx',
      pipPackages: [
        'mlx-audio>=0.3.1',
        'huggingface_hub[cli]>=0.31.0',
        'numpy>=1.26.0',
        'soundfile>=0.12.1',
      ],
      asrModelId: 'mlx-community/Qwen3-ASR-0.6B-4bit',
      asrLanguage: 'Chinese',
      modelSource: 'huggingface',
      device: 'auto',
    },
  },
  {
    id: 'builtin-tts-qwen3-0.6b-8bit-v1',
    name: 'Qwen3-TTS-0.6B-8bit（MLX）',
    description:
      '共享 Python 3.12 + 隔离 env + mlx-audio + mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit（Apple Silicon 本地 TTS）',
    hasAsr: false,
    hasTts: true,
    runtime: {
      kind: 'python',
      pythonVersion: DEFAULT_PYTHON_VERSION,
      packages: DEFAULT_PYTHON_PACKAGES,
      pythonEnvProfile: 'tts-qwen3-mlx',
      pipPackages: [
        'mlx-audio>=0.3.1',
        'huggingface_hub[cli]>=0.31.0',
        'numpy>=1.26.0',
        'soundfile>=0.12.1',
      ],
      ttsEngine: 'qwen3-mlx',
      ttsModelId: 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit',
      ttsMode: 'custom_voice',
      ttsSpeaker: 'vivian',
      ttsLanguage: 'Chinese',
      modelSource: 'huggingface',
      device: 'auto',
    },
  },
  {
    id: 'builtin-tts-edge-v1',
    name: 'Edge TTS（在线自然女声）',
    description:
      '共享 Python 3.12 + 隔离 env + edge-tts（zh-CN-XiaoxiaoNeural，自然女声云端 TTS）',
    hasAsr: false,
    hasTts: true,
    runtime: {
      kind: 'python',
      pythonVersion: DEFAULT_PYTHON_VERSION,
      packages: DEFAULT_PYTHON_PACKAGES,
      pythonEnvProfile: 'tts-edge',
      pipPackages: [
        'edge-tts>=7.2.7',
        'numpy>=1.26.0',
        'soundfile>=0.12.1',
      ],
      ttsEngine: 'edge',
      ttsVoice: 'zh-CN-XiaoxiaoNeural',
      ttsRate: '+0%',
      ttsPitch: '+0Hz',
      ttsVolume: '+0%',
      ttsLanguage: 'Chinese',
      modelSource: 'auto',
      device: 'auto',
    },
  },
];

function getBuiltInVoiceModelCatalog() {
  return BUILT_IN_VOICE_MODEL_CATALOG.map((item) => ({
    ...item,
    asr: item.asr ? { ...item.asr } : null,
    tts: item.tts ? { ...item.tts } : null,
    runtime: item.runtime
      ? {
          ...item.runtime,
          packages: item.runtime.packages ? { ...item.runtime.packages } : {},
          pipPackages: Array.isArray(item.runtime.pipPackages)
            ? [...item.runtime.pipPackages]
            : [],
        }
      : null,
  }));
}

module.exports = {
  getBuiltInVoiceModelCatalog,
};
