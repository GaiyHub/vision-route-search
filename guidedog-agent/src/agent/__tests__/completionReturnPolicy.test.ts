import {
  INITIAL_TASK_INTERACTION_KIND,
  isExternalUiMutationTool,
  nextInteractionKind,
  shouldReturnToExternalApp,
} from '../completionReturnPolicy';

describe('completionReturnPolicy', () => {
  test.each([
    'ui_tap', 'ui_fill', 'ui_long_press', 'ui_clear_text', 'ui_press_enter', 'ui_set_checked',
    'ui_swipe', 'ui_scroll', 'ui_scroll_page', 'open_app', 'ui_global_action',
  ])('%s upgrades a task even when only dispatch is known', (tool) => {
    expect(isExternalUiMutationTool(tool)).toBe(true);
    expect(nextInteractionKind(INITIAL_TASK_INTERACTION_KIND, tool)).toBe('device_operation');
  });

  test.each([
    ['long_click', 'ui_long_press'],
    ['longClick', 'ui_long_press'],
  ])('normalizes alias %s as %s', (alias) => {
    expect(isExternalUiMutationTool(alias)).toBe(true);
  });

  test('does not reinterpret an unknown top-level click as ui_tap', () => {
    expect(isExternalUiMutationTool('click')).toBe(false);
  });

  test.each([
    'ui_find_node', 'ui_get_node', 'wait',
    'ui_wait_for_node', 'ui_wait_for_change', 'todo_update', 'write_note', 'read_note',
    'read_skill', 'confirm_action', 'ask_user', 'task_complete', 'task_failed', 'browser_read',
  ])('%s remains host-contained or read-only', (tool) => {
    expect(isExternalUiMutationTool(tool)).toBe(false);
    expect(nextInteractionKind(INITIAL_TASK_INTERACTION_KIND, tool)).toBe('question_answer');
  });

  it('never downgrades and a fresh task starts as question-answer', () => {
    expect(nextInteractionKind('device_operation', 'browser_read')).toBe('device_operation');
    expect(INITIAL_TASK_INTERACTION_KIND).toBe('question_answer');
    expect(shouldReturnToExternalApp('question_answer')).toBe(false);
    expect(shouldReturnToExternalApp('device_operation')).toBe(true);
  });
});
