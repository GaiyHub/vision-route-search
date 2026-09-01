import { createHash } from 'node:crypto';
import { z } from 'zod';

export const EVALUATION_SCHEMA_VERSION = 1 as const;
export const EVALUATION_INSTRUCTION_MAX_BYTES = 32 * 1024;
export const EVALUATION_PAYLOAD_MAX_BYTES = 64 * 1024;
export const EVALUATION_TIMEOUT_MIN_MS = 1_000;
export const EVALUATION_TIMEOUT_MAX_MS = 30 * 60 * 1_000;

const evaluationId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const traceId = z.string().regex(/^[a-f0-9]{32}$/);
const isoDateTime = z.string().datetime({ offset: true });
const nonNegativeInteger = z.number().int().safe().nonnegative();

export const evalRequestV1Schema = z.object({
  schemaVersion: z.literal(EVALUATION_SCHEMA_VERSION),
  requestId: evaluationId,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: evaluationId,
  sampleId: evaluationId,
  instruction: z.string().trim().min(1).refine(
    (value) => Buffer.byteLength(value, 'utf8') <= EVALUATION_INSTRUCTION_MAX_BYTES,
    'instruction 超过大小限制',
  ),
  timeoutMs: z.number().int().safe().min(EVALUATION_TIMEOUT_MIN_MS).max(EVALUATION_TIMEOUT_MAX_MS),
  conversationMode: z.literal('ISOLATED'),
}).strict();

const tokenUsageSchema = z.object({
  prompt: nonNegativeInteger,
  completion: nonNegativeInteger,
  total: nonNegativeInteger,
  cached: nonNegativeInteger.optional(),
}).strict().superRefine((value, context) => {
  if (value.total !== value.prompt + value.completion) {
    context.addIssue({ code: 'custom', path: ['total'], message: 'total 与输入输出 Token 之和不一致' });
  }
  if (value.cached !== undefined && value.cached > value.prompt) {
    context.addIssue({ code: 'custom', path: ['cached'], message: 'cached 不能大于 prompt' });
  }
});

export const commandExecutionResultSchema = z.object({
  outcome: z.enum(['complete', 'stopped', 'error', 'blocked', 'timed_out']),
  summary: z.string(),
  traceId,
  startedAt: isoDateTime,
  finishedAt: isoDateTime,
  durationMs: nonNegativeInteger,
  stepCount: nonNegativeInteger,
  actionCount: nonNegativeInteger,
  tokens: tokenUsageSchema,
  blockedInteraction: z.enum(['RISK', 'ASK_USER', 'USER_ACTION']).optional(),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.finishedAt) < Date.parse(value.startedAt)) {
    context.addIssue({ code: 'custom', path: ['finishedAt'], message: 'finishedAt 早于 startedAt' });
  }
  if (value.outcome === 'blocked' && value.blockedInteraction === undefined) {
    context.addIssue({ code: 'custom', path: ['blockedInteraction'], message: 'blocked 结果缺少交互类型' });
  }
  if (value.outcome !== 'blocked' && value.blockedInteraction !== undefined) {
    context.addIssue({ code: 'custom', path: ['blockedInteraction'], message: '非 blocked 结果不能包含交互类型' });
  }
});

const statusBase = {
  schemaVersion: z.literal(EVALUATION_SCHEMA_VERSION),
  requestId: evaluationId,
  runId: evaluationId,
  sampleId: evaluationId,
  updatedAt: isoDateTime,
};

export const evalStatusV1Schema = z.discriminatedUnion('state', [
  z.object({ ...statusBase, state: z.literal('ACCEPTED') }).strict(),
  z.object({ ...statusBase, state: z.literal('RUNNING'), traceId, startedAt: isoDateTime }).strict(),
  z.object({ ...statusBase, state: z.literal('COMPLETED'), result: commandExecutionResultSchema }).strict()
    .refine((value) => value.result.outcome === 'complete', { path: ['result', 'outcome'], message: 'COMPLETED 必须包含 complete 结果' }),
  z.object({ ...statusBase, state: z.literal('BLOCKED'), result: commandExecutionResultSchema }).strict()
    .refine((value) => value.result.outcome === 'blocked', { path: ['result', 'outcome'], message: 'BLOCKED 必须包含 blocked 结果' }),
  z.object({ ...statusBase, state: z.literal('TIMED_OUT'), traceId: traceId.optional(), reason: z.string().trim().min(1) }).strict(),
  z.object({ ...statusBase, state: z.literal('CANCELLED'), traceId: traceId.optional(), reason: z.string().trim().min(1) }).strict(),
  z.object({ ...statusBase, state: z.literal('ERROR'), traceId: traceId.optional(), code: z.string().trim().min(1), message: z.string().trim().min(1) }).strict(),
]);

export type EvalRequestV1 = z.infer<typeof evalRequestV1Schema>;
export type EvalStatusV1 = z.infer<typeof evalStatusV1Schema>;
export type CommandExecutionResult = z.infer<typeof commandExecutionResultSchema>;

export function canonicalizeEvalRequestForHash(request: Omit<EvalRequestV1, 'requestHash'>): string {
  return JSON.stringify({
    schemaVersion: request.schemaVersion,
    requestId: request.requestId,
    runId: request.runId,
    sampleId: request.sampleId,
    instruction: request.instruction,
    timeoutMs: request.timeoutMs,
    conversationMode: request.conversationMode,
  });
}

export function hashEvalRequest(request: Omit<EvalRequestV1, 'requestHash'>): string {
  return createHash('sha256').update(canonicalizeEvalRequestForHash(request), 'utf8').digest('hex');
}

export function encodeEvalRequestPayload(request: EvalRequestV1): string {
  const parsed = evalRequestV1Schema.parse(request);
  const raw = JSON.stringify({
    schemaVersion: parsed.schemaVersion,
    requestId: parsed.requestId,
    runId: parsed.runId,
    sampleId: parsed.sampleId,
    instruction: parsed.instruction,
    timeoutMs: parsed.timeoutMs,
    conversationMode: parsed.conversationMode,
    requestHash: parsed.requestHash,
  });
  if (Buffer.byteLength(raw, 'utf8') > EVALUATION_PAYLOAD_MAX_BYTES) {
    throw new Error('评测请求超过 payload 大小限制');
  }
  return Buffer.from(raw, 'utf8').toString('base64url');
}
