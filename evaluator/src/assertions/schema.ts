import { z } from 'zod';

export const assertionResultSchema = z.object({
  schemaVersion: z.literal(1),
  assertionId: z.string().regex(/^assertion-\d{3}$/),
  type: z.string().min(1),
  verdict: z.enum(['PASS', 'FAIL', 'ERROR']),
  reason: z.string().min(1),
  evidence: z.array(z.string()),
}).strict();

export const assertionReportSchema = z.object({
  schemaVersion: z.literal(1),
  results: z.array(assertionResultSchema),
  summary: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export type AssertionResult = z.infer<typeof assertionResultSchema>;
export type AssertionReport = z.infer<typeof assertionReportSchema>;
