import { describe, it, expect } from 'vitest';
import { parseSseChunk } from '../src/services/sseClient.js';

describe('parseSseChunk', () => {
  it('parses CRLF-delimited SSE events', () => {
    const events = [];
    const buffer = 'event: text-delta\r\ndata: {"content":"你好"}\r\n\r\n';

    const remaining = parseSseChunk(buffer, (eventType, data) => {
      events.push({ eventType, data });
    });

    expect(remaining).toBe('');
    expect(events).toEqual([
      {
        eventType: 'text-delta',
        data: '{"content":"你好"}',
      },
    ]);
  });

  it('keeps partial data in buffer and parses after next chunk', () => {
    const events = [];

    const chunk1 = 'event: text-delta\r\ndata: {"content":"你';
    const left = parseSseChunk(chunk1, (eventType, data) => {
      events.push({ eventType, data });
    });

    expect(events).toEqual([]);

    const chunk2 = '好"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n';
    const remaining = parseSseChunk(left + chunk2, (eventType, data) => {
      events.push({ eventType, data });
    });

    expect(remaining).toBe('');
    expect(events).toEqual([
      { eventType: 'text-delta', data: '{"content":"你好"}' },
      { eventType: 'done', data: '{}' },
    ]);
  });
});
