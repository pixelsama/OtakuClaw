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
    },
  },
}));

function renderShell(props = {}) {
  return renderToStaticMarkup(
    React.createElement(ScenicGuideShell, {
      desktopMode: false,
      platform: 'win32',
      onWindowControl: () => {},
      ...props,
    }),
  );
}

describe('ScenicGuideShell', () => {
  it('renders the Lingshan scenic guide default shell without legacy room copy', () => {
    const html = renderShell();

    expect(html).toContain('灵山胜境 AI 导游');
    expect(html).toContain('景区导览服务 AI 数字人');
    expect(html).toContain('请管理员导入官方资料包');
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
          behaviorDataRowCount: 140447,
        },
      },
    });

    expect(html).toContain('官方资料包已就绪');
    expect(html).toContain('22');
    expect(html).toContain('3');
    expect(html).toContain('140,447');
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
