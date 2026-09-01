import type { Tool } from '../types';
import { toAnthropicTool, toGemmaFunction, toOpenAIFunction } from '../tools/ToolSchema';

const tool: Tool = {
  name: 'read_status',
  description: '读取状态。',
  parameters: {
    type: 'object',
    properties: {},
  },
  outputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['ready', 'busy'] },
    },
    required: ['status'],
    additionalProperties: false,
  },
};

describe('provider-neutral tool output schema', () => {
  it('retains a structured successful-data contract on the internal tool', () => {
    expect(tool.outputSchema).toEqual({
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ready', 'busy'] },
      },
      required: ['status'],
      additionalProperties: false,
    });
  });

  it('does not inject output metadata into provider input schemas', () => {
    expect(JSON.stringify(toOpenAIFunction(tool))).not.toContain('outputSchema');
    expect(JSON.stringify(toAnthropicTool(tool))).not.toContain('outputSchema');
    expect(JSON.stringify(toGemmaFunction(tool))).not.toContain('outputSchema');
  });

  it('serializes closed nested input objects for every provider', () => {
    const nestedInputTool: Tool = {
      name: 'mutate',
      description: '变更状态。',
      parameters: {
        type: 'object',
        properties: {
          risk: {
            type: 'object',
            properties: { level: { type: 'string' } },
            required: ['level'],
            additionalProperties: false,
          },
        },
      },
    };

    for (const schema of [
      toOpenAIFunction(nestedInputTool),
      toAnthropicTool(nestedInputTool),
      toGemmaFunction(nestedInputTool),
    ]) {
      expect(JSON.stringify(schema)).toContain(
        '"risk":{"type":"object","properties":{"level":{"type":"string"}},"required":["level"],"additionalProperties":false}',
      );
    }
  });
});
