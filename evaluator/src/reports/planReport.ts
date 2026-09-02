import { join } from 'node:path';
import { z } from 'zod';
import { sampleMetricsSchema, type SampleMetrics } from '../evidence/schema.js';
import { readValidatedJson, writeJsonAtomic } from '../storage/atomicFile.js';
import type { EvaluationRun, SampleAttempt, SampleRun } from '../server/apiTypes.js';
import { assertionReportSchema } from '../assertions/schema.js';
import { judgeAssessmentSchema } from '../judge/schema.js';
import { judgeRunConfigSchema } from '../judge/schema.js';

const reportSampleSchema = z.object({
  sampleId: z.string(),
  instruction: z.string(),
  attemptId: z.string(),
  attemptNumber: z.number().int().positive(),
  state: z.enum(['PENDING', 'RUNNING', 'PASSED', 'FAILED', 'INCONCLUSIVE', 'BLOCKED', 'INFRA_ERROR', 'TIMED_OUT', 'CANCELLED']),
  summary: z.string().optional(),
  durationMs: z.number().int().nonnegative().nullable(),
  tokens: z.object({ prompt: z.number(), completion: z.number(), total: z.number(), cached: z.number().nullable() }).nullable(),
  metrics: sampleMetricsSchema.nullable(),
  assertions: assertionReportSchema.default({ schemaVersion: 1, results: [], summary: { passed: 0, failed: 0, errors: 0 } }),
  judge: judgeAssessmentSchema.optional(),
}).strict();

export const planRunReportSchema = z.object({
  schemaVersion: z.literal(1),
  planId: z.string(),
  runId: z.string(),
  planName: z.string(),
  datasetId: z.string(),
  datasetName: z.string(),
  deviceSerial: z.string(),
  judgeConfig: judgeRunConfigSchema.optional(),
  runState: z.enum(['COMPLETED', 'CANCELLED', 'INTERRUPTED']),
  generatedAt: z.string(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    inconclusive: z.number().int().nonnegative().default(0),
    blocked: z.number().int().nonnegative(),
    infraError: z.number().int().nonnegative(),
    timedOut: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    passRate: z.number().min(0).max(1),
    durationMs: z.number().int().nonnegative(),
    totalTokens: z.number().nonnegative().nullable(),
    cachedTokens: z.number().nonnegative().nullable(),
  }).strict(),
  samples: z.array(reportSampleSchema),
}).strict();

export type PlanRunReport = z.infer<typeof planRunReportSchema>;

export class PlanReportStoreError extends Error {
  readonly code = 'REPORT_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'PlanReportStoreError';
  }
}

export class PlanReportStore {
  constructor(private readonly dataRoot: string) {}

  async generate(run: EvaluationRun): Promise<PlanRunReport> {
    if (!run.planId || !run.planSnapshot) throw new Error('历史评测不生成计划报告');
    if (run.state === 'PENDING' || run.state === 'RUNNING') throw new Error('运行尚未结束，无法生成报告');
    const samples = await Promise.all(run.samples.map(async (sample) => {
      const attempt = latestAttempt(sample);
      return reportSampleSchema.parse({
        sampleId: sample.sampleId,
        instruction: sample.instruction,
        attemptId: attempt.attemptId,
        attemptNumber: attempt.attemptNumber,
        state: attempt.state,
        ...(attempt.summary ? { summary: attempt.summary } : {}),
        durationMs: attempt.durationMs ?? null,
        tokens: attempt.tokens ? { ...attempt.tokens, cached: attempt.tokens.cached ?? null } : null,
        metrics: await this.readMetrics(run.runId, sample.sampleId, attempt.attemptId),
        assertions: attempt.assertions ?? { schemaVersion: 1, results: [], summary: { passed: 0, failed: 0, errors: 0 } },
        ...(attempt.judge ? { judge: attempt.judge } : {}),
      });
    }));
    const count = (state: typeof samples[number]['state']) => samples.filter((sample) => sample.state === state).length;
    const tokenSamples = samples.map((sample) => sample.tokens).filter((tokens) => tokens !== null);
    const report = planRunReportSchema.parse({
      schemaVersion: 1,
      planId: run.planId,
      runId: run.runId,
      planName: run.planSnapshot.plan.name,
      datasetId: run.datasetId,
      datasetName: run.datasetName,
      deviceSerial: run.deviceSerial,
      ...(run.judgeSnapshot ? { judgeConfig: run.judgeSnapshot } : {}),
      runState: run.state,
      generatedAt: new Date().toISOString(),
      summary: {
        total: samples.length,
        passed: count('PASSED'), failed: count('FAILED'), inconclusive: count('INCONCLUSIVE'), blocked: count('BLOCKED'),
        infraError: count('INFRA_ERROR'), timedOut: count('TIMED_OUT'), cancelled: count('CANCELLED'),
        pending: count('PENDING') + count('RUNNING'),
        passRate: samples.length === 0 ? 0 : count('PASSED') / samples.length,
        durationMs: samples.reduce((sum, sample) => sum + (sample.durationMs ?? 0), 0),
        totalTokens: tokenSamples.length ? tokenSamples.reduce((sum, tokens) => sum + tokens.total, 0) : null,
        cachedTokens: tokenSamples.some((tokens) => tokens.cached !== null)
          ? tokenSamples.reduce((sum, tokens) => sum + (tokens.cached ?? 0), 0)
          : null,
      },
      samples,
    });
    await writeJsonAtomic(this.path(run.runId), report);
    return report;
  }

  async get(runId: string): Promise<PlanRunReport> {
    try {
      return await readValidatedJson(this.path(runId), planRunReportSchema);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new PlanReportStoreError(`评测报告不存在：${runId}`);
      }
      throw error;
    }
  }

  private path(runId: string): string { return join(this.dataRoot, 'runs', runId, 'report.json'); }
  private async readMetrics(runId: string, sampleId: string, attemptId: string): Promise<SampleMetrics | null> {
    try {
      return await readValidatedJson(join(this.dataRoot, 'runs', runId, 'samples', sampleId, 'attempts', attemptId, 'normalized', 'metrics.json'), sampleMetricsSchema);
    } catch {
      return null;
    }
  }
}

function latestAttempt(sample: SampleRun): SampleAttempt {
  const attempt = sample.attempts?.at(-1);
  if (!attempt) throw new Error(`计划样本缺少 Attempt：${sample.sampleId}`);
  return attempt;
}
