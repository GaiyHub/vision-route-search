/** Model-visible result budgets by tool family. */
const UNBOUNDED_RESULT_TOOLS = new Set([
  'ui_inspect',
  'ui_screenshot',
  'ui_scroll_page',
  'list_apps',
  'read_skill',
]);

const TOOL_RESULT_BUDGETS: Record<string, number> = {
  browser_read: 24_000,
  browser_find: 24_000,
  browser_manage: 24_000,
  shell_execute: 16_000,
  ui_find_node: 12_000,
  file_read: 12_000,
};

const DEFAULT_TOOL_RESULT_BUDGET = 8_000;
const TRUNCATION_MARKER = '…[已截断]';

/** `null` means the tool result is forwarded without local truncation. */
export function toolResultBudget(toolName?: string): number | null {
  if (toolName && UNBOUNDED_RESULT_TOOLS.has(toolName)) return null;
  return toolName
    ? TOOL_RESULT_BUDGETS[toolName] ?? DEFAULT_TOOL_RESULT_BUDGET
    : DEFAULT_TOOL_RESULT_BUDGET;
}

export function truncateToolResult(text: string, toolName?: string): string {
  const limit = toolResultBudget(toolName);
  if (limit === null || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`;
}
