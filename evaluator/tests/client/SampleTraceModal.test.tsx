// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SampleTraceModal } from '../../src/client/SampleTraceModal.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SampleTraceModal', () => {
  it('展示关键指标、轨迹详情并按类型重新查询', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/samples/sample-1')) {
        return Response.json({
          runId: 'run-1',
          sample: {
            sampleId: 'sample-1',
            instruction: '打开天气并查询北京天气',
            state: 'PASSED',
            summary: '已展示北京天气',
          },
          metrics: {
            success: true,
            verdict: 'PASSED',
            tokenUsage: { prompt: 100, completion: 20, total: 120, cached: 80 },
            stepCount: 2,
            modelCallCount: 1,
            toolCallCount: 1,
            cacheHitRate: 0.8,
            toolSuccessRate: 1,
            toolCalls: { succeeded: 1, failed: 0, unknown: 0 },
            durationMs: 2300,
            modelDurationMs: 1200,
            toolDurationMs: 900,
          },
          artifacts: [{ artifactId: 'trace.json', mediaType: 'application/json', sizeBytes: 2048 }],
        });
      }
      return Response.json({
        events: [
          {
            eventId: 'event-user',
            type: 'USER_INPUT',
            occurredAt: '2026-09-02T08:00:00.000Z',
            input: '打开天气并查询北京天气',
          },
          {
            eventId: 'event-model',
            type: 'MODEL_CALL',
            occurredAt: '2026-09-02T08:00:01.000Z',
            model: 'doubao-seed',
            request: { messages: [{ role: 'user', content: '查询天气' }] },
            response: { content: '调用工具' },
            usage: { prompt: 100, completion: 20, total: 120, cached: 80 },
            durationMs: 1200,
          },
        ],
        pagination: { nextCursor: null, totalItems: 2 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SampleTraceModal runId="run-1" sampleId="sample-1" onClose={() => undefined} />);

    expect(await screen.findByText('80.0%')).toBeTruthy();
    expect(screen.getByText('2.30s')).toBeTruthy();
    expect(screen.getByText('doubao-seed · 模型调用')).toBeTruthy();
    fireEvent.click(screen.getByText('doubao-seed · 模型调用'));
    expect(screen.getByText(/查询天气/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('轨迹类型'), { target: { value: 'MODEL_CALL' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('type=MODEL_CALL')));
  });
});
