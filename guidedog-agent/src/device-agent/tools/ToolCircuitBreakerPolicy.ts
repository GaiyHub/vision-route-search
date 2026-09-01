import { PHONE_TOOLS } from './PhoneTools';
import { TODO_CREATE_TOOL, TODO_UPDATE_TOOL } from './TodoTool';
import { READ_SKILL_TOOL } from './SkillTool';
import { SHELL_EXECUTE_TOOL } from '../../shell';
import { BROWSER_TOOL_NAMES } from '../../browser/BrowserTypes';
import { WEB_SEARCH_TOOL } from '../../web-search';

export const CONFIRM_ACTION_DEFAULT_DESCRIPTION =
  '请求用户授权一个具体的高风险、不可逆或会产生真实外部影响的动作。本工具只确认、不执行动作，返回 confirmed 或 denied；一次授权仅对应 action 描述的对象和范围。';

export const ASK_USER_DEFAULT_DESCRIPTION =
  '仅当缺少只能由用户提供、且会实质决定预期结果的信息或选择，导致无法正确继续时提问。可依据目标、上下文或工具结果继续，或仅有多种执行方式时不得调用。一次只问一个问题；回答作为工具结果返回。';

export const REQUEST_USER_ACTION_DEFAULT_DESCRIPTION =
  '当多次自动操作仍无法可靠完成一个明确的界面步骤时，在悬浮窗指导用户手动操作并等待其点击“已完成”。不要求用户输入信息，也不得用于绕过敏感操作确认。';

export const TOOL_LOOP_HISTORY_SIZE = 30;
export const DEFAULT_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT = 8;
export const MIN_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT = 1;
export const MAX_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT = 50;

export function normalizeConsecutiveCircuitBlockLimit(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : DEFAULT_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT;
  return Math.min(
    MAX_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT,
    Math.max(MIN_CONSECUTIVE_CIRCUIT_BLOCK_LIMIT, numeric),
  );
}

export type ToolActionFamily =
  | 'navigation'
  | 'input'
  | 'gesture'
  | 'wait'
  | 'observation'
  | 'exempt';

export type ToolCircuitBreakerBehavior = 'block' | 'warn-only' | 'exempt';

export interface ToolCircuitBreakerThreshold {
  warningThreshold: number;
  blockThreshold: number;
}

export type ToolCircuitBreakerOverrides = Record<string, ToolCircuitBreakerThreshold>;

export interface ToolCircuitBreakerCatalogEntry {
  name: string;
  label: string;
  description: string;
  family: ToolActionFamily;
  behavior: ToolCircuitBreakerBehavior;
  warningThreshold: number;
  blockThreshold: number | null;
}

export interface ResolvedToolCircuitBreakerPolicy extends ToolCircuitBreakerCatalogEntry {}

const FAMILY_DEFAULTS: Record<Exclude<ToolActionFamily, 'exempt'>, ToolCircuitBreakerThreshold> = {
  navigation: { warningThreshold: 2, blockThreshold: 4 },
  input: { warningThreshold: 2, blockThreshold: 3 },
  gesture: { warningThreshold: 3, blockThreshold: 5 },
  wait: { warningThreshold: 4, blockThreshold: 8 },
  observation: { warningThreshold: 5, blockThreshold: TOOL_LOOP_HISTORY_SIZE },
};

const TOOL_ALIASES: Record<string, string> = {
  inspect_ui: 'ui_inspect',
  screenshot: 'ui_screenshot',
  tap: 'ui_tap',
  fill: 'ui_fill',
  long_press: 'ui_long_press',
  clear_text: 'ui_clear_text',
  press_enter: 'ui_press_enter',
  swipe: 'ui_swipe',
  scroll: 'ui_scroll',
  scroll_page: 'ui_scroll_page',
  global_action: 'ui_global_action',
  find_node: 'ui_find_node',
  wait_for_node: 'ui_wait_for_node',
  wait_for_change: 'ui_wait_for_change',
  set_checked: 'ui_set_checked',
  browser_use: BROWSER_TOOL_NAMES.manage,
  long_click: 'ui_long_press',
  longClick: 'ui_long_press',
  fill_text: 'ui_fill',
};

const SAFETY_EXEMPT_TOOLS = new Set([
  'task_complete',
  'task_failed',
  'todo_create',
  'todo_update',
  'read_skill',
  'confirm_action',
  'ask_user',
  'request_user_action',
]);

const NON_CONFIGURABLE_CIRCUIT_BREAKER_TOOLS = new Set(['file_read']);

const META: Record<string, { label: string; family: ToolActionFamily; description?: string }> = {
  ui_tap: { label: '点击', family: 'navigation' },
  ui_fill: { label: '填写文本', family: 'input' },
  ui_long_press: { label: '长按', family: 'navigation' },
  clipboard_set: { label: '写入剪贴板', family: 'input' },
  ui_clear_text: { label: '清空文本', family: 'input' },
  ui_press_enter: { label: '按回车', family: 'input' },
  ui_swipe: { label: '滑动', family: 'gesture' },
  ui_scroll: { label: '滚动', family: 'gesture' },
  ui_scroll_page: { label: '分页滚动', family: 'gesture' },
  open_app: { label: '打开应用', family: 'navigation' },
  ui_global_action: { label: '系统导航', family: 'navigation' },
  wait: { label: '等待', family: 'wait' },
  ui_inspect: { label: '读取界面结构', family: 'observation' },
  ui_dump_raw_tree: { label: '读取原始无障碍树', family: 'observation' },
  ui_screenshot: { label: '截取手机屏幕', family: 'observation' },
  list_apps: { label: '应用列表', family: 'observation' },
  ui_find_node: { label: '查找节点', family: 'observation' },
  ui_wait_for_node: { label: '等待节点', family: 'wait' },
  ui_wait_for_change: { label: '等待变化', family: 'wait' },
  ui_get_node: { label: '读取节点属性', family: 'observation' },
  ui_set_checked: { label: '设置选中状态', family: 'input' },
  task_complete: { label: '完成任务', family: 'exempt' },
  task_failed: { label: '结束失败任务', family: 'exempt' },
  write_note: { label: '写入任务笔记', family: 'observation' },
  read_note: { label: '读取任务笔记', family: 'observation' },
  web_search: {
    label: '联网搜索',
    family: 'observation',
    description: WEB_SEARCH_TOOL.description,
  },
  browser_navigate: { label: '浏览器导航', family: 'navigation' },
  browser_screenshot: { label: '浏览器截图', family: 'observation' },
  browser_click: { label: '浏览器点击', family: 'navigation' },
  browser_type: { label: '浏览器输入', family: 'input' },
  browser_read: { label: '浏览器读取', family: 'observation' },
  browser_find: { label: '浏览器查找', family: 'observation' },
  browser_scroll: { label: '浏览器滚动', family: 'gesture' },
  browser_wait: { label: '等待网页稳定', family: 'wait' },
  browser_manage: { label: '浏览器管理', family: 'navigation' },
  shell_execute: {
    label: '隔离 Shell',
    family: 'navigation',
    description: SHELL_EXECUTE_TOOL.description,
  },
  confirm_action: {
    label: '敏感操作确认',
    family: 'exempt',
    description: CONFIRM_ACTION_DEFAULT_DESCRIPTION,
  },
  ask_user: {
    label: '用户澄清',
    family: 'exempt',
    description: ASK_USER_DEFAULT_DESCRIPTION,
  },
  request_user_action: {
    label: '用户辅助操作',
    family: 'exempt',
    description: REQUEST_USER_ACTION_DEFAULT_DESCRIPTION,
  },
  todo_create: { label: '创建任务清单', family: 'exempt' },
  todo_update: { label: '更新任务清单', family: 'exempt' },
  read_skill: { label: '读取经验', family: 'exempt' },
};

export function canonicalToolName(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

function behaviorForFamily(family: ToolActionFamily): ToolCircuitBreakerBehavior {
  if (family === 'exempt') return 'exempt';
  if (family === 'observation') return 'warn-only';
  return 'block';
}

function catalogEntry(name: string, description?: string): ToolCircuitBreakerCatalogEntry {
  const canonical = canonicalToolName(name);
  if (SAFETY_EXEMPT_TOOLS.has(canonical)) {
    return {
      name: canonical,
      label: META[canonical]?.label ?? canonical,
      description: description ?? META[canonical]?.description ?? '',
      family: 'exempt',
      behavior: 'exempt',
      warningThreshold: TOOL_LOOP_HISTORY_SIZE,
      blockThreshold: null,
    };
  }
  const meta = META[canonical] ?? { label: canonical, family: inferFamily(canonical) };
  const defaults = FAMILY_DEFAULTS[meta.family as Exclude<ToolActionFamily, 'exempt'>];
  return {
    name: canonical,
    label: meta.label,
    description: description ?? meta.description ?? '',
    family: meta.family,
    behavior: behaviorForFamily(meta.family),
    warningThreshold: defaults.warningThreshold,
    blockThreshold: meta.family === 'observation' ? null : defaults.blockThreshold,
  };
}

function inferFamily(name: string): Exclude<ToolActionFamily, 'exempt'> {
  if (/wait|poll/.test(name)) return 'wait';
  if (/scroll|swipe|drag/.test(name)) return 'gesture';
  if (/type|input|clear|enter|check|select/.test(name)) return 'input';
  if (/find|get|read|list|inspect|observe|note/.test(name)) return 'observation';
  return 'navigation';
}

/** Shared canonical catalog consumed by both Settings and AgentLoop. */
export const TOOL_CIRCUIT_BREAKER_CATALOG: readonly ToolCircuitBreakerCatalogEntry[] =
  [
    ...PHONE_TOOLS.map((tool) => catalogEntry(tool.name, tool.description)),
    ...Object.values(BROWSER_TOOL_NAMES).map((name) => catalogEntry(name)),
    catalogEntry(WEB_SEARCH_TOOL.name, WEB_SEARCH_TOOL.description),
    catalogEntry(SHELL_EXECUTE_TOOL.name, SHELL_EXECUTE_TOOL.description),
    catalogEntry('ask_user'),
    catalogEntry('request_user_action'),
    catalogEntry(TODO_CREATE_TOOL.name, TODO_CREATE_TOOL.description),
    catalogEntry(TODO_UPDATE_TOOL.name, TODO_UPDATE_TOOL.description),
    catalogEntry(READ_SKILL_TOOL.name, READ_SKILL_TOOL.description),
  ];

export function isValidToolCircuitBreakerThreshold(
  value: unknown,
  historySize = TOOL_LOOP_HISTORY_SIZE,
): value is ToolCircuitBreakerThreshold {
  if (!value || typeof value !== 'object') return false;
  const threshold = value as Partial<ToolCircuitBreakerThreshold>;
  return (
    Number.isInteger(threshold.warningThreshold) &&
    Number.isInteger(threshold.blockThreshold) &&
    (threshold.warningThreshold as number) >= 1 &&
    (threshold.warningThreshold as number) < (threshold.blockThreshold as number) &&
    (threshold.blockThreshold as number) <= historySize
  );
}

/**
 * Normalize persisted data one entry at a time. Invalid or safety-exempt
 * entries are dropped without affecting valid settings for other tools.
 */
export function normalizeToolCircuitBreakerOverrides(
  raw: unknown,
  historySize = TOOL_LOOP_HISTORY_SIZE,
): ToolCircuitBreakerOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const normalized: ToolCircuitBreakerOverrides = {};
  for (const [rawName, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = canonicalToolName(rawName);
    if (NON_CONFIGURABLE_CIRCUIT_BREAKER_TOOLS.has(name)) continue;
    if (SAFETY_EXEMPT_TOOLS.has(name)) continue;
    if (isValidToolCircuitBreakerThreshold(value, historySize)) {
      normalized[name] = {
        warningThreshold: value.warningThreshold,
        blockThreshold: value.blockThreshold,
      };
    }
  }
  return normalized;
}

export function resolveToolCircuitBreakerPolicy(
  toolName: string,
  overrides: ToolCircuitBreakerOverrides = {},
): ResolvedToolCircuitBreakerPolicy {
  const canonical = canonicalToolName(toolName);
  const base =
    TOOL_CIRCUIT_BREAKER_CATALOG.find((entry) => entry.name === canonical) ??
    catalogEntry(canonical);
  if (base.behavior === 'exempt') return { ...base };
  const override = overrides[canonical];
  if (!isValidToolCircuitBreakerThreshold(override)) return { ...base };
  return {
    ...base,
    warningThreshold: override.warningThreshold,
    blockThreshold: base.behavior === 'warn-only' ? null : override.blockThreshold,
  };
}

export function getDefaultToolCircuitBreakerThreshold(
  toolName: string,
): ToolCircuitBreakerThreshold | null {
  const policy = resolveToolCircuitBreakerPolicy(toolName);
  if (policy.behavior === 'exempt') return null;
  return {
    warningThreshold: policy.warningThreshold,
    blockThreshold:
      policy.blockThreshold ?? FAMILY_DEFAULTS.observation.blockThreshold,
  };
}

export function createToolCircuitBreakerPolicySnapshot(
  toolNames: readonly string[],
  rawOverrides: unknown,
): Readonly<Record<string, ResolvedToolCircuitBreakerPolicy>> {
  const overrides = normalizeToolCircuitBreakerOverrides(rawOverrides);
  const snapshot: Record<string, ResolvedToolCircuitBreakerPolicy> = {};
  for (const rawName of toolNames) {
    const name = canonicalToolName(rawName);
    snapshot[name] = Object.freeze(resolveToolCircuitBreakerPolicy(name, overrides));
  }
  return Object.freeze(snapshot);
}
