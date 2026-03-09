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
const SUPPORTED_TTS_SAMPLE_RATES = new Set([8000, 16000, 24000, 48000]);

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
      const voice = sanitizeText(options.voice, DEFAULT_TTS_VOICE);
      const language = sanitizeText(options.language, DEFAULT_TTS_LANGUAGE);
      const workspace = sanitizeText(options.workspace);
      const responseFormat = sanitizeText(options.responseFormat, DEFAULT_TTS_RESPONSE_FORMAT).toLowerCase();
      const sampleRate = toPositiveInteger(options.sampleRate, DEFAULT_TTS_SAMPLE_RATE);
      const speechRate = toFiniteNumber(options.speechRate, 1);
      const instructions = sanitizeText(options.instructions);
      const optimizeInstructions = toBooleanFlag(options.optimizeInstructions, false);
      const timeoutMs = Math.max(
        10_000,
        toPositiveInteger(options.timeoutMs, DEFAULT_DASHSCOPE_TIMEOUT_MS),
      );

      if (responseFormat !== 'pcm') {
        throw createVoiceProviderError(
          'voice_tts_dashscope_response_format_unsupported',
          `DashScope realtime TTS currently supports pcm output only. Received ${responseFormat}.`,
          'speaking',
          false,
        );
      }

      if (!SUPPORTED_TTS_SAMPLE_RATES.has(sampleRate)) {
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
      const headers = buildDashScopeHeaders({
        apiKey,
        workspace,
      });
      const WebSocketCtor = getWebSocketImpl(WebSocketImpl);

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
    },
  };
}

module.exports = {
  createDashScopeTtsProvider,
};
