import type { ToolCall, ToolFailure } from '../types';
import { toolFailure } from '../tools/ToolResult';
import {
  TOOL_LOOP_HISTORY_SIZE,
  canonicalToolName,
  createToolCircuitBreakerPolicySnapshot,
  normalizeToolCircuitBreakerOverrides,
  resolveToolCircuitBreakerPolicy,
  type ResolvedToolCircuitBreakerPolicy,
  type ToolActionFamily,
  type ToolCircuitBreakerOverrides,
} from '../tools/ToolCircuitBreakerPolicy';

export type CircuitBreakerReason =
  | 'UI_UNCHANGED'
  | 'TOOL_FAILED_UI_UNCHANGED'
  | 'INVALID_ARGUMENT'
  | 'RESULT_UNCHANGED'
  | 'LOOP_BLOCKED'
  | 'CONSECUTIVE_BLOCK_LIMIT'
  | 'RECOVERED';

export interface ToolLoopObservation {
  screenFingerprint: string;
  foregroundFingerprint: string;
  todoFingerprint: string;
  screenshotUnchanged: boolean;
}

export interface NormalizedToolAction {
  canonicalName: string;
  family: ToolActionFamily;
  fingerprint: string;
  summary: string;
  normalizedArguments: Record<string, unknown>;
}

export interface ToolLoopRecord {
  action: NormalizedToolAction;
  resultFingerprint: string;
  before: ToolLoopObservation;
  after: ToolLoopObservation;
  progress: boolean;
  reason: CircuitBreakerReason;
  failure: ToolFailureSnapshot | null;
  timestamp: number;
}

interface ToolFailureSnapshot {
  code: string;
  message: string;
  details?: unknown;
}

export interface ToolLoopWarning {
  tool: string;
  family: ToolActionFamily;
  fingerprint: string;
  count: number;
  reason: CircuitBreakerReason;
  message: string;
}

export type ToolLoopBlockedResult = ToolFailure;

export interface CircuitBreakerEvent {
  type: 'warning' | 'blocked' | 'recovered' | 'terminated';
  tool: string;
  family: ToolActionFamily;
  fingerprint: string;
  count: number;
  blockedAttempts?: number;
  reason: CircuitBreakerReason;
}

export interface ToolLoopRecordResult {
  progress: boolean;
  noProgressCount: number;
  warning: ToolLoopWarning | null;
  event: CircuitBreakerEvent | null;
}

const DISPLAY_ONLY_KEYS = new Set([
  'tool_title',
  'title',
  'call_id',
  'callId',
  'timestamp',
  'description',
  'observationImage',
  'base64',
]);
const COORDINATE_GRID = 24;

export class ToolLoopCircuitBreaker {
  private readonly policies: Readonly<Record<string, ResolvedToolCircuitBreakerPolicy>>;
  private readonly overrides: ToolCircuitBreakerOverrides;
  private readonly historySize: number;
  private readonly records: ToolLoopRecord[] = [];
  private readonly warnedFingerprints = new Set<string>();
  private readonly blockedAttempts = new Map<string, number>();
  private pendingWarning: ToolLoopWarning | null = null;

  constructor(options: {
    toolNames: readonly string[];
    overrides?: ToolCircuitBreakerOverrides;
    historySize?: number;
  }) {
    this.historySize = options.historySize ?? TOOL_LOOP_HISTORY_SIZE;
    if (!Number.isInteger(this.historySize) || this.historySize < 2) {
      throw new Error('Tool loop history size must be an integer >= 2');
    }
    this.overrides = normalizeToolCircuitBreakerOverrides(options.overrides ?? {});
    this.policies = createToolCircuitBreakerPolicySnapshot(
      options.toolNames,
      this.overrides,
    );
    for (const policy of Object.values(this.policies)) {
      if (
        policy.behavior === 'block' &&
        (policy.blockThreshold === null ||
          policy.warningThreshold >= policy.blockThreshold ||
          policy.blockThreshold > this.historySize)
      ) {
        throw new Error(`Invalid circuit-breaker thresholds for ${policy.name}`);
      }
    }
  }

  reset(): void {
    this.records.length = 0;
    this.warnedFingerprints.clear();
    this.blockedAttempts.clear();
    this.pendingWarning = null;
  }

  policyFor(toolName: string): ResolvedToolCircuitBreakerPolicy {
    const name = canonicalToolName(toolName);
    return this.policies[name] ?? resolveToolCircuitBreakerPolicy(name, this.overrides);
  }

  normalize(call: ToolCall): NormalizedToolAction {
    return normalizeToolAction(call, this.policyFor(call.name));
  }

  checkBefore(call: ToolCall): {
    action: NormalizedToolAction;
    count: number;
    blocked: ToolLoopBlockedResult | null;
    event: CircuitBreakerEvent | null;
  } {
    const action = this.normalize(call);
    const policy = this.policyFor(action.canonicalName);
    const count = this.countNoProgress(action.fingerprint);
    if (
      policy.behavior !== 'block' ||
      policy.blockThreshold === null ||
      count < policy.blockThreshold
    ) {
      this.blockedAttempts.delete(action.fingerprint);
      return { action, count, blocked: null, event: null };
    }
    const blockedAttempts = (this.blockedAttempts.get(action.fingerprint) ?? 0) + 1;
    this.blockedAttempts.set(action.fingerprint, blockedAttempts);
    const lastFailure = this.findLatestEquivalent(action.fingerprint)?.failure ?? null;
    const invalidArguments = lastFailure?.code === 'INVALID_ARGUMENT' ||
      lastFailure?.code === 'MALFORMED_TOOL_ARGUMENTS';
    const lastFailureSummary = lastFailure ? describeFailure(lastFailure) : '';
    const event: CircuitBreakerEvent = {
      type: 'blocked',
      tool: action.canonicalName,
      family: action.family,
      fingerprint: shortFingerprint(action.fingerprint),
      count,
      blockedAttempts,
      reason: 'LOOP_BLOCKED',
    };
    const recoveryHint = invalidArguments
      ? `最近一次失败是参数无效：${lastFailureSummary}。必须修改参数字段或类型；再次提交完全相同的参数不会执行工具。`
      : action.canonicalName === 'ui_tap'
      ? `已连续 ${count} 次执行等价点击但界面没有进展。当前点击模式已熔断，不要继续使用同一 ref、文本或资源 ID 原样重试。重新观察并检查遮罩或弹窗；若节点点击已被接受但界面未变化，可使用最新 ui_screenshot 的 coordinate 模式，仍无法继续时调用 task_failed。`
      : `已连续 ${count} 次执行等价动作但界面没有进展。请重新观察屏幕、校正目标、处理遮罩或弹窗、返回或重新打开应用；不要原样重试，仍无法继续时调用 task_failed。`;
    return {
      action,
      count,
      event,
      blocked: toolFailure(
        invalidArguments
          ? '相同的无效工具参数已被循环熔断器阻止'
          : '等价动作连续无进展，已被循环熔断器阻止',
        'LOOP_BLOCKED', {
        retryable: false,
        details: {
          count,
          blockedAttempts,
          action: action.summary,
          ...(lastFailure ? { lastFailure } : {}),
          guidance: recoveryHint,
        },
      }),
    };
  }

  recordAfter(
    call: ToolCall,
    result: unknown,
    before: ToolLoopObservation,
    after: ToolLoopObservation,
  ): ToolLoopRecordResult {
    const action = this.normalize(call);
    const policy = this.policyFor(action.canonicalName);
    if (policy.behavior === 'exempt') {
      return { progress: false, noProgressCount: 0, warning: null, event: null };
    }

    const previous = this.findLatestEquivalent(action.fingerprint);
    const resultFingerprint = fingerprintValue(result);
    const failure = toolFailureSnapshot(result);
    const progress = determineToolProgress({
      canonicalName: action.canonicalName,
      policy,
      result,
      resultFingerprint,
      previousResultFingerprint: previous?.resultFingerprint ?? null,
      before,
      after,
    });
    const reason = progress
      ? 'RECOVERED'
      : failure?.code === 'INVALID_ARGUMENT' || failure?.code === 'MALFORMED_TOOL_ARGUMENTS'
        ? 'INVALID_ARGUMENT'
        : toolResultFailed(result)
        ? 'TOOL_FAILED_UI_UNCHANGED'
        : previous?.resultFingerprint === resultFingerprint
          ? 'RESULT_UNCHANGED'
          : 'UI_UNCHANGED';
    this.records.push({
      action,
      resultFingerprint,
      before,
      after,
      progress,
      reason,
      failure,
      timestamp: Date.now(),
    });
    while (this.records.length > this.historySize) this.records.shift();

    if (progress) {
      const hadLoop = this.warnedFingerprints.delete(action.fingerprint);
      this.blockedAttempts.delete(action.fingerprint);
      return {
        progress,
        noProgressCount: 0,
        warning: null,
        event: hadLoop
          ? {
              type: 'recovered',
              tool: action.canonicalName,
              family: action.family,
              fingerprint: shortFingerprint(action.fingerprint),
              count: 0,
              reason: 'RECOVERED',
            }
          : null,
      };
    }

    const count = this.countNoProgress(action.fingerprint);
    let warning: ToolLoopWarning | null = null;
    if (
      count >= policy.warningThreshold &&
      !this.warnedFingerprints.has(action.fingerprint)
    ) {
      this.warnedFingerprints.add(action.fingerprint);
      const invalidArguments = reason === 'INVALID_ARGUMENT' && failure !== null;
      warning = {
        tool: action.canonicalName,
        family: action.family,
        fingerprint: shortFingerprint(action.fingerprint),
        count,
        reason,
        message: invalidArguments
          ? `[工具参数熔断提醒] 「${action.summary}」已连续 ${count} 次因参数无效而失败。最近错误：${describeFailure(failure)}。请修改参数字段或类型，不要原样重试。`
          : action.canonicalName === 'ui_tap'
          ? `[工具熔断提醒] 「${action.summary}」已连续 ${count} 次没有产生界面进展。不要原样重试同一点击模式；重新观察并检查遮罩/弹窗，节点点击无效时可使用最新 ui_screenshot 的 coordinate 模式，仍无法推进时调用 task_failed。`
          : `[工具熔断提醒] 「${action.summary}」已连续 ${count} 次没有产生界面进展。请重新观察并检查遮罩/弹窗，或校正目标、返回、重新打开应用；不要原样重试，仍无法推进时调用 task_failed。`,
      };
      this.pendingWarning = warning;
    }
    return {
      progress,
      noProgressCount: count,
      warning,
      event: warning
        ? {
            type: 'warning',
            tool: warning.tool,
            family: warning.family,
            fingerprint: warning.fingerprint,
            count: warning.count,
            reason: warning.reason,
          }
        : null,
    };
  }

  consumeWarning(): ToolLoopWarning | null {
    const warning = this.pendingWarning;
    this.pendingWarning = null;
    return warning;
  }

  private findLatestEquivalent(fingerprint: string): ToolLoopRecord | null {
    for (let index = this.records.length - 1; index >= 0; index--) {
      const record = this.records[index];
      if (record.action.fingerprint === fingerprint) return record;
    }
    return null;
  }

  private countNoProgress(fingerprint: string): number {
    let count = 0;
    for (let index = this.records.length - 1; index >= 0; index--) {
      const record = this.records[index];
      if (record.action.fingerprint === fingerprint) {
        if (record.progress) break;
        count++;
        continue;
      }
      const otherPolicy = this.policyFor(record.action.canonicalName);
      if (otherPolicy.behavior === 'warn-only') continue;
      if (record.progress) break;
    }
    return count;
  }
}

export function createToolLoopObservation(input: {
  screenState: string;
  foreground?: unknown;
  todoState?: string;
  screenshotUnchanged?: boolean;
}): ToolLoopObservation {
  return {
    screenFingerprint: fingerprintValue(normalizeScreenState(input.screenState)),
    foregroundFingerprint: fingerprintValue(input.foreground ?? null),
    todoFingerprint: fingerprintValue(input.todoState ?? ''),
    screenshotUnchanged: input.screenshotUnchanged === true,
  };
}

export function normalizeToolAction(
  call: ToolCall,
  policy: ResolvedToolCircuitBreakerPolicy = resolveToolCircuitBreakerPolicy(call.name),
): NormalizedToolAction {
  const canonicalName = canonicalToolName(call.name);
  const args = normalizeArguments(canonicalName, call.arguments ?? {});
  const fingerprint = `${canonicalName}|${stableStringify(args)}`;
  return {
    canonicalName,
    family: policy.family,
    fingerprint,
    summary: `${canonicalName}(${summarizeArguments(args)})`,
    normalizedArguments: args,
  };
}

function normalizeArguments(
  toolName: string,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const clean = stableNormalize(raw) as Record<string, unknown>;
  // Model-only safety metadata must not make the same physical action look
  // different to loop detection when its wording changes between rounds.
  delete clean._risk;
  if (toolName === 'ui_tap' || toolName === 'ui_long_press') {
    const result: Record<string, unknown> = {};
    if (toolName === 'ui_tap') {
      if (typeof clean.mode === 'string') {
        result.mode = clean.mode === 'semantic'
          ? inferTapMode(clean)
          : clean.mode;
      }
      result.target = typeof clean.ref === 'string'
        ? 'ref'
        : typeof clean.nodeId === 'string'
          ? 'nodeId'
        : typeof clean.x === 'number' || typeof clean.y === 'number'
          ? 'coordinate'
          : 'semantic';
    } else if (typeof clean.mode === 'string') {
      result.mode = clean.mode;
    }
    const resolvedBounds = clean._resolvedBounds;
    if (
      resolvedBounds &&
      typeof resolvedBounds === 'object' &&
      typeof (resolvedBounds as Record<string, unknown>).left === 'number' &&
      typeof (resolvedBounds as Record<string, unknown>).top === 'number' &&
      typeof (resolvedBounds as Record<string, unknown>).right === 'number' &&
      typeof (resolvedBounds as Record<string, unknown>).bottom === 'number'
    ) {
      const bounds = resolvedBounds as Record<'left' | 'top' | 'right' | 'bottom', number>;
      result.targetRegion = [
        quantize(bounds.left),
        quantize(bounds.top),
        quantize(bounds.right),
        quantize(bounds.bottom),
      ];
      if (typeof clean._resolvedResourceId === 'string' && clean._resolvedResourceId.trim()) {
        result.resourceId = clean._resolvedResourceId.trim();
      }
    } else if (typeof clean.ref === 'string' && clean.ref.trim()) {
      result.ref = clean.ref.trim();
    }
    if (typeof clean.nodeId === 'string' && clean.nodeId.trim()) {
      result.nodeId = clean.nodeId.trim();
    }
    for (const key of ['text', 'contentDescription', 'resourceId'] as const) {
      if (typeof clean[key] === 'string' && clean[key].trim()) result[key] = clean[key].trim();
    }
    if (typeof clean.matchIndex === 'number') result.matchIndex = clean.matchIndex;
    if (typeof clean.x === 'number' && typeof clean.y === 'number') {
      result.region = [quantize(clean.x), quantize(clean.y)];
    }
    return Object.keys(result).length > 0 ? result : clean;
  }
  if (toolName === 'ui_swipe') {
    const startX = numberOrZero(clean.startX);
    const startY = numberOrZero(clean.startY);
    const endX = numberOrZero(clean.endX);
    const endY = numberOrZero(clean.endY);
    const dx = endX - startX;
    const dy = endY - startY;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const direction = horizontal ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up';
    const magnitude = Math.sqrt(dx * dx + dy * dy);
    return {
      direction,
      startRegion: [quantize(startX), quantize(startY)],
      endRegion: [quantize(endX), quantize(endY)],
      magnitude: magnitude < 240 ? 'short' : magnitude < 720 ? 'medium' : 'long',
    };
  }
  if (toolName === 'wait' || toolName === 'ui_wait_for_node' || toolName === 'ui_wait_for_change' || toolName === 'browser_wait') {
    const result = { ...clean };
    for (const key of ['ms', 'timeoutMs', 'intervalMs', 'pollIntervalMs']) {
      // Duration changes are tuning of the same wait action, not a different
      // recovery strategy. Keep semantic targets (for example node queries)
      // while excluding timing knobs from the loop fingerprint.
      delete result[key];
    }
    return result;
  }
  return clean;
}

function inferTapMode(args: Record<string, unknown>): string {
  if (typeof args.ref === 'string') return 'ref';
  if (typeof args.x === 'number' || typeof args.y === 'number') return 'coordinate';
  if (typeof args.contentDescription === 'string') return 'content_description';
  if (typeof args.resourceId === 'string') return 'resource_id';
  return 'text';
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (DISPLAY_ONLY_KEYS.has(key)) continue;
      normalized[key] = stableNormalize((value as Record<string, unknown>)[key]);
    }
    return normalized;
  }
  if (typeof value === 'string') return value.trim().replace(/\r\n?/g, '\n');
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return value;
}

function normalizeScreenState(value: string): string {
  return value
    .replace(/\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/g, '<time>')
    .replace(/\b\d{1,3}%/g, '<percent>')
    .replace(/\b\d+(?:\.\d+)?\s*(?:KB|MB|GB)\/s\b/gi, '<rate>')
    .replace(/\s+/g, ' ')
    .trim();
}

function determineToolProgress(input: {
  canonicalName: string;
  policy: ResolvedToolCircuitBreakerPolicy;
  result: unknown;
  resultFingerprint: string;
  previousResultFingerprint: string | null;
  before: ToolLoopObservation;
  after: ToolLoopObservation;
}): boolean {
  if (toolResultVerifiedChanged(input.result)) return true;
  if (
    input.before.screenFingerprint !== input.after.screenFingerprint ||
    input.before.foregroundFingerprint !== input.after.foregroundFingerprint ||
    input.before.todoFingerprint !== input.after.todoFingerprint
  ) {
    return true;
  }
  // Wait output often contains elapsed-time text. A different string is not
  // evidence of progress; only a verified or observed state change above is.
  if (input.policy.family === 'wait') return false;
  if (input.policy.behavior === 'warn-only') {
    return (
      !toolResultFailed(input.result) &&
      input.previousResultFingerprint !== null &&
      input.previousResultFingerprint !== input.resultFingerprint
    );
  }
  if (input.canonicalName.startsWith('browser_')) {
    // Browser calls deliberately reuse the phone observation. URL, DOM and
    // scroll progress live in the structured tool result instead.
    return (
      !toolResultFailed(input.result) &&
      input.previousResultFingerprint !== null &&
      input.previousResultFingerprint !== input.resultFingerprint
    );
  }
  return false;
}

/** Action tools may perform their own explicit post-condition verification.
 * Trust only the affirmative verified signal, never a bare native true. */
function toolResultVerifiedChanged(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const root = result as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object'
    ? root.data as Record<string, unknown>
    : null;
  const candidate = data ?? root;
  return candidate.verificationStatus === 'verified_changed' &&
    (candidate.changed === true || candidate.screenChanged === true);
}

function toolResultFailed(result: unknown): boolean {
  if (result === false || result instanceof Error) return true;
  return Boolean(
    result &&
      typeof result === 'object' &&
      ((result as { ok?: unknown }).ok === false ||
        (result as { error?: unknown }).error !== undefined),
  );
}

function toolFailureSnapshot(result: unknown): ToolFailureSnapshot | null {
  if (!result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  if (record.ok !== false && record.error === undefined) return null;
  const code = typeof record.code === 'string' && record.code.trim()
    ? record.code.trim().toUpperCase()
    : 'TOOL_EXECUTION_ERROR';
  const message = typeof record.error === 'string' && record.error.trim()
    ? record.error.trim()
    : '工具执行失败';
  return {
    code,
    message,
    ...(record.details !== undefined ? { details: record.details } : {}),
  };
}

function describeFailure(failure: ToolFailureSnapshot): string {
  if (failure.details && typeof failure.details === 'object') {
    const errors = (failure.details as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
      const first = errors.find((item): item is string => typeof item === 'string' && item.trim() !== '');
      if (first) return first.trim();
    }
  }
  return failure.message;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

function fingerprintValue(value: unknown): string {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function shortFingerprint(fingerprint: string): string {
  return fingerprintValue(fingerprint).slice(0, 8);
}

function quantize(value: number): number {
  return Math.floor(value / COORDINATE_GRID);
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function summarizeArguments(args: Record<string, unknown>): string {
  const safe: Record<string, unknown> = { ...args };
  if ('text' in safe) safe.text = '<redacted>';
  if ('value' in safe) safe.value = '<redacted>';
  const text = stableStringify(safe);
  return text.length <= 96 ? text : `${text.slice(0, 95)}…`;
}
