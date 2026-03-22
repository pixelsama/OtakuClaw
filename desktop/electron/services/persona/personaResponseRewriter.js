const { normalizeText, truncateText } = require('./shortTermMemoryStore');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fallback to JSON cloning below.
    }
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeReplyInput(input) {
  if (typeof input === 'string') {
    return {
      reply: normalizeText(input),
      changed: false,
      reason: 'normalized_text',
      metadata: {},
    };
  }

  if (isObject(input)) {
    const reply = normalizeText(
      input.reply || input.text || input.content || input.message || '',
    );
    return {
      reply,
      changed: false,
      reason: normalizeText(input.reason || ''),
      metadata: isObject(input.metadata) ? cloneValue(input.metadata) : {},
    };
  }

  return {
    reply: '',
    changed: false,
    reason: '',
    metadata: {},
  };
}

function maybeAddSoftEnding(reply) {
  if (!reply) {
    return reply;
  }

  if (/[。！？!?…]$/.test(reply)) {
    return reply;
  }

  if (reply.length <= 18) {
    return `${reply}。`;
  }

  return reply;
}

function rewritePersonaResponse(input, context = {}) {
  const source = normalizeReplyInput(input);
  let reply = source.reply;
  const options = isObject(context) ? context : {};
  const prefix = normalizeText(options.prefix || '');
  const suffix = normalizeText(options.suffix || '');
  const maxChars = Math.max(0, Number.parseInt(options.maxChars, 10) || 0);
  const soften = options.soften !== false && !suffix;

  if (prefix) {
    reply = reply ? `${prefix}${reply}` : prefix;
  }

  if (soften) {
    reply = maybeAddSoftEnding(reply);
  }

  if (suffix) {
    reply = reply ? `${reply}${suffix}` : suffix;
  }

  if (maxChars > 0) {
    reply = truncateText(reply, maxChars);
  }

  const changed = reply !== source.reply;
  return {
    reply,
    changed,
    reason: changed ? 'rewritten' : source.reason || 'noop',
    originalReply: source.reply,
    metadata: {
      ...source.metadata,
      rewrittenAt: new Date().toISOString(),
    },
  };
}

function createPersonaResponseRewriter(options = {}) {
  return {
    rewrite(input, context) {
      return rewritePersonaResponse(input, {
        ...options,
        ...context,
      });
    },
  };
}

module.exports = {
  createPersonaResponseRewriter,
  normalizeReplyInput,
  rewritePersonaResponse,
};
