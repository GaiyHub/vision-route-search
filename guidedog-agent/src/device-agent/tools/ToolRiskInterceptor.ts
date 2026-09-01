import type {
  Tool,
  ToolCall,
  ToolFailure,
  ToolRiskGateRequest,
  ToolRiskLevel,
} from '../types';
import { toolFailure } from './ToolResult';
import { canonicalToolName } from './ToolCircuitBreakerPolicy';

/**
 * Calls that can alter UI, device, browser or external state. Observation,
 * bookkeeping and user-gate tools are deliberately absent and are treated as
 * framework-owned low risk without spending model output tokens.
 */
const MODEL_ASSESSED_TOOLS = new Set([
  'ui_tap',
  'ui_fill',
  'ui_long_press',
  'clipboard_set',
  'ui_clear_text',
  'ui_press_enter',
  'ui_swipe',
  'ui_scroll',
  'ui_scroll_page',
  'ui_set_checked',
  'open_app',
  'ui_global_action',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_manage',
  'shell_execute',
]);

const RISK_PROPERTY = {
  type: 'object' as const,
  description: '仅评估本次调用的直接影响，不继承整体目标。high 必须用 reason 说明执行后立即产生的真实外部影响；low 可省略 reason',
  properties: {
    level: {
      type: 'string' as const,
      enum: ['low', 'high'],
      description: '调用执行后立即产生真实外部影响时填 high，否则填 low',
    },
    reason: {
      type: 'string' as const,
      description: 'high 必填：用简洁业务语义说明对象、关键数值和直接后果；low 省略',
    },
  },
  required: ['level'],
  additionalProperties: false,
};

export function toolNeedsModelRiskAssessment(tool: Tool | string): boolean {
  const name = typeof tool === 'string' ? tool : tool.name;
  return MODEL_ASSESSED_TOOLS.has(canonicalToolName(name));
}

/** Add the common model-facing risk envelope without changing tool handlers. */
export function addToolRiskAssessment(tool: Tool): Tool {
  if (!toolNeedsModelRiskAssessment(tool) || tool.parameters.properties._risk) return tool;
  return {
    ...tool,
    parameters: {
      ...tool.parameters,
      properties: {
        ...tool.parameters.properties,
        _risk: RISK_PROPERTY,
      },
      required: [...new Set([...(tool.parameters.required ?? []), '_risk'])],
    },
  };
}

type ParsedAssessment = {
  level: ToolRiskLevel;
  reason?: string;
};

export const MAX_RISK_REASON_CODE_POINTS = 160;

export type RiskInterception =
  | { ok: true; call: ToolCall }
  | { ok: false; failure: ToolFailure };

export interface ToolRiskInterceptorOptions {
  gate?: (request: ToolRiskGateRequest) => Promise<'execute' | 'deny'>;
  /** Adds live ref text/resource metadata to the user-facing confirmation summary. */
  describeTarget?: (call: ToolCall) => string;
}

/**
 * Central pre-dispatch safety boundary. It validates and removes model-only
 * metadata and blocks a model-declared high-risk frozen call until the host
 * returns a decision. Risk classification itself belongs entirely to the model.
 */
export class ToolRiskInterceptor {
  constructor(private readonly options: ToolRiskInterceptorOptions = {}) {}

  requiresConfirmation(call: ToolCall): boolean {
    const assessment = this.resolveAssessment(call);
    return assessment !== null && assessment.level !== 'low';
  }

  async intercept(call: ToolCall): Promise<RiskInterception> {
    if (!toolNeedsModelRiskAssessment(call.name)) {
      return { ok: true, call: stripRiskMetadata(call) };
    }
    const declared = parseAssessment(call.arguments._risk);
    if (!declared) {
      // Library consumers that do not install a host gate retain the legacy
      // direct-execution contract. Production installs a gate and therefore
      // enforces the model-facing required field below.
      if (!this.options.gate) return { ok: true, call: stripRiskMetadata(call) };
      return {
        ok: false,
        failure: toolFailure('缺少有效的工具风险评估', 'INVALID_ARGUMENT', {
          retryable: true,
          hint: '请按当前工具 schema 将 _risk 填为 { level: "low" } 或 { level: "high", reason: "…" } 后重新调用。',
        }),
      };
    }

    if (declared.level === 'high' && !declared.reason && this.options.gate) {
      return {
        ok: false,
        failure: toolFailure('高风险工具调用缺少风险说明', 'INVALID_ARGUMENT', {
          retryable: true,
          hint: '请将 _risk 设为 { level: "high", reason: "对象、关键数值和直接后果" } 后重新调用。',
        }),
      };
    }

    const assessment = this.resolveAssessment(call) ?? declared;
    const executableCall = stripRiskMetadata(call);
    if (assessment.level === 'low' || !this.options.gate) {
      return { ok: true, call: executableCall };
    }

    const summary = this.describeCall(call);
    const request: ToolRiskGateRequest = {
      toolName: canonicalToolName(call.name),
      arguments: Object.freeze({ ...executableCall.arguments }),
      risk: assessment.level,
      reason: assessment.reason!,
      summary,
      fingerprint: fingerprintCall(executableCall),
    };
    const decision = await this.options.gate(request);
    if (decision !== 'execute') {
      return {
        ok: false,
        failure: toolFailure('用户拒绝执行该操作', 'USER_DENIED_RISK_ACTION', {
          retryable: false,
          details: {
            denied: true,
            risk: assessment.level,
            summary,
          },
        }),
      };
    }
    return { ok: true, call: executableCall };
  }

  private resolveAssessment(call: ToolCall): ParsedAssessment | null {
    if (!toolNeedsModelRiskAssessment(call.name)) return null;
    return parseAssessment(call.arguments._risk);
  }

  private describeCall(call: ToolCall): string {
    const name = canonicalToolName(call.name);
    const describedTarget = this.options.describeTarget?.(call)?.trim();
    const fallbackTarget = [
      call.arguments.packageName,
      call.arguments.url,
      call.arguments.action,
      call.arguments.operation,
    ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    const target = compactTarget(describedTarget || fallbackTarget || '');
    const quotedTarget = target ? `「${target}」` : '';

    switch (name) {
      case 'ui_tap': return target ? `点击${quotedTarget}` : '点击当前界面目标';
      case 'ui_long_press': return target ? `长按${quotedTarget}` : '长按当前界面目标';
      case 'ui_fill':
      case 'clipboard_set': return '将内容写入系统剪贴板';
      case 'ui_clear_text': return target ? `清空${quotedTarget}的内容` : '清空当前输入框';
      case 'ui_press_enter': return '提交当前输入';
      case 'ui_swipe':
      case 'ui_scroll':
      case 'ui_scroll_page': return '滚动当前界面';
      case 'ui_set_checked': return target ? `更改${quotedTarget}的选中状态` : '更改当前控件的选中状态';
      case 'open_app': return target ? `打开应用${quotedTarget}` : '打开应用';
      case 'ui_global_action': return target ? `执行系统操作${quotedTarget}` : '执行系统操作';
      case 'browser_navigate': return target ? `打开网页${quotedTarget}` : '打开网页';
      case 'browser_click': return target ? `点击网页元素${quotedTarget}` : '点击网页元素';
      case 'browser_type': return target ? `向网页元素${quotedTarget}输入内容` : '向网页输入内容';
      case 'browser_scroll': return '滚动当前网页';
      case 'browser_manage': return target ? `执行浏览器操作${quotedTarget}` : '执行浏览器操作';
      case 'shell_execute': return target ? `执行 Shell 命令${quotedTarget}` : '执行 Shell 命令';
      default: return target ? `执行${quotedTarget}` : `执行工具 ${name}`;
    }
  }
}

function parseAssessment(value: unknown): ParsedAssessment | null {
  // Accept the previous string form in persisted history during migration.
  // Production still rejects legacy high-risk calls without a reason below.
  if (value === 'low' || value === 'high') return { level: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const level = record.level;
  if (level !== 'low' && level !== 'high') return null;
  const reason = sanitizeRiskReason(record.reason);
  return reason ? { level, reason } : { level };
}

/** Normalize model-authored risk prose before it crosses a UI/native bridge. */
export function sanitizeRiskReason(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const scalarSafe = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0xD800 && codePoint <= 0xDFFF ? '\uFFFD' : character;
  }).join('');
  const normalized = scalarSafe
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return undefined;
  const codePoints = Array.from(normalized);
  return codePoints.length <= MAX_RISK_REASON_CODE_POINTS
    ? normalized
    : `${codePoints.slice(0, MAX_RISK_REASON_CODE_POINTS - 1).join('')}…`;
}

function compactTarget(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 117)}…`;
}

function stripRiskMetadata(call: ToolCall): ToolCall {
  if (!Object.prototype.hasOwnProperty.call(call.arguments, '_risk')) return call;
  const { _risk: _ignored, ...argumentsWithoutRisk } = call.arguments;
  return { ...call, arguments: argumentsWithoutRisk };
}

function fingerprintCall(call: ToolCall): string {
  return `${canonicalToolName(call.name)}|${stableStringify(call.arguments)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
