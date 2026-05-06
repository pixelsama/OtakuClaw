import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ScenicAdminShell from '../src/shells/ScenicAdminShell.jsx';

globalThis.React = React;

vi.mock('../src/components/window/WindowTitleBar.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'window-title-bar-mock' }),
}));

vi.mock('../src/services/desktopBridge.js', () => ({
  desktopBridge: {
    scenicGuide: {
      getManifest: vi.fn(async () => ({ ok: true, manifest: null })),
      getKnowledgeSummary: vi.fn(async () => ({ ok: true, knowledgeSummary: null })),
      pickDataDirectory: vi.fn(async () => ({ ok: false, canceled: true })),
      importOfficialData: vi.fn(async () => ({ ok: false })),
    },
  },
}));

function renderShell(props = {}) {
  return renderToStaticMarkup(
    React.createElement(ScenicAdminShell, {
      desktopMode: false,
      platform: 'win32',
      onWindowControl: () => {},
      onBackToGuide: () => {},
      onOpenAdvancedSettings: () => {},
      ...props,
    }),
  );
}

describe('ScenicAdminShell', () => {
  it('renders a separate scenic management backend', () => {
    const html = renderShell();

    expect(html).toContain('景区管理后台');
    expect(html).toContain('官方资料、知识库与导览运营管理');
    expect(html).toContain('导入官方资料包');
    expect(html).toContain('高级设置');
    expect(html).toContain('请导入比赛官方资料包');
    expect(html).not.toContain('导览问答');
    expect(html).not.toContain('数字人讲解员');
  });

  it('renders imported management metrics', () => {
    const html = renderShell({
      initialManifest: {
        datasetId: 'official-lingshan-2026',
        scenicId: 'lingshan',
        importSummary: {
          spotCount: 22,
          routeCount: 3,
          behaviorDataRowCount: 140447,
        },
        knowledgeSummary: {
          knowledgeBlockCount: 94,
          officialKnowledgeBlockCount: 94,
          manualKnowledgeBlockCount: 0,
          version: 1,
        },
        sources: [
          { id: 'spot', fileName: '灵山胜境 景点结构化数据集.docx', exists: true },
        ],
      },
    });

    expect(html).toContain('官方资料与知识库已就绪');
    expect(html).toContain('140,447');
    expect(html).toContain('94');
    expect(html).toContain('灵山胜境 景点结构化数据集.docx');
  });
});
