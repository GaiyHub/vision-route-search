import {
  ContextCompressionError,
  ContextCompressionManager,
  type ContextHistoryRound,
} from '../agent/ContextCompressionManager';
import type {
  LLMMessage,
  LLMProviderInterface,
  ModelResponse,
  ScreenshotImage,
  Tool,
} from '../types';

class SummaryProvider implements LLMProviderInterface {
  calls = 0;
  prompts: LLMMessage[][] = [];
  constructor(private readonly response = '用户正在完成手机操作，较早步骤已经执行，最近状态仍需继续确认。') {}
  async generate(): Promise<string> { return this.response; }
  async generateWithTools(_messages: LLMMessage[], tools: Tool[]): Promise<string> {
    this.calls += 1;
    this.prompts.push(_messages);
    expect(tools).toEqual([]);
    return this.response;
  }
  async generateStructuredWithTools(): Promise<ModelResponse> {
    return { content: [{ type: 'text', text: this.response }] };
  }
  async generateWithVision(
    _messages: LLMMessage[],
    _tools: Tool[],
    _image: ScreenshotImage,
  ): Promise<string> { return this.response; }
}

function toolRound(index: number, tool = 'shell_execute', result = `output-${index}`): ContextHistoryRound {
  const callId = `call_${index}`;
  return {
    id: `round_${index}`,
    assistantText: `<tool_use id="${callId}" name="${tool}">{}</tool_use>`,
    userText: `<tool_result tool_use_id="${callId}" is_error="false">\n${result}\n</tool_result>`,
    assistantContent: [{ type: 'tool_call', id: callId, name: tool, arguments: {} }],
    userContent: [
      { type: 'tool_result', callId, result: { ok: true, data: result } },
      { type: 'text', text: `第 ${index} 步` },
    ],
  };
}

function textRound(index: number, text: string): ContextHistoryRound {
  return {
    id: `text_${index}`,
    assistantText: text,
    userText: `第 ${index} 步完成`,
    assistantContent: [{ type: 'text', text }],
    userContent: [{ type: 'text', text: `第 ${index} 步完成` }],
  };
}

function conversationRound(index: number, userText: string, assistantText = ''): ContextHistoryRound {
  return {
    id: `conversation_${index}`,
    origin: 'conversation',
    assistantText,
    userText,
    assistantContent: assistantText ? [{ type: 'text', text: assistantText }] : [],
    userContent: [{ type: 'text', text: userText }],
  };
}

describe('ContextCompressionManager', () => {
  test('performs one deterministic L2 pass and protects the recent four rounds', () => {
    const provider = new SummaryProvider();
    const manager = new ContextCompressionManager({ provider, contextWindowTokens: 32_000 });
    const rounds = Array.from({ length: 6 }, (_, index) => toolRound(index));

    const first = manager.offloadOnce(rounds);
    const second = manager.offloadOnce(rounds);
    const repeated = manager.offloadOnce(first.rounds);

    expect(first.count).toBe(2);
    expect(first.rounds).toEqual(second.rounds);
    expect(first.rounds[0]!.userText).toContain('contextOffloaded');
    expect(first.rounds[1]!.userText).toContain('contextOffloaded');
    expect(first.rounds[2]!.userText).toContain('output-2');
    expect(rounds[0]!.userText).toContain('output-0');
    expect(repeated.count).toBe(0);
    expect(repeated.rounds).toEqual(first.rounds);
    expect(first.rounds[0]!.assistantContent).toEqual(rounds[0]!.assistantContent);
    expect(first.rounds[0]!.userContent[0]).toEqual(expect.objectContaining({ callId: 'call_0' }));
  });

  test('offloads historical UI observations outside the recent tail', () => {
    const provider = new SummaryProvider();
    const manager = new ContextCompressionManager({ provider, contextWindowTokens: 32_000 });
    const rounds = [
      toolRound(0),
      toolRound(1, 'ui_screenshot', 'large accessibility tree'),
      ...Array.from({ length: 4 }, (_, index) => toolRound(index + 2)),
    ];

    const result = manager.offloadOnce(rounds);
    expect(result.rounds[0]!.userText).toContain('contextOffloaded');
    expect(result.rounds[1]!.userText).toContain('contextOffloaded');
    expect(result.rounds[1]!.userText).not.toContain('large accessibility tree');
  });

  test('does not summarize below the sole threshold', async () => {
    const provider = new SummaryProvider();
    const manager = new ContextCompressionManager({ provider, contextWindowTokens: 32_000 });
    const result = await manager.prepare([textRound(0, '短消息')], {
      fixedContext: '固定提示词',
      tools: [],
    });

    expect(provider.calls).toBe(0);
    expect(result.compacted).toBe(false);
    expect(result.summaryMessage).toBeUndefined();
    expect(result.thresholdTokens).toBe(27_200);
  });

  test('uses the configured context-window percentage as the sole summary threshold', async () => {
    const provider = new SummaryProvider();
    const manager = new ContextCompressionManager({
      provider,
      contextWindowTokens: 32_000,
      thresholdPercent: 60,
    });
    const result = await manager.prepare([textRound(0, '短消息')], {
      fixedContext: '固定提示词',
      tools: [],
    });

    expect(result.thresholdTokens).toBe(19_200);
    expect(result.compacted).toBe(false);
  });

  test('treats a low threshold as a trigger instead of blocking an irreducible first turn', async () => {
    const provider = new SummaryProvider();
    const manager = new ContextCompressionManager({
      provider,
      contextWindowTokens: 8_192,
      thresholdPercent: 1,
    });
    const result = await manager.prepare([], {
      fixedContext: '固定系统提示'.repeat(100),
      tools: [{
        name: 'shell_execute',
        description: '执行命令',
        parameters: { type: 'object', properties: {} },
      }],
    });

    expect(result.estimatedTokens).toBeGreaterThan(result.thresholdTokens);
    expect(result.compacted).toBe(false);
    expect(provider.calls).toBe(0);
  });

  test('accepts one low-threshold summary when the result is below the real model limit', async () => {
    const provider = new SummaryProvider('历史已压缩');
    const manager = new ContextCompressionManager({
      provider,
      contextWindowTokens: 8_192,
      thresholdPercent: 1,
    });
    const rounds = [
      textRound(0, '甲'.repeat(300)),
      ...Array.from({ length: 4 }, (_, index) => textRound(index + 1, '最近状态')),
    ];

    const result = await manager.prepare(rounds, { fixedContext: '固定提示', tools: [] });

    expect(provider.calls).toBe(1);
    expect(result.compacted).toBe(true);
    expect(result.estimatedTokens).toBeGreaterThan(result.thresholdTokens);
    expect(result.estimatedTokens).toBeLessThan(8_192);
  });

  test('summarizes at most once and injects the natural-language checkpoint', async () => {
    const provider = new SummaryProvider('用户要求继续完成当前手机任务，前两轮已处理。');
    const manager = new ContextCompressionManager({
      provider,
      contextWindowTokens: 4_096,
      thresholdPercent: 50,
    });
    const rounds = [
      textRound(0, '甲'.repeat(1_200)),
      textRound(1, '乙'.repeat(1_200)),
      ...Array.from({ length: 4 }, (_, index) => textRound(index + 2, '最近状态')),
    ];

    const result = await manager.prepare(rounds, {
      fixedContext: '固定系统提示',
      runtimeContext: '当前任务：完成手机操作',
      currentContext: '当前熔断提醒：不要重复点击',
      liveContext: '任务进度：实时 Todo',
      tools: [],
    });
    expect(provider.calls).toBe(1);
    expect(result.compacted).toBe(true);
    expect(result.rounds.map((round) => round.id)).toEqual([
      'text_2', 'text_3', 'text_4', 'text_5',
    ]);
    expect(result.summaryMessage).toBe(
      '<context_summary>\n用户要求继续完成当前手机任务，前两轮已处理。\n</context_summary>',
    );
    expect(manager.checkpointSnapshot?.summary).toBe('用户要求继续完成当前手机任务，前两轮已处理。');
    expect(provider.prompts[0]![0]!.content).not.toContain('当前任务：完成手机操作');
    expect(provider.prompts[0]![0]!.content).not.toContain('当前熔断提醒：不要重复点击');
    expect(provider.prompts[0]![0]!.content).toContain('甲');
    expect(provider.prompts[0]![0]!.content).not.toContain('实时 Todo');

    const next = await manager.prepare([...rounds, textRound(6, '新增步骤')], {
      fixedContext: '固定系统提示',
      runtimeContext: '当前任务：完成手机操作',
      liveContext: '任务进度：Todo 已更新',
      tools: [],
    });
    expect(provider.calls).toBe(1);
    expect(next.summaryMessage).toBe(result.summaryMessage);
    expect(next.rounds.map((round) => round.id)).toEqual([
      'text_2', 'text_3', 'text_4', 'text_5', 'text_6',
    ]);
  });

  test('keeps recent conversation turns raw even after many tool rounds', async () => {
    const provider = new SummaryProvider('较早工具步骤已经压缩。');
    const manager = new ContextCompressionManager({
      provider,
      contextWindowTokens: 4_096,
      thresholdPercent: 1,
    });
    const rounds = [
      conversationRound(0, '发送短信给叶至伟，内容是哈哈'),
      ...Array.from({ length: 6 }, (_, index) => toolRound(index)),
    ];

    const result = await manager.prepare(rounds, { fixedContext: '固定提示', tools: [] });

    expect(provider.calls).toBe(1);
    expect(result.rounds.map((round) => round.id)).toEqual([
      'conversation_0', 'round_2', 'round_3', 'round_4', 'round_5',
    ]);
    expect(provider.prompts[0]![0]!.content).toContain(
      '以下最近会话仍会原样保留',
    );
    expect(provider.prompts[0]![0]!.content).toContain(
      '用户：\n发送短信给叶至伟，内容是哈哈',
    );
    const compressedHistory = provider.prompts[0]![0]!.content
      .split('需要压缩的新增历史：')[1] ?? '';
    expect(compressedHistory).not.toContain('发送短信给叶至伟');
  });

  test('labels real user messages as user content in summary input', async () => {
    const provider = new SummaryProvider('旧对话摘要。');
    const manager = new ContextCompressionManager({
      provider,
      contextWindowTokens: 4_096,
      thresholdPercent: 1,
      protectedRecentRounds: 1,
    });
    const rounds = [
      conversationRound(0, '较早用户目标'),
      conversationRound(1, '后续用户目标'),
      toolRound(2),
    ];

    await manager.prepare(rounds, { fixedContext: '固定提示', tools: [] });

    const prompt = provider.prompts[0]![0]!.content;
    const compressedHistory = prompt.split('需要压缩的新增历史：')[1] ?? '';
    expect(compressedHistory).toContain('用户：\n较早用户目标');
    expect(compressedHistory).not.toContain('工具与环境结果：\n较早用户目标');
  });

  test('disabled mode keeps all available rounds without calling the summarizer', async () => {
    const provider = new SummaryProvider();
    const manager = new ContextCompressionManager({
      provider,
      enabled: false,
      contextWindowTokens: 4_096,
    });
    const result = await manager.prepare(
      [textRound(0, 'a'), textRound(1, 'b'), textRound(2, 'c')],
      { fixedContext: '', tools: [] },
    );

    expect(result.rounds.map((round) => round.id)).toEqual(['text_0', 'text_1', 'text_2']);
    expect(result.omittedCount).toBe(0);
    expect(provider.calls).toBe(0);
  });

  test('does not start a second summary when one summary is still too large', async () => {
    const provider = new SummaryProvider('摘要'.repeat(1_400));
    const manager = new ContextCompressionManager({ provider, contextWindowTokens: 4_096 });
    const rounds = [
      textRound(0, '甲'.repeat(1_200)),
      textRound(1, '乙'.repeat(1_200)),
      ...Array.from({ length: 4 }, (_, index) => textRound(index + 2, '丙'.repeat(350))),
    ];

    await expect(manager.prepare(rounds, { fixedContext: '固定', tools: [] }))
      .rejects.toEqual(expect.objectContaining<Partial<ContextCompressionError>>({
        code: 'CONTEXT_STILL_TOO_LARGE',
      }));
    expect(provider.calls).toBe(1);
    expect(manager.checkpointSnapshot).toBeNull();
  });

  test('reports the transient compression phase only while generating a summary', async () => {
    const provider = new SummaryProvider('已压缩的历史摘要');
    const states: Array<'compressing' | 'idle'> = [];
    const summaries: string[] = [];
    const manager = new ContextCompressionManager({
      provider,
      contextWindowTokens: 4_096,
      thresholdPercent: 50,
      onCompressionStateChange: (state) => states.push(state),
      onCompressed: (summary) => summaries.push(summary),
    });
    const rounds = [
      textRound(0, '甲'.repeat(1_200)),
      textRound(1, '乙'.repeat(1_200)),
      ...Array.from({ length: 4 }, (_, index) => textRound(index + 2, '丙'.repeat(120))),
    ];

    await manager.prepare(rounds, { fixedContext: '固定', tools: [] });

    expect(states).toEqual(['compressing', 'idle']);
    expect(summaries).toEqual(['已压缩的历史摘要']);
  });
});
