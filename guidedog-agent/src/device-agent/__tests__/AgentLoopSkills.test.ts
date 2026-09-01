/**
 * Behavioral tests for the experience library (skills): catalog injection
 * into task-level runtime context, on-demand body loading via read_skill (with the
 * body surviving into the next decision round), and absence of read_skill
 * when no skills are configured.
 */

import { AgentLoop } from '../agent/AgentLoop';
import type { AgentEvent, LLMMessage, LLMProviderInterface, Tool } from '../types';
import { READ_SKILL_TOOL_NAME } from '../tools/SkillTool';

jest.mock('react-native-accessibility-controller', () => ({
  getAccessibilityTree: jest.fn(async () => ({
    text: '测试屏幕',
    children: [],
    resourceId: 'test',
    className: 'View',
  })),
  openApp: jest.fn(async () => true),
}));

interface ProviderCapture {
  provider: LLMProviderInterface;
  messagesList: LLMMessage[][];
  toolsList: Tool[][];
}

function makeProvider(responses: string[]): ProviderCapture {
  const messagesList: LLMMessage[][] = [];
  const toolsList: Tool[][] = [];
  const generateWithTools = jest.fn(async (messages: LLMMessage[], tools: Tool[]) => {
    messagesList.push(messages);
    toolsList.push(tools);
    const idx = messagesList.length - 1;
    return idx < responses.length ? responses[idx] : '';
  });
  return {
    provider: { generateWithTools } as unknown as LLMProviderInterface,
    messagesList,
    toolsList,
  };
}

function systemContent(messages: LLMMessage[]): string {
  return messages.find((m) => m.role === 'system')?.content ?? '';
}

function runtimeContext(messages: LLMMessage[]): string {
  return messages.find(
    (m) => m.role === 'user' && m.content.includes('<runtime_context>'),
  )?.content ?? '';
}

function toolNames(tools: Tool[]): string[] {
  return tools.map((t) => t.name);
}

async function collectEvents(loop: AgentLoop): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of loop.run('测试任务')) events.push(e);
  return events;
}

const skillBody = '## 操作流程\n1. 打开应用\n2. 点击充值';

const skills = {
  catalog: [{ name: 'alipay-topup', description: '支付宝充值流程' }],
  load: jest.fn(async (name: string) => (name === 'alipay-topup' ? skillBody : null)),
};

const readSkill = `{"name": "read_skill", "arguments": {"name": "alipay-topup"}}`;
const taskComplete = '{"name": "task_complete", "arguments": {"summary": "已完成"}}';

describe('experience library (skills)', () => {
  test('keeps the base prompt static and moves task-scoped data to runtime context', async () => {
    const { provider, messagesList } = makeProvider([taskComplete]);
    const loop = new AgentLoop({
      provider,
      systemPrompt: 'BASE_AGENT_POLICY',
      systemPromptSuffix: 'CUSTOM_RULE',
    });
    await collectEvents(loop);

    const systemMessages = messagesList[0].filter((message) => message.role === 'system');
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].content).toContain('BASE_AGENT_POLICY');
    expect(systemMessages[0].content).not.toContain('测试任务');
    expect(systemMessages[0].content).not.toContain('CUSTOM_RULE');
    expect(systemMessages[0].content).not.toContain('请根据当前屏幕与任务进度决定下一步');

    const runtime = runtimeContext(messagesList[0]);
    expect(runtime).not.toContain('测试任务');
    expect(messagesList[0].some(
      (message) => message.role === 'user' && message.content === '测试任务',
    )).toBe(true);
    expect(runtime).not.toContain('当前任务:');
    expect(runtime).toContain('用户附加说明:\nCUSTOM_RULE');
    expect(runtime.match(/CUSTOM_RULE/g)).toHaveLength(1);
    expect(messagesList[0][1].cache).toBe(true);
  });

  test('keeps a compact decision protocol when no base prompt is supplied', async () => {
    const { provider, messagesList } = makeProvider([taskComplete]);
    await collectEvents(new AgentLoop({ provider }));
    expect(systemContent(messagesList[0])).toContain('请根据任务进度和工具结果决定下一步');
  });

  test('always exposes immutable file_read outside presets and user overrides', async () => {
    const { provider, toolsList } = makeProvider([taskComplete]);
    await collectEvents(new AgentLoop({
      provider,
      toolFilter: [],
      toolConfigurationOverrides: {
        file_read: {
          enabled: false,
          description: '用户篡改的描述',
          uiEffect: 'change',
        },
      },
    }));
    const fileRead = toolsList[0].find((tool) => tool.name === 'file_read');
    expect(fileRead).toBeDefined();
    expect(fileRead?.description).toContain('分页读取豆泡为超大工具结果保存的完整文本');
    expect(fileRead?.description).not.toContain('用户篡改');
    expect(fileRead?.parameters.properties._changesScreen).toBeUndefined();
  });

  test('catalog is injected into the task-level runtime context', async () => {
    const { provider, messagesList } = makeProvider([taskComplete]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 3,
      settleMs: 0,
      skills: {
        catalog: skills.catalog,
        load: skills.load,
      },
    });
    await collectEvents(loop);

    expect(systemContent(messagesList[0])).not.toContain('可用经验（skills）');
    const runtime = runtimeContext(messagesList[0]);
    expect(runtime).toContain('可用经验（skills）');
    expect(runtime).toContain('alipay-topup: 支付宝充值流程');
  });

  test('read_skill loads the body and it survives into the next decision round', async () => {
    const { provider, messagesList, toolsList } = makeProvider([readSkill, taskComplete]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 3,
      settleMs: 0,
      skills: {
        catalog: skills.catalog,
        load: skills.load,
      },
    });
    await collectEvents(loop);

    expect(skills.load).toHaveBeenCalledWith('alipay-topup');
    expect(toolNames(toolsList[0])).toContain(READ_SKILL_TOOL_NAME);

    // The second inference must see the loaded body in the user round
    // (tool_result semantics: the call record stays in the assistant round,
    // the body moves to the user round).
    const secondUser = messagesList[1].find(
      (m) => m.role === 'user' && m.content.includes('<tool_result'),
    );
    expect(secondUser?.content).toContain('tool_use_id="toolu_1" is_error="false"');
    expect(secondUser?.content).toContain('alipay-topup');
    expect(secondUser?.content).toContain('## 操作流程');
    expect(secondUser?.content).toContain('1. 打开应用');
    expect(secondUser?.content).toContain('2. 点击充值');
    // The assistant round keeps only the call record, not the body.
    const secondAssistant = messagesList[1].find((m) => m.role === 'assistant');
    expect(secondAssistant?.content).toContain('name="read_skill"');
    expect(secondAssistant?.content).not.toContain(skillBody);
  });

  test('an unknown skill name yields an error line, not a crash', async () => {
    const unknown = '{"name": "read_skill", "arguments": {"name": "no-such-skill"}}';
    const { provider, messagesList } = makeProvider([unknown, taskComplete]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 3,
      settleMs: 0,
      skills: {
        catalog: skills.catalog,
        load: skills.load,
      },
    });
    await collectEvents(loop);

    const secondAssistant = messagesList[1].find((m) => m.role === 'assistant');
    const secondUser = messagesList[1].find((m) => m.role === 'user' && m.content.includes('<tool_result'));
    expect(secondAssistant?.content).toContain('name="read_skill"');
    expect(secondAssistant?.content).not.toContain('失败');
    expect(secondUser?.content).toContain('is_error="true"');
    expect(secondUser?.content).toContain('no-such-skill');
  });

  test('no skills configured → no read_skill tool and no catalog block', async () => {
    const { provider, messagesList, toolsList } = makeProvider([taskComplete]);
    const loop = new AgentLoop({ provider, maxSteps: 3, settleMs: 0 });
    await collectEvents(loop);

    expect(toolNames(toolsList[0])).not.toContain(READ_SKILL_TOOL_NAME);
    expect(runtimeContext(messagesList[0])).not.toContain('可用经验');
  });

  test('toolFilter never hides read_skill', async () => {
    const { provider, toolsList } = makeProvider([taskComplete]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 3,
      settleMs: 0,
      toolFilter: ['ui_tap'],
      skills: {
        catalog: skills.catalog,
        load: skills.load,
      },
    });
    await collectEvents(loop);

    expect(toolNames(toolsList[0])).toContain(READ_SKILL_TOOL_NAME);
    expect(toolNames(toolsList[0])).toContain('ui_tap');
    expect(toolNames(toolsList[0])).toContain('open_app');
  });
});
