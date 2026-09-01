import {
  TAVILY_SEARCH_ENDPOINT,
  WEB_SEARCH_TOOL,
  createWebSearchHandler,
  createWebSearchToolRegistration,
} from '../WebSearchTool';

function response(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

describe('web_search Tavily adapter', () => {
  it('exposes a read-only search contract', () => {
    expect(WEB_SEARCH_TOOL.name).toBe('web_search');
    expect(WEB_SEARCH_TOOL.uiEffect).toBe('none');
    expect(WEB_SEARCH_TOOL.description).toContain('知识截止日期之后');
    expect(WEB_SEARCH_TOOL.description).toContain('限定来源域名');
    expect(WEB_SEARCH_TOOL.parameters.required).toEqual(['query']);
    expect(createWebSearchToolRegistration({ getApiKey: () => '' }).placement).toBe('back');
  });

  it('returns an actionable configuration error without making a request', async () => {
    const fetchFn = jest.fn();
    const handler = createWebSearchHandler({
      getApiKey: () => '',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await expect(handler({ query: '小米最新旗舰手机' })).resolves.toMatchObject({
      ok: false,
      code: 'WEB_SEARCH_NOT_CONFIGURED',
      retryable: false,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('uses Tavily basic search and returns compact structured results', async () => {
    const fetchFn = jest.fn(async () => response(200, {
      query: '小米最新旗舰手机 官方售价',
      results: [
        {
          title: '小米官网',
          url: 'https://www.mi.com/example',
          content: '官方产品与售价信息',
          score: 0.98,
          published_date: '2026-08-01',
        },
      ],
      response_time: '0.42',
      usage: { credits: 1 },
      request_id: 'request-1',
    }));
    const handler = createWebSearchHandler({
      getApiKey: () => ' tvly-secret ',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await handler({
      query: ' 小米最新旗舰手机 官方售价 ',
      max_results: 99,
      include_domains: [' MI.COM ', ''],
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const calls = fetchFn.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    const [url, init] = calls[0];
    expect(url).toBe(TAVILY_SEARCH_ENDPOINT);
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tvly-secret' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      query: '小米最新旗舰手机 官方售价',
      search_depth: 'basic',
      topic: 'general',
      max_results: 10,
      include_domains: ['mi.com'],
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    });
    expect(result).toEqual({
      ok: true,
      provider: 'tavily',
      query: '小米最新旗舰手机 官方售价',
      results: [{
        title: '小米官网',
        url: 'https://www.mi.com/example',
        content: '官方产品与售价信息',
        score: 0.98,
        published_date: '2026-08-01',
      }],
      response_time: '0.42',
      usage: { credits: 1 },
      request_id: 'request-1',
    });
  });

  it.each([
    [401, 'WEB_SEARCH_UNAUTHORIZED', false],
    [429, 'WEB_SEARCH_RATE_LIMITED', true],
    [432, 'WEB_SEARCH_QUOTA_EXCEEDED', false],
    [500, 'WEB_SEARCH_SERVICE_ERROR', true],
  ])('maps Tavily HTTP %s to a stable error', async (status, code, retryable) => {
    const handler = createWebSearchHandler({
      getApiKey: () => 'tvly-secret',
      fetchFn: jest.fn(async () => response(status, {})) as unknown as typeof fetch,
    });

    await expect(handler({ query: 'test' })).resolves.toMatchObject({
      ok: false,
      code,
      retryable,
    });
  });
});
