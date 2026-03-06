const PYTHON_RUNTIME_PACKAGES = {
  'darwin-arm64': {
    archiveUrl:
      'https://github.com/astral-sh/python-build-standalone/releases/download/20260303/cpython-3.11.15%2B20260303-aarch64-apple-darwin-install_only_stripped.tar.gz',
  },
  'darwin-x64': {
    archiveUrl:
      'https://github.com/astral-sh/python-build-standalone/releases/download/20260303/cpython-3.11.15%2B20260303-x86_64-apple-darwin-install_only_stripped.tar.gz',
  },
  'linux-x64': {
    archiveUrl:
      'https://github.com/astral-sh/python-build-standalone/releases/download/20260303/cpython-3.11.15%2B20260303-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz',
  },
  'win32-x64': {
    archiveUrl:
      'https://github.com/astral-sh/python-build-standalone/releases/download/20260303/cpython-3.11.15%2B20260303-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
  },
};

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
      '内置 Python 3.11 + mlx-audio + mlx-community/Qwen3-ASR-0.6B-4bit（Apple Silicon 本地 ASR）',
    hasAsr: true,
    hasTts: false,
    runtime: {
      kind: 'python',
      pythonVersion: '3.11.15',
      packages: PYTHON_RUNTIME_PACKAGES,
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
    id: 'builtin-tts-kokoro-v1',
    name: 'Kokoro TTS（内置推荐）',
    description: 'kokoro-multi-lang-v1_0（稳定优先默认 CPU）',
    hasAsr: false,
    hasTts: true,
    tts: {
      archiveUrl:
        'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2',
      extractedDir: 'kokoro-multi-lang-v1_0',
      modelRelativePath: 'model.onnx',
      voicesRelativePath: 'voices.bin',
      tokensRelativePath: 'tokens.txt',
      dataDirRelativePath: 'espeak-ng-data',
      lexiconRelativePath: 'lexicon-zh.txt',
      lang: 'zh',
      sid: '46',
      modelKind: 'kokoro',
      executionProvider: 'cpu',
    },
  },
  {
    id: 'builtin-tts-qwen3tts-v1',
    name: 'Qwen3-TTS（Python 实验）',
    description:
      '内置 Python 3.11 + qwen-tts + Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice（实验）',
    hasAsr: false,
    hasTts: true,
    runtime: {
      kind: 'python',
      pythonVersion: '3.11.15',
      packages: PYTHON_RUNTIME_PACKAGES,
      pipPackages: [
        'qwen-tts>=0.1.1',
        'huggingface_hub[cli]>=0.31.0',
        'numpy>=1.26.0',
        'soundfile>=0.12.1',
      ],
      ttsModelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
      ttsTokenizerModelId: 'Qwen/Qwen3-TTS-Tokenizer-12Hz',
      ttsMode: 'custom_voice',
      ttsSpeaker: 'Vivian',
      ttsLanguage: 'Chinese',
      modelSource: 'huggingface',
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
