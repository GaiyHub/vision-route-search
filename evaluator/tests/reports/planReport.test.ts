import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanReportStore } from '../../src/reports/planReport.js';
import { evaluationRunSchema } from '../../src/server/apiTypes.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('PlanRun 报告', () => {
  it('只聚合每个样本的最新 Attempt 并持久化', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doupao-report-'));
    roots.push(root);
    const plan = {
      schemaVersion: 1 as const,
      planId: 'plan-11111111-1111-4111-8111-111111111111',
      name: '回归计划', datasetId: 'smoke', deviceSerial: 'device-1', sampleIds: ['answer'],
      execution: { defaultTimeoutMs: 30_000, continueOnFailure: true }, judge: { enabled: true },
      createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
    };
    const dataset = {
      schemaVersion: 1 as const, id: 'smoke', name: '冒烟',
      defaults: { timeoutMs: 30_000, conversationMode: 'ISOLATED' as const },
      samples: [{ id: 'answer', instruction: '回答问题', enabled: true, setup: [], teardown: [], assertions: [{ type: 'outcome' as const, equals: 'complete' as const }], tags: [] }],
    };
    const run = evaluationRunSchema.parse({
      schemaVersion: 1, runId: 'run-1', planId: plan.planId, planSnapshot: { plan, dataset },
      datasetId: dataset.id, datasetName: dataset.name, deviceSerial: 'device-1', source: 'MOCK',
      state: 'COMPLETED', createdAt: plan.createdAt, finishedAt: '2026-09-02T00:00:03.000Z', cancelRequested: false,
      samples: [{
        sampleId: 'answer', instruction: '回答问题', state: 'PASSED', phase: 'DONE',
        latestAttemptId: 'attempt-22222222-2222-4222-8222-222222222222',
        attempts: [
          { attemptId: 'attempt-11111111-1111-4111-8111-111111111111', attemptNumber: 1, state: 'FAILED', phase: 'DONE', durationMs: 1000, tokens: { prompt: 10, completion: 2, total: 12 } },
          { attemptId: 'attempt-22222222-2222-4222-8222-222222222222', attemptNumber: 2, state: 'PASSED', phase: 'DONE', durationMs: 2000, tokens: { prompt: 20, completion: 4, total: 24, cached: 10 } },
        ],
      }],
    });
    const metricsDirectory = join(root, 'runs', 'run-1', 'samples', 'answer', 'attempts', 'attempt-22222222-2222-4222-8222-222222222222', 'normalized');
    await mkdir(metricsDirectory, { recursive: true });
    await writeFile(join(metricsDirectory, 'metrics.json'), JSON.stringify({
      schemaVersion: 1, success: true, verdict: 'PASSED',
      tokenUsage: { prompt: 20, completion: 4, total: 24, cached: 10 },
      stepCount: 3, modelCallCount: 2, toolCallCount: 1,
      cacheHitRate: 0.5, toolSuccessRate: 1,
      toolCalls: { succeeded: 1, failed: 0, unknown: 0 },
      durationMs: 2000, modelDurationMs: 1200, toolDurationMs: 500, unavailable: [],
    }));
    const reports = new PlanReportStore(root);
    const report = await reports.generate(run);
    expect(report.summary).toMatchObject({ total: 1, passed: 1, failed: 0, passRate: 1, durationMs: 2000, totalTokens: 24, cachedTokens: 10, totalSteps: 3 });
    expect(report.samples).toMatchObject([{ attemptNumber: 2, state: 'PASSED' }]);
    await expect(reports.get(run.runId)).resolves.toEqual(report);
  });
});
