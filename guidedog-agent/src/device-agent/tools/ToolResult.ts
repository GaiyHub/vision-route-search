import type {
  ScreenshotImage,
  ToolFailure,
  ToolResult,
  ToolResultMetadata,
  ToolSuccess,
} from '../types';

export interface ToolFailureOptions extends ToolResultMetadata {
  /** @deprecated Legacy input only; deliberately omitted from model-visible results. */
  retryable?: boolean;
  /** @deprecated Legacy input only; deliberately omitted from model-visible results. */
  hint?: string;
  details?: unknown;
}

export function toolSuccess<T>(data: T, metadata: ToolResultMetadata = {}): ToolSuccess<T> {
  return { ok: true, data, ...metadata };
}

export function toolFailure(
  error: unknown,
  code = 'TOOL_EXECUTION_ERROR',
  options: ToolFailureOptions = {},
): ToolFailure {
  const {
    retryable: _legacyRetryable,
    hint: _legacyHint,
    details,
    ...metadata
  } = options;
  return {
    ok: false,
    error: safeErrorMessage(error),
    code: normalizeErrorCode(code),
    ...(details !== undefined ? { details } : {}),
    ...metadata,
  };
}

export function isToolResult(value: unknown): value is ToolResult {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as { ok?: unknown }).ok === 'boolean',
  );
}

export function isToolFailure(value: unknown): value is ToolFailure {
  return isToolResult(value) && value.ok === false;
}

export function toolResultData<T = unknown>(value: unknown): T | undefined {
  return isToolResult(value) && value.ok ? value.data as T : undefined;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || '工具执行失败';
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error === undefined || error === null) return '工具执行失败（无更多信息）';
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== '{}' ? serialized : String(error);
  } catch {
    return String(error);
  }
}

export function normalizeErrorCode(code: unknown): string {
  if (typeof code !== 'string') return 'TOOL_EXECUTION_ERROR';
  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
  return normalized || 'TOOL_EXECUTION_ERROR';
}

export function toolResultMetadata(raw: Record<string, unknown>): ToolResultMetadata {
  const observationImage = raw.observationImage as ScreenshotImage | undefined;
  return {
    ...(observationImage ? { observationImage } : {}),
    ...(typeof raw.sensitive === 'boolean' ? { sensitive: raw.sensitive } : {}),
  };
}
