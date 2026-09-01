import type { LLMMessage, ScreenshotImage, Tool } from '../types';
import { LLMProvider } from './LLMProvider';
import { ScreenshotPreprocessor } from '../agent/ScreenshotPreprocessor';

/**
 * On-device LLM provider using Gemma 4 via react-native-executorch.
 *
 * Runs inference entirely on the device with no network calls.
 * Requires the ExecuTorch .pte model to be downloaded to the device.
 *
 * The actual react-native-executorch integration is injected via the
 * `generateFn` / `generateWithImageFn` options, keeping this class testable
 * without a running React Native bridge.
 */
export interface GemmaProviderOptions {
  /** Model identifier (e.g., GEMMA4_E4B, GEMMA4_E2B). */
  model: string;
  /** Maximum tokens to generate per response. Default: 512. */
  maxTokens?: number;
  /** Temperature for sampling. Default: 0.7. */
  temperature?: number;
  /**
   * Injected text-only generation function from react-native-executorch.
   * If not provided the provider will throw indicating that the
   * ExecuTorch bridge is required.
   *
   * Example usage with the hook:
   *   const { generate } = useLLM({ model: GEMMA4_E4B });
   *   new GemmaProvider({ model: 'GEMMA4_E4B', generateFn: generate })
   */
  generateFn?: (prompt: string) => Promise<string>;
  /**
   * Injected multimodal generation function from react-native-executorch.
   * Enables `generateWithVision` for screenshot-grounded inference.
   *
   * Wire it up from `useLLM` with `capabilities: ['vision']`:
   *   const { sendMessage } = useLLM({ model: GEMMA4_E4B });
   *   new GemmaProvider({
   *     model: 'GEMMA4_E4B',
   *     generateFn: generate,
   *     generateWithImageFn: (prompt, imagePath) =>
   *       sendMessage(prompt, { imagePath }),
   *   })
   *
   * The function receives a plain local path (no `file://` prefix).
   */
  generateWithImageFn?: (prompt: string, imagePath: string) => Promise<string>;
}

export class GemmaProvider extends LLMProvider {
  private options: Required<Omit<GemmaProviderOptions, 'generateWithImageFn'>> & {
    generateWithImageFn: ((prompt: string, imagePath: string) => Promise<string>) | undefined;
  };

  constructor(options: GemmaProviderOptions) {
    super();
    this.options = {
      maxTokens: 512,
      temperature: 0.7,
      generateFn: GemmaProvider.notImplemented,
      generateWithImageFn: undefined,
      ...options,
    };
  }

  /**
   * Generate a plain text response from the on-device Gemma model.
   */
  async generate(prompt: string): Promise<string> {
    return this.options.generateFn(prompt);
  }

  /**
   * Generate a response with tool schemas injected into the system prompt.
   *
   * Gemma 4 uses function-calling syntax. The chat-style message array is
   * flattened back into a single prompt (role markers preserved) with the
   * tool schemas embedded as a JSON block in the system section. The response
   * is returned as-is for ToolParser to handle.
   */
  async generateWithTools(messages: LLMMessage[], tools: Tool[]): Promise<string> {
    const systemBlock = GemmaProvider.buildToolSystemPrompt(tools);
    const conversation = LLMProvider.serializeMessages(messages);
    const fullPrompt = `${systemBlock}\n\n${conversation}`;
    return this.options.generateFn(fullPrompt);
  }

  /**
   * Generate a response with tool schemas and a screenshot image.
   *
   * Attaches the screenshot to the prompt as a vision input. The image
   * path is normalized (strips `file://` prefix) before being passed to
   * the underlying ExecuTorch bridge. Falls back to text-only inference
   * if `generateWithImageFn` was not provided.
   *
   * @param prompt - The text prompt describing the task and screen state
   * @param tools - Available tools injected into the system block
   * @param imagePath - Raw screenshot path from `takeScreenshot()`
   */
  async generateWithVision(
    messages: LLMMessage[],
    tools: Tool[],
    image: ScreenshotImage,
  ): Promise<string> {
    const systemBlock = GemmaProvider.buildToolSystemPrompt(tools);
    const conversation = LLMProvider.serializeMessages(messages);
    const visionPrompt = ScreenshotPreprocessor.buildVisionPrompt(conversation);
    const fullPrompt = `${systemBlock}\n\n${visionPrompt}`;

    if (!this.options.generateWithImageFn || !image.path) {
      // Graceful fallback: no image function wired up, run text-only.
      return this.options.generateFn(fullPrompt);
    }

    const normalizedPath = ScreenshotPreprocessor.normalizePath(image.path);
    return this.options.generateWithImageFn(fullPrompt, normalizedPath);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a system-prompt block that describes the available tools.
   *
   * The format matches Gemma 4's expected function-calling template:
   *
   *   You have access to the following tools:
   *   [{"name": "ui_tap", "description": "...", "parameters": {...}}, ...]
   *
   *   To call a tool, respond ONLY with a JSON object in this format:
   *   {"name": "<tool>", "arguments": {...}}
   *
   *   To call multiple tools in sequence, respond with a JSON array:
   *   [{"name": "<tool>", "arguments": {...}}, ...]
   */
  private static buildToolSystemPrompt(tools: Tool[]): string {
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
      '你是一个手机自动化智能体。你通过调用工具来控制 Android 手机。',
      '',
      '可用工具:',
      JSON.stringify(schemas, null, 2),
      '',
      '调用工具时，只输出以下格式之一的有效 JSON:',
      '  单个调用:   {"name": "<工具名>", "arguments": {...}}',
      '  多个调用:   [{"name": "<工具名>", "arguments": {...}}, ...]',
      '',
      '缺少继续所需信息或目标不明确时调用 ask_user；仅需向用户说明且无需操作时，可以直接输出文字，不要编造工具调用。',
      '一旦调用工具，则必须只输出上述 JSON 格式，不要混入任何其他文字、解释或 markdown。',
    ].join('\n');
  }

  private static async notImplemented(_prompt: string): Promise<string> {
    throw new Error(
      'GemmaProvider requires a generateFn from react-native-executorch. ' +
        'Pass it via the generateFn option:\n\n' +
        '  const { generate } = useLLM({ model: GEMMA4_E4B });\n' +
        '  new GemmaProvider({ model: "GEMMA4_E4B", generateFn: generate })',
    );
  }
}
