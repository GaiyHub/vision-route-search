import { AgentLoop } from '../agent/AgentLoop';
import type { AgentEvent, LLMMessage, LLMProviderInterface } from '../types';

const mockCtrl = {
  getAccessibilityTree: jest.fn<Promise<unknown>, []>(async () => ({
    text: '初始屏幕',
    children: [],
    className: 'View',
  })),
  openApp: jest.fn<Promise<boolean>, [string]>(async () => true),
};

jest.mock('react-native-accessibility-controller', () => mockCtrl);

describe('AgentLoop prompt-safe thinking history', () => {
  beforeEach(() => {
    mockCtrl.getAccessibilityTree.mockReset().mockResolvedValue({
      text: '初始屏幕',
      children: [],
      className: 'View',
    });
    mockCtrl.openApp.mockReset().mockResolvedValue(true);
  });

  it('emits complete thinking but sends only durable action history next round', async () => {
    const messagesList: LLMMessage[][] = [];
    const thinkingText = '比较 {screenState} 后打开目标应用';
    const responses = [
      `<think>${thinkingText}</think>\n` +
        '<tool_call>{"name":"open_app","arguments":{"packageName":"target.app"}}</tool_call>',
      '{"name":"task_complete","arguments":{"summary":"已完成"}}',
    ];
    const provider = {
      generateWithTools: jest.fn(async (messages: LLMMessage[]) => {
        messagesList.push(messages.map((message) => ({ ...message })));
        return responses[messagesList.length - 1] ?? responses[responses.length - 1];
      }),
    } as unknown as LLMProviderInterface;
    const observedThinking: string[] = [];
    const cacheDiagnostics: Array<Record<string, unknown>> = [];
    const loop = new AgentLoop({
      provider,
      maxSteps: 3,
      settleMs: 0,
      delayFn: async () => {},
      onThinking: (content) => observedThinking.push(content),
      onCacheDiagnostic: (event) => cacheDiagnostics.push(event),
    });
    const events: AgentEvent[] = [];

    for await (const event of loop.run('打开目标应用')) events.push(event);

    expect(observedThinking).toEqual([thinkingText]);
    expect(events).toContainEqual({ type: 'thinking', content: thinkingText });
    expect(mockCtrl.openApp).toHaveBeenCalledWith('target.app');

    const secondRequest = messagesList[1];
    const assistantHistory = secondRequest
      .filter((message) => message.role === 'assistant')
      .map((message) => message.content)
      .join('\n');
    expect(assistantHistory).not.toContain(thinkingText);
    expect(assistantHistory).not.toContain('<think>');
    expect(assistantHistory).toContain('name="open_app"');
    expect(assistantHistory).toContain('target.app');
    expect(secondRequest.some(
      (message) => message.role === 'user' && message.content.includes('工具调用结束'),
    )).toBe(true);
    expect(cacheDiagnostics).toHaveLength(2);
    expect(cacheDiagnostics[0]).toEqual(expect.objectContaining({
      scope: 'agent_loop',
      event: 'context',
      previousPrefixRetained: null,
    }));
    expect(cacheDiagnostics[1]).toEqual(expect.objectContaining({
      scope: 'agent_loop',
      event: 'context',
      previousPrefixRetained: true,
    }));
  });
});
