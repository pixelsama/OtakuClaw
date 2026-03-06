const BASE_DURATION_MS = 520;
const UNIT_DURATION_MS = 165;
const MIN_DURATION_MS = 900;
const MAX_DURATION_MS = 4200;

const CHINESE_CHAR_WEIGHT = 1;
const LATIN_WORD_WEIGHT = 0.55;
const NUMBER_TOKEN_WEIGHT = 0.5;
const EMOJI_WEIGHT = 0.8;
const SYMBOL_WEIGHT = 0.6;

const COMMA_PAUSE_MS = 140;
const COLON_PAUSE_MS = 180;
const LINE_BREAK_PAUSE_MS = 220;
const HARD_STOP_PAUSE_MS = 260;
const ELLIPSIS_PAUSE_MS = 360;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function countMatches(pattern, input) {
  const matches = input.match(pattern);
  return matches ? matches.length : 0;
}

export function estimateSubtitleUnits(text = '') {
  const source = typeof text === 'string' ? text.trim() : '';
  if (!source) {
    return 0;
  }

  let remaining = source;
  let units = 0;

  const hanMatches = remaining.match(/[\u3400-\u9FFF]/g);
  if (hanMatches) {
    units += hanMatches.length * CHINESE_CHAR_WEIGHT;
    remaining = remaining.replace(/[\u3400-\u9FFF]/g, ' ');
  }

  const latinWords = remaining.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g);
  if (latinWords) {
    units += latinWords.length * LATIN_WORD_WEIGHT;
    remaining = remaining.replace(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g, ' ');
  }

  const numberTokens = remaining.match(/\d+(?:[.:/-]\d+)*/g);
  if (numberTokens) {
    units += numberTokens.length * NUMBER_TOKEN_WEIGHT;
    remaining = remaining.replace(/\d+(?:[.:/-]\d+)*/g, ' ');
  }

  try {
    const emojiMatches = remaining.match(/\p{Extended_Pictographic}/gu);
    if (emojiMatches) {
      units += emojiMatches.length * EMOJI_WEIGHT;
      remaining = remaining.replace(/\p{Extended_Pictographic}/gu, ' ');
    }
  } catch {
    // Unicode property escapes are expected in modern runtimes, but keep a safe fallback.
  }

  const symbolMatches = remaining.match(/[^\s.,!?;:，。！？；：、…]/g);
  if (symbolMatches) {
    units += symbolMatches.length * SYMBOL_WEIGHT;
  }

  return units;
}

export function estimateSubtitlePauseMs(text = '') {
  const source = typeof text === 'string' ? text : '';
  if (!source) {
    return 0;
  }

  let remaining = source;
  let pauseMs = 0;

  const ellipsisCount = countMatches(/(?:\.\.\.|…{1,2})/g, remaining);
  if (ellipsisCount > 0) {
    pauseMs += ellipsisCount * ELLIPSIS_PAUSE_MS;
    remaining = remaining.replace(/(?:\.\.\.|…{1,2})/g, ' ');
  }

  const lineBreakCount = countMatches(/\n/g, remaining);
  pauseMs += lineBreakCount * LINE_BREAK_PAUSE_MS;
  remaining = remaining.replace(/\n/g, ' ');

  pauseMs += countMatches(/[：:]/g, remaining) * COLON_PAUSE_MS;
  pauseMs += countMatches(/[，、,]/g, remaining) * COMMA_PAUSE_MS;
  pauseMs += countMatches(/[。！？!?；;]/g, remaining) * HARD_STOP_PAUSE_MS;

  return pauseMs;
}

export function computeSyntheticSubtitleDurationMs(text = '') {
  const units = estimateSubtitleUnits(text);
  const pauseMs = estimateSubtitlePauseMs(text);
  const durationMs = BASE_DURATION_MS + units * UNIT_DURATION_MS + pauseMs;
  return clamp(Math.round(durationMs), MIN_DURATION_MS, MAX_DURATION_MS);
}

