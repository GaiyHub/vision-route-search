import type { ModelMessage } from '../types';
import { CloudProvider } from '../providers/CloudProvider';

const history: ModelMessage[] = [
  { role: 'system', content: [{ type: 'text', text: '系统指令' }] },
  { role: 'user', content: [{ type: 'text', text: '初始屏幕' }] },
  {
    role: 'assistant',
    content: [
      { type: 'tool_call', id: 'call_1', name: 'ui_tap', arguments: { x: 10, y: 20 } },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', callId: 'call_1', result: { ok: true, data: true } },
      { type: 'text', text: '第 1 步: 观察了屏幕' },
    ],
  },
];

function installFetch(json: Record<string, unknown>): jest.Mock {
  const fn = jest.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => json,
    text: async () => '',
  }));
  (global as { fetch: unknown }).fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('CloudProvider structured protocol adapters', () => {
  test('redacts image base64 from debug logs while retaining request diagnostics', async () => {
    installFetch({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] });
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const secretImage = 'SECRET_IMAGE_BYTES_SHOULD_NEVER_REACH_LOGCAT';
    const provider = new CloudProvider({
      apiKey: 'k',
      model: 'gpt-4o',
      apiFormat: 'openai',
      baseUrl: 'https://example.test/v1',
      debugLog: true,
    });

    await provider.generateStructuredWithVision(history, [], {
      base64: secretImage,
      mimeType: 'image/jpeg',
      width: 900,
      height: 2000,
    });

    const output = log.mock.calls.flat().join('\n');
    expect(output).not.toContain(secretImage);
    expect(output).toContain('[image_base64_redacted chars=44]');
    log.mockRestore();
  });

  test('emits privacy-safe visual request serialization, HTTP and response parsing timings', async () => {
    installFetch({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] });
    const timing: Array<Record<string, unknown>> = [];
    const provider = new CloudProvider({
      apiKey: 'k',
      model: 'gpt-4o',
      apiFormat: 'openai',
      baseUrl: 'https://example.test/v1',
      onTimingDiagnostic: (event) => timing.push(event),
    });

    await provider.generateStructuredWithVision(history, [], {
      base64: 'image-bytes',
      mimeType: 'image/jpeg',
      width: 900,
      height: 2000,
    });

    expect(timing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'vision_request_serialize',
        imageWidth: 900,
        imageHeight: 2000,
        imageBase64Chars: 11,
      }),
      expect.objectContaining({ stage: 'vision_http_wait', status: 200 }),
      expect.objectContaining({ stage: 'vision_response_parse' }),
    ]));
    expect(timing.every((event) => !JSON.stringify(event).includes('image-bytes'))).toBe(true);
  });

  test('OpenAI adapter emits native tool_calls/tool messages and parses native calls', async () => {
    const fetchMock = installFetch({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{
            id: 'call_2',
            type: 'function',
            function: { name: 'ui_tap', arguments: '{"x":30,"y":40}' },
          }],
        },
      }],
    });
    const provider = new CloudProvider({
      apiKey: 'k',
      model: 'gpt-4o',
      apiFormat: 'openai',
      baseUrl: 'https://example.test/v1',
    });

    const response = await provider.generateStructuredWithTools(history, []);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);

    expect(JSON.stringify(body.messages)).not.toContain('<tool_use');
    expect(body.temperature).toBe(0.2);
    expect(body.messages[2]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'call_1', function: { name: 'ui_tap', arguments: '{"x":10,"y":20}' } }],
    });
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'true' });
    expect(response.content).toEqual([
      { type: 'tool_call', id: 'call_2', name: 'ui_tap', arguments: { x: 30, y: 40 } },
    ]);
  });

  test('Anthropic adapter emits native tool_use/tool_result blocks and parses native calls', async () => {
    const fetchMock = installFetch({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'toolu_2', name: 'ui_tap', input: { x: 30, y: 40 } }],
    });
    const provider = new CloudProvider({
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
      apiFormat: 'anthropic',
      baseUrl: 'https://example.test/v1',
    });

    const response = await provider.generateStructuredWithTools(history, []);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);

    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_1', name: 'ui_tap', input: { x: 10, y: 20 } }],
    });
    expect(body.messages[2].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'call_1',
      content: 'true',
      is_error: false,
    });
    expect(response.content).toEqual([
      { type: 'tool_call', id: 'toolu_2', name: 'ui_tap', arguments: { x: 30, y: 40 } },
    ]);
  });

  test('Anthropic merges adjacent user messages while preserving cache breakpoints', async () => {
    const fetchMock = installFetch({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    });
    const provider = new CloudProvider({
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
      apiFormat: 'anthropic',
      baseUrl: 'https://example.test/v1',
    });
    const messages: ModelMessage[] = [
      { role: 'system', cache: true, content: [{ type: 'text', text: '系统' }] },
      { role: 'user', cache: true, content: [{ type: 'text', text: '稳定运行上下文' }] },
      { role: 'user', cache: true, content: [{ type: 'text', text: '历史摘要' }] },
      { role: 'user', content: [{ type: 'text', text: '当前问题' }] },
    ];

    await provider.generateStructuredWithTools(messages, []);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);

    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '稳定运行上下文', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: '历史摘要', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: '当前问题' },
      ],
    });
  });

  test('OpenAI adapter exposes unescaped quotes as malformed native tool arguments', async () => {
    const malformed = '{"mode":"ref","ref":"u56r","_risk":{"level":"low","summary":"点击"咻咻满"搜索"}}';
    installFetch({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{
            id: 'bad_call',
            type: 'function',
            function: { name: 'ui_tap', arguments: malformed },
          }],
        },
      }],
    });
    const provider = new CloudProvider({
      apiKey: 'k', model: 'qwen3.7-flash', apiFormat: 'openai', baseUrl: 'https://example.test/v1',
    });

    const response = await provider.generateStructuredWithTools(history, []);

    expect(response.content).toEqual([expect.objectContaining({
      type: 'tool_call',
      id: 'bad_call',
      name: 'ui_tap',
      arguments: {},
      argumentParseError: expect.objectContaining({
        code: 'MALFORMED_TOOL_ARGUMENTS',
        rawArgumentsPreview: malformed,
      }),
    })]);
  });

  test('OpenAI adapter rejects malformed native tool arguments without repair', async () => {
    const malformed = '{"mode":"ref","ref":]';
    installFetch({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{
            id: 'bad_call',
            type: 'function',
            function: { name: 'ui_tap', arguments: malformed },
          }],
        },
      }],
    });
    const provider = new CloudProvider({
      apiKey: 'k', model: 'qwen3.7-flash', apiFormat: 'openai', baseUrl: 'https://example.test/v1',
    });

    const response = await provider.generateStructuredWithTools(history, []);

    expect(response.content).toEqual([expect.objectContaining({
      type: 'tool_call',
      id: 'bad_call',
      name: 'ui_tap',
      arguments: {},
      argumentParseError: expect.objectContaining({
        code: 'MALFORMED_TOOL_ARGUMENTS',
        rawArgumentsPreview: malformed,
      }),
    })]);
  });

  test('OpenAI adapter accepts literal JSON controls inside a risk reason', async () => {
    const controls = '{"ref":"pay","_risk":{"level":"high","reason":"支付\u0000 1元\n水费"}}';
    installFetch({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{
            id: 'control_reason_call',
            type: 'function',
            function: { name: 'ui_tap', arguments: controls },
          }],
        },
      }],
    });
    const provider = new CloudProvider({
      apiKey: 'k', model: 'qwen3.7-flash', apiFormat: 'openai', baseUrl: 'https://example.test/v1',
    });

    const response = await provider.generateStructuredWithTools(history, []);

    expect(response.content).toEqual([expect.objectContaining({
      type: 'tool_call',
      name: 'ui_tap',
      arguments: {
        ref: 'pay',
        _risk: { level: 'high', reason: '支付\u0000 1元\n水费' },
      },
    })]);
  });

  test('OpenAI adapter preserves polluted risk arguments for model-visible diagnostics', async () => {
    const malformed = '{"packageName":"com.jingdong.app.mall","_risk"><parameter name="level":"low","summary":"打开京东"}';
    installFetch({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{
            id: 'polluted_risk_call',
            type: 'function',
            function: { name: 'open_app', arguments: malformed },
          }],
        },
      }],
    });
    const provider = new CloudProvider({
      apiKey: 'k', model: 'doubao-seed-2.0-lite', apiFormat: 'openai', baseUrl: 'https://example.test/v1',
    });

    const response = await provider.generateStructuredWithTools(history, []);

    expect(response.content).toEqual([expect.objectContaining({
      type: 'tool_call',
      id: 'polluted_risk_call',
      name: 'open_app',
      arguments: {},
      argumentParseError: expect.objectContaining({
        code: 'MALFORMED_TOOL_ARGUMENTS',
        rawArgumentsPreview: malformed,
      }),
    })]);
  });

  test('OpenAI adapter preserves complete UI observations beyond the old 2000-character cap', async () => {
    const longTree = `tree-start-${'x'.repeat(5_000)}-tree-end`;
    const messages: ModelMessage[] = [
      { role: 'system', content: [{ type: 'text', text: 'system' }] },
      { role: 'assistant', content: [{
        type: 'tool_call', id: 'inspect_1', name: 'ui_inspect', arguments: {},
      }] },
      { role: 'user', content: [{
        type: 'tool_result', callId: 'inspect_1', result: { ok: true, data: longTree },
      }] },
    ];
    const fetchMock = installFetch({
      choices: [{ finish_reason: 'stop', message: { content: 'done' } }],
    });
    const provider = new CloudProvider({
      apiKey: 'k', model: 'gpt-4o', apiFormat: 'openai', baseUrl: 'https://example.test/v1',
    });

    await provider.generateStructuredWithTools(messages, []);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.messages[2].content).toContain('tree-end');
    expect(body.messages[2].content).not.toContain('…[已截断]');
  });
});
