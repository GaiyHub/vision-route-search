import type {
  LLMMessage,
  ModelContent,
  ModelMessage,
  ModelResponse,
  ScreenshotImage,
  Tool,
  ToolResult,
} from '../types';
import { LLMProvider } from './LLMProvider';
import { toOpenAIFunction, toAnthropicTool } from '../tools/ToolSchema';
import { truncateToolResult } from '../tools/ToolResultBudget';

type VisionRequestDiagnostic = {
  vision: true;
  imageWidth?: number;
  imageHeight?: number;
  imageBase64Chars: number;
  mimeType: string;
};

/**
 * Cloud LLM provider for fallback when on-device inference is insufficient.
 *
 * Supports OpenAI-compatible APIs (OpenAI, Anthropic via OpenAI compat layer,
 * etc.) and the native Anthropic messages API.
 *
 * Used as a fallback for complex tasks or on devices that cannot run
 * Gemma 4 efficiently.
 */
export interface CloudProviderOptions {
  /** API key for the cloud provider. */
  apiKey: string;
  /** Model identifier (e.g., 'claude-sonnet-4-6', 'gpt-4o'). */
  model: string;
  /**
   * Base URL for the API.
   * - OpenAI: 'https://api.openai.com/v1' (default)
   * - Anthropic: 'https://api.anthropic.com/v1'
   * - Local/proxy: any compatible endpoint
   */
  baseUrl?: string;
  /** Maximum tokens to generate per response. Default: 1024. */
  maxTokens?: number;
  /** Temperature for sampling. Default: 0.7. */
  temperature?: number;
  /**
   * Which API format to use.
   * - 'openai': OpenAI chat completions API (default)
   * - 'anthropic': Anthropic messages API
   * - 'openrouter': OpenRouter — OpenAI-compatible but uses openrouter.ai base
   *   URL and requires an HTTP-Referer header for rate-limit attribution.
   */
  apiFormat?: 'openai' | 'anthropic' | 'openrouter';
  /**
   * HTTP-Referer header value sent with OpenRouter requests.
   * Required for rate-limit attribution; typically your app's GitHub URL.
   * Only used when apiFormat is 'openrouter'.
   */
  referer?: string;
  /**
   * Optional system prompt injected into every API request.
   *
   * For Anthropic this maps to the top-level `system` field (recommended).
   * For OpenAI/OpenRouter it is prepended as a `role: 'system'` message.
   * Leave unset to use the model's default behaviour.
   */
  system?: string;
  /**
   * Called with (promptTokens, completionTokens, cachedTokens) whenever the
   * API response includes usage metadata. cachedTokens are the prompt tokens
   * served from the provider's prompt cache. Used for per-task / global
   * token accounting and cache-hit-rate display.
   */
  onUsage?: (promptTokens: number, completionTokens: number, cachedTokens?: number) => void;
  /** Privacy-safe cache telemetry. Does not include API keys or message bodies. */
  onCacheDiagnostic?: (event: Record<string, unknown>) => void;
  /** Privacy-safe request-stage timings. Never includes prompts or image data. */
  onTimingDiagnostic?: (event: Record<string, unknown>) => void;
  /**
   * Hard per-request timeout in ms. A hung socket (no response, no error)
   * must never freeze the agent loop — the request is aborted and the
   * caller's retry/error path handles it. Default: 60000.
   */
  requestTimeoutMs?: number;
  /**
   * Toggle the model's thinking/reasoning mode. Only sent on OpenAI-format
   * requests as `enable_thinking` (Qwen3-series compatible endpoints).
   * Default: true.
   */
  enableThinking?: boolean;
  /**
   * Log redacted request/response bodies to logcat as [LLM] lines. Image
   * base64 is always replaced with its character count.
   * Default: false.
   */
  debugLog?: boolean;
}

export class CloudProvider extends LLMProvider {
  private options: Required<
    Omit<
      CloudProviderOptions,
      'system' | 'referer' | 'onUsage' | 'onCacheDiagnostic' | 'onTimingDiagnostic'
    >
  > & {
    system: string | undefined;
    referer: string | undefined;
    onUsage:
      | ((promptTokens: number, completionTokens: number, cachedTokens?: number) => void)
      | undefined;
    onCacheDiagnostic: ((event: Record<string, unknown>) => void) | undefined;
    onTimingDiagnostic: ((event: Record<string, unknown>) => void) | undefined;
  };

  constructor(options: CloudProviderOptions) {
    super();
    const format = options.apiFormat ?? 'openai';
    // OpenRouter uses the OpenAI-compatible API but at a different base URL.
    const defaultBaseUrl =
      format === 'anthropic'
        ? 'https://api.anthropic.com/v1'
        : format === 'openrouter'
          ? 'https://openrouter.ai/api/v1'
          : 'https://api.openai.com/v1';
    this.options = {
      baseUrl: defaultBaseUrl,
      // Thinking-capable models (Qwen3 series) spend a large chunk of the
      // budget on reasoning tokens before writing the actual answer; 1024
      // left the final tool-call JSON truncated to a text fragment. 4096
      // keeps the content budget usable in both modes.
      maxTokens: 4096,
      // Tool-driven agents benefit from stable, evidence-following decisions;
      // keep a small amount of flexibility without allowing factual/tool
      // choices to vary as much as general-purpose chat generation.
      temperature: 0.2,
      apiFormat: format,
      system: undefined,
      referer: undefined,
      onUsage: undefined,
      onCacheDiagnostic: undefined,
      onTimingDiagnostic: undefined,
      requestTimeoutMs: 60_000,
      enableThinking: true,
      debugLog: false,
      ...options,
    };
  }

  /**
   * Generate a plain text response from the cloud model.
   */
  async generate(prompt: string): Promise<string> {
    return this.options.apiFormat === 'anthropic'
      ? this.anthropicGenerate(prompt)
      : this.openaiGenerate(prompt);
  }

  /**
   * Generate a response with tool schemas injected into the prompt.
   *
   * For cloud providers we use native function calling when supported.
   * The raw text response (which may contain JSON tool calls) is returned
   * for ToolParser to process.
   *
   * OpenRouter uses the OpenAI-compatible path automatically.
   */
  async generateWithTools(messages: LLMMessage[], tools: Tool[]): Promise<string> {
    return this.options.apiFormat === 'anthropic'
      ? this.anthropicGenerateWithTools(messages, tools)
      : this.openaiGenerateWithTools(messages, tools);
  }

  /**
   * Generate a response with tool-calling support and a screenshot image.
   *
   * Uses the in-memory `image.base64` payload delivered by the native capture
   * (RN's fetch cannot read `file://` URIs, so reading the file back on the
   * JS side is impossible). Falls back to `generateWithTools` when no payload
   * is available.
   */
  async generateWithVision(messages: LLMMessage[], tools: Tool[], image: ScreenshotImage): Promise<string> {
    if (!image.base64) {
      return this.generateWithTools(messages, tools);
    }
    const mimeType = image.mimeType ?? 'image/png';
    const diagnostic = visionRequestDiagnostic(image);
    return this.options.apiFormat === 'anthropic'
      ? this.anthropicGenerateWithVision(messages, tools, image.base64, mimeType, diagnostic)
      : this.openaiGenerateWithVision(messages, tools, image.base64, mimeType, diagnostic);
  }

  async generateStructuredWithTools(
    messages: ModelMessage[],
    tools: Tool[],
  ): Promise<ModelResponse> {
    return this.options.apiFormat === 'anthropic'
      ? this.anthropicGenerateStructured(messages, tools)
      : this.openaiGenerateStructured(messages, tools);
  }

  async generateStructuredWithVision(
    messages: ModelMessage[],
    tools: Tool[],
    image: ScreenshotImage,
  ): Promise<ModelResponse> {
    if (!image.base64) return this.generateStructuredWithTools(messages, tools);
    const mimeType = image.mimeType ?? 'image/png';
    const diagnostic = visionRequestDiagnostic(image);
    return this.options.apiFormat === 'anthropic'
      ? this.anthropicGenerateStructured(messages, tools, image.base64, mimeType, diagnostic)
      : this.openaiGenerateStructured(messages, tools, image.base64, mimeType, diagnostic);
  }

  private async openaiGenerateStructured(
    messages: ModelMessage[],
    tools: Tool[],
    imageBase64?: string,
    mimeType = 'image/png',
    diagnostic?: VisionRequestDiagnostic,
  ): Promise<ModelResponse> {
    const canonical = this.withStructuredSystemFallback(messages);
    const bodyMessages = toOpenAIMessages(canonical);
    if (imageBase64) attachOpenAIImage(bodyMessages, imageBase64, mimeType);
    const response = await this.fetchJson(`${this.options.baseUrl}/chat/completions`, {
      model: this.options.model,
      messages: bodyMessages,
      tools: tools.map(toOpenAIFunction),
      tool_choice: 'auto',
      max_tokens: this.options.maxTokens,
      temperature: this.options.temperature,
      ...(this.options.enableThinking === false ? { enable_thinking: false } : {}),
    }, {}, diagnostic);
    return parseOpenAIModelResponse(response);
  }

  private async anthropicGenerateStructured(
    messages: ModelMessage[],
    tools: Tool[],
    imageBase64?: string,
    mimeType = 'image/png',
    diagnostic?: VisionRequestDiagnostic,
  ): Promise<ModelResponse> {
    const system = this.extractStructuredSystem(messages);
    const bodyMessages = toAnthropicMessages(messages);
    if (imageBase64) attachAnthropicImage(bodyMessages, imageBase64, mimeType);
    const body: Record<string, unknown> = {
      model: this.options.model,
      max_tokens: this.options.maxTokens,
      tools: tools.map(toAnthropicTool),
      messages: bodyMessages,
    };
    if (system) body.system = this.toAnthropicSystem(system);
    const response = await this.fetchJson(
      `${this.options.baseUrl}/messages`,
      body,
      { 'x-api-key': this.options.apiKey, 'anthropic-version': '2023-06-01' },
      diagnostic,
    );
    return parseAnthropicModelResponse(response);
  }

  // ---------------------------------------------------------------------------
  // OpenAI-compatible implementation
  // ---------------------------------------------------------------------------

  private async openaiGenerate(prompt: string): Promise<string> {
    const messages = this.options.system
      ? [{ role: 'system', content: this.options.system }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];
    const response = await this.fetchJson(`${this.options.baseUrl}/chat/completions`, {
      model: this.options.model,
      messages,
      max_tokens: this.options.maxTokens,
      temperature: this.options.temperature,
    });
    const choices = response?.choices as Array<{ message?: { content?: string } }> | undefined;
    return choices?.[0]?.message?.content ?? '';
  }

  private async openaiGenerateWithTools(messages: LLMMessage[], tools: Tool[]): Promise<string> {
    const openaiTools = tools.map(toOpenAIFunction);
    // OpenAI-compatible endpoints auto-cache prefixes and reject unknown
    // fields, so the `cache` hint is stripped before sending.
    const bodyMessages = this.withSystemFallback(messages).map(this.stripCache);

    const body: Record<string, unknown> = {
      model: this.options.model,
      messages: bodyMessages,
      tools: openaiTools,
      tool_choice: 'auto',
      max_tokens: this.options.maxTokens,
      temperature: this.options.temperature,
    };
    // Qwen3-series endpoints (阿里云百炼 compatible-mode) accept
    // `enable_thinking` to toggle the reasoning mode. Only send it when
    // thinking is explicitly disabled — OpenAI's own API rejects the field.
    if (this.options.enableThinking === false) {
      body.enable_thinking = false;
    }

    const response = await this.fetchJson(`${this.options.baseUrl}/chat/completions`, body);

    const choices = response?.choices as Array<{ message?: { content?: string; tool_calls?: unknown[]; reasoning_content?: string } }> | undefined;
    const message = choices?.[0]?.message;
    if (!message) return '';

    // If the model returned a native tool call, serialize it back to JSON
    // so the ToolParser can handle it uniformly.
    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      const calls = message.tool_calls.map((tc: unknown) => {
        const tcObj = tc as Record<string, unknown>;
        const fn = tcObj.function as Record<string, unknown> | undefined;
        const parsed = parseOpenAIToolArguments(fn?.arguments);
        return { name: fn?.name, ...parsed };
      });
      return JSON.stringify(calls);
    }

    return CloudProvider.mergeThinkingContent(message);
  }

  /**
   * Qwen3-series models in thinking mode sometimes finish the reasoning
   * block with the tool-call JSON still inside `reasoning_content` and an
   * empty (or fragmentary) `content`. Surface the reasoning text as a
   * fallback so ToolParser can still find and execute the call instead of
   * treating the empty reply as "done".
   */
  private static mergeThinkingContent(message: {
    content?: string;
    reasoning_content?: string;
  }): string {
    const content = message.content?.trim() ?? '';
    const reasoning = message.reasoning_content?.trim() ?? '';
    if (content) return message.content ?? '';
    return reasoning || '';
  }

  // ---------------------------------------------------------------------------
  // Anthropic implementation
  // ---------------------------------------------------------------------------

  private async anthropicGenerate(prompt: string): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.options.model,
      max_tokens: this.options.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    };
    if (this.options.system) body.system = this.options.system;
    const response = await this.fetchJson(
      `${this.options.baseUrl}/messages`,
      body,
      {
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01',
      },
    );
    const content = response?.content as Array<Record<string, unknown>> | undefined;
    return (content?.[0]?.text as string | undefined) ?? '';
  }

  private async anthropicGenerateWithTools(messages: LLMMessage[], tools: Tool[]): Promise<string> {
    const anthropicTools = tools.map(toAnthropicTool);
    const system = this.extractSystem(messages);

    // Anthropic requires alternating user/assistant turns starting with user;
    // the caller builds messages exactly like that (after filtering system).
    // Messages flagged with `cache` become cache_control breakpoints so the
    // stable prefix (system + history) is reused across turns.
    const anthropicBody: Record<string, unknown> = {
      model: this.options.model,
      max_tokens: this.options.maxTokens,
      tools: anthropicTools,
      messages: messages
        .filter((m) => m.role !== 'system')
        .map((m) => {
          const msg: Record<string, unknown> = { role: m.role, content: m.content };
          if (m.cache) msg.cache_control = { type: 'ephemeral' };
          return msg;
        }),
    };
    if (system) anthropicBody.system = this.toAnthropicSystem(system);
    const response = await this.fetchJson(
      `${this.options.baseUrl}/messages`,
      anthropicBody,
      {
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01',
      },
    );

    // Anthropic returns tool_use blocks in the content array
    if (Array.isArray(response?.content)) {
      const toolBlocks = response.content.filter(
        (b: Record<string, unknown>) => b.type === 'tool_use',
      );
      if (toolBlocks.length > 0) {
        const calls = toolBlocks.map((b: Record<string, unknown>) => ({
          name: b.name,
          arguments: b.input ?? {},
        }));
        return JSON.stringify(calls);
      }

      // Text response
      const textBlock = response.content.find(
        (b: Record<string, unknown>) => b.type === 'text',
      );
      return textBlock?.text ?? '';
    }

    return '';
  }

  // ---------------------------------------------------------------------------
  // Vision implementations
  // ---------------------------------------------------------------------------

  private async openaiGenerateWithVision(
    messages: LLMMessage[],
    tools: Tool[],
    imageBase64: string,
    mimeType: string,
    diagnostic: VisionRequestDiagnostic,
  ): Promise<string> {
    const openaiTools = tools.map(toOpenAIFunction);
    const bodyMessages = this.withSystemFallback(messages).map((m, i, arr) => {
      // Attach the screenshot to the last user message (current screen).
      if (m.role === 'user' && i === arr.length - 1) {
        return {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            { type: 'text', text: m.content },
          ],
        };
      }
      return this.stripCache(m);
    });

    const response = await this.fetchJson(`${this.options.baseUrl}/chat/completions`, {
      model: this.options.model,
      messages: bodyMessages,
      tools: openaiTools,
      tool_choice: 'auto',
      max_tokens: this.options.maxTokens,
      temperature: this.options.temperature,
      ...(this.options.enableThinking === false ? { enable_thinking: false } : {}),
    }, {}, diagnostic);

    const choices = response?.choices as Array<{ message?: { content?: string; tool_calls?: unknown[]; reasoning_content?: string } }> | undefined;
    const message = choices?.[0]?.message;
    if (!message) return '';

    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      const calls = message.tool_calls.map((tc: unknown) => {
        const tcObj = tc as Record<string, unknown>;
        const fn = tcObj.function as Record<string, unknown> | undefined;
        const parsed = parseOpenAIToolArguments(fn?.arguments);
        return { name: fn?.name, ...parsed };
      });
      return JSON.stringify(calls);
    }

    return CloudProvider.mergeThinkingContent(message);
  }

  private async anthropicGenerateWithVision(
    messages: LLMMessage[],
    tools: Tool[],
    imageBase64: string,
    mimeType: string,
    diagnostic: VisionRequestDiagnostic,
  ): Promise<string> {
    const anthropicTools = tools.map(toAnthropicTool);
    const system = this.extractSystem(messages);
    const bodyMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m, i, arr) => {
        // Attach the screenshot to the last user message (current screen).
        if (m.role === 'user' && i === arr.length - 1) {
          return {
            role: 'user',
            cache_control: m.cache ? { type: 'ephemeral' } : undefined,
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
              { type: 'text', text: m.content },
            ],
          };
        }
        const msg: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.cache) msg.cache_control = { type: 'ephemeral' };
        return msg;
      });
    const body: Record<string, unknown> = {
      model: this.options.model,
      max_tokens: this.options.maxTokens,
      tools: anthropicTools,
      messages: bodyMessages,
    };
    if (system) body.system = this.toAnthropicSystem(system);

    const response = await this.fetchJson(
      `${this.options.baseUrl}/messages`,
      body,
      { 'x-api-key': this.options.apiKey, 'anthropic-version': '2023-06-01' },
      diagnostic,
    );

    if (Array.isArray(response?.content)) {
      const toolBlocks = response.content.filter(
        (b: Record<string, unknown>) => b.type === 'tool_use',
      );
      if (toolBlocks.length > 0) {
        const calls = toolBlocks.map((b: Record<string, unknown>) => ({
          name: b.name,
          arguments: b.input ?? {},
        }));
        return JSON.stringify(calls);
      }
      const textBlock = response.content.find(
        (b: Record<string, unknown>) => b.type === 'text',
      );
      return (textBlock as Record<string, unknown> | undefined)?.text as string ?? '';
    }

    return '';
  }

  // ---------------------------------------------------------------------------
  // HTTP helper
  // ---------------------------------------------------------------------------

  private stripCache(m: LLMMessage): { role: LLMMessage['role']; content: string } {
    return { role: m.role, content: m.content };
  }

  /**
   * Prepend the configured `system` option when the message array does not
   * already carry a system message (e.g. callers that build history without
   * one). OpenAI-compatible endpoints accept a system message inline.
   */
  private withSystemFallback(messages: LLMMessage[]): LLMMessage[] {
    if (messages.some((m) => m.role === 'system') || !this.options.system) return messages;
    return [{ role: 'system', content: this.options.system }, ...messages];
  }

  private withStructuredSystemFallback(messages: ModelMessage[]): ModelMessage[] {
    if (messages.some((m) => m.role === 'system') || !this.options.system) return messages;
    return [
      { role: 'system', content: [{ type: 'text', text: this.options.system }] },
      ...messages,
    ];
  }

  /**
   * Extract the system prompt for the Anthropic API, which takes `system` as
   * a top-level field instead of a message. Combines the configured `system`
   * option with any system message the caller already included, and reports
   * whether the caller marked it as a cache breakpoint.
   */
  private extractSystem(messages: LLMMessage[]):
    | { text: string; cache: boolean }
    | null {
    const parts: string[] = [];
    let cache = false;
    if (this.options.system) parts.push(this.options.system);
    for (const m of messages) {
      if (m.role === 'system') {
        parts.push(m.content);
        if (m.cache) cache = true;
      }
    }
    if (parts.length === 0) return null;
    return { text: parts.join('\n\n'), cache };
  }

  private extractStructuredSystem(messages: ModelMessage[]):
    | { text: string; cache: boolean }
    | null {
    const parts: string[] = [];
    let cache = false;
    if (this.options.system) parts.push(this.options.system);
    for (const message of messages) {
      if (message.role !== 'system') continue;
      const text = modelText(message.content);
      if (text) parts.push(text);
      if (message.cache) cache = true;
    }
    return parts.length > 0 ? { text: parts.join('\n\n'), cache } : null;
  }

  /**
   * Anthropic `system` accepts a plain string or a block array with
   * `cache_control`. Use the block form when the caller marked the system
   * message as a cache breakpoint.
   */
  private toAnthropicSystem(system: { text: string; cache: boolean }):
    | string
    | Array<Record<string, unknown>> {
    if (!system.cache) return system.text;
    return [{ type: 'text', text: system.text, cache_control: { type: 'ephemeral' } }];
  }

  private async fetchJson(
    url: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
    diagnostic?: VisionRequestDiagnostic,
  ): Promise<Record<string, unknown>> {
    const isAnthropic = this.options.apiFormat === 'anthropic';
    const isOpenRouter = this.options.apiFormat === 'openrouter';
    this.emitCacheDiagnostic({
      event: 'request',
      apiFormat: this.options.apiFormat,
      model: this.options.model,
      endpointHost: safeHost(url),
      cacheControlMode: isAnthropic ? 'explicit_ephemeral' : 'provider_automatic',
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };

    if (!isAnthropic) {
      headers['Authorization'] = `Bearer ${this.options.apiKey}`;
    }

    if (isOpenRouter && this.options.referer) {
      headers['HTTP-Referer'] = this.options.referer;
    }

    // Abort the request when it exceeds the hard timeout: a hung socket must
    // surface as an error (which the loop's retry/error path handles) instead
    // of leaving the event loop awaiting forever. The abort is also wired to
    // reject directly, so it works even if the underlying fetch implementation
    // does not honour AbortSignal.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.requestTimeoutMs);
    const serializeStartedAt = Date.now();
    const serializedBody = JSON.stringify(body);
    if (diagnostic) {
      this.emitTimingDiagnostic({
        stage: 'vision_request_serialize',
        durationMs: Date.now() - serializeStartedAt,
        requestBodyChars: serializedBody.length,
        ...diagnostic,
      });
    }
    let res: Response;
    const fetchStartedAt = Date.now();
    try {
      res = await new Promise<Response>((resolve, reject) => {
        let done = false;
        const finish = (fn: () => void) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          fn();
        };
        controller.signal.addEventListener('abort', () => {
          finish(() =>
            reject(
              new Error(
                `CloudProvider 请求超时（${this.options.requestTimeoutMs / 1000}s）: ${url}`,
              ),
            ),
          );
        });
        this.debugLogChunked(`[LLM] req ${url} ${stringifyRedactedDebugPayload(body)}`);
        fetch(url, {
          method: 'POST',
          headers,
          body: serializedBody,
          signal: controller.signal,
        })
          .then((r) => finish(() => resolve(r)))
          .catch((err) => finish(() => reject(err)));
      });
    } finally {
      clearTimeout(timer);
    }
    if (diagnostic) {
      this.emitTimingDiagnostic({
        stage: 'vision_http_wait',
        durationMs: Date.now() - fetchStartedAt,
        status: res.status,
        requestBodyChars: serializedBody.length,
        ...diagnostic,
      });
    }

    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`CloudProvider API error ${res.status}: ${errorText}`);
    }

    const parseStartedAt = Date.now();
    const data = (await res.json()) as Record<string, unknown>;
    if (diagnostic) {
      this.emitTimingDiagnostic({
        stage: 'vision_response_parse',
        durationMs: Date.now() - parseStartedAt,
        ...diagnostic,
      });
    }
    this.debugLogChunked(`[LLM] resp ${stringifyRedactedDebugPayload(data)}`);
    this.reportUsage(data);
    return data;
  }

  /**
   * Emit a redacted LLM request/response body to logcat when debugLog is on.
   * A single logcat line is capped (~4KB), so oversized payloads are split
   * into numbered [LLM.part i/N] lines that can be reassembled in order.
   */
  private debugLogChunked(line: string): void {
    if (!this.options.debugLog) return;
    const MAX = 3000;
    const total = Math.ceil(line.length / MAX);
    for (let i = 0; i < total; i++) {
      const part = line.slice(i * MAX, (i + 1) * MAX);
      // eslint-disable-next-line no-console
      console.log(total > 1 ? `[LLM.part ${i + 1}/${total}] ${part}` : part);
    }
  }

  private emitTimingDiagnostic(event: Record<string, unknown>): void {
    try {
      this.options.onTimingDiagnostic?.(event);
    } catch {
      // Diagnostics must never affect inference.
    }
    // eslint-disable-next-line no-console
    console.log(`[TIMING] ${JSON.stringify(event)}`);
  }

  private reportUsage(data: Record<string, unknown>): void {
    const usage = data.usage as
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          input_tokens?: number;
          output_tokens?: number;
          // OpenAI-compatible: prompt_tokens_details.cached_tokens.
          prompt_tokens_details?: { cached_tokens?: number };
          // Anthropic: cache_read_input_tokens.
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        }
      | undefined;
    if (!usage) {
      this.emitCacheDiagnostic({
        event: 'usage',
        apiFormat: this.options.apiFormat,
        model: this.options.model,
        usagePresent: false,
        cacheMetricPresent: false,
        cacheMetricSource: 'missing',
      });
      return;
    }
    // OpenAI reports cached tokens as a subset of prompt_tokens. Anthropic
    // reports uncached input, cache reads and cache writes as disjoint fields,
    // so normalize them into one full prompt-token denominator first.
    const anthropicPrompt =
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    const prompt = usage.prompt_tokens ?? anthropicPrompt;
    const completion = usage.completion_tokens ?? usage.output_tokens ?? 0;
    const cached =
      usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? 0;
    const openAiCacheMetricPresent =
      typeof usage.prompt_tokens_details?.cached_tokens === 'number';
    const anthropicCacheMetricPresent = typeof usage.cache_read_input_tokens === 'number';
    this.emitCacheDiagnostic({
      event: 'usage',
      apiFormat: this.options.apiFormat,
      model: this.options.model,
      usagePresent: true,
      usageKeys: Object.keys(usage).sort(),
      promptTokenDetailKeys: usage.prompt_tokens_details
        ? Object.keys(usage.prompt_tokens_details).sort()
        : [],
      cacheMetricPresent: openAiCacheMetricPresent || anthropicCacheMetricPresent,
      cacheMetricSource: openAiCacheMetricPresent
        ? 'prompt_tokens_details.cached_tokens'
        : anthropicCacheMetricPresent
          ? 'cache_read_input_tokens'
          : 'missing',
      promptTokens: prompt,
      completionTokens: completion,
      cacheReadTokens: cached,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[USAGE] format=${this.options.apiFormat} prompt=${prompt} completion=${completion} cached=${cached} raw=${JSON.stringify(usage)}`,
    );
    this.options.onUsage?.(prompt, completion, cached);
  }

  private emitCacheDiagnostic(event: Record<string, unknown>): void {
    if (!this.options.onCacheDiagnostic) return;
    const payload = { scope: 'provider', ...event };
    // eslint-disable-next-line no-console
    console.log(`[CACHE] ${JSON.stringify(payload)}`);
    try {
      this.options.onCacheDiagnostic(payload);
    } catch {
      // Diagnostics must never affect inference.
    }
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}

function visionRequestDiagnostic(image: ScreenshotImage): VisionRequestDiagnostic {
  return {
    vision: true,
    ...(typeof image.width === 'number' ? { imageWidth: image.width } : {}),
    ...(typeof image.height === 'number' ? { imageHeight: image.height } : {}),
    imageBase64Chars: image.base64?.length ?? 0,
    mimeType: image.mimeType ?? 'image/png',
  };
}

/** Redact inline image bytes without cloning or logging the original payload. */
function stringifyRedactedDebugPayload(value: unknown): string {
  return JSON.stringify(value, function (key, candidate) {
    if (
      typeof candidate === 'string' &&
      /^data:image\/[^;]+;base64,/i.test(candidate)
    ) {
      const comma = candidate.indexOf(',');
      const chars = comma >= 0 ? candidate.length - comma - 1 : candidate.length;
      return `[image_base64_redacted chars=${chars}]`;
    }
    if (
      key === 'data' &&
      typeof candidate === 'string' &&
      this && typeof this === 'object' &&
      (this as { type?: unknown }).type === 'base64'
    ) {
      return `[image_base64_redacted chars=${candidate.length}]`;
    }
    return candidate;
  });
}

function modelText(content: ModelContent[]): string {
  return content
    .filter((item): item is Extract<ModelContent, { type: 'text' }> => item.type === 'text')
    .map((item) => item.text)
    .filter(Boolean)
    .join('\n');
}

function toolResultText(result: ToolResult, toolName?: string): string {
  const value = result.ok
    ? result.data
    : {
        code: result.code,
        message: result.error,
        ...(result.details !== undefined ? { details: result.details } : {}),
      };
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return truncateToolResult(text, toolName);
}

function toolNamesByCallId(messages: ModelMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    for (const item of message.content) {
      if (item.type === 'tool_call') names.set(item.id, item.name);
    }
  }
  return names;
}

function toOpenAIMessages(messages: ModelMessage[]): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  const toolNames = toolNamesByCallId(messages);
  for (const message of messages) {
    if (message.role === 'system') {
      output.push({ role: 'system', content: modelText(message.content) });
      continue;
    }
    if (message.role === 'assistant') {
      const calls = message.content.filter(
        (item): item is Extract<ModelContent, { type: 'tool_call' }> => item.type === 'tool_call',
      );
      const text = modelText(message.content);
      output.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: 'function',
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.arguments),
                },
              })),
            }
          : {}),
      });
      continue;
    }
    for (const item of message.content) {
      if (item.type === 'tool_result') {
        output.push({
          role: 'tool',
          tool_call_id: item.callId,
          content: toolResultText(item.result, toolNames.get(item.callId)),
        });
      }
    }
    const text = modelText(message.content);
    if (text) output.push({ role: 'user', content: text });
  }
  return output;
}

function attachOpenAIImage(
  messages: Array<Record<string, unknown>>,
  imageBase64: string,
  mimeType: string,
): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue;
    const text = typeof messages[i].content === 'string' ? messages[i].content : '';
    messages[i] = {
      ...messages[i],
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        { type: 'text', text },
      ],
    };
    return;
  }
}

function toAnthropicMessages(messages: ModelMessage[]): Array<Record<string, unknown>> {
  const toolNames = toolNamesByCallId(messages);
  const output: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    const blocks: Array<Record<string, unknown>> = message.content.map((item) => {
      if (item.type === 'text') return { type: 'text', text: item.text };
      if (item.type === 'tool_call') {
        return { type: 'tool_use', id: item.id, name: item.name, input: item.arguments };
      }
      return {
        type: 'tool_result',
        tool_use_id: item.callId,
        content: toolResultText(item.result, toolNames.get(item.callId)),
        is_error: !item.result.ok,
      };
    });
    if (message.cache && blocks.length > 0) {
      blocks[blocks.length - 1] = {
        ...blocks[blocks.length - 1],
        cache_control: { type: 'ephemeral' },
      };
    }
    const previous = output[output.length - 1];
    if (previous?.role === message.role && Array.isArray(previous.content)) {
      (previous.content as Array<Record<string, unknown>>).push(...blocks);
    } else {
      output.push({ role: message.role, content: blocks });
    }
  }
  return output;
}

function attachAnthropicImage(
  messages: Array<Record<string, unknown>>,
  imageBase64: string,
  mimeType: string,
): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user' || !Array.isArray(messages[i].content)) continue;
    (messages[i].content as Array<Record<string, unknown>>).unshift({
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data: imageBase64 },
    });
    return;
  }
}

function parseOpenAIModelResponse(response: Record<string, unknown>): ModelResponse {
  const choices = response.choices as Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      reasoning_content?: string;
      tool_calls?: Array<Record<string, unknown>>;
    };
  }> | undefined;
  const choice = choices?.[0];
  const message = choice?.message;
  if (!message) return { content: [], finishReason: 'error' };
  const content: ModelResponse['content'] = [];
  const text = message.content?.trim() || message.reasoning_content?.trim() || '';
  if (text) content.push({ type: 'text', text });
  for (const rawCall of message.tool_calls ?? []) {
    const fn = rawCall.function as Record<string, unknown> | undefined;
    if (typeof fn?.name !== 'string' || !fn.name) continue;
    const parsed = parseOpenAIToolArguments(fn.arguments);
    content.push({
      type: 'tool_call',
      id: typeof rawCall.id === 'string' ? rawCall.id : `call_${content.length}`,
      name: fn.name,
      ...parsed,
    });
  }
  return {
    content,
    finishReason: content.some((item) => item.type === 'tool_call')
      ? 'tool_call'
      : choice?.finish_reason === 'length'
        ? 'length'
        : 'stop',
  };
}

const RAW_TOOL_ARGUMENT_PREVIEW_LIMIT = 800;

function parseOpenAIToolArguments(value: unknown): {
  arguments: Record<string, unknown>;
  argumentParseError?: {
    code: 'MALFORMED_TOOL_ARGUMENTS';
    message: string;
    rawArgumentsPreview: string;
  };
} {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  try {
    return { arguments: parseToolArgumentObject(raw) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      arguments: {},
      argumentParseError: {
        code: 'MALFORMED_TOOL_ARGUMENTS',
        message,
        rawArgumentsPreview: raw.length <= RAW_TOOL_ARGUMENT_PREVIEW_LIMIT
          ? raw
          : `${raw.slice(0, RAW_TOOL_ARGUMENT_PREVIEW_LIMIT)}…[已截断]`,
      },
    };
  }
}

function parseToolArgumentObject(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (originalError) {
    const controlSafe = escapeUnescapedJsonStringControls(raw);
    if (controlSafe === raw) throw originalError;
    parsed = JSON.parse(controlSafe);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('工具参数必须是 JSON 对象');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Some compatible endpoints place literal ASCII control characters inside a
 * JSON string instead of escaping them. Repair only that invalid encoding;
 * malformed quoting, delimiters, and object structure remain hard failures.
 */
function escapeUnescapedJsonStringControls(raw: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  let changed = false;

  for (const character of raw) {
    if (!inString) {
      result += character;
      if (character === '"') inString = true;
      continue;
    }
    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      result += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      result += character;
      inString = false;
      continue;
    }
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1F) {
      result += `\\u${codePoint.toString(16).padStart(4, '0')}`;
      changed = true;
    } else {
      result += character;
    }
  }

  return changed ? result : raw;
}

function parseAnthropicModelResponse(response: Record<string, unknown>): ModelResponse {
  const blocks = Array.isArray(response.content)
    ? response.content as Array<Record<string, unknown>>
    : [];
  const content: ModelResponse['content'] = [];
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      content.push({ type: 'text', text: block.text });
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      const input = block.input && typeof block.input === 'object' && !Array.isArray(block.input)
        ? block.input as Record<string, unknown>
        : {};
      content.push({
        type: 'tool_call',
        id: typeof block.id === 'string' ? block.id : `toolu_${content.length}`,
        name: block.name,
        arguments: input,
      });
    }
  }
  return {
    content,
    finishReason: content.some((item) => item.type === 'tool_call')
      ? 'tool_call'
      : response.stop_reason === 'max_tokens'
        ? 'length'
        : 'stop',
  };
}
