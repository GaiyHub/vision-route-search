import type { CommandExecutionResult } from '../contracts/evaluation.js';
import type { EvaluationAssertion } from '../datasets/schema.js';
import type { SampleMetrics, TraceDocument, TraceEvent } from '../evidence/schema.js';
import { assertionReportSchema, type AssertionReport, type AssertionResult } from './schema.js';

export interface AssertionEvidence {
  outcome?: CommandExecutionResult['outcome'];
  finalResponse?: string;
  blockedInteraction?: CommandExecutionResult['blockedInteraction'];
  metrics?: SampleMetrics;
  trace?: TraceDocument;
  foregroundPackage?: string;
  uiText?: string;
}

export function evaluateAssertions(assertions: EvaluationAssertion[], evidence: AssertionEvidence): AssertionReport {
  const results = assertions.map((assertion, index) => evaluate(assertion, evidence, `assertion-${String(index + 1).padStart(3, '0')}`));
  return assertionReportSchema.parse({
    schemaVersion: 1,
    results,
    summary: {
      passed: results.filter((item) => item.verdict === 'PASS').length,
      failed: results.filter((item) => item.verdict === 'FAIL').length,
      errors: results.filter((item) => item.verdict === 'ERROR').length,
    },
  });
}

function evaluate(assertion: EvaluationAssertion, evidence: AssertionEvidence, assertionId: string): AssertionResult {
  const finish = (verdict: AssertionResult['verdict'], reason: string, pointers: string[] = []): AssertionResult => ({
    schemaVersion: 1, assertionId, type: assertion.type, verdict, reason, evidence: pointers,
  });
  switch (assertion.type) {
    case 'outcome':
      if (evidence.outcome === undefined) return finish('ERROR', '缺少 Agent outcome 证据');
      return evidence.outcome === assertion.equals
        ? finish('PASS', `outcome 为 ${evidence.outcome}`, ['status.result.outcome'])
        : finish('FAIL', `期望 outcome=${assertion.equals}，实际为 ${evidence.outcome}`, ['status.result.outcome']);
    case 'finalResponse':
      return evaluateText(assertion, evidence.finalResponse, finish, 'finalResponse');
    case 'toolCalled': {
      if (!evidence.trace) return finish('ERROR', '缺少标准化轨迹证据');
      const calls = evidence.trace.events.filter((event): event is Extract<TraceEvent, { type: 'TOOL_CALL' }> => event.type === 'TOOL_CALL' && event.toolName === assertion.name);
      const pointers = calls.map((event) => `trace:${event.eventId}`);
      const passed = assertion.forbidden ? calls.length === 0
        : calls.length >= (assertion.minCalls ?? 1) && (assertion.maxCalls === undefined || calls.length <= assertion.maxCalls);
      return finish(passed ? 'PASS' : 'FAIL', `${assertion.name} 调用 ${calls.length} 次`, pointers);
    }
    case 'toolResult': {
      if (!evidence.trace) return finish('ERROR', '缺少标准化轨迹证据');
      const calls = evidence.trace.events.filter((event): event is Extract<TraceEvent, { type: 'TOOL_CALL' }> => event.type === 'TOOL_CALL' && event.toolName === assertion.name);
      const matched = calls.filter((event) => assertion.success !== undefined
        ? event.success === assertion.success
        : event.errorCode === assertion.errorCode);
      return finish(matched.length > 0 ? 'PASS' : 'FAIL', matched.length > 0 ? `找到符合条件的 ${assertion.name} 结果` : `未找到符合条件的 ${assertion.name} 结果`, matched.map((event) => `trace:${event.eventId}`));
    }
    case 'duration':
      return evaluateRange(assertion, evidence.metrics?.durationMs, finish, '总耗时', 'metrics.durationMs');
    case 'steps':
      return evaluateRange(assertion, evidence.metrics?.stepCount, finish, 'Agent 步数', 'metrics.stepCount');
    case 'tokens':
      return evaluateRange(assertion, evidence.metrics?.tokenUsage[assertion.metric], finish, `${assertion.metric} Token`, `metrics.tokenUsage.${assertion.metric}`);
    case 'foregroundPackage':
      if (evidence.foregroundPackage === undefined) return finish('ERROR', '缺少最终前台包名证据');
      return evidence.foregroundPackage === assertion.equals
        ? finish('PASS', `前台包名为 ${evidence.foregroundPackage}`, ['device.foregroundPackage'])
        : finish('FAIL', `期望前台包名 ${assertion.equals}，实际为 ${evidence.foregroundPackage}`, ['device.foregroundPackage']);
    case 'uiText':
      return evaluateText(assertion, evidence.uiText, finish, 'uiHierarchy');
    case 'blockedInteraction': {
      if (evidence.blockedInteraction === undefined) {
        return assertion.forbidden
          ? finish('PASS', `未发生 ${assertion.interaction} 阻塞`, ['status.result.blockedInteraction'])
          : finish('FAIL', `未发生期望的 ${assertion.interaction} 阻塞`, ['status.result.blockedInteraction']);
      }
      const matched = evidence.blockedInteraction === assertion.interaction;
      const passed = assertion.forbidden ? !matched : matched;
      return finish(passed ? 'PASS' : 'FAIL', `实际阻塞类型为 ${evidence.blockedInteraction}`, ['status.result.blockedInteraction']);
    }
  }
}

type Finish = (verdict: AssertionResult['verdict'], reason: string, evidence?: string[]) => AssertionResult;

function evaluateText(
  assertion: Extract<EvaluationAssertion, { type: 'finalResponse' | 'uiText' }>,
  actual: string | undefined,
  finish: Finish,
  pointer: string,
): AssertionResult {
  if (actual === undefined) return finish('ERROR', `缺少 ${pointer} 证据`);
  const source = assertion.caseSensitive ? actual : actual.toLocaleLowerCase('en-US');
  const normalize = (value: string) => assertion.caseSensitive ? value : value.toLocaleLowerCase('en-US');
  let passed: boolean;
  let expectation: string;
  try {
    if (assertion.contains !== undefined) {
      passed = source.includes(normalize(assertion.contains)); expectation = `包含“${assertion.contains}”`;
    } else if (assertion.excludes !== undefined) {
      passed = !source.includes(normalize(assertion.excludes)); expectation = `不包含“${assertion.excludes}”`;
    } else {
      passed = new RegExp(assertion.matches!, assertion.caseSensitive ? 'u' : 'iu').test(actual); expectation = `匹配 /${assertion.matches}/`;
    }
  } catch {
    return finish('ERROR', '正则表达式无法安全执行');
  }
  return finish(passed ? 'PASS' : 'FAIL', `${pointer} ${passed ? '满足' : '不满足'}条件：${expectation}`, [pointer]);
}

function evaluateRange(
  assertion: { min?: number | undefined; max?: number | undefined },
  actual: number | null | undefined,
  finish: Finish,
  label: string,
  pointer: string,
): AssertionResult {
  if (actual === undefined || actual === null) return finish('ERROR', `缺少 ${label} 证据`);
  const passed = (assertion.min === undefined || actual >= assertion.min) && (assertion.max === undefined || actual <= assertion.max);
  const range = [assertion.min === undefined ? null : `>=${assertion.min}`, assertion.max === undefined ? null : `<=${assertion.max}`].filter(Boolean).join(' 且 ');
  return finish(passed ? 'PASS' : 'FAIL', `${label}=${actual}，要求 ${range}`, [pointer]);
}
