const files = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/user/0/com.watchdog.agent/files/',
  EncodingType: { UTF8: 'utf8' },
  makeDirectoryAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: files.has(uri) })),
  readAsStringAsync: jest.fn(async (uri: string) => files.get(uri) ?? ''),
  writeAsStringAsync: jest.fn(async (uri: string, content: string) => {
    files.set(uri, content);
  }),
}));

import {
  beginTrace,
  endSpan,
  endTrace,
  flush,
  recordCompletedSpan,
  startSpan,
} from '../../agent/otelLogger';
import { appendTaskLog, beginTaskLog } from '../taskLogger';

describe('unified request trace', () => {
  beforeEach(() => {
    files.clear();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes one complete OTel root span with GenAI attributes and events', async () => {
    const traceId = beginTrace({ command: '缓存诊断' });
    beginTaskLog('缓存诊断');
    for (let i = 0; i < 24; i++) {
      appendTaskLog('cache_diagnostic', { index: i });
    }
    endTrace('ok', { outcome: 'complete', summary: '完成' });
    await flush(traceId);

    const internalEntries = [...files.entries()].filter(([uri]) =>
      uri.startsWith('file:///data/user/0/com.watchdog.agent/files/tasklogs/'),
    );
    const external = [...files.entries()].find(([uri]) =>
      uri.startsWith(
        'file:///storage/emulated/0/Android/data/com.watchdog.agent/files/tasklogs/',
      ),
    );

    expect(internalEntries).toHaveLength(1);
    const [internalUri, content] = internalEntries[0];
    expect(internalUri).toContain(`otel-${traceId}.jsonl`);
    expect(external?.[1]).toBe(content);
    expect([...files.keys()].some((uri) => /\/task-/.test(uri))).toBe(false);

    const records = content.trim().split('\n').map((line) => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      encoding: 'otel-span-jsonl-v1',
      traceId,
      name: 'invoke_agent 豆泡',
      kind: 'INTERNAL',
      attributes: {
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.agent.name': '豆泡',
        'doupao.agent.outcome': 'complete',
      },
      status: { code: 'UNSET' },
    });
    expect(records[0].attributes['gen_ai.input.messages']).toContain('缓存诊断');
    expect(records[0].attributes['gen_ai.output.messages']).toContain('完成');
    expect(records[0].events).toHaveLength(24);
    expect(records[0].events[0].attributes['doupao.index']).toBe(0);
    expect(records[0].events[23].attributes['doupao.index']).toBe(23);
  });

  it('uses execute_tool GenAI conventions and OTel error status', async () => {
    const traceId = beginTrace({ command: '点击搜索' });
    const toolSpanId = startSpan('tool.ui_tap', {
      step: 1,
      tool: 'ui_tap',
      args: { nodeId: 'node-1' },
    });
    endSpan(toolSpanId, 'error', { result: { ok: false, error: '节点不可用' } });
    endTrace('error', { outcome: 'error', summary: '无法完成' });
    await flush(traceId);

    const content = [...files.entries()].find(([uri]) =>
      uri.includes(`/tasklogs/otel-${traceId}.jsonl`),
    )?.[1] ?? '';
    const records = content.trim().split('\n').map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({
      traceId,
      spanId: toolSpanId,
      name: 'execute_tool ui_tap',
      kind: 'INTERNAL',
      attributes: {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'ui_tap',
        'doupao.agent.step': 1,
        'error.type': 'doupao.agent.operation_failed',
      },
      status: { code: 'ERROR' },
    });
    expect(records[0].attributes['gen_ai.tool.call.arguments']).toContain('node-1');
    expect(records[0].attributes['gen_ai.tool.call.result']).toContain('节点不可用');
    expect(records[1].name).toBe('invoke_agent 豆泡');
  });

  it('records model calls as GenAI chat spans with usage', async () => {
    const traceId = beginTrace({ command: '现在几点' });
    recordCompletedSpan(
      'model.chat',
      420,
      'ok',
      { model: 'glm-4.6v-flash', provider: 'openai_compatible', remote: true, attempt: 1 },
      { inputTokens: 800, outputTokens: 42, cachedTokens: 600 },
    );
    endTrace('ok', { outcome: 'complete', summary: '现在是十点。' });
    await flush(traceId);

    const content = [...files.entries()].find(([uri]) =>
      uri.includes(`/tasklogs/otel-${traceId}.jsonl`),
    )?.[1] ?? '';
    const modelSpan = JSON.parse(content.trim().split('\n')[0]);
    expect(modelSpan).toMatchObject({
      name: 'chat glm-4.6v-flash',
      kind: 'CLIENT',
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'openai_compatible',
        'gen_ai.request.model': 'glm-4.6v-flash',
        'gen_ai.usage.input_tokens': 800,
        'gen_ai.usage.output_tokens': 42,
        'gen_ai.usage.cache_read.input_tokens': 600,
      },
    });
  });

  it('records evaluation model input and output on the model span', async () => {
    const traceId = beginTrace({ command: '查找医院' });
    recordCompletedSpan(
      'model.chat',
      500,
      'ok',
      {
        model: 'doubao', provider: 'openai_compatible', remote: true, attempt: 1,
        request: {
          messages: [{ role: 'user', content: [{ type: 'text', text: '查找医院' }] }],
          tools: [{ name: 'ui_inspect', description: '读取界面', parameters: { type: 'object' } }],
        },
      },
      {
        inputTokens: 100, outputTokens: 20, cachedTokens: 80,
        response: { content: [{ type: 'tool_call', id: 'call-1', name: 'ui_inspect', arguments: {} }], finishReason: 'tool_call' },
        finishReason: 'tool_call',
      },
    );
    endTrace('ok', { outcome: 'complete', summary: '完成' });
    await flush(traceId);

    const content = [...files.entries()].find(([uri]) =>
      uri.includes(`/tasklogs/otel-${traceId}.jsonl`),
    )?.[1] ?? '';
    const modelSpan = JSON.parse(content.trim().split('\n')[0]);
    expect(JSON.parse(modelSpan.attributes['gen_ai.input.messages'])).toEqual([
      { role: 'user', content: [{ type: 'text', text: '查找医院' }] },
    ]);
    expect(JSON.parse(modelSpan.attributes['gen_ai.output.messages'])).toMatchObject({
      finishReason: 'tool_call',
    });
    expect(modelSpan.attributes['gen_ai.tool.definitions']).toContain('ui_inspect');
  });

  it('routes evaluation traces only to the request artifact directory', async () => {
    const outputDirectory = 'file:///storage/emulated/0/Android/data/com.watchdog.agent/files/'
      + 'evaluation/run-1/sample-1/request-1';
    const traceId = beginTrace(
      {
        command: '评测任务',
        source: 'EVALUATION',
        requestId: 'request-1',
        runId: 'run-1',
        sampleId: 'sample-1',
      },
      { directory: outputDirectory },
    );
    endTrace('ok', { outcome: 'complete', summary: '完成' });
    await flush(traceId);

    expect([...files.keys()]).toEqual([`${outputDirectory}/otel-${traceId}.jsonl`]);
    const root = JSON.parse(files.values().next().value?.trim() ?? '{}');
    expect(root.attributes).toMatchObject({
      'doupao.source': 'EVALUATION',
      'doupao.request_id': 'request-1',
      'doupao.run_id': 'run-1',
      'doupao.sample_id': 'sample-1',
    });
  });
});
