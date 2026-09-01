import type {
  LLMMessage,
  LLMProviderInterface,
  ModelMessage,
  ModelResponse,
  ScreenshotImage,
  Tool,
} from '../types';
import { LLMProvider } from './LLMProvider';
import { legacyTextResponse, modelMessagesToLegacy } from './StructuredProtocol';

/**
 * Options for DualModelProvider.
 */
export interface DualModelProviderOptions {
  /**
   * Provider used for all reasoning and planning calls (`generate` and
   * `generateWithVision`). Typically Gemma 4 E4B.
   */
  reasoningProvider: LLMProviderInterface;
  /**
   * Provider used for tool-dispatch calls (`generateWithTools`).
   * Typically FunctionGemma 270M. If omitted, all calls fall through to
   * `reasoningProvider`.
   */
  dispatchProvider?: LLMProviderInterface;
  /**
   * Factory that creates and returns the dispatch provider on first use.
   *
   * Use this instead of `dispatchProvider` to lazy-load FunctionGemma 270M,
   * avoiding startup RAM cost until the agent actually begins executing actions.
   * The factory is called at most once; the resolved provider is cached.
   *
   * Example:
   *   loadDispatchProvider: async () => {
   *     const { generate } = await loadFunctionGemma();
   *     return new FunctionGemmaProvider({ generateFn: generate });
   *   }
   */
  loadDispatchProvider?: () => Promise<LLMProviderInterface>;
  /**
   * Restrict which tools are offered to the dispatch provider.
   *
   * FunctionGemma 270M performs best with a compact tool list to stay within
   * the prefill token budget. Pass `PHONE_TOOL_PRESETS.DISPATCH` to limit the
   * schema to direct-action tools only (tap, swipe, type, etc.).
   *
   * When set, `generateWithTools` filters the `tools` array before forwarding
   * to the dispatch provider. The unfiltered `tools` list is still passed to
   * the reasoning provider on fallback.
   *
   * Default: undefined (pass all tools to dispatch provider).
   */
  dispatchToolFilter?: string[];
  /**
   * Log routing decisions to the console using a [DualModelProvider] prefix.
   * Useful for profiling which model handles each step. Default: false.
   */
  debug?: boolean;
}

/**
 * Routes inference between a fast tool-dispatch model and a full reasoning model.
 *
 * ## Routing rules
 *
 * | Method                | Routed to         | Reason                                    |
 * |-----------------------|-------------------|-------------------------------------------|
 * | `generateWithTools`   | dispatchProvider  | FunctionGemma is specialised for this     |
 * | `generate`            | reasoningProvider | Planning / free-form text needs full model |
 * | `generateWithVision`  | reasoningProvider | Vision grounding needs full model          |
 *
 * If the dispatch provider throws, `generateWithTools` falls back to the
 * reasoning provider transparently. This means the agent degrades gracefully
 * if FunctionGemma is not yet loaded or encounters an OOM condition.
 *
 * ## Lazy loading
 *
 * Pass `loadDispatchProvider` instead of `dispatchProvider` to defer loading
 * FunctionGemma 270M until the first tool-dispatch call. The factory is
 * called once and the result is cached; subsequent calls reuse it.
 *
 * ## Usage
 *
 *   const provider = new DualModelProvider({
 *     reasoningProvider: new GemmaProvider({
 *       model: 'GEMMA4_E4B',
 *       generateFn: reasoningGenerateFn,
 *     }),
 *     loadDispatchProvider: async () =>
 *       new FunctionGemmaProvider({ generateFn: dispatchGenerateFn }),
 *   });
 *
 *   const agent = new AgentLoop({ provider, maxSteps: 50 });
 */
export class DualModelProvider extends LLMProvider {
  private readonly reasoning: LLMProviderInterface;
  private readonly _staticDispatch: LLMProviderInterface | undefined;
  private readonly _loadDispatch: (() => Promise<LLMProviderInterface>) | undefined;
  private readonly _dispatchToolFilter: Set<string> | undefined;
  private readonly _debug: boolean;

  private _dispatch: LLMProviderInterface | null = null;
  private _dispatchLoading: Promise<LLMProviderInterface> | null = null;

  constructor(options: DualModelProviderOptions) {
    super();
    this.reasoning = options.reasoningProvider;
    this._staticDispatch = options.dispatchProvider;
    this._loadDispatch = options.loadDispatchProvider;
    this._dispatchToolFilter = options.dispatchToolFilter
      ? new Set(options.dispatchToolFilter)
      : undefined;
    this._debug = options.debug ?? false;

    if (this._staticDispatch) {
      this._dispatch = this._staticDispatch;
    }
  }

  /**
   * Route to the reasoning provider for planning and free-form text generation.
   */
  async generate(prompt: string): Promise<string> {
    this.log('generate → reasoningProvider');
    return this.reasoning.generate(prompt);
  }

  /**
   * Route to the dispatch provider (FunctionGemma 270M) for tool selection.
   *
   * Lazy-loads the dispatch provider on first call if `loadDispatchProvider`
   * was given. Falls back to the reasoning provider if dispatch is unavailable
   * or throws.
   */
  async generateWithTools(messages: LLMMessage[], tools: Tool[]): Promise<string> {
    try {
      const dispatch = await this.resolveDispatch();
      if (dispatch) {
        const dispatchTools = this._dispatchToolFilter
          ? tools.filter((t) => this._dispatchToolFilter!.has(t.name))
          : tools;
        this.log(`generateWithTools → dispatchProvider (${dispatchTools.length} tools)`);
        return await dispatch.generateWithTools(messages, dispatchTools);
      }
    } catch (err) {
      this.log(
        `dispatch unavailable, falling back to reasoningProvider: ${String(err)}`,
      );
    }
    this.log('generateWithTools → reasoningProvider');
    return this.reasoning.generateWithTools(messages, tools);
  }

  async generateStructuredWithTools(
    messages: ModelMessage[],
    tools: Tool[],
  ): Promise<ModelResponse> {
    try {
      const dispatch = await this.resolveDispatch();
      if (dispatch) {
        const dispatchTools = this._dispatchToolFilter
          ? tools.filter((tool) => this._dispatchToolFilter!.has(tool.name))
          : tools;
        this.log(`generateStructuredWithTools → dispatchProvider (${dispatchTools.length} tools)`);
        if (dispatch.generateStructuredWithTools) {
          return await dispatch.generateStructuredWithTools(messages, dispatchTools);
        }
        return legacyTextResponse(
          await dispatch.generateWithTools(modelMessagesToLegacy(messages), dispatchTools),
        );
      }
    } catch (err) {
      this.log(`structured dispatch unavailable, falling back to reasoningProvider: ${String(err)}`);
    }
    if (this.reasoning.generateStructuredWithTools) {
      return this.reasoning.generateStructuredWithTools(messages, tools);
    }
    return legacyTextResponse(
      await this.reasoning.generateWithTools(modelMessagesToLegacy(messages), tools),
    );
  }

  /**
   * Route to the reasoning provider for vision-grounded tool selection.
   * Falls back to text-only generateWithTools if the reasoning provider
   * does not implement generateWithVision.
   */
  async generateWithVision(
    messages: LLMMessage[],
    tools: Tool[],
    image: ScreenshotImage,
  ): Promise<string> {
    this.log('generateWithVision → reasoningProvider');
    if (this.reasoning.generateWithVision) {
      return this.reasoning.generateWithVision(messages, tools, image);
    }
    return this.reasoning.generateWithTools(messages, tools);
  }

  async generateStructuredWithVision(
    messages: ModelMessage[],
    tools: Tool[],
    image: ScreenshotImage,
  ): Promise<ModelResponse> {
    this.log('generateStructuredWithVision → reasoningProvider');
    if (this.reasoning.generateStructuredWithVision) {
      return this.reasoning.generateStructuredWithVision(messages, tools, image);
    }
    const legacy = modelMessagesToLegacy(messages);
    if (this.reasoning.generateWithVision) {
      return legacyTextResponse(await this.reasoning.generateWithVision(legacy, tools, image));
    }
    return legacyTextResponse(await this.reasoning.generateWithTools(legacy, tools));
  }

  /**
   * Whether the dispatch provider has been loaded and is ready.
   * Useful for showing a "fast mode ready" indicator in the UI.
   */
  get isDispatchReady(): boolean {
    return this._dispatch !== null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve the dispatch provider.
   *
   * If a static `dispatchProvider` was given, returns it immediately.
   * If a `loadDispatchProvider` factory was given, calls it once on first
   * use, caches the result, and returns it. Subsequent calls return the
   * cached provider without re-invoking the factory.
   * If neither is configured, returns null.
   */
  private async resolveDispatch(): Promise<LLMProviderInterface | null> {
    if (this._dispatch) return this._dispatch;
    if (!this._loadDispatch) return null;

    if (!this._dispatchLoading) {
      this._dispatchLoading = this._loadDispatch().then((p) => {
        this._dispatch = p;
        this.log('dispatchProvider loaded and cached');
        return p;
      });
    }
    return this._dispatchLoading;
  }

  private log(message: string): void {
    if (this._debug) {
      console.log(`[DualModelProvider] ${message}`);
    }
  }
}
