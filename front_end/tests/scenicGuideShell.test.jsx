import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ScenicGuideShell, { hasImportedOfficialData } from '../src/shells/ScenicGuideShell.jsx';

globalThis.React = React;

vi.mock('../src/components/window/WindowTitleBar.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'window-title-bar-mock' }),
}));

vi.mock('../src/services/desktopBridge.js', () => ({
  desktopBridge: {
    scenicGuide: {
      getManifest: vi.fn(async () => ({ ok: true, manifest: null })),
      pickDataDirectory: vi.fn(async () => ({ ok: false, canceled: true })),
      importOfficialData: vi.fn(async () => ({ ok: false })),
      askQuestion: vi.fn(async () => ({ ok: false })),
    },
  },
}));

function renderShell(props = {}) {
  return renderToStaticMarkup(
    React.createElement(ScenicGuideShell, {
      desktopMode: false,
      platform: 'win32',
      onWindowControl: () => {},
      onOpenAdminPortal: () => {},
      ...props,
    }),
  );
}

describe('ScenicGuideShell', () => {
  it('renders the Lingshan scenic guide default shell without legacy room copy', () => {
    const html = renderShell();

    expect(html).toContain('灵山胜境 AI 导游');
    expect(html).toContain('景区导览服务 AI 数字人');
    expect(html).toContain('导览资料准备中，请联系景区工作人员');
    expect(html).toContain('aria-label="景区管理后台"');
    expect(html).not.toContain('导入官方资料包');
    expect(html).not.toContain('高级设置');
    expect(html).not.toContain('OpenClaw');
    expect(html).not.toContain('Nanobot');
    expect(html).not.toContain('Python');
    expect(html).not.toContain('Pixel');
    expect(html).not.toContain('Decorate');
    expect(html).not.toContain('办公室');
    expect(html).not.toContain('多 Agent');
  });

  it('renders official data status after manifest import', () => {
    const html = renderShell({
      initialManifest: {
        datasetId: 'official-lingshan-2026',
        scenicId: 'lingshan',
        importSummary: {
          spotCount: 22,
          routeCount: 3,
        },
        knowledgeSummary: { knowledgeBlockCount: 94 },
      },
    });

    expect(html).toContain('灵山胜境导览资料已就绪');
    expect(html).toContain('22');
    expect(html).toContain('3');
    expect(html).toContain('94');
    expect(html).not.toContain('140,447');
  });

  it('renders traced answer content and source list when answer data exists', () => {
    const html = renderShell({
      initialManifest: {
        datasetId: 'official-lingshan-2026',
        scenicId: 'lingshan',
        importSummary: {
          spotCount: 22,
          routeCount: 3,
        },
        knowledgeSummary: { knowledgeBlockCount: 94 },
      },
      initialAnswerResult: {
        question: '灵山大佛有什么特色？',
        answer: '根据官方资料，灵山大佛是景区标志性景观，适合远眺与合影。',
        confidence: 0.88,
        sources: [
          {
            blockId: 'official:spot:LS-011',
            title: '灵山大佛 LS-011',
            excerpt: '灵山大佛是景区标志性景观，高88米。',
          },
        ],
      },
    });

    expect(html).toContain('根据官方资料，灵山大佛是景区标志性景观，适合远眺与合影。');
    expect(html).toContain('匹配度 88%');
    expect(html).toContain('来源 1 条');
    expect(html).toContain('灵山大佛 LS-011');
  });

  it('requires the Lingshan official manifest before enabling imported state', () => {
    expect(hasImportedOfficialData({
      datasetId: 'official-lingshan-2026',
      scenicId: 'lingshan',
      importSummary: { spotCount: 22 },
    })).toBe(true);
    expect(hasImportedOfficialData({
      datasetId: 'official-lingshan-2026',
      scenicId: 'other',
      importSummary: { spotCount: 22 },
    })).toBe(false);
  });
});
