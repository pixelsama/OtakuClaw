const { createTtsProvider } = require('./providerFactory');

function createAbortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function toRequestId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    code: error?.code || '',
    message: error?.message || 'TTS worker error.',
    stage: error?.stage || 'speaking',
    retriable: Boolean(error?.retriable),
  };
}

function cloneAudioChunk(value) {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(value));
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }

  if (Array.isArray(value)) {
    return Buffer.from(value);
  }

  return Buffer.alloc(0);
}

let providerName = null;
let runtimeEnv = process.env;
let ttsProvider = null;

const requestAbortControllers = new Map();
const ackWaiters = new Map();

function sendMessage(payload) {
  if (!process.send) {
    return;
  }

  try {
    process.send(payload);
  } catch {
    // noop
  }
}

function getAckKey(requestId, seq) {
  return `${requestId}:${seq}`;
}

function rejectAckWaitersForRequest(requestId, error) {
  const prefix = `${requestId}:`;
  for (const [key, waiter] of ackWaiters.entries()) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    ackWaiters.delete(key);
    waiter.reject(error);
  }
}

function waitForChunkAck(requestId, seq, signal) {
  const key = getAckKey(requestId, seq);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      ackWaiters.delete(key);
      reject(createAbortError());
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    ackWaiters.set(key, {
      resolve: () => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        resolve();
      },
      reject: (error) => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        reject(error);
      },
    });
  });
}

function handleChunkAck(message = {}) {
  const requestId = toRequestId(message.requestId);
  const seq = Number.isFinite(message.seq) ? Math.floor(message.seq) : 0;
  if (!requestId || seq <= 0) {
    return;
  }

  const key = getAckKey(requestId, seq);
  const waiter = ackWaiters.get(key);
  if (!waiter) {
    return;
  }

  ackWaiters.delete(key);
  waiter.resolve();
}

function abortRequest(requestId) {
  const controller = requestAbortControllers.get(requestId);
  if (controller) {
    controller.abort();
  }

  rejectAckWaitersForRequest(requestId, createAbortError());
}

function getTtsProvider() {
  if (ttsProvider) {
    return ttsProvider;
  }

  ttsProvider = createTtsProvider({
    provider: providerName,
    env: runtimeEnv,
  });

  return ttsProvider;
}

async function handleSynthesize(message = {}) {
  const requestId = toRequestId(message.requestId);
  if (!requestId) {
    return;
  }

  const text = typeof message.text === 'string' ? message.text : '';
  const controller = new AbortController();
  requestAbortControllers.set(requestId, controller);

  let chunkSeq = 0;
  try {
    const provider = getTtsProvider();
    const result = await provider.synthesize({
      text,
      signal: controller.signal,
      onChunk: async ({ audioChunk, codec, sampleRate }) => {
        chunkSeq += 1;
        sendMessage({
          type: 'tts-chunk',
          requestId,
          seq: chunkSeq,
          chunkId: chunkSeq,
          codec: typeof codec === 'string' ? codec : '',
          sampleRate: Number.isFinite(sampleRate) ? Math.floor(sampleRate) : 0,
          audioChunk: cloneAudioChunk(audioChunk),
        });
        await waitForChunkAck(requestId, chunkSeq, controller.signal);
      },
    });

    sendMessage({
      type: 'synthesize-done',
      requestId,
      sampleRate: Number.isFinite(result?.sampleRate) ? Math.floor(result.sampleRate) : 0,
      sampleCount: Number.isFinite(result?.sampleCount) ? Math.floor(result.sampleCount) : 0,
    });
  } catch (error) {
    sendMessage({
      type: 'synthesize-error',
      requestId,
      error: serializeError(error),
    });
  } finally {
    requestAbortControllers.delete(requestId);
    rejectAckWaitersForRequest(requestId, createAbortError());
  }
}

process.on('message', (message = {}) => {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'init') {
    runtimeEnv = message.env && typeof message.env === 'object' ? message.env : process.env;
    providerName = toRequestId(message.provider) || null;
    ttsProvider = null;
    sendMessage({ type: 'ready' });
    return;
  }

  if (message.type === 'synthesize') {
    void handleSynthesize(message);
    return;
  }

  if (message.type === 'chunk-ack') {
    handleChunkAck(message);
    return;
  }

  if (message.type === 'abort') {
    const requestId = toRequestId(message.requestId);
    if (requestId) {
      abortRequest(requestId);
    }
  }
});

process.on('disconnect', () => {
  process.exit(0);
});
