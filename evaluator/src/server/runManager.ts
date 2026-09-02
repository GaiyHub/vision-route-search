import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ZodType } from 'zod';
import { evaluateAssertions } from '../assertions/engine.js';
import type { EvaluationDataset, EvaluationSample } from '../datasets/schema.js';
import { finalDeviceStateSchema, sampleMetricsSchema, traceDocumentSchema, type SampleMetrics, type TraceDocument } from '../evidence/schema.js';
import type { JudgeService } from '../judge/service.js';
import type { JudgeAssessment } from '../judge/schema.js';
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
    public readonly code: 'RUN_NOT_RETRYABLE' | 'SAMPLE_NOT_RETRYABLE' | 'DEVICE_BUSY' | 'PLAN_STALE' | 'JUDGE_NOT_READY',
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
    private readonly judge?: JudgeService,
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
    if (plan.judge.enabled && selected.some((sample) => sample?.judge?.enabled) && !this.judge?.publicConfig().configured) {
      throw new RunManagerError('JUDGE_NOT_READY', '计划启用了 LLM-as-Judge，请先完成 Judge 配置');
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
      ...(plan ? judgeSnapshot(this.judge) : {}),
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
    for (const [sampleIndex, sample] of samples.entries()) {
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
        await this.applyAssertions(run, definition, sample, target, result);
        if (run.planSnapshot?.plan.judge.enabled && definition.judge?.enabled) {
          target.phase = 'JUDGE';
          await this.applyJudge(run, definition, sample, target, result);
        }
        target.phase = 'DONE';
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
      if (!continueOnFailure && !hasPassed(target)) {
        for (const remaining of samples.slice(sampleIndex + 1)) markPendingCancelled(remaining);
        break;
      }
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
    if (run.planId) await this.reports.generate(run);
    await writeJsonAtomic(this.path(run.runId), run);
  }

  private async applyAssertions(
    run: EvaluationRun,
    definition: EvaluationSample,
    sample: SampleRun,
    target: SampleAttempt | SampleRun,
    result: SampleExecution,
  ): Promise<void> {
    const attemptId = 'attemptId' in target ? target.attemptId : undefined;
    const normalizedRoot = attemptId
      ? join(this.dataRoot, 'runs', run.runId, 'samples', sample.sampleId, 'attempts', attemptId, 'normalized')
      : join(this.dataRoot, 'runs', run.runId, 'samples', sample.sampleId, 'normalized');
    const trace = await readOptional(join(normalizedRoot, 'trace.json'), traceDocumentSchema);
    const storedMetrics = await readOptional(join(normalizedRoot, 'metrics.json'), sampleMetricsSchema);
    const deviceState = await readOptional(join(normalizedRoot, 'device-state.json'), finalDeviceStateSchema);
    const uiText = await readOptionalText(join(normalizedRoot, '..', 'raw', 'ui-hierarchy.xml'));
    const metrics = storedMetrics ?? syntheticMetrics(result);
    const assertions = evaluateAssertions(definition.assertions, {
      ...(result.agentOutcome ? { outcome: result.agentOutcome } : {}),
      finalResponse: result.summary,
      ...(result.blockedInteraction ? { blockedInteraction: result.blockedInteraction } : {}),
      ...(metrics ? { metrics } : {}),
      ...(trace ? { trace } : {}),
      ...(deviceState?.foregroundPackage ? { foregroundPackage: deviceState.foregroundPackage } : {}),
      ...(uiText ? { uiText } : {}),
    });
    target.assertions = assertions;
    const assertionPath = join(normalizedRoot, 'assertions.json');
    await writeJsonAtomic(assertionPath, assertions);
    if (target.evidence) {
      target.evidence.files.assertions = 'normalized/assertions.json';
    }
    const aggregate = aggregateVerdict(result.verdict, assertions.summary);
    target.state = aggregate;
    if (storedMetrics) {
      await writeJsonAtomic(join(normalizedRoot, 'metrics.json'), sampleMetricsSchema.parse({
        ...storedMetrics,
        success: aggregate === 'PASSED',
        verdict: aggregate,
      }));
    }
  }

  private async applyJudge(
    run: EvaluationRun,
    definition: EvaluationSample,
    sample: SampleRun,
    target: SampleAttempt | SampleRun,
    result: SampleExecution,
  ): Promise<void> {
    const attemptId = 'attemptId' in target ? target.attemptId : undefined;
    const normalizedRoot = attemptId
      ? join(this.dataRoot, 'runs', run.runId, 'samples', sample.sampleId, 'attempts', attemptId, 'normalized')
      : join(this.dataRoot, 'runs', run.runId, 'samples', sample.sampleId, 'normalized');
    const trace = await readOptional(join(normalizedRoot, 'trace.json'), traceDocumentSchema);
    const judge = this.judge
      ? await this.judge.evaluate({
        sample: definition,
        finalResponse: result.summary,
        assertions: target.assertions!,
        ...(trace ? { trace } : {}),
      })
      : missingJudge(definition.judge!.threshold);
    target.judge = judge;
    await writeJsonAtomic(join(normalizedRoot, 'judge.json'), judge);
    if (target.evidence) target.evidence.files.judge = 'normalized/judge.json';
    target.state = aggregateJudgeVerdict(target.state, judge);
    const metrics = await readOptional(join(normalizedRoot, 'metrics.json'), sampleMetricsSchema);
    if (metrics) await writeJsonAtomic(join(normalizedRoot, 'metrics.json'), sampleMetricsSchema.parse({
      ...metrics, success: target.state === 'PASSED', verdict: target.state,
    }));
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
  for (const field of ['startedAt', 'finishedAt', 'durationMs', 'summary', 'traceId', 'requestId', 'tokens', 'evidence', 'assertions', 'judge'] as const) {
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

async function readOptional<T>(path: string, schema: ZodType<T>): Promise<T | undefined> {
  try { return await readValidatedJson(path, schema); }
  catch { return undefined; }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); }
  catch { return undefined; }
}

function syntheticMetrics(result: SampleExecution): SampleMetrics | undefined {
  if (result.durationMs === undefined || result.stepCount === undefined) return undefined;
  const tokens = result.tokens;
  return sampleMetricsSchema.parse({
    schemaVersion: 1,
    success: result.verdict === 'PASSED',
    verdict: result.verdict,
    ...(result.agentOutcome ? { agentOutcome: result.agentOutcome } : {}),
    tokenUsage: {
      prompt: tokens?.prompt ?? null,
      completion: tokens?.completion ?? null,
      total: tokens?.total ?? null,
      cached: tokens?.cached ?? null,
    },
    stepCount: result.stepCount,
    modelCallCount: 0,
    toolCallCount: 0,
    cacheHitRate: tokens?.cached !== undefined && tokens.prompt > 0 ? tokens.cached / tokens.prompt : null,
    toolSuccessRate: null,
    toolCalls: { succeeded: 0, failed: 0, unknown: 0 },
    durationMs: result.durationMs,
    modelDurationMs: null,
    toolDurationMs: null,
    unavailable: ['toolSuccessRate'],
  });
}

function aggregateVerdict(
  agentVerdict: SampleExecution['verdict'],
  assertions: { failed: number; errors: number },
): SampleExecution['verdict'] {
  if (agentVerdict !== 'PASSED') return agentVerdict;
  if (assertions.errors > 0) return 'INFRA_ERROR';
  if (assertions.failed > 0) return 'FAILED';
  return 'PASSED';
}

function aggregateJudgeVerdict(
  current: SampleAttempt['state'],
  judge: JudgeAssessment,
): SampleAttempt['state'] {
  if (judge.verdict === 'INFRA_ERROR' || judge.verdict === 'JUDGE_ERROR') return 'INFRA_ERROR';
  if (current === 'INFRA_ERROR' || current === 'CANCELLED' || current === 'TIMED_OUT' || current === 'BLOCKED') return current;
  if (current === 'FAILED' || judge.verdict === 'FAIL') return 'FAILED';
  if (judge.verdict === 'INCONCLUSIVE') return 'INCONCLUSIVE';
  return 'PASSED';
}

function missingJudge(threshold: number): JudgeAssessment {
  return {
    schemaVersion: 1, verdict: 'INFRA_ERROR', provider: 'OPENAI_COMPATIBLE', model: 'UNCONFIGURED',
    rubricVersion: 'sample-v1', promptTemplateVersion: 'judge-v1', threshold,
    evidenceHash: '0'.repeat(64), warnings: [], attempts: [{ attemptNumber: 1, error: 'Judge 服务未注入' }],
  };
}

function judgeSnapshot(judge?: JudgeService): { judgeSnapshot?: { provider: 'OPENAI_COMPATIBLE'; baseUrl: string; model: string; timeoutMs: number; supportsImages: boolean } } {
  const config = judge?.publicConfig();
  if (!config?.configured) return {};
  return { judgeSnapshot: { provider: config.provider, baseUrl: config.baseUrl, model: config.model, timeoutMs: config.timeoutMs, supportsImages: config.supportsImages } };
}
