const {
  DEFAULT_DASHSCOPE_TIMEOUT_MS,
  buildDashScopeHeaders,
  createAbortError,
  createEventId,
  createVoiceProviderError,
  decodeBase64Payload,
  extractDashScopeError,
  getWebSocketImpl,
  parseMessageData,
  resolveInferenceUrl,
  resolveRealtimeUrl,
  safeCloseWebSocket,
  sanitizeText,
  toBooleanFlag,
  toFiniteNumber,
  toPositiveInteger,
} = require('../dashscope/common');

const DEFAULT_TTS_MODEL = 'qwen-tts-realtime-latest';
const DEFAULT_TTS_VOICE = 'Cherry';
const DEFAULT_TTS_LANGUAGE = 'Chinese';
const DEFAULT_TTS_SAMPLE_RATE = 24000;
const DEFAULT_TTS_RESPONSE_FORMAT = 'pcm';
const DEFAULT_COSYVOICE_SAMPLE_RATE = 22050;
const DEFAULT_COSYVOICE_VOLUME = 50;
const DEFAULT_COSYVOICE_PITCH = 1;
const DEFAULT_COSYVOICE_VOICE = 'longxiaochun_v2';
const SUPPORTED_QWEN_SAMPLE_RATES = new Set([8000, 16000, 24000, 48000]);
const SUPPORTED_COSYVOICE_SAMPLE_RATES = new Set([8000, 16000, 22050, 24000, 32000, 44100, 48000]);

function resolveDashScopeTtsModelProfile(model) {
  const normalizedModel = sanitizeText(model, DEFAULT_TTS_MODEL).toLowerCase();
  if (normalizedModel.startsWith('cosyvoice-')) {
    return {
      family: 'cosyvoice',
      model: normalizedModel,
      defaultSampleRate: DEFAULT_COSYVOICE_SAMPLE_RATE,
      defaultVoice: DEFAULT_COSYVOICE_VOICE,
      defaultResponseFormat: 'pcm',
      defaultSpeechRate: 1,
    };
  }

  return {
    family: 'qwen-realtime',
    model: normalizedModel,
    defaultSampleRate: DEFAULT_TTS_SAMPLE_RATE,
    defaultVoice: DEFAULT_TTS_VOICE,
    defaultResponseFormat: DEFAULT_TTS_RESPONSE_FORMAT,
    defaultSpeechRate: 1,
  };
}

function extractCosyVoiceAudioChunk(message) {
  const directAudio = message?.payload?.output?.audio ?? message?.output?.audio ?? message?.audio;
  if (!directAudio) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(directAudio)) {
    return Buffer.from(directAudio);
  }

  if (directAudio instanceof Uint8Array) {
    return Buffer.from(directAudio);
  }

  if (typeof directAudio === 'string') {
    return decodeBase64Payload(directAudio);
  }

  if (typeof directAudio === 'object') {
    const candidate =
      sanitizeText(directAudio.data)
      || sanitizeText(directAudio.audio)
      || sanitizeText(directAudio.base64)
      || sanitizeText(directAudio.content);
    if (candidate) {
      return decodeBase64Payload(candidate);
    }
  }

  return Buffer.alloc(0);
}

function createCosyVoiceError(message, fallbackCode = 'voice_tts_dashscope_cosyvoice_failed') {
  const header = message?.header && typeof message.header === 'object' ? message.header : {};
  const output =
    message?.payload?.output && typeof message.payload.output === 'object'
      ? message.payload.output
      : (message?.output && typeof message.output === 'object' ? message.output : {});
  const code = sanitizeText(
    output.code || header.error_code || message?.code,
    fallbackCode,
  );
  const detail = sanitizeText(
    output.message || output.error || header.error_message || message?.message,
    'DashScope CosyVoice request failed.',
  );
  return createVoiceProviderError(code, detail, 'speaking', true);
}

function createQwenRealtimeTts({
  normalizedText,
  signal,
  onChunk,
  options,
  model,
  voice,
  language,
  responseFormat,
  sampleRate,
  speechRate,
  timeoutMs,
  instructions,
  optimizeInstructions,
  headers,
  WebSocketCtor,
}) {
  if (responseFormat !== 'pcm') {
    throw createVoiceProviderError(
      'voice_tts_dashscope_response_format_unsupported',
      `DashScope realtime TTS currently supports pcm output only. Received ${responseFormat}.`,
      'speaking',
      false,
    );
  }

  if (!SUPPORTED_QWEN_SAMPLE_RATES.has(sampleRate)) {
    throw createVoiceProviderError(
      'voice_tts_dashscope_sample_rate_unsupported',
      `DashScope realtime TTS sample rate must be one of 8000, 16000, 24000 or 48000. Received ${sampleRate}.`,
      'speaking',
      false,
    );
  }

  const url = resolveRealtimeUrl({
    baseUrl: options.baseUrl,
    model,
  });

  return new Promise((resolve, reject) => {
    const requestId = createEventId('dashscope-tts');
    let settled = false;
    let sessionReady = false;
    let totalBytes = 0;
    let chunkChain = Promise.resolve();
    let timeoutId = null;
    let socket = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      if (socket) {
        socket.removeAllListeners?.();
      }
    };

    const rejectOnce = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      safeCloseWebSocket(socket, { terminate: error?.name === 'AbortError' });
      reject(error);
    };

    const resolveOnce = async () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      safeCloseWebSocket(socket);

      try {
        await chunkChain;
      } catch (error) {
        reject(error);
        return;
      }

      resolve({
        sampleRate,
        sampleCount: Math.floor(totalBytes / 2),
      });
    };

    const sendJson = (payload) => {
      if (!socket || typeof socket.send !== 'function') {
        throw createVoiceProviderError(
          'voice_tts_dashscope_socket_unavailable',
          'DashScope TTS websocket is unavailable.',
          'speaking',
          true,
        );
      }

      socket.send(JSON.stringify(payload));
    };

    const startSynthesis = () => {
      sendJson({
        type: 'input_text_buffer.append',
        event_id: `${requestId}-append`,
        text: normalizedText,
      });
      sendJson({
        type: 'input_text_buffer.commit',
        event_id: `${requestId}-commit`,
      });
      sendJson({
        type: 'session.finish',
        event_id: `${requestId}-finish`,
      });
    };

    const onAbort = () => {
      rejectOnce(createAbortError());
    };

    timeoutId = setTimeout(() => {
      rejectOnce(
        createVoiceProviderError(
          'voice_tts_dashscope_timeout',
          `DashScope TTS timed out after ${timeoutMs}ms.`,
          'speaking',
          true,
        ),
      );
    }, timeoutMs);
    timeoutId.unref?.();

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      socket = new WebSocketCtor(url, {
        headers,
        handshakeTimeout: timeoutMs,
      });
    } catch (error) {
      rejectOnce(
        createVoiceProviderError(
          'voice_tts_dashscope_connect_failed',
          `Failed to create DashScope TTS websocket: ${error?.message || 'unknown error'}`,
          'speaking',
          true,
        ),
      );
      return;
    }

    socket.on('open', () => {
      try {
        sendJson({
          type: 'session.update',
          event_id: `${requestId}-session`,
          session: {
            voice,
            mode: 'server_commit',
            language_type: language,
            response_format: responseFormat,
            sample_rate: sampleRate,
            ...(Number.isFinite(speechRate) ? { speech_rate: speechRate } : {}),
            ...(instructions ? { instructions } : {}),
            ...(instructions ? { optimize_instructions: optimizeInstructions } : {}),
          },
        });
      } catch (error) {
        rejectOnce(error);
      }
    });

    socket.on('message', (raw, isBinary) => {
      const message = parseMessageData(raw, isBinary);
      if (!message || typeof message.type !== 'string') {
        return;
      }

      if (message.type === 'error') {
        rejectOnce(
          extractDashScopeError(message, {
            fallbackCode: 'voice_tts_dashscope_failed',
            fallbackMessage: 'DashScope TTS request failed.',
            stage: 'speaking',
          }),
        );
        return;
      }

      if (message.type === 'session.updated') {
        if (sessionReady) {
          return;
        }
        sessionReady = true;
        try {
          startSynthesis();
        } catch (error) {
          rejectOnce(error);
        }
        return;
      }

      if (message.type === 'response.audio.delta') {
        const pcmChunk = decodeBase64Payload(message.delta);
        if (!pcmChunk.length) {
          return;
        }

        totalBytes += pcmChunk.length;
        if (typeof onChunk === 'function') {
          chunkChain = chunkChain.then(() =>
            onChunk({
              audioChunk: pcmChunk,
              sampleRate,
              codec: 'pcm_s16le',
            }));
          chunkChain.catch((error) => {
            rejectOnce(error);
          });
        }
        return;
      }

      if (message.type === 'session.finished') {
        void resolveOnce();
      }
    });

    socket.on('error', (error) => {
      rejectOnce(
        createVoiceProviderError(
          'voice_tts_dashscope_socket_error',
          `DashScope TTS websocket error: ${error?.message || 'unknown error'}`,
          'speaking',
          true,
        ),
      );
    });

    socket.on('close', () => {
      if (settled) {
        return;
      }

      if (totalBytes > 0) {
        void resolveOnce();
        return;
      }

      rejectOnce(
        createVoiceProviderError(
          'voice_tts_dashscope_socket_closed',
          'DashScope TTS websocket closed before audio was returned.',
          'speaking',
          true,
        ),
      );
    });
  });
}

function createCosyVoiceTts({
  normalizedText,
  signal,
  onChunk,
  options,
  model,
  voice,
  responseFormat,
  sampleRate,
  speechRate,
  timeoutMs,
  headers,
  WebSocketCtor,
}) {
  if (responseFormat !== 'pcm') {
    throw createVoiceProviderError(
      'voice_tts_dashscope_cosyvoice_response_format_unsupported',
      `DashScope CosyVoice integration currently supports pcm output only. Received ${responseFormat}.`,
      'speaking',
      false,
    );
  }

  if (!SUPPORTED_COSYVOICE_SAMPLE_RATES.has(sampleRate)) {
    throw createVoiceProviderError(
      'voice_tts_dashscope_cosyvoice_sample_rate_unsupported',
      `DashScope CosyVoice sample rate must be one of 8000, 16000, 22050, 24000, 32000, 44100 or 48000. Received ${sampleRate}.`,
      'speaking',
      false,
    );
  }

  const url = resolveInferenceUrl({
    baseUrl: options.baseUrl,
    model,
  });
  const volume = toFiniteNumber(options.volume, DEFAULT_COSYVOICE_VOLUME);
  const pitch = toFiniteNumber(options.pitch, DEFAULT_COSYVOICE_PITCH);

  return new Promise((resolve, reject) => {
    const requestId = createEventId('dashscope-cosyvoice-tts');
    let settled = false;
    let taskStarted = false;
    let totalBytes = 0;
    let chunkChain = Promise.resolve();
    let timeoutId = null;
    let socket = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      if (socket) {
        socket.removeAllListeners?.();
      }
    };

    const rejectOnce = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      safeCloseWebSocket(socket, { terminate: error?.name === 'AbortError' });
      reject(error);
    };

    const resolveOnce = async () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      safeCloseWebSocket(socket);

      try {
        await chunkChain;
      } catch (error) {
        reject(error);
        return;
      }

      resolve({
        sampleRate,
        sampleCount: Math.floor(totalBytes / 2),
      });
    };

    const emitAudioChunk = (audioChunk) => {
      if (!audioChunk.length) {
        return;
      }
      totalBytes += audioChunk.length;
      if (typeof onChunk === 'function') {
        chunkChain = chunkChain.then(() =>
          onChunk({
            audioChunk,
            sampleRate,
            codec: 'pcm_s16le',
          }));
        chunkChain.catch((error) => {
          rejectOnce(error);
        });
      }
    };

    const sendJson = (payload) => {
      if (!socket || typeof socket.send !== 'function') {
        throw createVoiceProviderError(
          'voice_tts_dashscope_socket_unavailable',
          'DashScope CosyVoice websocket is unavailable.',
          'speaking',
          true,
        );
      }
      socket.send(JSON.stringify(payload));
    };

    const sendRunTask = () => {
      sendJson({
        header: {
          action: 'run-task',
          task_id: requestId,
          streaming: 'duplex',
        },
        payload: {
          task_group: 'audio',
          task: 'tts',
          function: 'SpeechSynthesizer',
          model,
          parameters: {
            text_type: 'PlainText',
            voice,
            format: responseFormat,
            sample_rate: sampleRate,
            volume,
            rate: speechRate,
            pitch,
          },
          input: {},
        },
      });
    };

    const sendTextAndFinish = () => {
      sendJson({
        header: {
          action: 'continue-task',
          task_id: requestId,
          streaming: 'duplex',
        },
        payload: {
          input: {
            text: normalizedText,
          },
        },
      });
      sendJson({
        header: {
          action: 'finish-task',
          task_id: requestId,
          streaming: 'duplex',
        },
        payload: {},
      });
    };

    const onAbort = () => {
      rejectOnce(createAbortError());
    };

    timeoutId = setTimeout(() => {
      rejectOnce(
        createVoiceProviderError(
          'voice_tts_dashscope_timeout',
          `DashScope CosyVoice TTS timed out after ${timeoutMs}ms.`,
          'speaking',
          true,
        ),
      );
    }, timeoutMs);
    timeoutId.unref?.();

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      socket = new WebSocketCtor(url, {
        headers,
        handshakeTimeout: timeoutMs,
      });
    } catch (error) {
      rejectOnce(
        createVoiceProviderError(
          'voice_tts_dashscope_connect_failed',
          `Failed to create DashScope CosyVoice websocket: ${error?.message || 'unknown error'}`,
          'speaking',
          true,
        ),
      );
      return;
    }

    socket.on('open', () => {
      try {
        sendRunTask();
      } catch (error) {
        rejectOnce(error);
      }
    });

    socket.on('message', (raw, isBinary) => {
      if (isBinary) {
        const audioChunk = Buffer.isBuffer(raw) ? Buffer.from(raw) : Buffer.from(raw || []);
        emitAudioChunk(audioChunk);
        return;
      }

      const message = parseMessageData(raw, false);
      if (!message || typeof message !== 'object') {
        return;
      }

      const eventName = sanitizeText(message?.header?.event || message?.type).toLowerCase();
      const taskStatus = sanitizeText(message?.payload?.output?.task_status).toUpperCase();

      if (eventName === 'error' || eventName === 'task-failed' || taskStatus === 'FAILED') {
        rejectOnce(createCosyVoiceError(message));
        return;
      }

      const inlineAudio = extractCosyVoiceAudioChunk(message);
      if (inlineAudio.length) {
        emitAudioChunk(inlineAudio);
      }

      if (eventName === 'task-started') {
        if (taskStarted) {
          return;
        }
        taskStarted = true;
        try {
          sendTextAndFinish();
        } catch (error) {
          rejectOnce(error);
        }
        return;
      }

      if (eventName === 'task-finished' || taskStatus === 'SUCCEEDED') {
        void resolveOnce();
      }
    });

    socket.on('error', (error) => {
      rejectOnce(
        createVoiceProviderError(
          'voice_tts_dashscope_socket_error',
          `DashScope CosyVoice websocket error: ${error?.message || 'unknown error'}`,
          'speaking',
          true,
        ),
      );
    });

    socket.on('close', () => {
      if (settled) {
        return;
      }

      if (totalBytes > 0) {
        void resolveOnce();
        return;
      }

      rejectOnce(
        createVoiceProviderError(
          'voice_tts_dashscope_socket_closed',
          'DashScope CosyVoice websocket closed before audio was returned.',
          'speaking',
          true,
        ),
      );
    });
  });
}

function createDashScopeTtsProvider({ options = {}, WebSocketImpl = null } = {}) {
  return {
    async warmup() {
      return;
    },
    async synthesize({ text = '', signal, onChunk } = {}) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const normalizedText = sanitizeText(text);
      if (!normalizedText) {
        return {
          sampleRate: DEFAULT_TTS_SAMPLE_RATE,
          sampleCount: 0,
        };
      }

      const apiKey = sanitizeText(options.apiKey);
      if (!apiKey) {
        throw createVoiceProviderError(
          'voice_tts_dashscope_api_key_missing',
          'Missing DashScope API key for TTS.',
          'speaking',
          false,
        );
      }

      const model = sanitizeText(options.model, DEFAULT_TTS_MODEL);
      const profile = resolveDashScopeTtsModelProfile(model);
      const voice = sanitizeText(options.voice, profile.defaultVoice);
      const language = sanitizeText(options.language, DEFAULT_TTS_LANGUAGE);
      const workspace = sanitizeText(options.workspace);
      const responseFormat = sanitizeText(options.responseFormat, profile.defaultResponseFormat).toLowerCase();
      const sampleRate = toPositiveInteger(options.sampleRate, profile.defaultSampleRate);
      const speechRate = toFiniteNumber(options.speechRate, profile.defaultSpeechRate);
      const instructions = sanitizeText(options.instructions);
      const optimizeInstructions = toBooleanFlag(options.optimizeInstructions, false);
      const timeoutMs = Math.max(
        10_000,
        toPositiveInteger(options.timeoutMs, DEFAULT_DASHSCOPE_TIMEOUT_MS),
      );

      const headers = buildDashScopeHeaders({
        apiKey,
        workspace,
      });
      const WebSocketCtor = getWebSocketImpl(WebSocketImpl);

      if (profile.family === 'cosyvoice') {
        return createCosyVoiceTts({
          normalizedText,
          signal,
          onChunk,
          options,
          model,
          voice,
          responseFormat,
          sampleRate,
          speechRate,
          timeoutMs,
          headers,
          WebSocketCtor,
        });
      }

      return createQwenRealtimeTts({
        normalizedText,
        signal,
        onChunk,
        options,
        model,
        voice,
        language,
        responseFormat,
        sampleRate,
        speechRate,
        timeoutMs,
        instructions,
        optimizeInstructions,
        headers,
        WebSocketCtor,
      });
    },
  };
}

module.exports = {
  createDashScopeTtsProvider,
  resolveDashScopeTtsModelProfile,
};
