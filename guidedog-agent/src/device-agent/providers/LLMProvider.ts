import type { LLMMessage, LLMProviderInterface, Tool } from '../types';

/**
 * Abstract base class for LLM providers.
 *
 * Concrete implementations handle the specifics of on-device inference
 * (GemmaProvider) or cloud API calls (CloudProvider). The AgentLoop
 * interacts only with this interface.
 */
export abstract class LLMProvider implements LLMProviderInterface {
  /**
   * Generate a plain text response from the model.
   */
  abstract generate(prompt: string): Promise<string>;

  /**
   * Generate a response that may include tool/function calls.
   *
   * The provider is responsible for formatting the tools into whatever
   * schema the underlying model expects and parsing the response.
   */
  abstract generateWithTools(messages: LLMMessage[], tools: Tool[]): Promise<string>;

  /**
   * Flatten a chat-style message array back into a single prompt string.
   *
   * Used by providers whose underlying model only accepts a flat text prompt
   * (on-device Gemma / FunctionGemma). Role markers keep the conversation
   * structure visible to the model.
   */
  protected static serializeMessages(messages: LLMMessage[]): string {
    if (messages.length === 0) return '';
    return messages
      .map((m) => `=== ${m.role.toUpperCase()} ===\n${m.content}`)
      .join('\n\n');
  }
}
