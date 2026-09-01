export const COMPLETION_SUPPLEMENT_MAX_LENGTH = 2000;

export const COMPLETION_DECISION_CHOICES = [
  { id: 'complete', label: '完成', accessibilityLabel: '确认任务完成' },
  { id: 'continue', label: '未完成', accessibilityLabel: '任务未完成，继续执行' },
  { id: 'supplement', label: '补充信息', accessibilityLabel: '补充任务信息' },
] as const;

export type CompletionDecisionChoice = typeof COMPLETION_DECISION_CHOICES[number]['id'];
export type CompletionDecisionPhase = 'decision' | 'supplement';

/** Native host keys must differ so Android cannot recycle button text across phases. */
export function completionPhaseNativeKey(phase: CompletionDecisionPhase): string {
  return `completion-${phase}-native-subtree`;
}

export type SupplementValidation =
  | { ok: true; text: string }
  | { ok: false; error: 'empty' | 'too_long' };

export function validateCompletionSupplement(rawText: string): SupplementValidation {
  const text = rawText.trim();
  if (!text) return { ok: false, error: 'empty' };
  if (text.length > COMPLETION_SUPPLEMENT_MAX_LENGTH) {
    return { ok: false, error: 'too_long' };
  }
  return { ok: true, text };
}

export function buildCompletionContinuation(result: string): string {
  return `用户确认任务尚未完成：${result}。请继续完成剩余步骤。`;
}

export function buildSupplementContinuation(text: string): string {
  // Text entered while a completion verdict is visible is still an ordinary
  // turn in the continuous conversation. Do not pre-classify it as a
  // correction or force the old goal to remain active; the model can infer
  // whether it continues, revises, or replaces the preceding goal.
  return text.trim();
}
