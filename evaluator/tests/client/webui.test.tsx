// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/dom';
import { describe, expect, it, vi } from 'vitest';

describe('评测 WebUI', () => {
  it('以评测计划作为执行入口，并独立展示执行记录和评测集', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const plan = {
      schemaVersion: 1, planId: 'plan-1', name: '真机核心回归', datasetId: 'smoke', deviceSerial: 'mock-pixel-8',
      sampleIds: ['answer'], execution: { defaultTimeoutMs: 30_000, continueOnFailure: true }, judge: { enabled: true },
      createdAt: '2026-09-02T08:00:00.000Z', updatedAt: '2026-09-02T08:00:00.000Z',
    };
    const run = {
      runId: 'run-plan-1', planId: 'plan-1', state: 'COMPLETED', datasetName: '冒烟评测', createdAt: '2026-09-02T08:01:00.000Z',
      planSnapshot: { plan, dataset: { schemaVersion: 1, id: 'smoke', name: '冒烟评测' } },
      samples: [{ sampleId: 'answer', instruction: '现在几点？', state: 'PASSED', phase: 'DONE', latestAttemptId: 'attempt-1', attempts: [{ attemptId: 'attempt-1', attemptNumber: 1, state: 'PASSED', phase: 'DONE', durationMs: 500, tokens: { total: 12 } }] }],
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/devices') return Response.json({ devices: [{ serial: 'mock-pixel-8', model: 'Pixel 8（Mock）', androidVersion: '15', state: 'READY', mock: true }] });
      if (url === '/api/datasets') return Response.json({ datasets: [{ schemaVersion: 1, id: 'smoke', name: '冒烟评测', defaults: { timeoutMs: 30_000, conversationMode: 'ISOLATED' }, samples: [{ id: 'answer', instruction: '现在几点？', enabled: true, assertions: [] }] }] });
      if (url.startsWith('/api/plans?')) return Response.json({ plans: [plan], pagination: { nextCursor: null } });
      if (url === '/api/plans/plan-1' && !init?.method) return Response.json(plan);
      if (url === '/api/plans' && init?.method === 'POST') return Response.json(plan, { status: 201 });
      if (url === '/api/runs') return Response.json({ runs: [] });
      if (url === '/api/plans/plan-1/runs' && init?.method === 'POST') return Response.json(run, { status: 202 });
      if (url === '/api/runs/run-plan-1') return Response.json(run);
      if (url === '/api/runs/run-plan-1/report') return Response.json({ planId: 'plan-1', runId: 'run-plan-1', generatedAt: '2026-09-02T08:02:00.000Z', summary: { total: 1, passed: 1, failed: 0, blocked: 0, infraError: 0, timedOut: 0, cancelled: 0, pending: 0, passRate: 1, durationMs: 500, totalTokens: 12, cachedTokens: 0 } });
      return Response.json({ error: { message: `未模拟：${url}` } }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await import('../../src/client/main.js');

    expect((await screen.findAllByText('真机核心回归')).length).toBeGreaterThan(0);
    expect(screen.getByRole('navigation', { name: '评测台导航' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '新建计划' }));
    fireEvent.change(await screen.findByLabelText('计划名称'), { target: { value: '新计划' } });
    fireEvent.click(screen.getByRole('button', { name: '保存计划' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/plans', expect.objectContaining({ method: 'POST' })));
    fireEvent.click(await screen.findByRole('button', { name: '执行评测计划' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/plans/plan-1/runs', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText('评测计划执行记录')).toBeTruthy();
    expect(await screen.findByText('整体报告')).toBeTruthy();
    expect(screen.getByText('100.0%')).toBeTruthy();
    expect(screen.getByText('Attempt 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '评测集' }));
    expect(await screen.findByText('维护样本、断言与 Judge 标准，不在此发起执行')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '开始评测' })).toBeNull();
  });
});
