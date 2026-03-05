const HARD_BOUNDARY_REGEX = /[。！？!?；;\n]/;
const SOFT_BOUNDARY_REGEX = /[，、,]/;
const DEFAULT_SEGMENT_MAX_CHARS = 32;

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function trimSegmentText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function createChatSegmentEmitter({
  streamId,
  sessionId = 'default',
  maxChars = DEFAULT_SEGMENT_MAX_CHARS,
  emitReady,
} = {}) {
  const segmentMaxChars = normalizePositiveInteger(maxChars, DEFAULT_SEGMENT_MAX_CHARS);
  let segmentIndex = 0;
  let buffer = '';

  const emitSegment = (text, metadata = {}) => {
    if (typeof emitReady !== 'function') {
      return;
    }

    const normalizedText = trimSegmentText(text);
    if (!normalizedText) {
      return;
    }

    const currentIndex = segmentIndex;
    segmentIndex += 1;
    emitReady({
      sessionId,
      turnId: streamId,
      segmentId: `${streamId}:${currentIndex}`,
      index: currentIndex,
      text: normalizedText,
      final: true,
      ...metadata,
    });
  };

  const flushByHardBoundary = (metadata = {}) => {
    let boundaryIndex = -1;
    for (let i = 0; i < buffer.length; i += 1) {
      if (HARD_BOUNDARY_REGEX.test(buffer[i])) {
        boundaryIndex = i;
        break;
      }
    }

    if (boundaryIndex === -1) {
      return false;
    }

    const segmentText = buffer.slice(0, boundaryIndex + 1);
    buffer = buffer.slice(boundaryIndex + 1);
    emitSegment(segmentText, metadata);
    return true;
  };

  const flushByLength = (metadata = {}) => {
    if (buffer.length < segmentMaxChars) {
      return false;
    }

    let splitIndex = -1;
    const scanLimit = Math.min(buffer.length, segmentMaxChars);
    for (let i = 0; i < scanLimit; i += 1) {
      if (SOFT_BOUNDARY_REGEX.test(buffer[i])) {
        splitIndex = i;
      }
    }

    if (splitIndex < 0) {
      splitIndex = segmentMaxChars - 1;
    }

    const segmentText = buffer.slice(0, splitIndex + 1);
    buffer = buffer.slice(splitIndex + 1);
    emitSegment(segmentText, metadata);
    return true;
  };

  const flushReadySegments = (metadata = {}) => {
    while (true) {
      if (flushByHardBoundary(metadata)) {
        continue;
      }
      if (flushByLength(metadata)) {
        continue;
      }
      break;
    }
  };

  const ingestDelta = (chunk, metadata = {}) => {
    if (typeof chunk !== 'string' || !chunk) {
      return;
    }

    buffer += chunk;
    flushReadySegments(metadata);
  };

  const flushRemaining = (metadata = {}) => {
    flushReadySegments(metadata);
    if (!buffer.trim()) {
      buffer = '';
      return;
    }
    emitSegment(buffer, metadata);
    buffer = '';
  };

  return {
    ingestDelta,
    flushRemaining,
  };
}

module.exports = {
  createChatSegmentEmitter,
  DEFAULT_SEGMENT_MAX_CHARS,
};
