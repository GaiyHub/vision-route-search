import type { EvalRequestV1, EvalStatusV1 } from '../contracts/evaluation.js';
import {
  sampleMetricsSchema,
  traceDocumentSchema,
  type SampleMetrics,
  type TraceDocument,
  type TraceEvent,
} from './schema.js';

interface OtelRecord {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string | null;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: Record<string, unknown>;
  events?: Array<{ name?: string; timeUnixNano?: string; attributes?: Record<string, unknown> }>;
  status?: { code?: string };
}

interface OrderedEvent {
  timeNano: string;
  line: number;
  event: UnsequencedTraceEvent;
}

type UnsequencedTraceEvent = TraceEvent extends infer Event
  ? Event extends TraceEvent ? Omit<Event, 'eventId' | 'sequence'> : never
  : never;

export function normalizeEvaluationEvidence(
  request: EvalRequestV1,
  status: EvalStatusV1,
  otelRaw: string,
): { trace: TraceDocument; metrics: SampleMetrics } {
  const records = otelRaw.trim().split('\n').filter(Boolean)
    .map((line) => JSON.parse(line) as OtelRecord);
  const traceId = traceIdOf(status) ?? records[0]?.traceId ?? 'unknown';
  const root = records.find((record) => record.parentSpanId === null);
  const firstNano = records.map((record) => record.startTimeUnixNano).filter(isString).sort(compareNano)[0];
  const ordered: OrderedEvent[] = [{
    timeNano: firstNano ?? `${Date.parse(status.updatedAt)}000000`,
    line: 1,
    event: {
      type: 'USER_INPUT',
      occurredAt: isoFromNano(firstNano, status.updatedAt),
      source: { artifactId: 'request' },
      input: request.instruction,
    },
  }];

  records.forEach((record, index) => {
    const attributes = record.attributes ?? {};
    const operation = attributes['gen_ai.operation.name'];
    const source = {
      artifactId: `otel-${traceId}`,
      line: index + 1,
      ...(record.spanId ? { spanId: record.spanId } : {}),
      ...(record.parentSpanId !== undefined ? { parentSpanId: record.parentSpanId } : {}),
    };
    if (operation === 'chat') {
      const prompt = numberAttribute(attributes, 'gen_ai.usage.input_tokens');
      const completion = numberAttribute(attributes, 'gen_ai.usage.output_tokens');
      const cached = numberAttribute(attributes, 'gen_ai.usage.cache_read.input_tokens');
      const messages = jsonAttribute(attributes['gen_ai.input.messages']);
      const tools = jsonAttribute(attributes['gen_ai.tool.definitions']);
      const image = jsonAttribute(attributes['doupao.inference.image']);
      const response = jsonAttribute(attributes['gen_ai.output.messages']);
      const attempt = numberAttribute(attributes, 'doupao.inference.attempt');
      ordered.push({
        timeNano: record.startTimeUnixNano ?? '0', line: index + 1,
        event: {
          type: 'MODEL_CALL', occurredAt: isoFromNano(record.startTimeUnixNano, status.updatedAt),
          ...(durationMs(record) !== undefined ? { durationMs: durationMs(record) } : {}),
          ...integerFields(attributes), source,
          model: stringAttribute(attributes, 'gen_ai.request.model') ?? 'unknown',
          ...(stringAttribute(attributes, 'gen_ai.provider.name') ? {
            provider: stringAttribute(attributes, 'gen_ai.provider.name'),
          } : {}),
          ...(attempt !== null && attempt > 0 ? { attempt } : {}),
          ...(messages !== undefined || tools !== undefined || image !== undefined ? {
            request: { ...(messages !== undefined ? { messages } : {}), ...(tools !== undefined ? { tools } : {}), ...(image !== undefined ? { image } : {}) },
          } : {}),
          ...(response !== undefined ? { response } : {}),
          ...(finishReason(attributes) ? { finishReason: finishReason(attributes) } : {}),
          usage: {
            prompt, completion,
            total: prompt !== null && completion !== null ? prompt + completion : null,
            cached,
          },
        },
      });
    } else if (operation === 'execute_tool') {
      const success = record.status?.code === 'ERROR' ? false
        : record.status?.code === 'UNSET' || record.status?.code === 'OK' ? true : null;
      ordered.push({
        timeNano: record.startTimeUnixNano ?? '0', line: index + 1,
        event: {
          type: 'TOOL_CALL', occurredAt: isoFromNano(record.startTimeUnixNano, status.updatedAt),
          ...(durationMs(record) !== undefined ? { durationMs: durationMs(record) } : {}),
          ...integerFields(attributes), source,
          toolName: stringAttribute(attributes, 'gen_ai.tool.name') ?? record.name?.replace(/^execute_tool\s+/, '') ?? 'unknown',
          ...(attributes['gen_ai.tool.call.arguments'] !== undefined ? { input: jsonAttribute(attributes['gen_ai.tool.call.arguments']) } : {}),
          ...(attributes['gen_ai.tool.call.result'] !== undefined ? { output: jsonAttribute(attributes['gen_ai.tool.call.result']) } : {}),
          success,
          ...(stringAttribute(attributes, 'error.type') ? { errorCode: stringAttribute(attributes, 'error.type') } : {}),
        },
      });
    }
    for (const event of record.events ?? []) {
      ordered.push({
        timeNano: event.timeUnixNano ?? record.startTimeUnixNano ?? '0', line: index + 1,
        event: {
          type: 'AGENT_EVENT',
          occurredAt: isoFromNano(event.timeUnixNano, status.updatedAt),
          ...integerFields(event.attributes ?? {}),
          source,
          name: event.name ?? 'unknown',
          ...(event.attributes && Object.keys(event.attributes).length > 0 ? { data: event.attributes } : {}),
        },
      });
    }
  });

  ordered.sort((left, right) => compareNano(left.timeNano, right.timeNano) || left.line - right.line);
  const events = ordered.map(({ event }, sequence): TraceEvent => ({
    ...event,
    eventId: `event-${String(sequence + 1).padStart(6, '0')}`,
    sequence,
  } as TraceEvent));
  const trace = traceDocumentSchema.parse({
    schemaVersion: 1, runId: request.runId, sampleId: request.sampleId,
    requestId: request.requestId, traceId, generatedAt: status.updatedAt, events,
  });
  return { trace, metrics: buildMetrics(status, trace, root) };
}

function buildMetrics(status: EvalStatusV1, trace: TraceDocument, root?: OtelRecord): SampleMetrics {
  const modelCalls = trace.events.filter((event): event is Extract<TraceEvent, { type: 'MODEL_CALL' }> => event.type === 'MODEL_CALL');
  const toolCalls = trace.events.filter((event): event is Extract<TraceEvent, { type: 'TOOL_CALL' }> => event.type === 'TOOL_CALL');
  const result = status.state === 'COMPLETED' || status.state === 'BLOCKED' ? status.result : undefined;
  const tokenComplete = modelCalls.length > 0 && modelCalls.every((call) =>
    call.usage.prompt !== null && call.usage.completion !== null && call.usage.total !== null);
  const prompt = tokenComplete ? sum(modelCalls.map((call) => call.usage.prompt!)) : result?.tokens.prompt ?? null;
  const completion = tokenComplete ? sum(modelCalls.map((call) => call.usage.completion!)) : result?.tokens.completion ?? null;
  const total = prompt !== null && completion !== null ? prompt + completion : null;
  const cacheComplete = modelCalls.length > 0 && modelCalls.every((call) => call.usage.cached !== null && call.usage.prompt !== null);
  const cached = cacheComplete ? sum(modelCalls.map((call) => call.usage.cached!)) : result?.tokens.cached ?? null;
  const succeeded = toolCalls.filter((call) => call.success === true).length;
  const failed = toolCalls.filter((call) => call.success === false).length;
  const unknown = toolCalls.length - succeeded - failed;
  const knownTools = succeeded + failed;
  const duration = result?.durationMs ?? durationMs(root);
  const verdict = verdictOf(status);
  const unavailable: SampleMetrics['unavailable'] = [];
  if (prompt === null || completion === null || total === null) unavailable.push('tokens');
  const cacheHitRate = prompt !== null && prompt > 0 && cached !== null ? cached / prompt : null;
  if (cacheHitRate === null) unavailable.push('cacheHitRate');
  const toolSuccessRate = knownTools > 0 ? succeeded / knownTools : null;
  if (toolSuccessRate === null) unavailable.push('toolSuccessRate');
  if (duration === undefined) unavailable.push('duration');
  const stepFromTrace = Math.max(0, ...trace.events.map((event) => event.step ?? 0));
  return sampleMetricsSchema.parse({
    schemaVersion: 1, success: verdict === 'PASSED', verdict,
    ...(result ? { agentOutcome: result.outcome } : {}),
    tokenUsage: { prompt, completion, total, cached },
    stepCount: result?.stepCount ?? stepFromTrace,
    modelCallCount: modelCalls.length,
    toolCallCount: toolCalls.length,
    cacheHitRate,
    toolSuccessRate,
    toolCalls: { succeeded, failed, unknown },
    durationMs: duration ?? null,
    modelDurationMs: modelCalls.length > 0 ? sum(modelCalls.map((call) => call.durationMs ?? 0)) : null,
    toolDurationMs: toolCalls.length > 0 ? sum(toolCalls.map((call) => call.durationMs ?? 0)) : null,
    unavailable,
  });
}

function verdictOf(status: EvalStatusV1): SampleMetrics['verdict'] {
  switch (status.state) {
    case 'COMPLETED': return 'PASSED';
    case 'BLOCKED': return 'BLOCKED';
    case 'TIMED_OUT': return 'TIMED_OUT';
    case 'CANCELLED': return 'CANCELLED';
    default: return 'INFRA_ERROR';
  }
}

function traceIdOf(status: EvalStatusV1): string | undefined {
  if (status.state === 'COMPLETED' || status.state === 'BLOCKED') return status.result.traceId;
  if (status.state === 'TIMED_OUT' || status.state === 'CANCELLED' || status.state === 'ERROR') return status.traceId;
  return undefined;
}

function integerFields(attributes: Record<string, unknown>): { round?: number; step?: number } {
  const round = numberAttribute(attributes, 'doupao.agent.round');
  const step = numberAttribute(attributes, 'doupao.agent.step');
  return {
    ...(round !== null && Number.isInteger(round) ? { round } : {}),
    ...(step !== null && Number.isInteger(step) ? { step } : {}),
  };
}

function numberAttribute(attributes: Record<string, unknown>, key: string): number | null {
  const value = attributes[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function stringAttribute(attributes: Record<string, unknown>, key: string): string | undefined {
  return typeof attributes[key] === 'string' ? attributes[key] : undefined;
}

function finishReason(attributes: Record<string, unknown>): string | undefined {
  const value = attributes['gen_ai.response.finish_reasons'];
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
}

function jsonAttribute(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function durationMs(record?: OtelRecord): number | undefined {
  if (!record?.startTimeUnixNano || !record.endTimeUnixNano) return undefined;
  try { return Number((BigInt(record.endTimeUnixNano) - BigInt(record.startTimeUnixNano)) / 1_000_000n); }
  catch { return undefined; }
}

function isoFromNano(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try { return new Date(Number(BigInt(value) / 1_000_000n)).toISOString(); }
  catch { return fallback; }
}

function compareNano(left: string, right: string): number {
  try { return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0; }
  catch { return left.localeCompare(right); }
}

function isString(value: string | undefined): value is string { return typeof value === 'string'; }
function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0); }
