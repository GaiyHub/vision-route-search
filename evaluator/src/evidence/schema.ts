import { z } from 'zod';

const stableId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const nonNegative = z.number().finite().nonnegative();
const nullableMetric = nonNegative.nullable();

const traceSourceSchema = z.object({
  artifactId: stableId,
  line: z.number().int().positive().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().nullable().optional(),
}).strict();

const traceEventBase = {
  eventId: stableId,
  sequence: z.number().int().nonnegative(),
  occurredAt: z.string(),
  durationMs: nonNegative.optional(),
  round: z.number().int().nonnegative().optional(),
  step: z.number().int().nonnegative().optional(),
  source: traceSourceSchema,
};

export const traceEventSchema = z.discriminatedUnion('type', [
  z.object({ ...traceEventBase, type: z.literal('USER_INPUT'), input: z.unknown() }).strict(),
  z.object({
    ...traceEventBase,
    type: z.literal('MODEL_CALL'),
    model: z.string(),
    provider: z.string().optional(),
    attempt: z.number().int().positive().optional(),
    request: z.unknown().optional(),
    response: z.unknown().optional(),
    finishReason: z.string().optional(),
    usage: z.object({
      prompt: nullableMetric,
      completion: nullableMetric,
      total: nullableMetric,
      cached: nullableMetric,
    }).strict(),
  }).strict(),
  z.object({
    ...traceEventBase,
    type: z.literal('TOOL_CALL'),
    toolName: z.string().min(1),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    success: z.boolean().nullable(),
    errorCode: z.string().optional(),
  }).strict(),
  z.object({
    ...traceEventBase,
    type: z.literal('AGENT_EVENT'),
    name: z.string().min(1),
    data: z.unknown().optional(),
  }).strict(),
]);

export const traceDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  runId: stableId,
  sampleId: stableId,
  requestId: stableId,
  traceId: z.string().min(1),
  generatedAt: z.string(),
  events: z.array(traceEventSchema),
}).strict();

export const sampleMetricsSchema = z.object({
  schemaVersion: z.literal(1),
  success: z.boolean(),
  verdict: z.enum(['PASSED', 'FAILED', 'BLOCKED', 'INFRA_ERROR', 'TIMED_OUT', 'CANCELLED']),
  agentOutcome: z.string().optional(),
  tokenUsage: z.object({
    prompt: nullableMetric,
    completion: nullableMetric,
    total: nullableMetric,
    cached: nullableMetric,
  }).strict(),
  stepCount: z.number().int().nonnegative(),
  modelCallCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  cacheHitRate: z.number().min(0).max(1).nullable(),
  toolSuccessRate: z.number().min(0).max(1).nullable(),
  toolCalls: z.object({
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }).strict(),
  durationMs: nullableMetric,
  modelDurationMs: nullableMetric,
  toolDurationMs: nullableMetric,
  unavailable: z.array(z.enum(['tokens', 'cacheHitRate', 'toolSuccessRate', 'duration'])),
}).strict();

export const tracePageSchema = z.object({
  schemaVersion: z.literal(1),
  events: z.array(traceEventSchema),
  pagination: z.object({
    cursor: z.string().nullable(),
    nextCursor: z.string().nullable(),
    limit: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export const artifactDescriptorSchema = z.object({
  artifactId: stableId,
  path: z.string().min(1),
  mediaType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
}).strict();

export type TraceEvent = z.infer<typeof traceEventSchema>;
export type TraceDocument = z.infer<typeof traceDocumentSchema>;
export type SampleMetrics = z.infer<typeof sampleMetricsSchema>;
export type TracePage = z.infer<typeof tracePageSchema>;
export type ArtifactDescriptor = z.infer<typeof artifactDescriptorSchema>;
