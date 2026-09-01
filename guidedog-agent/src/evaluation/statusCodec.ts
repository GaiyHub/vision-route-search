import {
  BlockedInteraction,
  CommandExecutionResult,
  CommandOutcome,
  EVALUATION_ID_PATTERN,
  EVALUATION_SCHEMA_VERSION,
  EVALUATION_TRACE_ID_PATTERN,
  EvalStatusV1,
  EvaluationContractError,
} from './contracts';

const OUTCOMES = new Set<CommandOutcome>(['complete', 'stopped', 'error', 'blocked', 'timed_out']);
const BLOCKED_INTERACTIONS = new Set<BlockedInteraction>(['RISK', 'ASK_USER', 'USER_ACTION']);
const STATUS_STATES = new Set([
  'ACCEPTED', 'RUNNING', 'COMPLETED', 'BLOCKED', 'TIMED_OUT', 'CANCELLED', 'ERROR',
]);
const RESULT_KEYS = new Set([
  'outcome', 'summary', 'traceId', 'startedAt', 'finishedAt', 'durationMs',
  'stepCount', 'actionCount', 'tokens', 'blockedInteraction',
]);
const TOKEN_KEYS = new Set(['prompt', 'completion', 'total', 'cached']);

function invalid(message: string, path?: string): never {
  throw new EvaluationContractError('INVALID_STATUS', message, path);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${path} 必须是对象`, path);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, path = ''): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`未知字段：${path}${key}`, `${path}${key}`);
  }
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(`${path} 必须是非负整数`, path);
  return value as number;
}

function isoTime(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    invalid(`${path} 必须是 ISO 8601 时间`, path);
  }
  return value;
}

function traceId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !EVALUATION_TRACE_ID_PATTERN.test(value)) {
    invalid(`${path} 格式无效`, path);
  }
  return value;
}

function statusKeys(...extra: string[]): Set<string> {
  return new Set(['schemaVersion', 'requestId', 'runId', 'sampleId', 'state', 'updatedAt', ...extra]);
}

export function parseCommandExecutionResult(raw: unknown): CommandExecutionResult {
  const value = record(raw, 'result');
  exactKeys(value, RESULT_KEYS, 'result.');
  if (typeof value.outcome !== 'string' || !OUTCOMES.has(value.outcome as CommandOutcome)) {
    invalid('result.outcome 无效', 'result.outcome');
  }
  if (typeof value.summary !== 'string') invalid('result.summary 必须是字符串', 'result.summary');
  traceId(value.traceId, 'result.traceId');
  const startedAt = isoTime(value.startedAt, 'result.startedAt');
  const finishedAt = isoTime(value.finishedAt, 'result.finishedAt');
  if (Date.parse(finishedAt) < Date.parse(startedAt)) invalid('result.finishedAt 早于 startedAt', 'result.finishedAt');
  nonNegativeInteger(value.durationMs, 'result.durationMs');
  nonNegativeInteger(value.stepCount, 'result.stepCount');
  nonNegativeInteger(value.actionCount, 'result.actionCount');

  const tokens = record(value.tokens, 'result.tokens');
  exactKeys(tokens, TOKEN_KEYS, 'result.tokens.');
  const prompt = nonNegativeInteger(tokens.prompt, 'result.tokens.prompt');
  const completion = nonNegativeInteger(tokens.completion, 'result.tokens.completion');
  const total = nonNegativeInteger(tokens.total, 'result.tokens.total');
  if (total !== prompt + completion) invalid('result.tokens.total 与输入输出 Token 之和不一致', 'result.tokens.total');
  if (tokens.cached !== undefined && nonNegativeInteger(tokens.cached, 'result.tokens.cached') > prompt) {
    invalid('result.tokens.cached 不能大于 prompt', 'result.tokens.cached');
  }

  if (value.outcome === 'blocked') {
    if (typeof value.blockedInteraction !== 'string' ||
        !BLOCKED_INTERACTIONS.has(value.blockedInteraction as BlockedInteraction)) {
      invalid('blocked 结果必须包含合法 blockedInteraction', 'result.blockedInteraction');
    }
  } else if (value.blockedInteraction !== undefined) {
    invalid('非 blocked 结果不能包含 blockedInteraction', 'result.blockedInteraction');
  }
  return value as unknown as CommandExecutionResult;
}

export function parseEvalStatus(raw: unknown): EvalStatusV1 {
  const value = record(raw, 'status');
  if (value.schemaVersion !== EVALUATION_SCHEMA_VERSION) {
    throw new EvaluationContractError('UNSUPPORTED_SCHEMA_VERSION', '不支持的评测状态版本', 'schemaVersion');
  }
  for (const id of ['requestId', 'runId', 'sampleId'] as const) {
    if (typeof value[id] !== 'string' || !EVALUATION_ID_PATTERN.test(value[id])) invalid(`${id} 格式无效`, id);
  }
  if (typeof value.state !== 'string' || !STATUS_STATES.has(value.state)) invalid('state 无效', 'state');
  isoTime(value.updatedAt, 'updatedAt');

  switch (value.state) {
    case 'ACCEPTED':
      exactKeys(value, statusKeys());
      break;
    case 'RUNNING':
      exactKeys(value, statusKeys('traceId', 'startedAt'));
      traceId(value.traceId, 'traceId');
      isoTime(value.startedAt, 'startedAt');
      break;
    case 'COMPLETED':
    case 'BLOCKED': {
      exactKeys(value, statusKeys('result'));
      const result = parseCommandExecutionResult(value.result);
      if (value.state === 'COMPLETED' && result.outcome !== 'complete') {
        invalid('COMPLETED 状态必须包含 complete 结果', 'result.outcome');
      }
      if (value.state === 'BLOCKED' && result.outcome !== 'blocked') {
        invalid('BLOCKED 状态必须包含 blocked 结果', 'result.outcome');
      }
      break;
    }
    case 'TIMED_OUT':
    case 'CANCELLED':
      exactKeys(value, statusKeys('traceId', 'reason'));
      if (value.traceId !== undefined) traceId(value.traceId, 'traceId');
      if (typeof value.reason !== 'string' || !value.reason.trim()) invalid('reason 不能为空', 'reason');
      break;
    case 'ERROR':
      exactKeys(value, statusKeys('traceId', 'code', 'message'));
      if (value.traceId !== undefined) traceId(value.traceId, 'traceId');
      if (typeof value.code !== 'string' || !value.code.trim()) invalid('code 不能为空', 'code');
      if (typeof value.message !== 'string' || !value.message.trim()) invalid('message 不能为空', 'message');
      break;
  }
  return value as unknown as EvalStatusV1;
}
