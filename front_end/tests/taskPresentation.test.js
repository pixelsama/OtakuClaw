import { describe, expect, it } from 'vitest';

import { resolveTaskStatsText } from '../src/components/download/taskPresentation.js';

function createTranslator() {
  return (key, params = {}) => {
    if (key === 'download.elapsedStats') {
      return `已运行 ${params.seconds}s`;
    }
    if (key === 'download.eta') {
      return '预计剩余';
    }
    if (key === 'download.waitingStats') {
      return '正在获取下载大小与速度信息...';
    }
    if (key === 'download.completedStats') {
      return '下载与安装已完成。';
    }
    if (key === 'download.failedStats') {
      return '下载或安装未完成。';
    }
    return key;
  };
}

describe('resolveTaskStatsText', () => {
  it('returns elapsed text for running phases without byte stats', () => {
    const t = createTranslator();
    const text = resolveTaskStatsText(
      {
        phase: 'running',
        startedAtMs: 1000,
        nowMs: 6400,
      },
      t,
    );
    expect(text).toBe('已运行 5s');
  });

  it('returns speed and eta when byte stats are available', () => {
    const t = createTranslator();
    const text = resolveTaskStatsText(
      {
        phase: 'running',
        fileDownloadedBytes: 1024,
        fileTotalBytes: 2048,
        downloadSpeedBytesPerSec: 512,
        estimatedRemainingSeconds: 2,
      },
      t,
    );
    expect(text).toContain('1.0 KB / 2.0 KB');
    expect(text).toContain('512 B/s');
    expect(text).toContain('预计剩余');
  });
});

