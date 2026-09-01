import {
  COMPLETION_DECISION_CHOICES,
  COMPLETION_SUPPLEMENT_MAX_LENGTH,
  buildCompletionContinuation,
  buildSupplementContinuation,
  completionPhaseNativeKey,
  validateCompletionSupplement,
} from '../completionDecision';

describe('completion decision dialog model', () => {
  it('exposes the three choices in the required order', () => {
    expect(COMPLETION_DECISION_CHOICES.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'complete', label: '完成' },
      { id: 'continue', label: '未完成' },
      { id: 'supplement', label: '补充信息' },
    ]);
  });

  it('uses distinct native subtree keys when switching dialog phases', () => {
    expect(completionPhaseNativeKey('supplement')).not.toBe(completionPhaseNativeKey('decision'));
  });

  it('requires valid supplemental text before continuation', () => {
    expect(validateCompletionSupplement('   ')).toEqual({ ok: false, error: 'empty' });
    expect(validateCompletionSupplement('x'.repeat(COMPLETION_SUPPLEMENT_MAX_LENGTH + 1)))
      .toEqual({ ok: false, error: 'too_long' });
    expect(validateCompletionSupplement('  missing detail  '))
      .toEqual({ ok: true, text: 'missing detail' });
  });

  it('attributes both continuation paths to the user', () => {
    expect(buildCompletionContinuation('模型总结')).toBe(
      '用户确认任务尚未完成：模型总结。请继续完成剩余步骤。',
    );
    expect(buildSupplementContinuation('  还要检查结果  ')).toBe('还要检查结果');
  });
});
