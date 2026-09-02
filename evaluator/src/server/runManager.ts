import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvaluationDataset, EvaluationSample } from '../datasets/schema.js';
import type { EvaluationPlan } from '../plans/schema.js';
import { PlanReportStore } from '../reports/planReport.js';
import { readValidatedJson, writeJsonAtomic } from '../storage/atomicFile.js';
import type { DatasetCatalog } from './datasetCatalog.js';
import {
  evaluationRunSchema,
  sampleAttemptSchema,
  type EvaluationRun,
  type SampleAttempt,
  type SampleRun,
} from './apiTypes.js';
import type { EvaluationRuntime, SampleExecution } from './runtime.js';

export class RunManagerError extends Error {
  constructor(
    public readonly code: 'RUN_NOT_RETRYABLE' | 'SAMPLE_NOT_RETRYABLE' | 'DEVICE_BUSY' | 'PLAN_STALE',
    message: string,
  ) {
    super(message);
    this.name = 'RunManagerError';
  }
}

export class RunManager {
  private readonly controllers = new Map<string, AbortController>();
  private readonly activeDeviceSerials = new Set<string>();
  private readonly reports: PlanReportStore;

  constructor(
    private readonly dataRoot: string,
    private readonly datasets: DatasetCatalog,
    private readonly runtime: EvaluationRuntime,
  ) {
    this.reports = new PlanReportStore(dataRoot);
  }

  private path(runId: string): string {
    return join(this.dataRoot, 'runs', runId, 'run.json');
  }

  async create(input: { datasetId: string; deviceSerial: string; sampleIds?: string[] | undefined }): Promise<EvaluationRun> {
    const dataset = await this.datasets.get(input.datasetId);
    if (!dataset) throw new Error(`评测集不存在：${input.datasetId}`);
    const selected = dataset.samples.filter((sample) => sample.enabled && (!input.sampleIds || input.sampleIds.includes(sample.id)));
    if (selected.length === 0) throw new Error('没有可执行的评测样本');
    return this.createRun(dataset, selected, input.deviceSerial, dataset.defaults.timeoutMs, true);
  }

  async createFromPlan(plan: EvaluationPlan): Promise<EvaluationRun> {
    const dataset = await this.datasets.get(plan.datasetId);
    if (!dataset) throw new RunManagerError('PLAN_STALE', `计划引用的评测集不存在：${plan.datasetId}`);
    const definitions = new Map(dataset.samples.map((sample) => [sample.id, sample]));
    const selected = plan.sampleIds.map((sampleId) => definitions.get(sampleId));
    if (selected.some((sample) => !sample?.enabled)) {
      throw new RunManagerError('PLAN_STALE', '计划中的样本已不存在或被禁用，请更新计划后重试');
    }
    return this.createRun(
      dataset,
      selected as EvaluationSample[],
      plan.deviceSerial,
      plan.execution.defaultTimeoutMs,
      plan.execution.continueOnFailure,
      plan,
    );
  }

  async get(runId: string): Promise<EvaluationRun> {
    return readValidatedJson(this.path(runId), evaluationRunSchema);
  }

  async list(planId?: string): Promise<EvaluationRun[]> {
    let entries;
    try { entries = await readdir(join(this.dataRoot, 'runs'), { withFileTypes: true }); }
    catch { return []; }
    const runs = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      try { return await this.get(entry.name); }
      catch { return null; }
    }));
    return runs
      .filter((run): run is EvaluationRun => run !== null && (!planId || run.planId === planId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async retrySample(runId: string, sampleId: string): Promise<EvaluationRun> {
    const run = await this.get(runId);
    if (!run.planId || !run.planSnapshot) {
      throw new RunManagerError('RUN_NOT_RETRYABLE', '历史评测为只读记录，请通过评测计划重新执行');
    }
    if (run.state === 'PENDING' || run.state === 'RUNNING') {
      throw new RunManagerError('RUN_NOT_RETRYABLE', '当前计划执行尚未结束');
    }
    const sample = run.samples.find((candidate) => candidate.sampleId === sampleId);
    const previous = sample?.attempts?.at(-1);
    if (!sample || !previous || previous.state === 'PENDING' || previous.state === 'RUNNING') {
      throw new RunManagerError('SAMPLE_NOT_RETRYABLE', `样本当前不可重试：${sampleId}`);
    }
    const definition = run.planSnapshot.dataset.samples.find((candidate) => candidate.id === sampleId);
    if (!definition) throw new RunManagerError('PLAN_STALE', `运行快照中缺少样本：${sampleId}`);
    const attempt = createAttempt(previous.attemptNumber + 1);
    sample.attempts!.push(attempt);
    syncLatestAttempt(sample, attempt);
    run.state = 'PENDING';
    run.cancelRequested = false;
    delete run.finishedAt;
    await this.start(run, run.planSnapshot.dataset, [sample], run.planSnapshot.plan.execution.continueOnFailure);
    return run;
  }

  async cancel(runId: string): Promise<EvaluationRun> {
    const run = await this.get(runId);
    if (run.state === 'COMPLETED' || run.state === 'CANCELLED') return run;
    run.cancelRequested = true;
    await writeJsonAtomic(this.path(runId), run);
    this.controllers.get(runId)?.abort();
    return run;
  }

  private async createRun(
    dataset: EvaluationDataset,
    selected: EvaluationSample[],
    deviceSerial: string,
    defaultTimeoutMs: number,
    continueOnFailure: boolean,
    plan?: EvaluationPlan,
  ): Promise<EvaluationRun> {
    await this.assertDeviceReady(deviceSerial);
    const now = new Date().toISOString();
    const run = evaluationRunSchema.parse({
      schemaVersion: 1,
      runId: `run-${randomUUID()}`,
      ...(plan ? { planId: plan.planId, planSnapshot: { plan, dataset } } : {}),
      datasetId: dataset.id,
      datasetName: dataset.name,
      deviceSerial,
      source: this.runtime.source,
      state: 'PENDING',
      createdAt: now,
      cancelRequested: false,
      samples: selected.map((sample): SampleRun => plan ? createPlannedSample(sample) : {
        sampleId: sample.id,
        instruction: sample.instruction,
        state: 'PENDING',
        phase: 'QUEUED',
      }),
    });
    await this.start(run, dataset, run.samples, continueOnFailure);
    return run;
  }

  private async start(
    run: EvaluationRun,
    dataset: EvaluationDataset,
    samples: SampleRun[],
    continueOnFailure: boolean,
  ): Promise<void> {
    await this.assertDeviceReady(run.deviceSerial);
    if (this.activeDeviceSerials.has(run.deviceSerial)) {
      throw new RunManagerError('DEVICE_BUSY', `设备已有评测任务在运行：${run.deviceSerial}`);
    }
    this.activeDeviceSerials.add(run.deviceSerial);
    try {
      await writeJsonAtomic(this.path(run.runId), run);
      const controller = new AbortController();
      this.controllers.set(run.runId, controller);
      void this.execute(run, dataset, samples, controller, continueOnFailure)
        .catch(() => undefined)
        .finally(() => this.activeDeviceSerials.delete(run.deviceSerial));
    } catch (error) {
      this.activeDeviceSerials.delete(run.deviceSerial);
      throw error;
    }
  }

  private async assertDeviceReady(deviceSerial: string): Promise<void> {
    const devices = await this.runtime.listDevices();
    if (!devices.some((device) => device.serial === deviceSerial && device.state === 'READY')) {
      throw new Error(`设备未就绪：${deviceSerial}`);
    }
  }

  private async execute(
    run: EvaluationRun,
    dataset: EvaluationDataset,
    samples: SampleRun[],
    controller: AbortController,
    continueOnFailure: boolean,
  ): Promise<void> {
    run.state = 'RUNNING';
    run.startedAt ??= new Date().toISOString();
    await writeJsonAtomic(this.path(run.runId), run);
    for (const sample of samples) {
      if (controller.signal.aborted) break;
      const definition = dataset.samples.find((candidate) => candidate.id === sample.sampleId);
      if (!definition) continue;
      const attempt = sample.attempts?.at(-1);
      const target = attempt ?? sample;
      target.state = 'RUNNING';
      target.phase = 'SUBMIT';
      target.startedAt = new Date().toISOString();
      if (attempt) syncLatestAttempt(sample, attempt);
      await writeJsonAtomic(this.path(run.runId), run);
      try {
        const result = await this.runtime.execute(definition, {
          runId: run.runId,
          ...(attempt ? { attemptId: attempt.attemptId } : {}),
          deviceSerial: run.deviceSerial,
          defaultTimeoutMs: run.planSnapshot?.plan.execution.defaultTimeoutMs ?? dataset.defaults.timeoutMs,
        }, controller.signal);
        applyResult(target, result);
      } catch (error) {
        target.state = controller.signal.aborted ? 'CANCELLED' : 'INFRA_ERROR';
        target.phase = 'DONE';
        target.summary = controller.signal.aborted
          ? '运行已由用户取消'
          : error instanceof Error ? error.message : '评测基础设施异常';
      }
      target.finishedAt = new Date().toISOString();
      target.durationMs = Date.parse(target.finishedAt) - Date.parse(target.startedAt!);
      if (attempt) syncLatestAttempt(sample, attempt);
      await writeJsonAtomic(this.path(run.runId), run);
      if (!continueOnFailure && !hasPassed(target)) break;
    }
    if (controller.signal.aborted) {
      run.state = 'CANCELLED';
      run.cancelRequested = true;
      for (const sample of samples) markPendingCancelled(sample);
    } else {
      run.state = 'COMPLETED';
    }
    run.finishedAt = new Date().toISOString();
    this.controllers.delete(run.runId);
    await writeJsonAtomic(this.path(run.runId), run);
    if (run.planId) await this.reports.generate(run);
  }
}

function createAttempt(attemptNumber: number): SampleAttempt {
  return sampleAttemptSchema.parse({
    attemptId: `attempt-${randomUUID()}`,
    attemptNumber,
    state: 'PENDING',
    phase: 'QUEUED',
  });
}

function createPlannedSample(sample: EvaluationSample): SampleRun {
  const attempt = createAttempt(1);
  return {
    sampleId: sample.id,
    instruction: sample.instruction,
    latestAttemptId: attempt.attemptId,
    attempts: [attempt],
    state: attempt.state,
    phase: attempt.phase,
  };
}

function applyResult(target: SampleAttempt | SampleRun, result: SampleExecution): void {
  target.state = result.verdict;
  target.phase = 'DONE';
  target.summary = result.summary;
  if (result.traceId) target.traceId = result.traceId;
  if (result.requestId) target.requestId = result.requestId;
  if (result.tokens) target.tokens = result.tokens;
  if (result.evidence) target.evidence = result.evidence;
}

function syncLatestAttempt(sample: SampleRun, attempt: SampleAttempt): void {
  sample.latestAttemptId = attempt.attemptId;
  for (const field of ['startedAt', 'finishedAt', 'durationMs', 'summary', 'traceId', 'requestId', 'tokens', 'evidence'] as const) {
    delete sample[field];
    const value = attempt[field];
    if (value !== undefined) Object.assign(sample, { [field]: value });
  }
  sample.state = attempt.state;
  sample.phase = attempt.phase;
}

function markPendingCancelled(sample: SampleRun): void {
  const attempt = sample.attempts?.at(-1);
  const target = attempt ?? sample;
  if (target.state !== 'PENDING') return;
  target.state = 'CANCELLED';
  target.phase = 'DONE';
  target.summary = '运行已由用户取消';
  target.finishedAt = new Date().toISOString();
  if (attempt) syncLatestAttempt(sample, attempt);
}

function hasPassed(target: SampleAttempt | SampleRun): boolean {
  return target.state === 'PASSED';
}
