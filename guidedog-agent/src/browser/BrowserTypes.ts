import type { ScreenshotImage } from '../device-agent/types';

export const BROWSER_TOOL_NAMES = {
  navigate: 'browser_navigate',
  screenshot: 'browser_screenshot',
  click: 'browser_click',
  type: 'browser_type',
  read: 'browser_read',
  find: 'browser_find',
  scroll: 'browser_scroll',
  wait: 'browser_wait',
  manage: 'browser_manage',
} as const;

export const BROWSER_TOOL_NAME_SET: ReadonlySet<string> = new Set(Object.values(BROWSER_TOOL_NAMES));

export function isBrowserToolName(name: string): boolean {
  return BROWSER_TOOL_NAME_SET.has(name);
}

export const CANONICAL_BROWSER_ACTIONS = [
  'navigate', 'screenshot', 'click', 'type', 'get_text', 'scroll',
  'get_page_info', 'execute_js', 'find_elements', 'hover', 'get_readable',
  'set_user_agent', 'set_viewport', 'get_backbone', 'fetch', 'new_tab',
  'close_tab', 'list_tabs', 'get_cookies', 'set_cookies',
  'scroll_and_collect', 'wait_for_dom_stable',
] as const;

export const LEGACY_BROWSER_ACTIONS = ['page_info', 'read_page', 'wait_for_stable'] as const;
export const BROWSER_ACTIONS = [...CANONICAL_BROWSER_ACTIONS, ...LEGACY_BROWSER_ACTIONS] as const;

export type CanonicalBrowserAction = (typeof CANONICAL_BROWSER_ACTIONS)[number];
export type BrowserAction = (typeof BROWSER_ACTIONS)[number];

export const BROWSER_ACTION_ALIASES: Readonly<Record<string, CanonicalBrowserAction>> = {
  page_info: 'get_page_info',
  read_page: 'get_readable',
  wait_for_stable: 'wait_for_dom_stable',
};

export function canonicalBrowserAction(action: BrowserAction): CanonicalBrowserAction {
  return BROWSER_ACTION_ALIASES[action] ?? action as CanonicalBrowserAction;
}

export type BrowserCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  http_only?: boolean;
  expires?: number;
};

export interface BrowserToolArgs {
  action: BrowserAction;
  url?: string;
  selector?: string;
  ref?: string;
  text?: string;
  query?: string;
  coordinate_x?: number;
  coordinate_y?: number;
  direction?: 'up' | 'down';
  amount?: number;
  timeout?: number;
  timeoutMs?: number;
  script?: string;
  user_agent?: 'desktop_chrome' | 'mobile_chrome';
  max_depth?: number;
  tab_id?: number;
  viewport_width?: number;
  viewport_height?: number;
  reset?: boolean;
  keywords?: string[] | string;
  fuzzy?: boolean;
  item_selector?: string;
  scroll_count?: number;
  full_page?: boolean;
  cookies?: BrowserCookie[] | string;
}

export interface BrowserPageMeta {
  url: string;
  title: string;
  loading: boolean;
}

export interface BrowserTabMeta extends BrowserPageMeta {
  id: number;
  selected: boolean;
}

export interface BrowserViewport {
  width: number;
  height: number;
}

export interface BrowserResultData {
  action: CanonicalBrowserAction;
  tab_id?: number;
  pageURL?: string;
  [key: string]: unknown;
}

export interface BrowserObservationResult {
  ok: boolean;
  data?: BrowserResultData;
  error?: string;
  hint?: string;
  observationImage?: ScreenshotImage;
  sensitive?: boolean;
}

export interface BrowserHostAdapter {
  show(): void;
  hide(): void;
  navigate(url: string, timeoutMs: number, tabId?: number): Promise<BrowserPageMeta>;
  evaluate(script: string, timeoutMs: number, tabId?: number): Promise<unknown>;
  getMeta(tabId?: number): BrowserPageMeta;
  getSelectedTabId(): number;
  getViewTag(tabId?: number): number | null;
  getViewport(tabId?: number): BrowserViewport | null;
  selectTab(tabId: number): BrowserPageMeta;
  newTab(url: string | undefined, timeoutMs: number): Promise<BrowserTabMeta>;
  closeTab(tabId?: number): Promise<BrowserTabMeta[]>;
  listTabs(): BrowserTabMeta[];
  setUserAgent(profile: 'desktop_chrome' | 'mobile_chrome', tabId?: number): Promise<BrowserPageMeta>;
  setViewport(viewport: BrowserViewport | null, tabId?: number): Promise<BrowserPageMeta>;
}
