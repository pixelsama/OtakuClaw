const {
  DEFAULT_DASHSCOPE_TIMEOUT_MS,
  buildDashScopeHeaders,
  createAbortError,
  createEventId,
  createVoiceProviderError,
  extractDashScopeError,
  getWebSocketImpl,
  parseMessageData,
  resolveRealtimeUrl,
  safeCloseWebSocket,
  sanitizeText,
  toPositiveInteger,
} = require('../dashscope/common');

const DEFAULT_ASR_MODEL = 'qwen3-asr-flash-realtime';
const DEFAULT_ASR_SAMPLE_RATE = 16000;
const SUPPORTED_SAMPLE_RATES = new Set([8000, 16000]);

function normalizeAudioChunks(audioChunks = []) {
  if (!Array.isArray(audioChunks) || !audioChunks.length) {
    return {
      sampleRate: DEFAULT_ASR_SAMPLE_RATE,
      pcmChunks: [],
    };
  }

  let sampleRate = DEFAULT_ASR_SAMPLE_RATE;
  const pcmChunks = [];

  for (const chunk of audioChunks) {
    if (!chunk || typeof chunk !== 'object') {
      continue;
    }

    if (Number.isFinite(chunk.sampleRate) && chunk.sampleRate > 0) {
      sampleRate = Math.floor(chunk.sampleRate);
    }

    const channels = Number.isFinite(chunk.channels) ? Math.floor(chunk.channels) : 1;
    if (channels !== 1) {
      throw createVoiceProviderError(
        'voice_asr_dashscope_channels_unsupported',
        `DashScope ASR only supports mono PCM input. Received channels=${channels}.`,
        'transcribing',
        false,
      );
    }

    const sampleFormat = sanitizeText(chunk.sampleFormat, 'pcm_s16le').toLowerCase();
    if (sampleFormat !== 'pcm_s16le') {
      throw createVoiceProviderError(
        'voice_asr_dashscope_sample_format_unsupported',
        `DashScope ASR only supports pcm_s16le input. Received ${sampleFormat}.`,
        'transcribing',
        false,
      );
    }

    const pcmChunk = Buffer.isBuffer(chunk.pcmChunk)
      ? Buffer.from(chunk.pcmChunk)
      : chunk.pcmChunk instanceof Uint8Array
        ? Buffer.from(chunk.pcmChunk)
        : null;
    if (pcmChunk?.length) {
      pcmChunks.push(pcmChunk);
    }
  }

  if (!SUPPORTED_SAMPLE_RATES.has(sampleRate)) {
    throw createVoiceProviderError(
      'voice_asr_dashscope_sample_rate_unsupported',
      `DashScope ASR supports 8000Hz or 16000Hz PCM. Received ${sampleRate}Hz.`,
      'transcribing',
      false,
    );
  }

  return {
    sampleRate,
    pcmChunks,
  };
}

function createDashScopeAsrProvider({ options = {}, WebSocketImpl = null } = {}) {
  return {
    async warmup() {
      return;
    },
    async transcribe({ audioChunks = [], signal, onPartial } = {}) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const {
        sampleRate,
        pcmChunks,
      } = normalizeAudioChunks(audioChunks);

      if (!pcmChunks.length) {
        return { text: '' };
      }

      const apiKey = sanitizeText(options.apiKey);
      if (!apiKey) {
        throw createVoiceProviderError(
          'voice_asr_dashscope_api_key_missing',
          'Missing DashScope API key for ASR.',
          'transcribing',
          false,
        );
      }

      const model = sanitizeText(options.model, DEFAULT_ASR_MODEL);
      const language = sanitizeText(options.language);
      const workspace = sanitizeText(options.workspace);
      const timeoutMs = Math.max(
        10_000,
        toPositiveInteger(options.timeoutMs, DEFAULT_DASHSCOPE_TIMEOUT_MS),
      );
      const url = resolveRealtimeUrl({
        baseUrl: options.baseUrl,
        model,
      });
      const headers = buildDashScopeHeaders({
        apiKey,
        workspace,
      });
      const WebSocketCtor = getWebSocketImpl(WebSocketImpl);

      return new Promise((resolve, reject) => {
        const requestId = createEventId('dashscope-asr');
        let settled = false;
        let sessionReady = false;
        let latestPartial = '';
        let finalText = '';
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

        const resolveOnce = (payload) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          safeCloseWebSocket(socket);
          resolve(payload);
        };

        const sendJson = (payload) => {
          if (!socket || typeof socket.send !== 'function') {
            throw createVoiceProviderError(
              'voice_asr_dashscope_socket_unavailable',
              'DashScope ASR websocket is unavailable.',
              'transcribing',
              true,
            );
          }

          socket.send(JSON.stringify(payload));
        };

        const flushAudio = () => {
          sendJson({
            type: 'input_audio_buffer.append',
            event_id: `${requestId}-append-1`,
            audio: Buffer.concat(pcmChunks).toString('base64'),
          });
          sendJson({
            type: 'input_audio_buffer.commit',
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
              'voice_asr_dashscope_timeout',
              `DashScope ASR timed out after ${timeoutMs}ms.`,
              'transcribing',
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
              'voice_asr_dashscope_connect_failed',
              `Failed to create DashScope ASR websocket: ${error?.message || 'unknown error'}`,
              'transcribing',
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
                modalities: ['text'],
                input_audio_format: 'pcm',
                sample_rate: sampleRate,
                ...(language ? { input_audio_transcription: { language } } : {}),
                turn_detection: null,
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
                fallbackCode: 'voice_asr_dashscope_failed',
                fallbackMessage: 'DashScope ASR request failed.',
                stage: 'transcribing',
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
              flushAudio();
            } catch (error) {
              rejectOnce(error);
            }
            return;
          }

          if (message.type === 'conversation.item.input_audio_transcription.delta') {
            const delta = sanitizeText(message.delta);
            if (!delta) {
              return;
            }

            latestPartial += delta;
            const preview = latestPartial.trim();
            if (preview && typeof onPartial === 'function') {
              onPartial(preview);
            }
            return;
          }

          if (message.type === 'conversation.item.input_audio_transcription.completed') {
            finalText = sanitizeText(message.transcript || message.text, finalText || latestPartial);
            return;
          }

          if (message.type === 'session.finished') {
            resolveOnce({
              text: sanitizeText(finalText || latestPartial),
            });
          }
        });

        socket.on('error', (error) => {
          rejectOnce(
            createVoiceProviderError(
              'voice_asr_dashscope_socket_error',
              `DashScope ASR websocket error: ${error?.message || 'unknown error'}`,
              'transcribing',
              true,
            ),
          );
        });

        socket.on('close', () => {
          if (settled) {
            return;
          }

          const resolvedText = sanitizeText(finalText || latestPartial);
          if (resolvedText) {
            resolveOnce({ text: resolvedText });
            return;
          }

          rejectOnce(
            createVoiceProviderError(
              'voice_asr_dashscope_socket_closed',
              'DashScope ASR websocket closed before transcription completed.',
              'transcribing',
              true,
            ),
          );
        });
      });
    },
  };
}

module.exports = {
  createDashScopeAsrProvider,
};
