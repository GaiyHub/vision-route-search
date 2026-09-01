import type { Tool } from '../types';
import { canonicalToolName } from './ToolCircuitBreakerPolicy';
import { BROWSER_TOOL_NAME_SET } from '../../browser/BrowserTypes';

export const MAX_TOOL_LABEL_LENGTH = 80;
export const MAX_TOOL_DESCRIPTION_LENGTH = 4000;

/** Core host/protocol tools that must remain available for reliable execution. */
export const REQUIRED_ENABLED_TOOLS = new Set([
  'open_app',
  'list_apps',
  'ask_user',
  'request_user_action',
  'task_complete',
  'task_failed',
  'file_read',
]);

/** Internal protocol tools have immutable availability and model metadata. */
export const NON_CONFIGURABLE_TOOLS = new Set(['file_read', 'confirm_action']);

/** Phone-UI tools hidden while forced visual mode is active. Browser DOM
 * tooling is intentionally absent: the mode only changes Android UI
 * observation, not the in-app browser's own interaction model. */
export const FORCE_VISUAL_BLOCKED_TOOLS = new Set([
  'ui_inspect',
  'ui_dump_raw_tree',
  'ui_find_node',
  'ui_get_node',
  'ui_wait_for_node',
  'ui_wait_for_change',
  'ui_set_checked',
]);

export const FORCE_VISUAL_REQUIRED_TOOL = 'ui_screenshot';

/** Tools whose observation semantics are protocol-owned and must not be
 * overridden from settings. */
export const UI_EFFECT_LOCKED_TOOLS = new Set([
  ...BROWSER_TOOL_NAME_SET,
  'wait',
  'ui_wait_for_node',
  'ui_wait_for_change',
  'ask_user',
  'request_user_action',
  'shell_execute',
  'web_search',
  'file_read',
]);

export interface ToolConfigurationOverride {
  enabled?: boolean;
  label?: string;
  description?: string;
  uiEffect?: 'change' | 'none' | 'adaptive';
}

export type ToolConfigurationOverrides = Record<string, ToolConfigurationOverride>;

function normalizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.trim() || value.length > maxLength) return undefined;
  return value;
}

/**
 * Validate persisted overrides independently so one malformed tool entry does
 * not discard configuration belonging to other tools.
 */
export function normalizeToolConfigurationOverrides(
  raw: unknown,
): ToolConfigurationOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const normalized: ToolConfigurationOverrides = {};
  for (const [rawName, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue;
    const name = canonicalToolName(rawName);
    if (NON_CONFIGURABLE_TOOLS.has(name)) continue;
    const value = rawValue as Record<string, unknown>;
    const entry: ToolConfigurationOverride = {};
    if (typeof value.enabled === 'boolean') {
      if (!(REQUIRED_ENABLED_TOOLS.has(name) && value.enabled === false)) {
        entry.enabled = value.enabled;
      }
    }
    const label = normalizeText(value.label, MAX_TOOL_LABEL_LENGTH);
    const description = normalizeText(value.description, MAX_TOOL_DESCRIPTION_LENGTH);
    if (
      !UI_EFFECT_LOCKED_TOOLS.has(name) &&
      (value.uiEffect === 'change' || value.uiEffect === 'none' || value.uiEffect === 'adaptive')
    ) {
      entry.uiEffect = value.uiEffect;
    }
    if (label !== undefined) entry.label = label;
    if (description !== undefined) entry.description = description;
    if (Object.keys(entry).length > 0) normalized[name] = entry;
  }
  return normalized;
}

export function isToolEnabled(
  toolName: string,
  enabledByDefault: boolean,
  overrides: ToolConfigurationOverrides,
): boolean {
  const name = canonicalToolName(toolName);
  if (REQUIRED_ENABLED_TOOLS.has(name)) return true;
  return overrides[name]?.enabled ?? enabledByDefault;
}

/** Apply only model-facing metadata. Canonical name and parameters stay immutable. */
export function applyToolConfiguration(
  tool: Tool,
  overrides: ToolConfigurationOverrides,
): Tool {
  const override = overrides[canonicalToolName(tool.name)];
  if (!override) return tool;
  return {
    ...tool,
    ...(override.description ? { description: override.description } : {}),
    ...(override.uiEffect === 'change' || override.uiEffect === 'none'
      ? { uiEffect: override.uiEffect }
      : {}),
  };
}
