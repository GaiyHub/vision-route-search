import { isExternalOperationToolCall } from '../completionGatePolicy';

describe('completion gate external-operation policy', () => {
  it.each([
    'ui_tap', 'ui_fill', 'open_app', 'ui_global_action', 'shell_execute', 'ask_user',
    'confirm_action',
  ])('classifies %s as an external operation', (tool) => {
    expect(isExternalOperationToolCall(tool)).toBe(true);
  });

  it.each([
    'ui_find_node', 'ui_get_node', 'list_apps', 'wait', 'todo_update',
    'read_skill', 'task_complete', 'task_failed',
  ])('classifies %s as non-operational', (tool) => {
    expect(isExternalOperationToolCall(tool)).toBe(false);
  });

  it.each([
    'browser_navigate', 'browser_click', 'browser_type', 'browser_scroll',
  ])('classifies %s as an external operation', (name) => {
    expect(isExternalOperationToolCall(name)).toBe(true);
  });

  it.each(['execute_js', 'new_tab', 'set_cookies'])(
    'classifies browser_manage operation %s as external',
    (operation) => expect(isExternalOperationToolCall('browser_manage', { operation })).toBe(true),
  );

  it.each([
    'browser_read', 'browser_find', 'browser_screenshot', 'browser_wait',
  ])('classifies %s as read-only', (name) => {
    expect(isExternalOperationToolCall(name)).toBe(false);
  });

  it.each(['fetch', 'get_cookies', 'list_tabs'])(
    'classifies browser_manage operation %s as read-only',
    (operation) => expect(isExternalOperationToolCall('browser_manage', { operation })).toBe(false),
  );

  it('does not reinterpret unknown phone-tool names', () => {
    expect(isExternalOperationToolCall('click')).toBe(false);
    expect(isExternalOperationToolCall('input_text')).toBe(false);
  });
});
