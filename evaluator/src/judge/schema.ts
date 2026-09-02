import { z } from 'zod';

export const judgeResultSchema = z.object({
  schemaVersion: z.literal(1),
  verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  score: z.number().min(0).max(1),
  reason: z.string().min(1),
  evidence: z.array(z.string()),
}).strict();

export const judgeAttemptSchema = z.object({
  attemptNumber: z.number().int().positive(),
  rawResponse: z.string().optional(),
  result: judgeResultSchema.optional(),
  error: z.string().optional(),
}).strict();

export const judgeAssessmentSchema = z.object({
  schemaVersion: z.literal(1),
  verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE', 'JUDGE_ERROR', 'INFRA_ERROR']),
  provider: z.literal('OPENAI_COMPATIBLE'),
  model: z.string(),
  rubricVersion: z.literal('sample-v1'),
  promptTemplateVersion: z.literal('judge-v1'),
  threshold: z.number().min(0).max(1),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  warnings: z.array(z.string()),
  attempts: z.array(judgeAttemptSchema).min(1),
}).strict();

export const judgeConfigInputSchema = z.object({
  baseUrl: z.url().refine((value) => {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  }, 'baseUrl 必须为不含凭据的 HTTP(S) 地址'),
  model: z.string().trim().min(1).max(200),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
  supportsImages: z.boolean().default(false),
  apiKey: z.string().trim().min(1).optional(),
}).strict();

export const judgeRunConfigSchema = z.object({
  provider: z.literal('OPENAI_COMPATIBLE'),
  baseUrl: z.url(),
  model: z.string(),
  timeoutMs: z.number().int().positive(),
  supportsImages: z.boolean(),
}).strict();

export type JudgeResult = z.infer<typeof judgeResultSchema>;
export type JudgeAssessment = z.infer<typeof judgeAssessmentSchema>;
export type JudgeConfigInput = z.infer<typeof judgeConfigInputSchema>;
export type JudgeRunConfig = z.infer<typeof judgeRunConfigSchema>;
