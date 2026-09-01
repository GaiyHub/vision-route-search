import { z } from 'zod';
import { EVALUATION_INSTRUCTION_MAX_BYTES } from '../contracts/evaluation.js';

export const DATASET_SCHEMA_VERSION = 1 as const;

const stableId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'ID 格式无效');
const packageName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/, '包名格式无效');
const nonNegativeInteger = z.number().int().safe().nonnegative();

export function isSafeRegexSource(source: string): boolean {
  if (source.length === 0 || source.length > 256) return false;
  if (/\\[1-9]/.test(source) || /\(\?<([=!])/.test(source)) return false;
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(source)) return false;
  try {
    new RegExp(source, 'u');
    return true;
  } catch {
    return false;
  }
}

const safeRegex = z.string().refine(isSafeRegexSource, '正则表达式无效或不安全');
const boundedRangeFields = {
  min: nonNegativeInteger.optional(),
  max: nonNegativeInteger.optional(),
};

function validateBoundedRange(
  value: { min?: number | undefined; max?: number | undefined },
  context: z.RefinementCtx,
  unit: string,
) {
  if (value.min === undefined && value.max === undefined) {
    context.addIssue({ code: 'custom', message: `至少配置 ${unit} 的 min 或 max` });
  }
  if (value.min !== undefined && value.max !== undefined && value.min > value.max) {
    context.addIssue({ code: 'custom', path: ['max'], message: 'max 不能小于 min' });
  }
}

const textAssertionFields = {
  caseSensitive: z.boolean().default(true),
  contains: z.string().min(1).optional(),
  excludes: z.string().min(1).optional(),
  matches: safeRegex.optional(),
};

function exactlyOneTextMatcher(
  value: { contains?: string | undefined; excludes?: string | undefined; matches?: string | undefined },
  context: z.RefinementCtx,
) {
  const count = [value.contains, value.excludes, value.matches].filter((item) => item !== undefined).length;
  if (count !== 1) context.addIssue({ code: 'custom', message: '必须且只能配置一种文本匹配条件' });
}

export const assertionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('outcome'), equals: z.enum(['complete', 'stopped', 'error', 'blocked', 'timed_out']) }).strict(),
  z.object({ type: z.literal('finalResponse'), ...textAssertionFields }).strict().superRefine(exactlyOneTextMatcher),
  z.object({
    type: z.literal('toolCalled'),
    name: z.string().trim().min(1),
    minCalls: nonNegativeInteger.optional(),
    maxCalls: nonNegativeInteger.optional(),
    forbidden: z.boolean().default(false),
  }).strict().superRefine((value, context) => {
    if (value.minCalls !== undefined && value.maxCalls !== undefined && value.minCalls > value.maxCalls) {
      context.addIssue({ code: 'custom', path: ['maxCalls'], message: 'maxCalls 不能小于 minCalls' });
    }
    if (value.forbidden && (value.minCalls !== undefined || value.maxCalls !== undefined)) {
      context.addIssue({ code: 'custom', message: '禁止调用时不能配置调用次数' });
    }
  }),
  z.object({ type: z.literal('toolResult'), name: z.string().trim().min(1), success: z.boolean().optional(), errorCode: z.string().trim().min(1).optional() }).strict()
    .superRefine((value, context) => {
      if ((value.success === undefined) === (value.errorCode === undefined)) {
        context.addIssue({ code: 'custom', message: '必须且只能配置 success 或 errorCode' });
      }
    }),
  z.object({ type: z.literal('duration'), ...boundedRangeFields }).strict()
    .superRefine((value, context) => validateBoundedRange(value, context, '耗时')),
  z.object({ type: z.literal('steps'), ...boundedRangeFields }).strict()
    .superRefine((value, context) => validateBoundedRange(value, context, '步数')),
  z.object({ type: z.literal('tokens'), metric: z.enum(['prompt', 'completion', 'total', 'cached']), ...boundedRangeFields }).strict()
    .superRefine((value, context) => validateBoundedRange(value, context, 'Token')),
  z.object({ type: z.literal('foregroundPackage'), equals: packageName }).strict(),
  z.object({ type: z.literal('uiText'), ...textAssertionFields }).strict().superRefine(exactlyOneTextMatcher),
  z.object({
    type: z.literal('blockedInteraction'),
    interaction: z.enum(['RISK', 'ASK_USER', 'USER_ACTION']),
    forbidden: z.boolean().default(false),
  }).strict(),
]);

export const setupActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('launchPackage'), packageName }).strict(),
  z.object({ type: z.literal('forceStopPackage'), packageName }).strict(),
  z.object({ type: z.literal('pressKey'), key: z.enum(['HOME', 'BACK']) }).strict(),
  z.object({ type: z.literal('wait'), durationMs: z.number().int().safe().min(100).max(30_000) }).strict(),
  z.object({ type: z.literal('assertPackageInstalled'), packageName }).strict(),
]);

export const judgeEvidenceSchema = z.enum([
  'finalResponse',
  'traceSummary',
  'assertionSummary',
  'finalScreenshot',
  'uiHierarchy',
]);

export const sampleJudgeSchema = z.object({
  enabled: z.boolean(),
  rubric: z.string().trim().min(1),
  threshold: z.number().min(0).max(1),
  evidence: z.array(judgeEvidenceSchema).min(1),
}).strict();

export const evaluationSampleSchema = z.object({
  id: stableId,
  name: z.string().trim().min(1).optional(),
  enabled: z.boolean().default(true),
  instruction: z.string().trim().min(1).refine(
    (value) => Buffer.byteLength(value, 'utf8') <= EVALUATION_INSTRUCTION_MAX_BYTES,
    'instruction 超过大小限制',
  ),
  timeoutMs: z.number().int().safe().min(1_000).max(30 * 60 * 1_000).optional(),
  setup: z.array(setupActionSchema).default([]),
  teardown: z.array(setupActionSchema).default([]),
  assertions: z.array(assertionSchema).default([]),
  judge: sampleJudgeSchema.optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
}).strict().superRefine((value, context) => {
  if (value.enabled && value.assertions.length === 0 && value.judge?.enabled !== true) {
    context.addIssue({ code: 'custom', message: '启用的样本至少需要一条断言或启用 Judge' });
  }
});

export const evaluationDatasetSchema = z.object({
  schemaVersion: z.literal(DATASET_SCHEMA_VERSION),
  id: stableId,
  name: z.string().trim().min(1),
  description: z.string().optional(),
  defaults: z.object({
    timeoutMs: z.number().int().safe().min(1_000).max(30 * 60 * 1_000).default(180_000),
    conversationMode: z.literal('ISOLATED').default('ISOLATED'),
  }).strict().default({ timeoutMs: 180_000, conversationMode: 'ISOLATED' }),
  samples: z.array(evaluationSampleSchema).min(1),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  value.samples.forEach((sample, index) => {
    if (seen.has(sample.id)) {
      context.addIssue({ code: 'custom', path: ['samples', index, 'id'], message: `样本 ID 重复：${sample.id}` });
    }
    seen.add(sample.id);
  });
});

export type EvaluationDataset = z.infer<typeof evaluationDatasetSchema>;
export type EvaluationSample = z.infer<typeof evaluationSampleSchema>;
export type EvaluationAssertion = z.infer<typeof assertionSchema>;
