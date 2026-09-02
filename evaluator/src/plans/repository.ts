import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatasetCatalog } from '../server/datasetCatalog.js';
import { readValidatedJson, writeJsonAtomic } from '../storage/atomicFile.js';
import {
  evaluationPlanSchema,
  evaluationPlanSummarySchema,
  type CreateEvaluationPlan,
  type EvaluationPlan,
  type EvaluationPlanSummary,
} from './schema.js';

export class PlanRepositoryError extends Error {
  constructor(
    public readonly code: 'PLAN_NOT_FOUND' | 'DATASET_NOT_FOUND' | 'SAMPLE_NOT_FOUND' | 'INVALID_CURSOR',
    message: string,
  ) {
    super(message);
    this.name = 'PlanRepositoryError';
  }
}

export interface PlanPage {
  plans: EvaluationPlanSummary[];
  pagination: { nextCursor: string | null };
}

export class PlanRepository {
  constructor(private readonly dataRoot: string, private readonly datasets: DatasetCatalog) {}

  private path(planId: string): string {
    return join(this.dataRoot, 'plans', `${planId}.json`);
  }

  async create(input: CreateEvaluationPlan): Promise<EvaluationPlan> {
    await this.validateReferences(input);
    const now = new Date().toISOString();
    const plan = evaluationPlanSchema.parse({
      schemaVersion: 1,
      planId: `plan-${randomUUID()}`,
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    await writeJsonAtomic(this.path(plan.planId), plan);
    return plan;
  }

  async get(planId: string): Promise<EvaluationPlan> {
    try {
      return await readValidatedJson(this.path(planId), evaluationPlanSchema);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new PlanRepositoryError('PLAN_NOT_FOUND', `评测计划不存在：${planId}`);
      }
      throw error;
    }
  }

  async update(planId: string, input: CreateEvaluationPlan): Promise<EvaluationPlan> {
    const current = await this.get(planId);
    await this.validateReferences(input);
    const plan = evaluationPlanSchema.parse({
      ...current,
      ...input,
      planId: current.planId,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    });
    await writeJsonAtomic(this.path(planId), plan);
    return plan;
  }

  async list(input: { cursor?: string | undefined; limit: number }): Promise<PlanPage> {
    let entries;
    try {
      entries = await readdir(join(this.dataRoot, 'plans'), { withFileTypes: true });
    } catch {
      return { plans: [], pagination: { nextCursor: null } };
    }
    const loaded = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        try {
          return await readValidatedJson(join(this.dataRoot, 'plans', entry.name), evaluationPlanSchema);
        } catch {
          return null;
        }
      }));
    const plans = loaded
      .filter((plan): plan is EvaluationPlan => plan !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.planId.localeCompare(left.planId));
    const start = input.cursor ? this.cursorIndex(plans, input.cursor) : 0;
    const page = plans.slice(start, start + input.limit);
    const hasMore = start + page.length < plans.length;
    return {
      plans: page.map((plan) => evaluationPlanSummarySchema.parse(plan)),
      pagination: { nextCursor: hasMore && page.length > 0 ? this.encodeCursor(page.at(-1)!) : null },
    };
  }

  private async validateReferences(input: CreateEvaluationPlan): Promise<void> {
    const dataset = await this.datasets.get(input.datasetId);
    if (!dataset) throw new PlanRepositoryError('DATASET_NOT_FOUND', `评测集不存在：${input.datasetId}`);
    const knownSamples = new Set(dataset.samples.map((sample) => sample.id));
    const missing = input.sampleIds.find((sampleId) => !knownSamples.has(sampleId));
    if (missing) throw new PlanRepositoryError('SAMPLE_NOT_FOUND', `评测样本不存在：${missing}`);
  }

  private encodeCursor(plan: EvaluationPlan): string {
    return Buffer.from(JSON.stringify([plan.updatedAt, plan.planId]), 'utf8').toString('base64url');
  }

  private cursorIndex(plans: EvaluationPlan[], cursor: string): number {
    try {
      const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (!Array.isArray(value) || value.length !== 2 || value.some((part) => typeof part !== 'string')) throw new Error();
      const index = plans.findIndex((plan) => plan.updatedAt === value[0] && plan.planId === value[1]);
      if (index < 0) throw new Error();
      return index + 1;
    } catch {
      throw new PlanRepositoryError('INVALID_CURSOR', '评测计划分页游标无效或已失效');
    }
  }
}

