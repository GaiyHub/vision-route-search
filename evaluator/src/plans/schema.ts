import { z } from 'zod';

export const PLAN_SCHEMA_VERSION = 1 as const;
export const planIdSchema = z.string().regex(/^plan-[0-9a-f-]{36}$/i, '计划 ID 格式无效');
export const planResourceIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, '资源 ID 格式无效');

export const planExecutionSchema = z.object({
  defaultTimeoutMs: z.number().int().safe().min(10_000).max(30 * 60 * 1_000).default(180_000),
  continueOnFailure: z.boolean().default(true),
}).strict();

export const planJudgeSchema = z.object({
  enabled: z.boolean().default(true),
}).strict();

const planEditableFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).optional(),
  datasetId: planResourceIdSchema,
  deviceSerial: z.string().trim().min(1).max(200),
  sampleIds: z.array(planResourceIdSchema).min(1),
  execution: planExecutionSchema.default({ defaultTimeoutMs: 180_000, continueOnFailure: true }),
  judge: planJudgeSchema.default({ enabled: true }),
};

function ensureUniqueSamples(value: { sampleIds: string[] }, context: z.RefinementCtx): void {
  const seen = new Set<string>();
  value.sampleIds.forEach((sampleId, index) => {
    if (seen.has(sampleId)) {
      context.addIssue({ code: 'custom', path: ['sampleIds', index], message: `样本 ID 重复：${sampleId}` });
    }
    seen.add(sampleId);
  });
}

export const createEvaluationPlanSchema = z.object(planEditableFields).strict().superRefine(ensureUniqueSamples);

export const evaluationPlanSchema = z.object({
  schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
  planId: planIdSchema,
  ...planEditableFields,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict().superRefine(ensureUniqueSamples);

export const evaluationPlanSummarySchema = evaluationPlanSchema.pick({
  schemaVersion: true,
  planId: true,
  name: true,
  description: true,
  datasetId: true,
  deviceSerial: true,
  sampleIds: true,
  createdAt: true,
  updatedAt: true,
}).strip();

export type CreateEvaluationPlan = z.infer<typeof createEvaluationPlanSchema>;
export type EvaluationPlan = z.infer<typeof evaluationPlanSchema>;
export type EvaluationPlanSummary = z.infer<typeof evaluationPlanSummarySchema>;
