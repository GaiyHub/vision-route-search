/**
 * Behavioral tests for the completion confirmation gate: the model's
 * task_complete / plain-text verdict must be confirmed by the user before the
 * loop finishes; a rejection appends a normal continuation turn and keeps the
 * loop running (consuming one step).
 */

import { AgentLoop } from '../agent/AgentLoop';
import type { AgentEvent, LLMMessage, LLMProviderInterface } from '../types';
import { CloudProvider } from '../providers/CloudProvider';
import { TodoList } from '../agent/TodoList';

jest.mock('react-native-accessibility-controller', () => ({
  getAccessibilityTree: jest.fn(async () => ({
    text: '测试屏幕',
    children: [],
    resourceId: 'test',
    className: 'View',
  })),
  openApp: jest.fn(async () => true),
}));

type GateDecision = 'complete' | { continue: string };
type CompletionGate = (result: string) => Promise<GateDecision>;

/** Typed gate mock so jest.fn inference doesn't widen the return to string. */
function makeGate<T extends string | { continue: string }>(
  impl: (result: string) => T | Promise<T>,
): jest.MockedFunction<CompletionGate> {
  return jest.fn(impl) as unknown as jest.MockedFunction<CompletionGate>;
}

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
  return {
    provider: { generateWithTools } as unknown as LLMProviderInterface,
    messagesList,
  };
}

/** Content of the last user turn in a message array. */
function lastUser(messages: LLMMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

async function collectEvents(
  loop: AgentLoop,
  task = '测试任务',
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of loop.run(task)) events.push(e);
  return events;
}

const taskComplete = (summary: string) =>
  `{"name": "task_complete", "arguments": {"summary": "${summary}"}}`;

describe('completion confirmation gate (task_complete path)', () => {
  test('gate "complete" → completion_pending then complete, loop ends', async () => {
    const gate = makeGate(async () => 'complete');
    const { provider } = makeProvider([taskComplete('已完成')]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      completionGate: gate,
    });
    const events = await collectEvents(loop);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledWith('已完成');
    expect(events.map((e) => e.type)).toEqual(['completion_pending', 'complete']);
  });

  test('gate { continue } → completion_pending, user turn appended, finishes on second verdict', async () => {
    const gate = makeGate(async (result) =>
      result === '第一次判定'
        ? { continue: '用户确认任务尚未完成：第一次判定。请继续完成剩余步骤。' }
        : 'complete',
    );
    const { provider, messagesList } = makeProvider([
      taskComplete('第一次判定'),
      taskComplete('第二次判定'),
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      completionGate: gate,
    });
    const events = await collectEvents(loop);
    expect(gate).toHaveBeenCalledTimes(2);
    // The continuation reply is appended to the latest user turn.
    expect(lastUser(messagesList[1])).toContain('用户确认任务尚未完成：第一次判定。请继续完成剩余步骤。');
    expect(events.map((e) => e.type)).toEqual([
      'completion_pending',
      'observation',
      'completion_pending',
      'complete',
    ]);
    // The rejection consumes one step (the observation after the verdict).
    const obs = events[1];
    expect(obs.type === 'observation' && obs.step).toBe(1);
  });

  test('rejected verdict raises the ceiling so at least 10 more steps run', async () => {
    // First verdict (task_complete) is rejected; when the raised ceiling is
    // later exhausted, the step-ceiling gate asks again and the user accepts.
    const gate = makeGate(async (result) =>
      result === '未完成判定'
        ? { continue: '用户确认任务尚未完成。请继续完成剩余步骤。' }
        : 'complete',
    );
    const onMaxStepsRaised = jest.fn();
    const { provider } = makeProvider([taskComplete('未完成判定')]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 3,
      settleMs: 0,
      completionGate: gate,
      onMaxStepsRaised,
    });
    // After the rejection the loop keeps running under a RAISED ceiling; with
    // an empty follow-up the degenerate path burns steps up to the new limit,
    // then the step-ceiling gate ends the task by user verdict.
    const events = await collectEvents(loop);
    expect(gate).toHaveBeenCalledTimes(2);
    // Ceiling raised from 3 to current step (0) + 10 + 1 = 11: the rejection
    // itself consumes one step, then 10 full iterations remain.
    expect(onMaxStepsRaised).toHaveBeenCalledWith(11);
    expect(events.map((e) => e.type)).toEqual([
      'completion_pending',
      ...Array(11).fill('observation'),
      'completion_pending',
      'complete',
    ]);
  });

  test('no gate wired → behavior unchanged (immediate complete)', async () => {
    const { provider } = makeProvider([taskComplete('已完成')]);
    const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
    const events = await collectEvents(loop);
    expect(events.map((e) => e.type)).toEqual(['complete']);
  });

  test('gate throws → falls back to complete, loop not broken', async () => {
    const gate = makeGate(async () => {
      throw new Error('boom');
    });
    const { provider } = makeProvider([taskComplete('已完成')]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      completionGate: gate,
    });
    const events = await collectEvents(loop);
    expect(events.map((e) => e.type)).toEqual(['completion_pending', 'complete']);
  });

  test('task_failed bypasses the gate', async () => {
    const gate = makeGate(async () => 'complete');
    const { provider } = makeProvider([
      `{"name": "task_failed", "arguments": {"reason": "失败"}}`,
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      completionGate: gate,
    });
    const events = await collectEvents(loop);
    expect(gate).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(['failed']);
  });
});

describe('step-ceiling confirmation gate (maxSteps exhausted)', () => {
  test('gate "complete" → completion_pending then complete, loop ends', async () => {
    const gate = makeGate(async () => 'complete');
    const { provider } = makeProvider(['', '']);
    const loop = new AgentLoop({
      provider,
      maxSteps: 2,
      settleMs: 0,
      completionGate: gate,
    });
    const events = await collectEvents(loop);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledWith('步数已用尽（2 步），任务是否已完成？');
    expect(events.map((e) => e.type)).toEqual([
      'observation',
      'observation',
      'completion_pending',
      'complete',
    ]);
  });

  test('gate { continue } → ceiling raised, user turn appended, keeps going', async () => {
    const gate = makeGate(async (result) =>
      result.startsWith('步数已用尽')
        ? { continue: '用户确认任务尚未完成。请继续完成剩余步骤。' }
        : 'complete',
    );
    const onMaxStepsRaised = jest.fn();
    const { provider, messagesList } = makeProvider(['', '', taskComplete('最终完成')]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 2,
      settleMs: 0,
      completionGate: gate,
      onMaxStepsRaised,
    });
    const events = await collectEvents(loop);
    expect(gate).toHaveBeenCalledTimes(2);
    // Ceiling raised from 2 to current step (2) + 10 + 1 = 13.
    expect(onMaxStepsRaised).toHaveBeenCalledWith(13);
    // The continuation reply reaches the next prompt.
    expect(lastUser(messagesList[2])).toContain('用户认为任务尚未完成');
    expect(events.map((e) => e.type)).toEqual([
      'observation',
      'observation',
      'completion_pending',
      'completion_pending',
      'complete',
    ]);
  });

  test('no gate wired → max_steps_reached end preserved', async () => {
    const { provider } = makeProvider(['', '']);
    const loop = new AgentLoop({ provider, maxSteps: 2, settleMs: 0 });
    const events = await collectEvents(loop);
    expect(events.map((e) => e.type)).toEqual([
      'observation',
      'observation',
      'max_steps_reached',
    ]);
  });
});

describe('completion confirmation gate (plain-text reply path)', () => {
  test('text reply + gate "complete" → completion_pending then response', async () => {
    const gate = makeGate(async () => 'complete');
    const { provider } = makeProvider(['任务已完成，无需更多操作']);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      completionGate: gate,
    });
    const events = await collectEvents(loop);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledWith('任务已完成，无需更多操作');
    expect(events.map((e) => e.type)).toEqual(['completion_pending', 'response']);
  });

  test('text reply + gate { continue } → user turn appended, loop keeps going', async () => {
    const gate = makeGate(async (result) =>
      result === '任务已完成，无需更多操作'
        ? { continue: '用户确认任务尚未完成。请继续完成剩余步骤。' }
        : 'complete',
    );
    const { provider, messagesList } = makeProvider([
      '任务已完成，无需更多操作',
      taskComplete('第二次判定'),
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      completionGate: gate,
    });
    const events = await collectEvents(loop);
    expect(gate).toHaveBeenCalledTimes(2);
    expect(lastUser(messagesList[1])).toContain('用户确认任务尚未完成。请继续完成剩余步骤。');
    expect(events.map((e) => e.type)).toEqual([
      'completion_pending',
      'observation',
      'completion_pending',
      'complete',
    ]);
  });

  test('degenerate empty output burns steps; only the ceiling gate fires', async () => {
    const gate = makeGate(async () => 'complete');
    const { provider } = makeProvider(['', '']);
    const loop = new AgentLoop({
      provider,
      maxSteps: 2,
      settleMs: 0,
      completionGate: gate,
    });
    const events = await collectEvents(loop);
    // Empty output never counts as a completion verdict: the gate is only
    // consulted once the step ceiling is exhausted.
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledWith('步数已用尽（2 步），任务是否已完成？');
    expect(events.map((e) => e.type)).toEqual([
      'observation',
      'observation',
      'completion_pending',
      'complete',
    ]);
  });
});

describe('message-array conversation structure (OpenAI protocol)', () => {
  const openApp = `{"name": "open_app", "arguments": {"packageName": "com.example"}}`;

  test('first turn: static system is followed by an unlabeled ordinary user turn', async () => {
    const { provider, messagesList } = makeProvider([taskComplete('已完成')]);
    const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
    await collectEvents(loop, '打开设置');
    const msgs = messagesList[0];
    expect(msgs.length).toBe(3);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).not.toContain('打开设置');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('<runtime_context>');
    expect(msgs[1].content).not.toContain('打开设置');
    expect(msgs[1].content).not.toContain('当前任务');
    expect(msgs[1].cache).toBe(true);
    expect(msgs[1].content).not.toContain('屏幕观察状态');
    expect(msgs[2]).toEqual(expect.objectContaining({ role: 'user', content: '打开设置' }));
  });

  test('prior conversation keeps user and assistant role boundaries', async () => {
    const { provider, messagesList } = makeProvider([taskComplete('已完成')]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      conversationHistory: [
        { id: 'u1', role: 'user', content: '帮我查杭州天气' },
        { id: 'a1', role: 'assistant', content: '今天晴，25℃' },
      ],
    });
    await collectEvents(loop, '那明天呢');

    const msgs = messagesList[0];
    expect(msgs.map((message) => message.role)).toEqual([
      'system', 'user', 'user', 'assistant', 'user',
    ]);
    expect(msgs[1].content).toContain('<runtime_context>');
    expect(msgs[2].content).toBe('帮我查杭州天气');
    expect(msgs[3].content).toBe('今天晴，25℃');
    expect(msgs[4].content).toBe('那明天呢');
    expect(JSON.stringify(msgs)).not.toContain('连续会话历史');
    expect(JSON.stringify(msgs)).not.toContain('当前任务');
  });

  test('history rounds alternate assistant/user and merge the latest user turn', async () => {
    const { provider, messagesList } = makeProvider([openApp, taskComplete('已完成')]);
    const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
    await collectEvents(loop);
    const msgs = messagesList[1];
    // system, user(runtime context), user(task), assistant(action), user(result)
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'user', 'assistant', 'user']);
    expect(msgs[3].content).toContain('name="open_app"');
    expect(msgs[3].content).toContain('packageName');
    // The merged user turn carries only the tool result and protocol boundary.
    expect(msgs[4].content).toContain('工具调用结束');
    expect(msgs[4].content).not.toContain('屏幕观察状态');
  });

  test('disabling context compression keeps all available rounds', async () => {
    const { provider, messagesList } = makeProvider([
      openApp, // round 1
      openApp, // round 2
      taskComplete('已完成'), // round 3 (this inference)
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      contextCompressionEnabled: false,
    });
    await collectEvents(loop);
    const msgs = messagesList[2];
    // Repeated no-progress actions may still be compacted by the loop detector,
    // but disabling context compression must not add a sliding-window omission.
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'user', 'assistant', 'user']);
    expect(msgs[1].content).toContain('<runtime_context>');
    expect(msgs[1].content).not.toContain('省略了更早的对话轮次');
    expect(msgs[1].cache).toBe(true);
    expect(lastUser(msgs)).not.toContain('较早的');
    expect(msgs[3].content).toContain('name="open_app"');
    // No implicit environment observation is added after the retained action.
    expect(lastUser(msgs)).not.toContain('屏幕观察状态');
  });

  test('messages submitted while running remain ordinary user turns', async () => {
    const pending: string[] = ['请使用百度'];
    const { provider, messagesList } = makeProvider([taskComplete('已完成')]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      getUserMessages: () => pending.splice(0),
    });
    await collectEvents(loop);
    const user = lastUser(messagesList[0]);
    expect(user.endsWith('请使用百度')).toBe(true);
    expect(user).not.toContain('用户修正');
    expect(user).not.toContain('初始目标不变');
  });

  test('empty Todo injects only a short applicability reminder', async () => {
    const { provider, messagesList } = makeProvider([taskComplete('已完成')]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      todoList: new TodoList(),
    });
    await collectEvents(loop);
    const user = lastUser(messagesList[0]);
    expect(user).toContain('任务清单当前为空');
    expect(user).toContain('todo_create');
    expect(user).toContain('简单任务无需创建清单');
    expect(user).not.toContain('任务进度:\n');
  });

  test('cache breakpoints mark the stable prefix only', async () => {
    const openApp = `{"name": "open_app", "arguments": {"packageName": "com.example"}}`;
    const { provider, messagesList } = makeProvider([openApp, taskComplete('已完成')]);
    const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
    await collectEvents(loop);
    const msgs = messagesList[1];
    // system is always cached; the last stable history assistant message is
    // a breakpoint; the volatile current user turn is never marked.
    expect(msgs[0].cache).toBe(true);
    expect(msgs[1].cache).toBe(true);
    expect(msgs[2].role).toBe('user');
    expect(msgs[2].cache).toBeUndefined();
    expect(msgs[3].role).toBe('assistant');
    expect(msgs[3].cache).toBe(true);
    expect(msgs[4].role).toBe('user');
    expect(msgs[4].cache).toBeUndefined();
  });

  test('compaction summarizes old prefix while recent user turns and Todo remain live', async () => {
    const summaryRequests: LLMMessage[][] = [];
    const provider = {
      generateWithTools: jest.fn(async (messages: LLMMessage[]) => {
        summaryRequests.push(messages);
        return '用户正在继续完成压缩后的手机任务。';
      }),
    } as unknown as LLMProviderInterface;
    const todo = new TodoList();
    todo.setItems([{
      subject: '核对最终页面',
      description: '确认最终页面满足目标',
      status: 'in_progress',
    }]);
    const loop = new AgentLoop({
      provider,
      systemPrompt: '固定系统提示',
      contextWindowTokens: 8_192,
      todoList: todo,
      toolFilter: ['task_complete'],
      settleMs: 0,
    });
    const buildMessages = (loop as unknown as {
      buildMessages: (
        task: string,
        history: AgentEvent[],
      ) => Promise<{ legacy: LLMMessage[] }>;
    }).buildMessages.bind(loop);

    const history: AgentEvent[] = Array.from({ length: 6 }, (_, index): AgentEvent => ({
      type: 'user_message',
      id: `test_user_${index}`,
      content: index < 2 ? `较早消息${index}：${'甲'.repeat(3_000)}` : `最近消息${index}`,
    }));
    const built = await buildMessages('执行目标：完成手机任务', history);

    expect(summaryRequests).toHaveLength(1);
    expect(summaryRequests[0]![0]!.content).toContain('较早消息0');
    expect(summaryRequests[0]![0]!.content).toContain('执行目标：完成手机任务');
    expect(summaryRequests[0]![0]!.content).toContain('最近消息5');
    expect(
      summaryRequests[0]![0]!.content.split('需要压缩的新增历史：')[1] ?? '',
    ).not.toContain('最近消息5');
    expect(summaryRequests[0]![0]!.content).not.toContain('核对最终页面');
    expect(built.legacy[2]!.content).toContain(
      '<context_summary>\n用户正在继续完成压缩后的手机任务。\n</context_summary>',
    );
    expect(built.legacy[1]!.content).toContain('<runtime_context>');
    expect(built.legacy[1]!.content).not.toContain('<context_summary>');
    expect(built.legacy[2]!.content).not.toContain('执行目标：完成手机任务');
    expect(built.legacy[2]!.content).not.toContain('当前任务');
    expect(JSON.stringify(built.legacy)).toContain('最近消息5');
    expect(JSON.stringify(built.legacy)).not.toContain('较早消息0');
    expect(lastUser(built.legacy)).toContain('核对最终页面');
  });

  test('stop during context compression exits cleanly without an error event', async () => {
    let finishSummary!: (value: string) => void;
    let markSummaryStarted!: () => void;
    const summaryStarted = new Promise<void>((resolve) => {
      markSummaryStarted = resolve;
    });
    const provider = {
      generateWithTools: jest.fn(() => {
        markSummaryStarted();
        return new Promise<string>((resolve) => { finishSummary = resolve; });
      }),
    } as unknown as LLMProviderInterface;
    const conversationHistory = Array.from({ length: 6 }, (_, index) => [
      {
        id: `u${index}`,
        role: 'user' as const,
        content: index < 2 ? `较早指令${index}${'甲'.repeat(4_000)}` : `最近指令${index}`,
      },
      {
        id: `a${index}`,
        role: 'assistant' as const,
        content: `回复${index}`,
      },
    ]).flat();
    const loop = new AgentLoop({
      provider,
      systemPrompt: '固定系统提示',
      contextWindowTokens: 8_192,
      conversationHistory,
      toolFilter: ['task_complete'],
      settleMs: 0,
    });

    const running = collectEvents(loop);
    await summaryStarted;
    loop.abort();
    finishSummary('不应提交的摘要');
    await expect(running).resolves.toEqual([]);
  });
});

describe('CloudProvider prompt caching serialization', () => {
  function mockFetch(): jest.Mock {
    const fn = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      text: async () => '',
    }));
    (global as { fetch: unknown }).fetch = fn as unknown as typeof fetch;
    return fn;
  }

  test('anthropic: cache flags become cache_control breakpoints', async () => {
    const fetchMock = mockFetch();
    const provider = new CloudProvider({
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
      apiFormat: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
    });
    await provider.generateWithTools(
      [
        { role: 'system', cache: true, content: '系统指令' },
        { role: 'user', content: '初始观察' },
        { role: 'assistant', cache: true, content: '- 调用了 open_app' },
        { role: 'user', content: '第 1 步: 观察了屏幕' },
      ],
      [],
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.system).toEqual([
      { type: 'text', text: '系统指令', cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.messages).toEqual([
      { role: 'user', content: '初始观察' },
      { role: 'assistant', content: '- 调用了 open_app', cache_control: { type: 'ephemeral' } },
      { role: 'user', content: '第 1 步: 观察了屏幕' },
    ]);
  });

  test('openai-compatible path ignores cache flags', async () => {
    const fetchMock = mockFetch();
    const provider = new CloudProvider({
      apiKey: 'k',
      model: 'gpt-4o',
      apiFormat: 'openai',
      baseUrl: 'https://api.openai.com/v1',
    });
    await provider.generateWithTools(
      [
        { role: 'system', cache: true, content: '系统指令' },
        { role: 'user', content: '屏幕' },
      ],
      [],
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.messages).toEqual([
      { role: 'system', content: '系统指令' },
      { role: 'user', content: '屏幕' },
    ]);
  });

  test('usage reporting: cached tokens forwarded for openai format', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          prompt_tokens_details: { cached_tokens: 90 },
        },
      }),
      text: async () => '',
    });
    const onUsage = jest.fn();
    const onCacheDiagnostic = jest.fn();
    const provider = new CloudProvider({
      apiKey: 'k',
      model: 'gpt-4o',
      apiFormat: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      onUsage,
      onCacheDiagnostic,
    });
    await provider.generateWithTools([{ role: 'user', content: '屏幕' }], []);
    expect(onUsage).toHaveBeenCalledWith(120, 30, 90);
    expect(onCacheDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'provider',
      event: 'usage',
      apiFormat: 'openai',
      cacheMetricPresent: true,
      cacheMetricSource: 'prompt_tokens_details.cached_tokens',
      cacheReadTokens: 90,
    }));
  });

  test('cache diagnostics distinguish a missing metric from a real zero', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      }),
      text: async () => '',
    });
    const onCacheDiagnostic = jest.fn();
    const provider = new CloudProvider({
      apiKey: 'k',
      model: 'custom-model',
      apiFormat: 'openai',
      baseUrl: 'https://gateway.example/v1',
      onCacheDiagnostic,
    });
    await provider.generateWithTools([{ role: 'user', content: '屏幕' }], []);
    expect(onCacheDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'provider',
      event: 'request',
      endpointHost: 'gateway.example',
      cacheControlMode: 'provider_automatic',
    }));
    expect(onCacheDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'provider',
      event: 'usage',
      cacheMetricPresent: false,
      cacheMetricSource: 'missing',
      usageKeys: ['completion_tokens', 'prompt_tokens'],
    }));
  });

  test('usage reporting: cached tokens forwarded for anthropic format', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        usage: {
          input_tokens: 200,
          output_tokens: 40,
          cache_read_input_tokens: 150,
          cache_creation_input_tokens: 50,
        },
      }),
      text: async () => '',
    });
    const onUsage = jest.fn();
    const provider = new CloudProvider({
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
      apiFormat: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      onUsage,
    });
    await provider.generateWithTools([{ role: 'user', content: '屏幕' }], []);
    expect(onUsage).toHaveBeenCalledWith(400, 40, 150);
  });

  test('hung fetch is aborted after requestTimeoutMs', async () => {
    const fetchMock = mockFetch();
    // A hung socket: the request neither responds nor errors, so without the
    // timeout it would freeze the agent loop forever.
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const provider = new CloudProvider({
      apiKey: 'k',
      model: 'gpt-4o',
      apiFormat: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      requestTimeoutMs: 50,
    });
    await expect(
      provider.generateWithTools([{ role: 'user', content: '屏幕' }], []),
    ).rejects.toThrow(/请求超时/);
    // The AbortController signal reached fetch and was actually aborted.
    const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
    expect(init.signal?.aborted).toBe(true);
  });
});

describe('thinking-mode fragment guard (no completion verdict on residue)', () => {
  test('fragment text "- 调用了 tap(" → runtime guidance injected, no completion_pending', async () => {
    const gate = makeGate(async () => 'complete');
    const { provider, messagesList } = makeProvider([
      '- 调用了 tap(',
      taskComplete('已完成'),
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      completionGate: gate,
    });
    const events = await collectEvents(loop);
    // The fragment must never reach the gate as a completion verdict.
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledWith('已完成');
    // Internal runtime guidance tells the model to emit a complete tool call.
    expect(lastUser(messagesList[1])).toContain('叙述残片');
    expect(lastUser(messagesList[1])).toContain('<tool_call>');
    expect(events.map((e) => e.type)).toEqual(['observation', 'completion_pending', 'complete']);
  });

  test('incomplete tool_use wrapper never becomes a completion verdict', async () => {
    const gate = makeGate(async () => 'complete');
    const { provider, messagesList } = makeProvider([
      '<tool_use id="toolu_35" name="ui_tap">',
      taskComplete('已完成'),
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      completionGate: gate,
    });
    const events = await collectEvents(loop);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledWith('已完成');
    expect(lastUser(messagesList[1])).toContain('叙述残片');
    expect(events.map((e) => e.type)).toEqual(['observation', 'completion_pending', 'complete']);
  });

  test('a long action narration is not treated as a fragment', async () => {
    const gate = makeGate(async () => 'complete');
    const { provider } = makeProvider([
      '调用了 tap(15) 后屏幕显示全部参数页面，现在读取各项参数。',
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 5,
      settleMs: 0,
      completionGate: gate,
    });
    const events = await collectEvents(loop);
    expect(gate).toHaveBeenCalledTimes(1);
    // A plain-text reply that passes the gate surfaces as a response event.
    expect(events.map((e) => e.type)).toEqual(['completion_pending', 'response']);
  });
});

describe('LLM inference timeout (hung provider)', () => {
  test('inference that never settles rejects with 推理超时 and emits error', async () => {
    const provider = {
      generateWithTools: jest.fn(() => new Promise<string>(() => {})),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({
      provider,
      maxSteps: 3,
      settleMs: 0,
      requestTimeoutMs: 50,
    });
    const events = await collectEvents(loop);
    expect(events.map((e) => e.type)).toEqual(['error']);
    expect((events[0] as { error: Error }).error.message).toMatch(/推理超时/);
  });

  test('timeout races the abort signal: abort still wins when it fires first', async () => {
    const provider = {
      generateWithTools: jest.fn(() => new Promise<string>(() => {})),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({
      provider,
      maxSteps: 3,
      settleMs: 0,
      requestTimeoutMs: 5000,
    });
    const events: AgentEvent[] = [];
    const iterator = loop.run('测试任务');
    const pump = (async () => {
      for await (const e of iterator) {
        events.push(e);
        if (e.type === 'error') break;
      }
    })();
    // Let the loop reach the hung inference, then abort it.
    await new Promise((r) => setTimeout(r, 20));
    loop.abort();
    await pump;
    expect(events.map((e) => e.type)).toEqual(['error']);
    expect((events[0] as { error: Error }).error.message).toBe('inference aborted');
  });
});
