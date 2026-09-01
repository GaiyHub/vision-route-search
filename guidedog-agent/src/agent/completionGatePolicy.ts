import { canonicalToolName } from '../device-agent/tools/ToolCircuitBreakerPolicy';
import { isExternalUiMutationTool } from './completionReturnPolicy';
import { BROWSER_TOOL_NAMES } from '../browser/BrowserTypes';

const BROWSER_EXTERNAL_OPERATION_TOOLS: ReadonlySet<string> = new Set([
  BROWSER_TOOL_NAMES.navigate,
  BROWSER_TOOL_NAMES.click,
  BROWSER_TOOL_NAMES.type,
  BROWSER_TOOL_NAMES.scroll,
]);
const BROWSER_EXTERNAL_MANAGE_OPERATIONS = new Set([
  'hover', 'execute_js', 'new_tab', 'close_tab', 'set_user_agent', 'set_viewport', 'set_cookies',
]);

/**
 * Whether one dispatched call means the agent actually operated an external
 * environment, or had a user clarification interaction that must retain final
 * confirmation. Read-only observation and other host protocol tools deliberately
 * return false so their terminal answers do not require completion approval.
 */
export function isExternalOperationToolCall(
  toolName: string,
  args: Record<string, unknown> = {},
): boolean {
  const name = canonicalToolName(toolName);
  if (isExternalUiMutationTool(name)) return true;
  if (name === 'ask_user' || name === 'confirm_action' || name === 'request_user_action') {
    return true;
  }
  if (name === 'shell_execute') return true;
  if (BROWSER_EXTERNAL_OPERATION_TOOLS.has(name)) return true;
  if (name === BROWSER_TOOL_NAMES.manage) {
    return typeof args.operation === 'string' && BROWSER_EXTERNAL_MANAGE_OPERATIONS.has(args.operation);
  }
  return false;
}
