import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JudgeService } from '../../src/judge/service.js';
import { PlanRepository } from '../../src/plans/repository.js';
import { DatasetCatalog } from '../../src/server/datasetCatalog.js';
import { MockEvaluationRuntime } from '../../src/server/mockRuntime.js';
import { RunManager } from '../../src/server/runManager.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('计划 Judge 聚合', () => {
  it('将 Judge 结论写入 Attempt 并参与最终状态', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doupao-judge-run-'));
    roots.push(root);
    const datasetDirectory = join(root, 'datasets');
    await mkdir(datasetDirectory);
    await writeFile(join(datasetDirectory, 'judge.json'), JSON.stringify({
      schemaVersion: 1, id: 'judge-run', name: 'Judge 聚合',
      samples: [{ id: 'answer', instruction: '回答问题', assertions: [{ type: 'outcome', equals: 'complete' }], judge: { enabled: true, rubric: '回答正确', threshold: 0.8, evidence: ['finalResponse', 'assertionSummary'] } }],
    }));
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: 1, verdict: 'FAIL', score: 0.2, reason: '回答不符合要求', evidence: ['finalResponse'] }) } }] }), { status: 200 }));
    const judge = new JudgeService({ baseUrl: 'https://judge.example/v1', model: 'judge-model', timeoutMs: 5000, supportsImages: false, apiKey: 'secret' }, fetch as typeof globalThis.fetch);
    const datasets = new DatasetCatalog(datasetDirectory);
    const plans = new PlanRepository(root, datasets);
    const plan = await plans.create({ name: '计划', datasetId: 'judge-run', deviceSerial: 'mock-pixel-8', sampleIds: ['answer'], execution: { defaultTimeoutMs: 30_000, continueOnFailure: true }, judge: { enabled: true } });
    const runs = new RunManager(root, datasets, new MockEvaluationRuntime(0), judge);
    const created = await runs.createFromPlan(plan);
    let run = await runs.get(created.runId);
    for (let attempt = 0; attempt < 20 && run.state !== 'COMPLETED'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      run = await runs.get(created.runId);
    }
    expect(run.samples[0]).toMatchObject({ state: 'FAILED', attempts: [{ judge: { verdict: 'FAIL', model: 'judge-model' } }] });
    expect(run.judgeSnapshot).toMatchObject({ provider: 'OPENAI_COMPATIBLE', model: 'judge-model', timeoutMs: 5000, supportsImages: false });
    expect(JSON.stringify(run)).not.toContain('secret');
  });

  it('未配置评审模型时跳过 AI 评审并继续执行计划', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doupao-judge-optional-'));
    roots.push(root);
    const datasetDirectory = join(root, 'datasets');
    await mkdir(datasetDirectory);
    await writeFile(join(datasetDirectory, 'judge.json'), JSON.stringify({
      schemaVersion: 1, id: 'judge-optional', name: '可选 AI 评审',
      samples: [{ id: 'answer', instruction: '回答问题', assertions: [{ type: 'outcome', equals: 'complete' }], judge: { enabled: true, rubric: '回答正确', threshold: 0.8, evidence: ['finalResponse'] } }],
    }));
    const datasets = new DatasetCatalog(datasetDirectory);
    const plans = new PlanRepository(root, datasets);
    const plan = await plans.create({ name: '计划', datasetId: 'judge-optional', deviceSerial: 'mock-pixel-8', sampleIds: ['answer'], execution: { defaultTimeoutMs: 30_000, continueOnFailure: true }, judge: { enabled: true } });
    const runs = new RunManager(root, datasets, new MockEvaluationRuntime(0), new JudgeService());

    const created = await runs.createFromPlan(plan);
    let run = await runs.get(created.runId);
    for (let attempt = 0; attempt < 20 && run.state !== 'COMPLETED'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      run = await runs.get(created.runId);
    }

    expect(run.samples[0]).toMatchObject({ state: 'PASSED', attempts: [{ state: 'PASSED' }] });
    expect(run.samples[0]?.attempts?.[0]?.judge).toBeUndefined();
    expect(run.judgeSnapshot).toBeUndefined();
  });
});
