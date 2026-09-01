/**
 * Vendor-neutral OpenTelemetry trace persistence.
 *
 * The JSONL encoding is local, but every completed record follows the OTel
 * Span data model (trace/span IDs, parent, kind, timestamps, attributes,
 * events and status). GenAI operations use the official `gen_ai.*` semantic
 * conventions, so an exporter can map these records to OTLP without knowing
 * about Langfuse, LangSmith or the agent loop.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');

type LegacyStatus = 'ok' | 'error';
type AttributeValue = string | number | boolean | string[] | number[] | boolean[];
type Attributes = Record<string, AttributeValue>;

interface SpanEvent {
  name: string;
  timeUnixNano: string;
  attributes: Attributes;
}

interface OpenSpan {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: 'INTERNAL' | 'CLIENT';
  startTimeUnixNano: string;
  attributes: Attributes;
  events: SpanEvent[];
}

const RESOURCE_ATTRIBUTES: Attributes = {
  'service.name': 'doupao-android-agent',
  'service.namespace': 'doupao',
  'service.version': '0.1.0',
  'deployment.environment.name': typeof __DEV__ !== 'undefined' && __DEV__
    ? 'development'
    : 'production',
};

const INSTRUMENTATION_SCOPE = {
  name: 'com.watchdog.agent.telemetry',
  version: '1.0.0',
};

let _traceId: string | null = null;
let _rootSpanId: string | null = null;
const _openSpans = new Map<string, OpenSpan>();
let _lines: string[] = [];
let _flushQueue: Promise<void> = Promise.resolve();

function randomHex(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

function unixNano(ms = Date.now()): string {
  return `${ms}000000`;
}

function bounded(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[max-depth]';
  if (typeof value === 'string') {
    return value.length > 12_000 ? `${value.slice(0, 11_997)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => bounded(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 200)
        .map(([key, item]) => [key, bounded(item, depth + 1)]),
    );
  }
  return value;
}

function jsonAttribute(value: unknown): string {
  try {
    return JSON.stringify(bounded(value));
  } catch {
    return JSON.stringify(String(value));
  }
}

function attributeValue(value: unknown): AttributeValue | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return bounded(value) as AttributeValue;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.slice(0, 200) as string[];
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
    return value.slice(0, 200) as number[];
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'boolean')) {
    return value.slice(0, 200) as boolean[];
  }
  if (value === undefined || value === null) return null;
  return jsonAttribute(value);
}

function snakeCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9_.-]/g, '_').toLowerCase();
}

function customAttributes(values: Record<string, unknown>, prefix = 'doupao'): Attributes {
  const result: Attributes = {};
  for (const [rawKey, rawValue] of Object.entries(values)) {
    const value = attributeValue(rawValue);
    if (value === null) continue;
    const key = rawKey.includes('.') ? rawKey : `${prefix}.${snakeCase(rawKey)}`;
    result[key] = value;
  }
  return result;
}

function startDefinition(
  requestedName: string,
  input: Record<string, unknown>,
): Pick<OpenSpan, 'name' | 'kind' | 'attributes'> {
  if (requestedName === 'agent.request') {
    const command = typeof input.command === 'string' ? input.command : jsonAttribute(input);
    return {
      name: 'invoke_agent 豆泡',
      kind: 'INTERNAL',
      attributes: {
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.agent.name': '豆泡',
        'gen_ai.output.type': 'text',
        // Content capture is intentional for this local diagnostic stream.
        'gen_ai.input.messages': jsonAttribute([
          { role: 'user', parts: [{ type: 'text', content: command }] },
        ]),
      },
    };
  }

  if (requestedName.startsWith('tool.')) {
    const toolName = requestedName.slice('tool.'.length) || String(input.tool ?? 'unknown');
    const attributes: Attributes = {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': toolName,
      'gen_ai.tool.type': 'function',
    };
    if (input.args !== undefined) {
      attributes['gen_ai.tool.call.arguments'] = jsonAttribute(input.args);
    }
    if (typeof input.step === 'number') attributes['doupao.agent.step'] = input.step;
    return { name: `execute_tool ${toolName}`, kind: 'INTERNAL', attributes };
  }

  if (requestedName === 'model.chat') {
    const model = String(input.model ?? 'unknown');
    const attributes: Attributes = {
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': model,
    };
    if (typeof input.provider === 'string' && input.provider) {
      attributes['gen_ai.provider.name'] = input.provider;
    }
    if (typeof input.attempt === 'number') attributes['doupao.inference.attempt'] = input.attempt;
    if (typeof input.round === 'number') attributes['doupao.agent.round'] = input.round;
    if (typeof input.step === 'number') attributes['doupao.agent.step'] = input.step;
    if (typeof input.vision === 'boolean') attributes['doupao.inference.vision'] = input.vision;
    return {
      name: `chat ${model}`,
      kind: input.remote === false ? 'INTERNAL' : 'CLIENT',
      attributes,
    };
  }

  return {
    name: requestedName,
    kind: 'INTERNAL',
    attributes: customAttributes(input),
  };
}

function endAttributes(span: OpenSpan, output: Record<string, unknown>): Attributes {
  if (span.attributes['gen_ai.operation.name'] === 'invoke_agent') {
    const result: Attributes = {};
    if (typeof output.summary === 'string') {
      result['gen_ai.output.messages'] = jsonAttribute([
        { role: 'assistant', parts: [{ type: 'text', content: output.summary }] },
      ]);
    }
    if (output.outcome !== undefined) result['doupao.agent.outcome'] = String(output.outcome);
    if (typeof output.actions === 'number') result['doupao.agent.action_count'] = output.actions;
    return result;
  }
  if (span.attributes['gen_ai.operation.name'] === 'execute_tool') {
    const value = output.result ?? output;
    return { 'gen_ai.tool.call.result': jsonAttribute(value) };
  }
  if (span.attributes['gen_ai.operation.name'] === 'chat') {
    const result: Attributes = {};
    if (typeof output.inputTokens === 'number') {
      result['gen_ai.usage.input_tokens'] = output.inputTokens;
    }
    if (typeof output.outputTokens === 'number') {
      result['gen_ai.usage.output_tokens'] = output.outputTokens;
    }
    if (typeof output.cachedTokens === 'number') {
      result['gen_ai.usage.cache_read.input_tokens'] = output.cachedTokens;
    }
    if (typeof output.finishReason === 'string') {
      result['gen_ai.response.finish_reasons'] = [output.finishReason];
    }
    return result;
  }
  return customAttributes(output);
}

function emit(record: Record<string, unknown>, traceId = _traceId): void {
  if (!traceId) return;
  const line = JSON.stringify(record);
  _lines.push(line);
  // eslint-disable-next-line no-console
  console.log(`[OTEL] ${line.length > 1200 ? `${line.slice(0, 1197)}…` : line}`);
  if (_lines.length >= 20) void flush(traceId);
}

/** Start one local GenAI agent invocation trace. */
export function beginTrace(attributes: Record<string, unknown> = {}): string {
  const traceId = randomHex(32);
  _traceId = traceId;
  _lines = [];
  _openSpans.clear();
  _rootSpanId = startSpan('agent.request', attributes, null);
  return traceId;
}

export function getTraceId(): string | null {
  return _traceId;
}

/** Start an OTel span; existing call sites keep this compatibility signature. */
export function startSpan(
  requestedName: string,
  input: Record<string, unknown> = {},
  parentSpanId: string | null = _rootSpanId,
): string {
  const spanId = randomHex(16);
  const definition = startDefinition(requestedName, input);
  _openSpans.set(spanId, {
    spanId,
    parentSpanId,
    name: definition.name,
    kind: definition.kind,
    startTimeUnixNano: unixNano(),
    attributes: definition.attributes,
    events: [],
  });
  return spanId;
}

/** Record an already completed operation when its measured duration arrives. */
export function recordCompletedSpan(
  requestedName: string,
  durationMs: number,
  status: LegacyStatus,
  input: Record<string, unknown> = {},
  output: Record<string, unknown> = {},
): string {
  const spanId = startSpan(requestedName, input);
  const span = _openSpans.get(spanId);
  if (span) span.startTimeUnixNano = unixNano(Date.now() - Math.max(0, durationMs));
  endSpan(spanId, status, output);
  return spanId;
}

/** End and export one complete OTel span record. */
export function endSpan(
  spanId: string,
  status: LegacyStatus = 'ok',
  output: Record<string, unknown> = {},
): void {
  const span = _openSpans.get(spanId);
  if (!span) return;
  _openSpans.delete(spanId);
  const attributes: Attributes = { ...span.attributes, ...endAttributes(span, output) };
  if (status === 'error') {
    attributes['error.type'] =
      typeof output.errorType === 'string' ? output.errorType : 'doupao.agent.operation_failed';
  }
  emit({
    encoding: 'otel-span-jsonl-v1',
    resource: { attributes: RESOURCE_ATTRIBUTES },
    instrumentationScope: INSTRUMENTATION_SCOPE,
    traceId: _traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    traceFlags: 1,
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: unixNano(),
    attributes,
    events: span.events,
    status: status === 'error'
      ? { code: 'ERROR', message: String(output.error ?? output.summary ?? 'operation failed') }
      : { code: 'UNSET' },
  });
}

/** Record a point-in-time OTel span event on the root agent span. */
export function logEvent(name: string, values: Record<string, unknown> = {}): void {
  const root = _rootSpanId ? _openSpans.get(_rootSpanId) : undefined;
  if (!root) return;
  root.events.push({
    name,
    timeUnixNano: unixNano(),
    attributes: customAttributes(values),
  });
}

/** Close the root invocation span and persist the final batch. */
export function endTrace(
  status: LegacyStatus = 'ok',
  output: Record<string, unknown> = {},
): void {
  const traceId = _traceId;
  if (!traceId) return;
  if (_rootSpanId) endSpan(_rootSpanId, status, output);
  _rootSpanId = null;
  _traceId = null;
  void flush(traceId);
}

/** Append completed spans to the local internal and adb-readable trace file. */
export async function flush(traceId: string | null = _traceId): Promise<void> {
  if (_lines.length === 0 || !traceId) {
    await _flushQueue;
    return;
  }
  const pending = _lines;
  _lines = [];
  const fileName = `otel-${traceId}.jsonl`;
  const content = `${pending.join('\n')}\n`;

  _flushQueue = _flushQueue.then(async () => {
    try {
      const internalDir = `${FileSystem.documentDirectory ?? ''}tasklogs/`;
      await FileSystem.makeDirectoryAsync(internalDir, { intermediates: true }).catch(() => {});
      await appendText(internalDir + fileName, content);

      const docDir = FileSystem.documentDirectory ?? '';
      const pkg = docDir.split('/').filter(Boolean).find((part) => part.includes('.')) ?? '';
      if (pkg) {
        const externalDir = `file:///storage/emulated/0/Android/data/${pkg}/files/tasklogs/`;
        await FileSystem.makeDirectoryAsync(externalDir, { intermediates: true }).catch(() => {});
        await appendText(externalDir + fileName, content);
      }
    } catch {
      // Telemetry must never affect the agent run.
    }
  });
  await _flushQueue;
}

async function appendText(uri: string, content: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri).catch(() => ({ exists: false }));
  const existing = info.exists
    ? await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 })
        .catch(() => '')
    : '';
  await FileSystem.writeAsStringAsync(uri, existing + content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}
