import type { LLMMessage, Tool } from '../types';
import { LLMProvider } from './LLMProvider';

/**
 * Options for FunctionGemmaProvider.
 */
export interface FunctionGemmaProviderOptions {
  /**
   * Injected inference function from react-native-executorch for FunctionGemma 270M.
   *
   * Wire it up from useLLM with the FunctionGemma model identifier:
   *   const { generate } = useLLM({ model: FUNCTION_GEMMA_270M });
   *   new FunctionGemmaProvider({ generateFn: generate })
   */
  generateFn?: (prompt: string) => Promise<string>;
  /**
   * Maximum tokens to generate per dispatch response.
   * FunctionGemma only needs to emit a compact JSON tool call, so 128 is
   * sufficient and avoids unnecessary compute. Default: 128.
   */
  maxTokens?: number;
}

/**
 * Fast tool-dispatch provider using FunctionGemma 270M.
 *
 * FunctionGemma 270M is fine-tuned exclusively for function/tool calling.
 * At 1,916 tok/s prefill / 142 tok/s decode on a Pixel 8, it can resolve
 * "which button to tap next" in well under 500 ms.
 *
 * This provider is designed to be used as the `dispatchProvider` in a
 * `DualModelProvider` alongside Gemma 4 E4B for reasoning. It handles
 * all `generateWithTools` calls (action selection) while the larger model
 * handles `generate` (planning) and `generateWithVision` (vision).
 *
 * Usage with DualModelProvider:
 *   const { generate: dispatchGen } = useLLM({ model: FUNCTION_GEMMA_270M });
 *   const { generate: reasoningGen } = useLLM({ model: GEMMA4_E4B });
 *
 *   const provider = new DualModelProvider({
 *     dispatchProvider: new FunctionGemmaProvider({ generateFn: dispatchGen }),
 *     reasoningProvider: new GemmaProvider({ model: 'GEMMA4_E4B', generateFn: reasoningGen }),
 *   });
 */
export class FunctionGemmaProvider extends LLMProvider {
  private options: Required<FunctionGemmaProviderOptions>;

  constructor(options: FunctionGemmaProviderOptions) {
    super();
    this.options = {
      maxTokens: 128,
      generateFn: FunctionGemmaProvider.notImplemented,
      ...options,
    };
  }

  /**
   * Generate a plain text response. Routes through the same inference function.
   */
  async generate(prompt: string): Promise<string> {
    return this.options.generateFn(prompt);
  }

  /**
   * Generate a tool call JSON by dispatching the screen state and task to
   * FunctionGemma 270M.
   *
   * The system prompt is intentionally compact: no reasoning scaffolding,
   * no examples — just the tool list and a tight JSON constraint. This
   * maximises prefill throughput at the cost of multi-step reasoning ability
   * (which is handled by the reasoning provider in DualModelProvider).
   */
  async generateWithTools(messages: LLMMessage[], tools: Tool[]): Promise<string> {
    const fullPrompt = `${FunctionGemmaProvider.buildDispatchPrompt(tools)}\n\n${LLMProvider.serializeMessages(messages)}`;
    return this.options.generateFn(fullPrompt);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a minimal dispatch system prompt for FunctionGemma 270M.
   *
   * Keeps the tool list as compact JSON (no indentation) to reduce prefill
   * tokens and stay within the model's effective context window.
   */
  private static buildDispatchPrompt(tools: Tool[]): string {
    const schemas = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: t.parameters.type,
        properties: t.parameters.properties,
        required: t.parameters.required ?? [],
      },
    }));

    return [
      '你是一个手机动作调度器。选择要执行的下一个动作。',
      '',
      '可用工具:',
      JSON.stringify(schemas),
      '',
      '只输出有效 JSON。单个调用: {"name":"<工具名>","arguments":{...}}',
      '多个调用: [{"name":"<工具名>","arguments":{...}},...]',
      '不要输出任何其他文字。',
    ].join('\n');
  }

  private static async notImplemented(_prompt: string): Promise<string> {
    throw new Error(
      'FunctionGemmaProvider requires a generateFn from react-native-executorch. ' +
        'Pass it from the useLLM hook with the FunctionGemma 270M model:\n\n' +
        '  const { generate } = useLLM({ model: FUNCTION_GEMMA_270M });\n' +
        '  new FunctionGemmaProvider({ generateFn: generate })',
    );
  }
}
