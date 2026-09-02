import { describe, expect, it } from 'vitest';
import { evaluateAssertions } from '../../src/assertions/engine.js';
import type { AssertionEvidence } from '../../src/assertions/engine.js';
import type { EvaluationAssertion } from '../../src/datasets/schema.js';

const baseEvidence: AssertionEvidence = {
  outcome: 'complete',
  finalResponse: '已经成功打开微信',
  blockedInteraction: undefined,
  metrics: {
    schemaVersion: 1, success: true, verdict: 'PASSED', agentOutcome: 'complete',
    tokenUsage: { prompt: 100, completion: 20, total: 120, cached: 80 },
    stepCount: 2, modelCallCount: 2, toolCallCount: 1, cacheHitRate: 0.8, toolSuccessRate: 1,
    toolCalls: { succeeded: 1, failed: 0, unknown: 0 }, durationMs: 1500,
    modelDurationMs: 1000, toolDurationMs: 300, unavailable: [],
  },
  trace: {
    schemaVersion: 1, runId: 'run-1', sampleId: 'sample-1', requestId: 'req-1', traceId: 'trace-1', generatedAt: '2026-01-01T00:00:00.000Z',
    events: [{ eventId: 'event-1', sequence: 0, occurredAt: '2026-01-01T00:00:00.000Z', source: { artifactId: 'otel', line: 1 }, type: 'TOOL_CALL', toolName: 'tap', success: true }],
  },
  foregroundPackage: 'com.tencent.mm',
  uiText: '<?xml version="1.0"?><node text="通讯录"/>',
};

describe('evaluateAssertions', () => {
  it('按原顺序执行并覆盖确定性断言', () => {
    const assertions: EvaluationAssertion[] = [
      { type: 'outcome', equals: 'complete' },
      { type: 'finalResponse', contains: '微信', caseSensitive: true },
      { type: 'toolCalled', name: 'tap', minCalls: 1, forbidden: false },
      { type: 'toolResult', name: 'tap', success: true },
      { type: 'duration', max: 2000 },
      { type: 'steps', max: 3 },
      { type: 'tokens', metric: 'cached', min: 60 },
      { type: 'blockedInteraction', interaction: 'RISK', forbidden: true },
      { type: 'foregroundPackage', equals: 'com.tencent.mm' },
      { type: 'uiText', contains: '通讯录', caseSensitive: true },
    ];
    const report = evaluateAssertions(assertions, baseEvidence);
    expect(report.results.map((item) => item.assertionId)).toEqual(['assertion-001', 'assertion-002', 'assertion-003', 'assertion-004', 'assertion-005', 'assertion-006', 'assertion-007', 'assertion-008', 'assertion-009', 'assertion-010']);
    expect(report.summary).toEqual({ passed: 10, failed: 0, errors: 0 });
  });

  it('区分条件失败与证据缺失且不短路', () => {
    const { foregroundPackage: _foregroundPackage, uiText: _uiText, ...missingUiEvidence } = baseEvidence;
    const report = evaluateAssertions([
      { type: 'finalResponse', contains: '支付宝', caseSensitive: true },
      { type: 'foregroundPackage', equals: 'com.tencent.mm' },
      { type: 'uiText', contains: '通讯录', caseSensitive: true },
    ], missingUiEvidence);
    expect(report.results.map((item) => item.verdict)).toEqual(['FAIL', 'ERROR', 'ERROR']);
    expect(report.summary).toEqual({ passed: 0, failed: 1, errors: 2 });
  });
});
