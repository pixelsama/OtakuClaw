function normalizeSseNewlines(buffer) {
  return buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function parseSseChunk(buffer, onEvent) {
  let normalized = normalizeSseNewlines(buffer);
  let startIndex = 0;

  while (true) {
    const endIndex = normalized.indexOf('\n\n', startIndex);
    if (endIndex === -1) {
      break;
    }

    const rawEvent = normalized.slice(startIndex, endIndex).trim();
    startIndex = endIndex + 2;

    if (!rawEvent) {
      continue;
    }

    let eventType = 'message';
    const dataLines = [];

    for (const line of rawEvent.split(/\n/)) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    onEvent(eventType, dataLines.join('\n'));
  }

  return normalized.slice(startIndex);
}
