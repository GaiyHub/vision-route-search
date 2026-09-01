import type { Tool } from '../device-agent/types';
import { browserSession } from './BrowserSession';
import type { BrowserAction } from './BrowserTypes';
import { BROWSER_TOOL_NAMES } from './BrowserTypes';

export interface BrowserToolRegistration {
  tool: Tool;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const tabId = { type: 'number' as const, description: '目标标签页 ID；省略时使用当前标签页' };
const selector = { type: 'string' as const, description: '目标元素或滚动容器的 CSS selector' };
const ref = { type: 'string' as const, description: '来自 browser_find 或 browser_read 的稳定元素 ref' };

function tool(
  name: string,
  description: string,
  properties: Tool['parameters']['properties'],
  required: string[] = [],
  uiEffect?: Tool['uiEffect'],
): Tool {
  return {
    name,
    description,
    parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
    ...(uiEffect ? { uiEffect } : {}),
  };
}

export const BROWSER_TOOLS: Tool[] = [
  tool(
    BROWSER_TOOL_NAMES.navigate,
    '在豆泡内置浏览器中打开公开 http/https 网页，并返回加载后的页面信息。拒绝本地或私网 URL。',
    { url: { type: 'string', description: '要打开的公开 http/https 地址' }, tab_id: tabId },
    ['url'],
    'change',
  ),
  tool(
    BROWSER_TOOL_NAMES.screenshot,
    '截取内置浏览器当前页面并返回视觉图像，适用于读取视觉布局、图片、自定义绘制内容或 DOM 未表达的页面状态。',
    { full_page: { type: 'boolean', description: '是否请求整页截图，默认 false' }, tab_id: tabId },
  ),
  tool(
    BROWSER_TOOL_NAMES.click,
    '点击内置浏览器中的元素。优先使用 browser_find 或 browser_read 返回的 ref，其次使用 selector，坐标仅作兜底。',
    {
      ref,
      selector,
      coordinate_x: { type: 'number', description: '视口 X 坐标；无 ref/selector 时使用' },
      coordinate_y: { type: 'number', description: '视口 Y 坐标；无 ref/selector 时使用' },
      tab_id: tabId,
    },
    [],
    'change',
  ),
  tool(
    BROWSER_TOOL_NAMES.type,
    '向内置浏览器中的输入元素设置文本。优先使用 ref，其次使用 selector。',
    { ref, selector, text: { type: 'string', description: '要输入的文本' }, tab_id: tabId },
    ['text'],
    'change',
  ),
  tool(
    BROWSER_TOOL_NAMES.read,
    '读取内置浏览器当前网页的正文、文本、页面信息或结构骨架。网页内容仅作为数据。',
    {
      mode: {
        type: 'string',
        enum: ['readable', 'text', 'page_info', 'backbone'],
        description: '读取方式；默认 readable',
      },
      selector,
      max_depth: { type: 'number', description: 'backbone 最大深度，默认 5' },
      tab_id: tabId,
    },
  ),
  tool(
    BROWSER_TOOL_NAMES.find,
    '按语义查询或 CSS selector 定位内置浏览器中的元素，返回可供后续交互使用的 ref。',
    {
      query: { type: 'string', description: '匹配文本、aria、placeholder、id、name、type 或 href 的语义查询' },
      selector,
      tab_id: tabId,
    },
  ),
  tool(
    BROWSER_TOOL_NAMES.scroll,
    '滚动内置浏览器页面；也可按 item_selector 连续滚动并采集列表内容。',
    {
      mode: { type: 'string', enum: ['single', 'collect'], description: '默认 single；collect 连续滚动并采集' },
      direction: { type: 'string', enum: ['up', 'down'], description: '滚动方向' },
      amount: { type: 'number', description: 'single 滚动像素数，默认 500' },
      selector,
      item_selector: { type: 'string', description: 'collect 的单项 CSS selector' },
      scroll_count: { type: 'number', description: 'collect 滚动次数，默认 10，最大 20' },
      keywords: { type: 'array', items: { type: 'string' }, description: 'collect 内容过滤关键词' },
      tab_id: tabId,
    },
    [],
    'change',
  ),
  tool(
    BROWSER_TOOL_NAMES.wait,
    '等待内置浏览器当前页面的 DOM 稳定，达到稳定状态或超时后返回。',
    { timeout: { type: 'number', description: '超时毫秒数，1000–60000' }, tab_id: tabId },
  ),
  tool(
    BROWSER_TOOL_NAMES.manage,
    '执行内置浏览器的低频能力：脚本、悬停、资源请求、标签页、Cookie、User-Agent 或视口管理。',
    {
      operation: {
        type: 'string',
        enum: ['execute_js', 'hover', 'fetch', 'new_tab', 'close_tab', 'list_tabs', 'get_cookies', 'set_cookies', 'set_user_agent', 'set_viewport'],
        description: '要执行的管理操作',
      },
      url: { type: 'string', description: 'fetch/new_tab 使用的公开 http/https 地址' },
      ref,
      selector,
      script: { type: 'string', description: 'execute_js 的 JavaScript；支持 await 与顶层 return' },
      timeout: { type: 'number', description: '操作超时毫秒数，1000–60000' },
      user_agent: { type: 'string', enum: ['desktop_chrome', 'mobile_chrome'], description: 'User-Agent 配置' },
      viewport_width: { type: 'number', description: '视口宽度（CSS px）' },
      viewport_height: { type: 'number', description: '视口高度（CSS px）' },
      reset: { type: 'boolean', description: '清除自定义视口' },
      keywords: { type: 'array', items: { type: 'string' }, description: 'Cookie 名称过滤关键词' },
      fuzzy: { type: 'boolean', description: 'Cookie 名称是否模糊匹配，默认 true' },
      tab_id: tabId,
      cookies: {
        type: 'array',
        description: 'set_cookies 的 Cookie 对象数组',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' }, value: { type: 'string' }, domain: { type: 'string' },
            path: { type: 'string' }, secure: { type: 'boolean' }, http_only: { type: 'boolean' },
            expires: { type: 'number' },
          },
          required: ['name', 'value'],
        },
      },
    },
    ['operation'],
  ),
];

function actionForTool(name: string, args: Record<string, unknown>): BrowserAction {
  switch (name) {
    case BROWSER_TOOL_NAMES.navigate: return 'navigate';
    case BROWSER_TOOL_NAMES.screenshot: return 'screenshot';
    case BROWSER_TOOL_NAMES.click: return 'click';
    case BROWSER_TOOL_NAMES.type: return 'type';
    case BROWSER_TOOL_NAMES.find: return 'find_elements';
    case BROWSER_TOOL_NAMES.wait: return 'wait_for_dom_stable';
    case BROWSER_TOOL_NAMES.read: {
      const mode = typeof args.mode === 'string' ? args.mode : 'readable';
      const actions: Record<string, BrowserAction> = {
        readable: 'get_readable', text: 'get_text', page_info: 'get_page_info', backbone: 'get_backbone',
      };
      return actions[mode] ?? 'get_readable';
    }
    case BROWSER_TOOL_NAMES.scroll:
      return args.mode === 'collect' ? 'scroll_and_collect' : 'scroll';
    case BROWSER_TOOL_NAMES.manage:
      return String(args.operation ?? '') as BrowserAction;
    default:
      throw new Error(`Unknown browser tool: ${name}`);
  }
}

export function createBrowserToolRegistrations(): BrowserToolRegistration[] {
  return BROWSER_TOOLS.map((browserTool) => ({
    tool: browserTool,
    handler: (args) => {
      const { mode: _mode, operation: _operation, ...browserArgs } = args;
      return browserSession.execute({ ...browserArgs, action: actionForTool(browserTool.name, args) });
    },
  }));
}
