import { describe, expect, it } from 'vitest';
import { sampleMetricsSchema, traceDocumentSchema, tracePageSchema } from '../../src/evidence/schema.js';

describe('评测轨迹与指标契约', () => {
  it('区分用户、模型、工具和 Agent 事件并保留逐步用量', () => {
    const common = {
      occurredAt: '2026-09-02T00:00:00.000Z',
      source: { artifactId: 'otel-trace', line: 1 },
    };
    const document = traceDocumentSchema.parse({
      schemaVersion: 1,
      runId: 'run-1', sampleId: 'sample-1', requestId: 'request-1', traceId: 'trace-1',
      generatedAt: '2026-09-02T00:00:01.000Z',
      events: [
        { ...common, eventId: 'event-000001', sequence: 0, type: 'USER_INPUT', input: '查询时间' },
        {
          ...common, eventId: 'event-000002', sequence: 1, type: 'MODEL_CALL', model: 'doubao',
          request: { messages: [] }, response: { content: '调用工具' },
          usage: { prompt: 100, completion: 20, total: 120, cached: 80 }, durationMs: 500,
        },
        {
          ...common, eventId: 'event-000003', sequence: 2, type: 'TOOL_CALL', toolName: 'wait',
          input: { ms: 100 }, output: { ok: true }, success: true, durationMs: 100,
        },
        { ...common, eventId: 'event-000004', sequence: 3, type: 'AGENT_EVENT', name: 'thinking' },
      ],
    });
    expect(document.events.map((event) => event.type)).toEqual([
      'USER_INPUT', 'MODEL_CALL', 'TOOL_CALL', 'AGENT_EVENT',
    ]);
  });

  it('用 null 表达不可用指标而不是伪造零值', () => {
    const metrics = sampleMetricsSchema.parse({
      schemaVersion: 1, success: false, verdict: 'INFRA_ERROR',
      tokenUsage: { prompt: null, completion: null, total: null, cached: null },
      stepCount: 0, modelCallCount: 0, toolCallCount: 0,
      cacheHitRate: null, toolSuccessRate: null,
      toolCalls: { succeeded: 0, failed: 0, unknown: 0 },
      durationMs: null, modelDurationMs: null, toolDurationMs: null,
      unavailable: ['tokens', 'cacheHitRate', 'toolSuccessRate', 'duration'],
    });
    expect(metrics.cacheHitRate).toBeNull();
  });

  it('分页响应只携带当前页事件', () => {
    const page = tracePageSchema.parse({
      schemaVersion: 1,
      events: [],
      pagination: { cursor: null, nextCursor: null, limit: 50, totalItems: 0 },
    });
    expect(page.pagination.limit).toBe(50);
  });
});
