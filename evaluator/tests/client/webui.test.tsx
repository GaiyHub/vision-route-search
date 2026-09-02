// @vitest-environment jsdom
import { screen } from '@testing-library/dom';
import { describe, expect, it, vi } from 'vitest';

describe('评测 WebUI', () => {
  it('展示 Mock 设备、评测集和样本', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url.includes('/api/devices')
        ? { devices: [{ serial: 'mock-pixel-8', model: 'Pixel 8（Mock）', androidVersion: '15', state: 'READY', mock: true, doupaoVersion: 'mock-1.0', evaluationApiVersion: 1 }] }
        : url.includes('/api/runs') ? { runs: [{ runId: 'run-history-1', state: 'COMPLETED', datasetName: '历史冒烟评测', createdAt: '2026-09-02T08:00:00.000Z', samples: [{ sampleId: 'answer', state: 'PASSED', phase: 'DONE', summary: '回答完成', durationMs: 500, tokens: { total: 12 } }] }] }
        : { datasets: [{ id: 'smoke', name: '冒烟评测', samples: [{ id: 'answer', instruction: '现在几点？', enabled: true }] }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    await import('../../src/client/main.js');
    expect(await screen.findByText('Pixel 8（Mock）')).toBeTruthy();
    expect(screen.getByText('● Mock')).toBeTruthy();
    expect(screen.getByText('冒烟评测')).toBeTruthy();
    expect(screen.getByText('现在几点？')).toBeTruthy();
    expect(screen.getByLabelText('运行记录')).toBeTruthy();
    expect(screen.getByText('查看指标与原始轨迹')).toBeTruthy();
  });
});
