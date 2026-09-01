import { canonicalToolName } from '../device-agent/tools/ToolCircuitBreakerPolicy';

export type TaskInteractionKind = 'question_answer' | 'device_operation';

export const INITIAL_TASK_INTERACTION_KIND: TaskInteractionKind = 'question_answer';

const EXTERNAL_UI_MUTATION_TOOLS = new Set([
  'ui_tap',
  'ui_fill',
  'ui_long_press',
  'ui_clear_text',
  'ui_press_enter',
  'ui_set_checked',
  'ui_swipe',
  'ui_scroll',
  'ui_scroll_page',
  'open_app',
  'ui_global_action',
]);

export function isExternalUiMutationTool(toolName: string): boolean {
  return EXTERNAL_UI_MUTATION_TOOLS.has(canonicalToolName(toolName));
}

/** Task classification is monotonic: once a phone mutation is dispatched,
 * later read-only or host-contained actions cannot downgrade the task. */
export function nextInteractionKind(
  current: TaskInteractionKind,
  toolName: string,
): TaskInteractionKind {
  if (current === 'device_operation' || isExternalUiMutationTool(toolName)) {
    return 'device_operation';
  }
  return 'question_answer';
}

export function shouldReturnToExternalApp(kind: TaskInteractionKind): boolean {
  return kind === 'device_operation';
}
