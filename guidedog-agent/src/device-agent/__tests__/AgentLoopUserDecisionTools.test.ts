/**
 * Behavioral tests for user-decision tools (confirm_action / ask_user): the loop must
 * BLOCK until the gate settles instead of force-failing the tool after the
 * 10s action timeout, and abort must still interrupt the wait.
 */

import { AgentLoop, USER_DECISION_TOOLS } from '../agent/AgentLoop';
import type { AgentEvent, LLMMessage, LLMProviderInterface } from '../types';

jest.mock('react-native-accessibility-controller', () => ({
  getAccessibilityTree: jest.fn(async () => ({
    text: '测试屏幕',
    children: [],
    resourceId: 'test',
    className: 'View',
  })),
  openApp: jest.fn(async () => true),
}));

const confirmTool = {
  name: 'confirm_action',
  description: '高风险操作确认',
  parameters: {
    type: 'object' as const,
    properties: {
      action: { type: 'string' as const },
      risk: { type: 'string' as const },
    },
    required: ['action', 'risk'],
  },
};

const askUserTool = {
  name: 'ask_user',
  description: '向用户澄清',
  parameters: {
    type: 'object' as const,
    properties: { question: { type: 'string' as const } },
    required: ['question'],
  },
};

const dummyTool = {
  name: 'dummy',
  description: '普通工具',
  parameters: { type: 'object' as const, properties: {} },
};

function makeProvider(responses: string[]): {
  provider: LLMProviderInterface;
  messagesList: LLMMessage[][];
} {
  const messagesList: LLMMessage[][] = [];
  const generateWithTools = jest.fn(async (messages: LLMMessage[]) => {
    messagesList.push(messages);
    const idx = messagesList.length - 1;
    return idx < responses.length ? responses[idx] : '';
  });
  return { provider: { generateWithTools } as unknown as LLMProviderInterface, messagesList };
}

/** Collapse every in-loop delay to at most 20ms so timeout races run fast. */
function fastDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(ms, 20)));
}

const taskComplete = (summary: string) =>
  `{"name": "task_complete", "arguments": {"summary": "${summary}"}}`;

describe('USER_DECISION_TOOLS', () => {
  test('contains both host-side user gates', () => {
    expect([...USER_DECISION_TOOLS]).toEqual([
      'confirm_action',
      'ask_user',
      'request_user_action',
    ]);
  });
});

describe('user-decision tool execution (blocking gate)', () => {
  test('confirm_action is not subject to the 10s action timeout', async () => {
    // The gate settles after 150ms; the collapsed 10s timeout (20ms) would
    // force-fail a normal tool first. confirm_action must wait for the user.
    const handler = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { ok: true, confirmed: true, denied: false };
    });
    const { provider } = makeProvider([
      '{"name": "confirm_action", "arguments": {"action": "点击「确认支付」", "risk": "high"}}',
      taskComplete('已完成'),
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      delayFn: fastDelay,
      extraTools: [{ tool: confirmTool, handler }],
    });
    const events: AgentEvent[] = [];
    for await (const e of loop.run('测试任务')) events.push(e);
    const action = events.find((e) => e.type === 'action');
    expect(action?.type === 'action' && action.result).toEqual({
      ok: true,
      data: { confirmed: true, denied: false },
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('ask_user is not subject to the 10s action timeout', async () => {
    const handler = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { ok: true, answered: true, answer: '妈妈' };
    });
    const { provider, messagesList } = makeProvider([
      '{"name": "ask_user", "arguments": {"question": "你想发送给谁？"}}',
      taskComplete('已完成'),
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      delayFn: fastDelay,
      extraTools: [{ tool: askUserTool, handler }],
    });
    const events: AgentEvent[] = [];
    for await (const e of loop.run('测试任务')) events.push(e);
    const action = events.find((e) => e.type === 'action');
    expect(action?.type === 'action' && action.result).toEqual({
      ok: true,
      data: { answered: true, answer: '妈妈' },
    });
    const nextAssistant = messagesList[1].find((message) => message.role === 'assistant');
    const nextUser = messagesList[1].find(
      (message) => message.role === 'user' && message.content.includes('<tool_result'),
    );
    expect(nextAssistant?.content).toContain('<tool_use id="toolu_1" name="ask_user">');
    expect(nextAssistant?.content).not.toContain('妈妈');
    expect(nextUser?.content).toContain('tool_use_id="toolu_1" is_error="false"');
    expect(nextUser?.content).toContain('妈妈');
    expect(nextUser?.content.indexOf('<tool_result')).toBeLessThan(
      nextUser?.content.indexOf('工具调用结束') ?? -1,
    );
  });

  test('ordinary tools keep the 10s action timeout', async () => {
    const handler = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { ok: true };
    });
    const { provider } = makeProvider([
      '{"name": "dummy", "arguments": {}}',
      taskComplete('已完成'),
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      delayFn: fastDelay,
      extraTools: [{ tool: dummyTool, handler }],
    });
    const events: AgentEvent[] = [];
    for await (const e of loop.run('测试任务')) events.push(e);
    const action = events.find((e) => e.type === 'action');
    expect(action?.type === 'action' && action.result).toEqual({
      ok: false,
      error: '工具调用超时（10 秒）',
      code: 'TOOL_TIMEOUT',
    });
  });

  test('abort interrupts a pending confirm_action wait', async () => {
    const handler = jest.fn(() => new Promise(() => {})); // gate never settles
    const { provider } = makeProvider([
      '{"name": "confirm_action", "arguments": {"action": "点击「确认支付」", "risk": "high"}}',
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      delayFn: fastDelay,
      extraTools: [{ tool: confirmTool, handler }],
    });
    const gen = loop.run('测试任务');
    const first = await gen.next(); // action event (loop now blocks on the gate)
    loop.abort();
    // The loop must exit promptly instead of hanging on the gate.
    const events: AgentEvent[] = [];
    let result = await gen.next();
    while (!result.done) {
      events.push(result.value);
      result = await gen.next();
    }
    expect(events.map((e) => e.type)).toContain('error');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(first.value?.type === 'action' && first.value.result).toMatchObject({
      ok: false,
      code: 'TOOL_CANCELLED',
    });
  });

  test('abort interrupts a pending ask_user wait', async () => {
    const handler = jest.fn(() => new Promise(() => {}));
    const { provider } = makeProvider([
      '{"name": "ask_user", "arguments": {"question": "请补充信息"}}',
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      delayFn: fastDelay,
      extraTools: [{ tool: askUserTool, handler }],
    });
    const gen = loop.run('测试任务');
    await gen.next();
    loop.abort();
    const events: AgentEvent[] = [];
    let result = await gen.next();
    while (!result.done) {
      events.push(result.value);
      result = await gen.next();
    }
    expect(events.map((e) => e.type)).toContain('error');
  });
});
