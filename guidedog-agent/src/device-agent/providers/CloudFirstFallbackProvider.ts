import type { LLMMessage, ModelMessage, ModelResponse, ScreenshotImage, Tool } from '../types';
import { LLMProvider } from './LLMProvider';
import type { CloudProvider } from './CloudProvider';
import type { GemmaProvider } from './GemmaProvider';
import { legacyTextResponse, modelMessagesToLegacy } from './StructuredProtocol';

export interface CloudFirstFallbackProviderOptions {
  /** Primary cloud provider. */
  cloud: CloudProvider;
  /** Secondary on-device provider, used when the cloud is unreachable. */
  local: GemmaProvider;
  /** If true, log fallback events to the console. */
  debug?: boolean;
}

/**
 * Cloud-first composite provider: tries the cloud API first and falls back
 * to the on-device model when the cloud call fails. Mirrors
 * FallbackProvider with the priority order reversed (cloud preferred,
 * local model secondary).
 */
export class CloudFirstFallbackProvider extends LLMProvider {
  private readonly cloud: CloudProvider;
  private readonly local: GemmaProvider;
  private readonly debug: boolean;

  constructor(options: CloudFirstFallbackProviderOptions) {
    super();
    this.cloud = options.cloud;
    this.local = options.local;
    this.debug = options.debug ?? false;
  }

  async generate(prompt: string): Promise<string> {
    try {
      return await this.cloud.generate(prompt);
    } catch (err) {
      if (this.debug) {
        console.warn('[CloudFirst] cloud generate failed, falling back to local:', err);
      }
      return this.local.generate(prompt);
    }
  }

  async generateWithTools(messages: LLMMessage[], tools: Tool[]): Promise<string> {
    try {
      return await this.cloud.generateWithTools(messages, tools);
    } catch (err) {
      if (this.debug) {
        console.warn('[CloudFirst] cloud generateWithTools failed, falling back to local:', err);
      }
      return this.local.generateWithTools(messages, tools);
    }
  }

  async generateStructuredWithTools(
    messages: ModelMessage[],
    tools: Tool[],
  ): Promise<ModelResponse> {
    try {
      return await this.cloud.generateStructuredWithTools(messages, tools);
    } catch (err) {
      if (this.debug) {
        console.warn('[CloudFirst] cloud structured call failed, falling back to local:', err);
      }
      return legacyTextResponse(
        await this.local.generateWithTools(modelMessagesToLegacy(messages), tools),
      );
    }
  }

  async generateWithVision(
    messages: LLMMessage[],
    tools: Tool[],
    image: ScreenshotImage,
  ): Promise<string> {
    try {
      return await this.cloud.generateWithVision(messages, tools, image);
    } catch (err) {
      if (this.debug) {
        console.warn('[CloudFirst] cloud generateWithVision failed, falling back to local:', err);
      }
      return this.local.generateWithVision(messages, tools, image);
    }
  }

  async generateStructuredWithVision(
    messages: ModelMessage[],
    tools: Tool[],
    image: ScreenshotImage,
  ): Promise<ModelResponse> {
    try {
      return await this.cloud.generateStructuredWithVision(messages, tools, image);
    } catch (err) {
      if (this.debug) {
        console.warn('[CloudFirst] cloud structured vision failed, falling back to local:', err);
      }
      return legacyTextResponse(
        await this.local.generateWithVision(modelMessagesToLegacy(messages), tools, image),
      );
    }
  }
}
