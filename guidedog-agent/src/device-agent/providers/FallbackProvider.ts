import type { LLMMessage, ModelMessage, ModelResponse, ScreenshotImage, Tool } from '../types';
import { LLMProvider } from './LLMProvider';
import type { GemmaProvider } from './GemmaProvider';
import type { CloudProvider } from './CloudProvider';
import { legacyTextResponse, modelMessagesToLegacy } from './StructuredProtocol';

/**
 * Heuristics that determine when to skip on-device inference and go straight
 * to the cloud provider. All thresholds are optional; any that are omitted
 * are disabled.
 */
export interface ComplexityHeuristics {
  /**
   * Prompt character length above which the task is considered too complex
   * for on-device inference. Gemma 4 E4B has a ~8 K-token context window;
   * conservative default is 6 000 characters (~1 500 tokens).
   */
  maxPromptLength?: number;
  /**
   * Number of on-device failures after which the provider switches to cloud
   * for the remainder of the session.
   */
  maxOnDeviceFailures?: number;
}

export interface FallbackProviderOptions {
  /** Primary on-device provider (Gemma via react-native-executorch). */
  onDevice: GemmaProvider;
  /** Cloud provider used when on-device inference fails or is too complex. */
  cloud: CloudProvider;
  /**
   * Heuristics for deciding when to bypass on-device inference entirely.
   * Defaults: maxPromptLength=6000, maxOnDeviceFailures=3.
   */
  complexity?: ComplexityHeuristics;
  /**
   * If true, log fallback events to the console.
   * Useful for debugging which provider is handling each request.
   */
  debug?: boolean;
}

/**
 * A composite LLM provider that tries on-device Gemma first and falls back
 * to a cloud provider when:
 *
 *  1. The on-device provider throws an error.
 *  2. The prompt is longer than `complexity.maxPromptLength` characters.
 *  3. The number of prior on-device failures exceeds `complexity.maxOnDeviceFailures`.
 *
 * This enables the agent to run entirely offline on capable devices while
 * gracefully degrading to cloud APIs for complex tasks or older hardware.
 *
 * Usage:
 *   const { generate } = useLLM({ model: GEMMA4_E4B });
 *   const provider = new FallbackProvider({
 *     onDevice: new GemmaProvider({ model: 'GEMMA4_E4B', generateFn: generate }),
 *     cloud: new CloudProvider({ apiKey: '...', model: 'claude-sonnet-4-6', apiFormat: 'anthropic' }),
 *   });
 *   const agent = new AgentLoop({ provider, maxSteps: 50 });
 */
export class FallbackProvider extends LLMProvider {
  private readonly onDevice: GemmaProvider;
  private readonly cloud: CloudProvider;
  private readonly maxPromptLength: number;
  private readonly maxOnDeviceFailures: number;
  private readonly debug: boolean;

  /** Consecutive on-device failures in this session. */
  private onDeviceFailures = 0;

  constructor(options: FallbackProviderOptions) {
    super();
    this.onDevice = options.onDevice;
    this.cloud = options.cloud;
    this.maxPromptLength = options.complexity?.maxPromptLength ?? 6_000;
    this.maxOnDeviceFailures = options.complexity?.maxOnDeviceFailures ?? 3;
    this.debug = options.debug ?? false;
  }

  /**
   * Generate a plain text response.
   *
   * Attempts on-device inference first. Falls back to cloud on error or if
   * complexity heuristics indicate the task exceeds on-device capabilities.
   */
  async generate(prompt: string): Promise<string> {
    if (this.shouldUseCloud([{ role: 'user', content: prompt }])) {
      this.log('complexity check → using cloud provider');
      return this.cloud.generate(prompt);
    }

    try {
      const result = await this.onDevice.generate(prompt);
      this.onDeviceFailures = 0; // reset on success
      return result;
    } catch (err) {
      this.onDeviceFailures++;
      this.log(`on-device generate failed (failures=${this.onDeviceFailures}): ${String(err)}`);
      return this.cloud.generate(prompt);
    }
  }

  /**
   * Generate a response with tool-calling support.
   *
   * Same fallback logic as `generate`. On-device is tried first; cloud is
   * used if the prompt is too long, on-device has failed too many times, or
   * the underlying generate call throws.
   */
  async generateWithTools(messages: LLMMessage[], tools: Tool[]): Promise<string> {
    if (this.shouldUseCloud(messages)) {
      this.log('complexity check → using cloud provider');
      return this.cloud.generateWithTools(messages, tools);
    }

    try {
      const result = await this.onDevice.generateWithTools(messages, tools);
      this.onDeviceFailures = 0; // reset on success
      return result;
    } catch (err) {
      this.onDeviceFailures++;
      this.log(`on-device generateWithTools failed (failures=${this.onDeviceFailures}): ${String(err)}`);
      return this.cloud.generateWithTools(messages, tools);
    }
  }

  async generateStructuredWithTools(
    messages: ModelMessage[],
    tools: Tool[],
  ): Promise<ModelResponse> {
    const legacy = modelMessagesToLegacy(messages);
    if (this.shouldUseCloud(legacy)) {
      this.log('complexity check → using cloud structured provider');
      return this.cloud.generateStructuredWithTools(messages, tools);
    }
    try {
      const result = await this.onDevice.generateWithTools(legacy, tools);
      this.onDeviceFailures = 0;
      return legacyTextResponse(result);
    } catch (err) {
      this.onDeviceFailures++;
      this.log(`on-device structured call failed (failures=${this.onDeviceFailures}): ${String(err)}`);
      return this.cloud.generateStructuredWithTools(messages, tools);
    }
  }

  /**
   * Generate a response with tool-calling support and a screenshot image.
   *
   * Delegates vision inference to the on-device provider (GemmaProvider
   * supports image input via its `generateWithVision` method). Falls back to
   * cloud vision inference when:
   *   - Complexity heuristics say to skip on-device
   *   - The on-device call throws
   *
   * CloudProvider.generateWithVision handles the image encoding and falls
   * back to text-only internally if the image cannot be read.
   */
  async generateWithVision(
    messages: LLMMessage[],
    tools: Tool[],
    image: ScreenshotImage,
  ): Promise<string> {
    if (this.shouldUseCloud(messages)) {
      this.log('complexity check → using cloud provider vision');
      return this.cloud.generateWithVision(messages, tools, image);
    }

    try {
      const result = await this.onDevice.generateWithVision(messages, tools, image);
      this.onDeviceFailures = 0;
      return result;
    } catch (err) {
      this.onDeviceFailures++;
      this.log(
        `on-device generateWithVision failed (failures=${this.onDeviceFailures}): ${String(err)}`,
      );
      return this.cloud.generateWithVision(messages, tools, image);
    }
  }

  async generateStructuredWithVision(
    messages: ModelMessage[],
    tools: Tool[],
    image: ScreenshotImage,
  ): Promise<ModelResponse> {
    const legacy = modelMessagesToLegacy(messages);
    if (this.shouldUseCloud(legacy)) {
      this.log('complexity check → using cloud structured provider vision');
      return this.cloud.generateStructuredWithVision(messages, tools, image);
    }
    try {
      const result = await this.onDevice.generateWithVision(legacy, tools, image);
      this.onDeviceFailures = 0;
      return legacyTextResponse(result);
    } catch (err) {
      this.onDeviceFailures++;
      this.log(`on-device structured vision failed (failures=${this.onDeviceFailures}): ${String(err)}`);
      return this.cloud.generateStructuredWithVision(messages, tools, image);
    }
  }

  /**
   * Reset the failure counter.
   *
   * Call this after a successful task completes to give the on-device
   * provider a fresh chance on the next task.
   */
  resetFailureCount(): void {
    this.onDeviceFailures = 0;
  }

  /**
   * Whether on-device failures have exceeded the threshold and the session
   * has permanently switched to cloud.
   */
  get isCloudMode(): boolean {
    return this.onDeviceFailures >= this.maxOnDeviceFailures;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Determine whether this request should bypass on-device inference entirely
   * and go straight to the cloud provider.
   */
  private shouldUseCloud(messages: LLMMessage[]): boolean {
    // Too many prior failures → stay on cloud for the rest of the session
    if (this.onDeviceFailures >= this.maxOnDeviceFailures) {
      return true;
    }
    // Total message content is too long for on-device context window
    const totalLength = messages.reduce((acc, m) => acc + m.content.length, 0);
    if (this.maxPromptLength > 0 && totalLength > this.maxPromptLength) {
      return true;
    }
    return false;
  }

  private log(message: string): void {
    if (this.debug) {
      // Use a simple console prefix so callers can filter these in Metro logs
      console.log(`[FallbackProvider] ${message}`);
    }
  }
}
