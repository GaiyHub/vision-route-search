import { AgentLoop } from '../agent/AgentLoop';
import type { AgentEvent, LLMMessage, LLMProviderInterface } from '../types';

const mockCtrl = {
  getAccessibilityTree: jest.fn<Promise<unknown>, []>(async () => []),
  getCurrentForegroundApp: jest.fn(async () => ({ packageName: 'test.app', className: 'Main' })),
  tapByQuery: jest.fn(async () => ({
    found: true, accepted: true, method: 'node_action', matchCount: 1, selectedIndex: 0,
    text: '搜索', contentDescription: null, resourceId: null,
    bounds: { left: 0, top: 0, right: 100, bottom: 100 }, reason: null,
  })),
  tapByQueryGesture: jest.fn(async () => ({
    found: true, accepted: true, method: 'coordinate_center', matchCount: 1, selectedIndex: 0,
    text: '搜索', contentDescription: null, resourceId: null,
    bounds: { left: 0, top: 0, right: 100, bottom: 100 }, reason: null,
  })),
};

jest.mock('react-native-accessibility-controller', () => mockCtrl);

async function collect(loop: AgentLoop): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of loop.run('测试熔断')) events.push(event);
  return events;
}

describe('AgentLoop circuit-breaker integration', () => {
  beforeEach(() => {
    mockCtrl.getAccessibilityTree.mockReset().mockResolvedValue([]);
    mockCtrl.getCurrentForegroundApp.mockReset().mockResolvedValue({
      packageName: 'test.app',
      className: 'Main',
    });
    mockCtrl.tapByQuery.mockClear();
    mockCtrl.tapByQueryGesture.mockClear();
  });

  test('allows configured retries, warns once, blocks before dispatch and keeps blocked history', async () => {
    const tap = '<tool_call>{"name":"ui_tap","arguments":{"text":"搜索"}}</tool_call>';
    const responses = [tap, tap, tap, tap, '{"name":"task_failed","arguments":{"reason":"无法推进"}}'];
    const messagesList: LLMMessage[][] = [];
    const provider = {
      generateWithTools: jest.fn(async (messages: LLMMessage[]) => {
        messagesList.push(messages);
        return responses[messagesList.length - 1] ?? responses[responses.length - 1];
      }),
    } as unknown as LLMProviderInterface;
    const circuitEvents: Array<{ type: string }> = [];
    const loop = new AgentLoop({
      provider,
      maxSteps: 8,
      settleMs: 0,
      delayFn: async () => {},
      toolCircuitBreakerOverrides: {
        tap: { warningThreshold: 1, blockThreshold: 2 },
      },
      onCircuitBreakerEvent: (event) => circuitEvents.push(event),
    });

    const events = await collect(loop);
    expect(mockCtrl.tapByQueryGesture).toHaveBeenCalledTimes(2);
    expect(mockCtrl.tapByQuery).not.toHaveBeenCalled();
    const blockedAction = events.find(
      (event) =>
        event.type === 'action' &&
        (event.result as { code?: string } | undefined)?.code === 'LOOP_BLOCKED',
    );
    expect(blockedAction).toBeDefined();
    expect(circuitEvents.map((event) => event.type)).toEqual(['warning', 'blocked', 'blocked']);

    const warningTurns = messagesList.filter((messages) =>
      messages.some((message) => message.role === 'user' && message.content.includes('[工具熔断提醒]')),
    );
    expect(warningTurns).toHaveLength(1);
    const finalPrompt = messagesList[messagesList.length - 1];
    const tapHistory = finalPrompt
      .filter((message) => message.role === 'assistant')
      .map((message) => message.content)
      .join('\n');
    // Ordinary no-progress attempts remain folded to the latest one, while
    // every hard-blocked attempt is retained so the model can see repetition.
    expect((tapHistory.match(/name="ui_tap"/g) ?? []).length).toBe(3);
    const resultHistory = finalPrompt
      .filter((message) => message.role === 'user')
      .map((message) => message.content)
      .join('\n');
    expect((resultHistory.match(/LOOP_BLOCKED/g) ?? []).length).toBe(2);
  });

  test('force-stops after the configured number of consecutive hard blocks', async () => {
    const tap = '<tool_call>{"name":"ui_tap","arguments":{"text":"搜索"}}</tool_call>';
    const provider = {
      generateWithTools: jest.fn(async () => tap),
    } as unknown as LLMProviderInterface;
    const circuitEvents: Array<{ type: string; count: number }> = [];
    const loop = new AgentLoop({
      provider,
      maxSteps: 20,
      settleMs: 0,
      delayFn: async () => {},
      consecutiveCircuitBreakerLimit: 2,
      toolCircuitBreakerOverrides: {
        tap: { warningThreshold: 1, blockThreshold: 2 },
      },
      onCircuitBreakerEvent: (event) => circuitEvents.push(event),
    });

    const events = await collect(loop);
    expect(mockCtrl.tapByQueryGesture).toHaveBeenCalledTimes(2);
    expect(provider.generateWithTools).toHaveBeenCalledTimes(4);
    expect(events[events.length - 1]).toMatchObject({
      type: 'failed',
      reason: expect.stringContaining('连续熔断 2 次'),
    });
    expect(circuitEvents[circuitEvents.length - 1]).toMatchObject({
      type: 'terminated',
      count: 2,
    });
  });
});
