import type { Tool } from '../device-agent/types';

export const WEB_SEARCH_TOOL_NAME = 'web_search';
export const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search';
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 10;
const REQUEST_TIMEOUT_MS = 9_000;

export const WEB_SEARCH_TOOL: Tool = {
  name: WEB_SEARCH_TOOL_NAME,
  description:
    '搜索互联网并使用结果回答问题。适用于获取知识截止日期之后的信息、当前事件和近期数据；单次调用返回带标题、URL、摘要、相关度和发布时间的搜索结果，并支持限定来源域名。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '具体搜索词，包含需要确认的对象、属性和必要限定条件',
      },
      topic: {
        type: 'string',
        enum: ['general', 'news', 'finance'],
        description: '搜索类别，默认 general；时事新闻使用 news，金融信息使用 finance',
      },
      time_range: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year'],
        description: '可选的结果时间范围',
      },
      max_results: {
        type: 'number',
        description: `返回结果数量，默认 ${DEFAULT_MAX_RESULTS}，范围 1–${MAX_RESULTS}`,
      },
      include_domains: {
        type: 'array',
        items: { type: 'string' },
        description: '可选的来源域名白名单，例如 ["mi.com"]',
      },
    },
    required: ['query'],
  },
  uiEffect: 'none',
};

interface TavilySearchResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
  published_date?: unknown;
}

interface TavilyResponse {
  query?: unknown;
  results?: unknown;
  response_time?: unknown;
  usage?: unknown;
  request_id?: unknown;
  detail?: unknown;
}

export interface WebSearchDeps {
  getApiKey: () => string;
  fetchFn?: typeof fetch;
}

function boundedInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_RESULTS, Math.max(1, Math.round(value)));
}

function domainList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0 && item.length <= 253)
    .slice(0, 10);
}

function detailMessage(detail: unknown): string | undefined {
  if (typeof detail === 'string') return detail;
  if (!detail || typeof detail !== 'object') return undefined;
  const error = (detail as Record<string, unknown>).error;
  return typeof error === 'string' ? error : undefined;
}

function failureForStatus(status: number, payload?: TavilyResponse) {
  const remoteMessage = detailMessage(payload?.detail);
  if (status === 401) {
    return { ok: false, error: 'Tavily API Key 无效或已失效', code: 'WEB_SEARCH_UNAUTHORIZED', retryable: false };
  }
  if (status === 429) {
    return { ok: false, error: remoteMessage ?? 'Tavily 请求过于频繁', code: 'WEB_SEARCH_RATE_LIMITED', retryable: true };
  }
  if (status === 432 || status === 433) {
    return { ok: false, error: remoteMessage ?? 'Tavily 免费额度或消费限额已用尽', code: 'WEB_SEARCH_QUOTA_EXCEEDED', retryable: false };
  }
  return {
    ok: false,
    error: remoteMessage ?? `Tavily 搜索请求失败（HTTP ${status}）`,
    code: status >= 500 ? 'WEB_SEARCH_SERVICE_ERROR' : 'WEB_SEARCH_REQUEST_REJECTED',
    retryable: status >= 500,
  };
}

function normalizedResults(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const result = (item && typeof item === 'object' ? item : {}) as TavilySearchResult;
    return {
      title: typeof result.title === 'string' ? result.title : '',
      url: typeof result.url === 'string' ? result.url : '',
      content: typeof result.content === 'string' ? result.content : '',
      score: typeof result.score === 'number' ? result.score : null,
      published_date: typeof result.published_date === 'string' ? result.published_date : null,
    };
  }).filter((result) => result.url.length > 0);
}

export function createWebSearchHandler(deps: WebSearchDeps) {
  return async (args: Record<string, unknown>): Promise<unknown> => {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      return { ok: false, error: 'query 不能为空', code: 'INVALID_ARGUMENT', retryable: false };
    }
    if (query.length > 400) {
      return { ok: false, error: 'query 不能超过 400 个字符', code: 'INVALID_ARGUMENT', retryable: false };
    }
    const apiKey = deps.getApiKey().trim();
    if (!apiKey) {
      return {
        ok: false,
        error: '尚未配置 Tavily API Key',
        code: 'WEB_SEARCH_NOT_CONFIGURED',
        retryable: false,
        hint: '请在豆泡设置页的工具配置中填写 Tavily API Key。',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await (deps.fetchFn ?? fetch)(TAVILY_SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          topic: args.topic ?? 'general',
          max_results: boundedInteger(args.max_results, DEFAULT_MAX_RESULTS),
          include_domains: domainList(args.include_domains),
          ...(typeof args.time_range === 'string' ? { time_range: args.time_range } : {}),
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          include_usage: true,
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as TavilyResponse;
      if (!response.ok) return failureForStatus(response.status, payload);
      return {
        ok: true,
        provider: 'tavily',
        query: typeof payload.query === 'string' ? payload.query : query,
        results: normalizedResults(payload.results),
        response_time: typeof payload.response_time === 'string' ? payload.response_time : null,
        usage: payload.usage && typeof payload.usage === 'object' ? payload.usage : null,
        request_id: typeof payload.request_id === 'string' ? payload.request_id : null,
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      return {
        ok: false,
        error: timedOut ? 'Tavily 搜索请求超时' : '无法连接 Tavily 搜索服务',
        code: timedOut ? 'WEB_SEARCH_TIMEOUT' : 'WEB_SEARCH_NETWORK_ERROR',
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createWebSearchToolRegistration(deps: WebSearchDeps) {
  return {
    tool: WEB_SEARCH_TOOL,
    handler: createWebSearchHandler(deps),
    enabledByDefault: true,
    placement: 'back' as const,
  };
}
