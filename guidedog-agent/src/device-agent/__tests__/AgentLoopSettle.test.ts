import { AgentLoop } from '../agent/AgentLoop';
import type { AgentEvent, LLMProviderInterface, Tool } from '../types';

jest.mock('react-native-accessibility-controller', () => ({}));

const taskComplete = '{"name":"task_complete","arguments":{"summary":"done"}}';

function providerFor(responses: string[]): LLMProviderInterface {
  let index = 0;
  return {
    generateWithTools: jest.fn(async () => responses[index++] ?? taskComplete),
  } as unknown as LLMProviderInterface;
}

function changingTool(name: string): Tool {
  return {
    name,
    description: 'test screen mutation',
    uiEffect: 'change',
    parameters: { type: 'object', properties: {} },
  };
}

async function run(loop: AgentLoop): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of loop.run('test')) events.push(event);
  return events;
}

describe('AgentLoop inter-tool settle policy', () => {
  test('does not add a fixed settle delay after the final tool call in a round', async () => {
    const delays: number[] = [];
    await run(new AgentLoop({
      provider: providerFor([
        '{"name":"mutate_ui","arguments":{}}',
        taskComplete,
      ]),
      maxSteps: 3,
      settleMs: 500,
      delayFn: async (ms) => {
        delays.push(ms);
        if (ms !== 500) await new Promise<void>(() => {});
      },
      extraTools: [{
        tool: changingTool('mutate_ui'),
        handler: async () => ({ ok: true, data: { dispatched: true } }),
      }],
    }));

    expect(delays.filter((ms) => ms === 500)).toHaveLength(0);
  });

  test('settles only between sequential changing calls, never after the batch', async () => {
    const delays: number[] = [];
    await run(new AgentLoop({
      provider: providerFor([
        '[{"name":"first_mutation","arguments":{}},{"name":"second_mutation","arguments":{}}]',
        taskComplete,
      ]),
      maxSteps: 3,
      settleMs: 500,
      delayFn: async (ms) => {
        delays.push(ms);
        if (ms !== 500) await new Promise<void>(() => {});
      },
      extraTools: [
        {
          tool: changingTool('first_mutation'),
          handler: async () => ({ ok: true, data: { dispatched: true } }),
        },
        {
          tool: changingTool('second_mutation'),
          handler: async () => ({ ok: true, data: { dispatched: true } }),
        },
      ],
    }));

    expect(delays.filter((ms) => ms === 500)).toHaveLength(1);
  });

  test('does not settle again when a changing tool returns a post-action image', async () => {
    const delays: number[] = [];
    await run(new AgentLoop({
      provider: providerFor([
        '[{"name":"observe_after_mutation","arguments":{}},{"name":"next_action","arguments":{}}]',
        taskComplete,
      ]),
      maxSteps: 3,
      settleMs: 500,
      delayFn: async (ms) => {
        delays.push(ms);
        if (ms !== 500) await new Promise<void>(() => {});
      },
      extraTools: [
        {
          tool: changingTool('observe_after_mutation'),
          handler: async () => ({
            ok: true,
            data: { dispatched: true },
            observationImage: { path: '/tmp/post-action.jpg', base64: 'image' },
          }),
        },
        {
          tool: changingTool('next_action'),
          handler: async () => ({ ok: true, data: { dispatched: true } }),
        },
      ],
    }));

    expect(delays.filter((ms) => ms === 500)).toHaveLength(0);
  });
});
