import { z } from 'zod';

export const deviceInfoSchema = z.object({
  serial: z.string(),
  model: z.string(),
  androidVersion: z.string(),
  state: z.enum(['READY', 'OFFLINE', 'UNAUTHORIZED']),
  doupaoVersion: z.string().optional(),
  evaluationApiVersion: z.number().int().optional(),
  mock: z.boolean(),
  reason: z.string().optional(),
}).strict();

export const sampleRunSchema = z.object({
  sampleId: z.string(),
  instruction: z.string(),
  state: z.enum(['PENDING', 'RUNNING', 'PASSED', 'FAILED', 'BLOCKED', 'INFRA_ERROR', 'TIMED_OUT', 'CANCELLED']),
  phase: z.enum(['QUEUED', 'SETUP', 'SUBMIT', 'WAIT_TERMINAL', 'COLLECT_EVIDENCE', 'ASSERT', 'JUDGE', 'PERSIST', 'DONE']),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  summary: z.string().optional(),
  traceId: z.string().optional(),
  requestId: z.string().optional(),
  tokens: z.object({ prompt: z.number(), completion: z.number(), total: z.number(), cached: z.number().optional() }).optional(),
  evidence: z.object({
    collectedAt: z.string(),
    files: z.object({
      request: z.string(), status: z.string(), otel: z.string().optional(), todo: z.string().optional(),
    }).strict(),
    warnings: z.array(z.string()),
  }).strict().optional(),
}).strict();

export const evaluationRunSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  datasetId: z.string(),
  datasetName: z.string(),
  deviceSerial: z.string(),
  source: z.enum(['MOCK', 'ADB']),
  state: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'CANCELLED', 'INTERRUPTED']),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  cancelRequested: z.boolean(),
  samples: z.array(sampleRunSchema),
}).strict();

export const createRunRequestSchema = z.object({
  datasetId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  deviceSerial: z.string().min(1),
  sampleIds: z.array(z.string()).optional(),
}).strict();

export type DeviceInfo = z.infer<typeof deviceInfoSchema>;
export type EvaluationRun = z.infer<typeof evaluationRunSchema>;
export type SampleRun = z.infer<typeof sampleRunSchema>;
