import type { Tool, ToolCall, ToolResult } from '../types';
import {
  normalizeErrorCode,
  toolFailure,
  toolResultMetadata,
  toolSuccess,
} from './ToolResult';
import { normalizeArgsBySchema, validateArgs } from './ToolSchema';

/**
 * Normalize any handler return value (or thrown error) to the unified
 * [ToolResult] shape. Legacy `{ ok, ... }` wrappers are accepted, but unknown
 * business fields are moved into data/details rather than leaking through the
 * top level. Thrown values become canonical failures without stack traces.
 */
export function normalizeToolResult(raw: unknown): ToolResult {
  if (raw instanceof Error) {
    return toolFailure(raw, 'TOOL_EXECUTION_ERROR');
  }
  if (raw === false) {
    return toolFailure('操作未成功（无更多信息）', 'OPERATION_REJECTED');
  }
  if (
    raw !== null &&
    typeof raw === 'object' &&
    typeof (raw as { ok?: unknown }).ok === 'boolean'
  ) {
    const record = raw as Record<string, unknown> & { ok: boolean };
    const metadata = toolResultMetadata(record);
    if (record.ok) {
      if (Object.prototype.hasOwnProperty.call(record, 'data')) {
        return toolSuccess(record.data, metadata);
      }
      const data = omitReserved(record, SUCCESS_RESERVED_KEYS);
      return toolSuccess(Object.keys(data).length > 0 ? data : undefined, metadata);
    }

    const code = explicitOrInferredCode(record.code, record.error);
    const details = Object.prototype.hasOwnProperty.call(record, 'details')
      ? record.details
      : Object.prototype.hasOwnProperty.call(record, 'data')
        ? record.data
        : omitReserved(record, FAILURE_RESERVED_KEYS);
    return toolFailure(record.error, code, {
      ...metadata,
      details: details && typeof details === 'object' && Object.keys(details as object).length === 0
        ? undefined
        : details,
    });
  }
  return toolSuccess(raw);
}

const SUCCESS_RESERVED_KEYS = new Set(['ok', 'data', 'observationImage', 'sensitive']);
const FAILURE_RESERVED_KEYS = new Set([
  'ok', 'data', 'error', 'code', 'retryable', 'hint', 'details', 'observationImage', 'sensitive',
]);

function omitReserved(
  value: Record<string, unknown>,
  reserved: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !reserved.has(key)));
}

function explicitOrInferredCode(code: unknown, error: unknown): string {
  if (typeof code === 'string' && code.trim()) return normalizeErrorCode(code);
  if (typeof error === 'string' && /^[A-Z][A-Z0-9_]+$/.test(error.trim())) {
    return normalizeErrorCode(error);
  }
  return 'TOOL_EXECUTION_ERROR';
}

/**
 * Registry for available agent tools.
 *
 * The registry holds tool definitions and their execution handlers.
 * Default phone tools are registered automatically; custom tools can
 * be added at runtime.
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>> =
    new Map();

  /**
   * Register a tool with its definition and execution handler.
   */
  register(
    tool: Tool,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.tools.set(tool.name, tool);
    this.handlers.set(tool.name, handler);
  }

  /**
   * Get all registered tool definitions (for passing to the LLM).
   */
  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** Validate a call against the handler-facing schema without dispatching it. */
  validate(call: ToolCall): ToolResult | null {
    const handler = this.handlers.get(call.name);
    if (!handler) {
      return toolFailure(
        `No handler registered for tool "${call.name}". ` +
          `Available: ${Array.from(this.handlers.keys()).join(', ')}`,
        'TOOL_NOT_FOUND',
      );
    }
    const tool = this.tools.get(call.name);
    if (!tool) return null;
    const normalizedArguments = normalizeArgsBySchema(call.arguments, tool.parameters);
    const validation = validateArgs(normalizedArguments, tool.parameters);
    if (validation.valid) return null;
    return toolFailure('工具参数无效', 'INVALID_ARGUMENT', {
      retryable: true,
      hint: '请严格按当前工具 schema 重新组织参数，不要混用其他模式的字段。',
      details: { errors: validation.errors },
    });
  }

  /**
   * Execute a tool call using the registered handler.
   *
   * The outcome is always a [ToolResult]: handler exceptions are caught and
   * converted to `{ ok: false, error }` (never rethrown), so a failing tool
   * never aborts the loop — the model receives the reason in the next prompt.
   * An unregistered tool yields a structured failure instead of throwing.
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    const handler = this.handlers.get(call.name);
    if (!handler) {
      return toolFailure(
        `No handler registered for tool "${call.name}". ` +
          `Available: ${Array.from(this.handlers.keys()).join(', ')}`,
        'TOOL_NOT_FOUND',
      );
    }
    const tool = this.tools.get(call.name);
    const normalizedArguments = tool
      ? normalizeArgsBySchema(call.arguments, tool.parameters)
      : call.arguments;
    const validationFailure = this.validate({ ...call, arguments: normalizedArguments });
    if (validationFailure) return validationFailure;
    try {
      return normalizeToolResult(await handler(normalizedArguments));
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err
        ? normalizeErrorCode((err as { code?: unknown }).code)
        : 'TOOL_EXECUTION_ERROR';
      const details = err && typeof err === 'object' && 'details' in err
        ? (err as { details?: unknown }).details
        : undefined;
      return toolFailure(err, code, { details });
    }
  }

  /**
   * Check whether a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}
