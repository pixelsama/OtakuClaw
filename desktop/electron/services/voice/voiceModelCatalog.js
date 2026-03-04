const BUILT_IN_VOICE_MODEL_CATALOG = [
  {
    id: 'builtin-zh-int8-zipformer-kokoro-v1',
    name: '中文 ASR + Kokoro TTS（内置推荐）',
    description: 'ASR: zipformer-ctc-zh-int8-2025-06-30, TTS: kokoro-multi-lang-v1_0（稳定优先默认 CPU）',
    asr: {
      archiveUrl:
        'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30.tar.bz2',
      extractedDir: 'sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30',
      modelRelativePath: 'model.int8.onnx',
      tokensRelativePath: 'tokens.txt',
      modelKind: 'zipformer2ctc',
      executionProvider: 'auto',
    },
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
      modelKind: 'kokoro',
      executionProvider: 'cpu',
    },
  },
];

function getBuiltInVoiceModelCatalog() {
  return BUILT_IN_VOICE_MODEL_CATALOG.map((item) => ({
    ...item,
    asr: item.asr ? { ...item.asr } : null,
    tts: item.tts ? { ...item.tts } : null,
  }));
}

module.exports = {
  getBuiltInVoiceModelCatalog,
};
