/**
 * Configuration for the agent loop.
 */
export interface AgentOptions {
  /** LLM provider instance (on-device or cloud). */
  provider: LLMProviderInterface;
  /** Base role, operating policy, and safety prompt owned by AgentLoop. */
  systemPrompt?: string;
  /** Sparse per-tool circuit-breaker thresholds, snapshotted for this loop. */
  toolCircuitBreakerOverrides?: import('./tools/ToolCircuitBreakerPolicy').ToolCircuitBreakerOverrides;
  /** Consecutive hard-blocked tool calls that force-stop the loop. Default: 8. */
  consecutiveCircuitBreakerLimit?: number;
  /** Sparse per-tool availability and model-facing metadata, snapshotted for this loop. */
  toolConfigurationOverrides?: import('./tools/ToolConfiguration').ToolConfigurationOverrides;
  /** Privacy-safe warning/block/recovery telemetry hook. */
  onCircuitBreakerEvent?: (
    event: import('./agent/ToolLoopCircuitBreaker').CircuitBreakerEvent,
  ) => void;
  /** Privacy-safe prompt-cache diagnostics for task logs. Never includes prompt text. */
  onCacheDiagnostic?: (event: Record<string, unknown>) => void;
  /** Privacy-safe per-round latency diagnostics. Never includes prompts, tool arguments, or results. */
  onTimingDiagnostic?: (event: Record<string, unknown>) => void;
  /** Maximum number of observe-think-act cycles before giving up. Default: 20. */
  maxSteps?: number;
  /** Milliseconds to wait between sequential UI-changing calls in one model response. Default: 500. */
  settleMs?: number;
  /**
   * Custom delay implementation used for every in-loop wait (inter-tool settle,
   * stabilization polling, retry backoff, wait tool). Hosts can inject a
   * freeze-safe delay (e.g. a native alarm-driven wait) so the loop survives
   * OEM background freezing that kills JS setTimeout timers. Falls back to a
   * plain setTimeout when omitted.
   */
  delayFn?: (ms: number) => Promise<void>;
  /**
   * Optional todo list maintained through `todo_create` and `todo_update`.
   * When provided, the current todo state is injected into every decision
   * prompt. An empty list is represented by a short applicability reminder.
   */
  todoList?: import('./agent/TodoList').TodoList;
  /**
   * Additional tools registered into the loop regardless of `toolFilter`
   * (e.g. the bookkeeping `todo_update` tool). Useful for host-injected
   * tools that must always be available to the LLM.
   */
  extraTools?: Array<{
    tool: Tool;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
    /** Preset-derived availability before an explicit per-tool override is applied. */
    enabledByDefault?: boolean;
  }>;
  /**
   * Host-owned confirmation surface invoked immediately before a model-planned
   * high-risk tool call. The original tool call is frozen by the loop;
   * `execute` resumes that exact call and `deny` prevents its handler from
   * running. When omitted, risk metadata remains protocol-compatible but no
   * confirmation UI is opened (useful for library consumers and tests).
   */
  toolRiskGate?: (request: ToolRiskGateRequest) => Promise<ToolRiskDecision>;
  /**
   * Host-owned visible recovery for an expired MediaProjection grant. The
   * current screenshot attempt is stopped before this callback runs. The host
   * may foreground its Activity, request consent, restore the previous app,
   * and return `granted`; AgentLoop then retries the exact screenshot call
   * once without another model round.
   */
  screenCapturePermissionGate?: () => Promise<'granted' | 'denied'>;
  /**
   * Host-owned visible recovery for a missing Android location permission.
   * AgentLoop pauses after the native command reports that authorization is
   * required, lets the host request it, then retries the exact call once.
   */
  locationPermissionGate?: () => Promise<'granted' | 'denied'>;
  /**
   * Experience library (skills) in Anthropic Agent Skills style.
   *
   * Two-level progressive disclosure: the catalog (name + description) is
   * injected into the system prompt on every turn; the model loads a skill's
   * full body on demand through the auto-registered `read_skill` tool. The
   * core loop only reads the injected data — storage stays in the host layer.
   *
   * @example
   * new AgentLoop({
   *   provider,
   *   skills: {
   *     catalog: [{ name: 'alipay-topup', description: '支付宝充值流程' }],
   *     load: (name) => hostReadSkillFile(name),
   *   },
   * })
   */
  skills?: {
    /** Level 1 metadata injected into the system prompt (at most 10 entries). */
    catalog: Array<{ name: string; description: string }>;
    /** Level 2 loader for the `read_skill` tool; returns the SKILL.md body or null. */
    load: (name: string) => Promise<string | null>;
  };
  /**
   * Enable image input for the explicit screenshot tool. The loop never
   * captures screenshots automatically.
   *
   * Requires `provider` to implement `generateWithVision` (e.g. GemmaProvider
   * configured with a `generateWithImageFn`). Falls back to text-only if the
   * provider does not implement `generateWithVision`.
   *
   * Default: false.
   */
  useVision?: boolean;
  /** Restrict Android UI observation to visual screenshots only. */
  forceVisualMode?: boolean;
  /** Overlay actionable accessibility refs on screenshots sent to the model. */
  screenshotNodeMarkersEnabled?: boolean;
  /** Downscale screenshots sent to the model without changing physical coordinates. Default: true. */
  screenshotDownscalingEnabled?: boolean;
  /** Allow ui_screenshot to run bundled OCR and expose OCR-derived refs. */
  ocrEnhancementEnabled?: boolean;
  /** Resolve node targets from live accessibility data, then tap by center gesture. */
  nodeTargetGestureTapEnabled?: boolean;
  /**
   * Suppress accessibility-tree and screenshot context while the host app
   * itself is foreground. Android's getCurrentForegroundApp returns an empty
   * package for the host window, preventing the model from describing its own
   * pending/thinking UI as task content. External-app observations are kept.
   */
  suppressHostScreen?: boolean;
  /**
   * Number of times to retry a failed LLM inference call before emitting an
   * error event. Uses exponential backoff: attempt N waits 2^N * 500 ms.
   * Default: 0 (no retries).
   */
  retryOnError?: number;
  /**
   * Additional instructions appended to the system/task prompt on every step.
   * Applies to all providers, including on-device GemmaProvider.
   * Use this to pass user-defined custom instructions into the agent.
   */
  systemPromptSuffix?: string;
  /** Fetch user messages submitted while this AgentLoop is running. Each
   * string becomes an ordinary user turn at the next decision boundary. */
  getUserMessages?: () => string[];
  /** True when a newer user turn is waiting in the host. AgentLoop checks it
   * before dispatching each model-planned tool so stale batched actions do not
   * run after the conversation has changed. */
  hasPendingUserMessages?: () => boolean;
  /** Earlier text turns from the same user-visible conversation. They are
   * injected as ordinary structured user/assistant messages, never flattened
   * into a task-specific runtime-context string. The command passed to run()
   * is appended as the newest user turn. */
  conversationHistory?: ConversationMessage[];
  /**
   * Hard timeout (ms) for a single LLM inference call. A provider that hangs
   * (e.g. a cloud request that never responds nor errors) rejects the
   * inference after this period and the loop's retry/error path takes over,
   * so a stuck request can never freeze the task forever. Backed by the
   * injected delayFn, so the timeout still fires while the app is frozen in
   * the background. Default: 90000. Set to 0 to disable.
   */
  requestTimeoutMs?: number;
  /** @deprecated Explicit UI observations are no longer length-truncated. */
  maxScreenLength?: number;
  /** Callback invoked on every action the agent takes. */
  onAction?: (action: AgentAction) => void;
  /** Callback invoked when the model emits reasoning/thinking text before a tool call. */
  onThinking?: (content: string) => void;
  /** Callback invoked while the loop is generating a conversation summary. */
  onContextCompressionStateChange?: (state: 'compressing' | 'idle') => void;
  /** Callback invoked after a generated conversation summary is committed. */
  onContextCompressed?: (summary: string) => void;
  /** Callback invoked when the model replies in plain text without any tool call (terminal response). */
  onResponse?: (content: string) => void;
  /**
   * Callback invoked after each screen observation step.
   * Fires immediately after the observation event is yielded.
   * Useful for external progress bars or debug panels without subscribing
   * to the full history stream.
   */
  onObservation?: (observation: { screenState: string; step: number }) => void;
  /** Callback invoked when the agent completes a task. */
  onComplete?: (result: string) => void;
  /**
   * Completion gate: when provided, the loop does NOT finish immediately on
   * `task_complete` (or a terminal plain-text reply). Instead it yields a
   * `completion_pending` event, awaits this gate, and then either finishes
   * (`'complete'`) or continues running with the returned text as an ordinary
   * user turn (`{ continue: message }`, consuming one step). The host uses this to ask
   * the user to confirm the model's completion verdict.
   *
   * When omitted, or when the gate throws / resolves an unexpected value, the
   * loop falls back to the previous behavior (finish immediately) — callers
   * that don't opt in are unaffected.
   */
  completionGate?: (result: string) => Promise<'complete' | { continue: string }>;
  /** Callback invoked when the agent explicitly fails a task via task_failed. */
  onFailed?: (reason: string) => void;
  /**
   * Maximum wall-clock milliseconds the loop may run before being terminated.
   * When the timeout elapses between iterations the loop yields
   * `{ type: 'timeout' }` and stops. Default: 0 (no timeout).
   */
  timeoutMs?: number;
  /** Callback invoked when the agent times out (only fires when timeoutMs > 0). */
  onTimeout?: () => void;
  /** Callback invoked when the agent exhausts all steps without completing the task. */
  onMaxSteps?: () => void;
  /**
   * Callback invoked when the loop RAISES its step ceiling after the user
   * rejected a completion verdict (`{ continue }` from completionGate): the
   * new maxSteps is reported so the host's progress UI stays consistent.
   */
  onMaxStepsRaised?: (maxSteps: number) => void;
  /** Callback invoked on error. */
  onError?: (error: Error) => void;
  /**
   * Restrict which phone tools are offered to the LLM for this task.
   *
   * When specified, only tools whose `name` is in this list are passed to the
   * provider. `task_complete` and `task_failed` are always included regardless
   * (the loop depends on them to exit). Omit for all PHONE_TOOLS (default).
   *
   * @example
   * // Read-only analysis — the agent can read the screen but cannot act
   * { toolFilter: ['list_apps'] }
   *
   * // Form-filling only — restrict navigation side-effects
   * { toolFilter: ['ui_tap', 'ui_fill', 'ui_scroll'] }
   */
  toolFilter?: string[];
  /**
   * Use the token-aware ContextCompressionManager. Enabled by default.
   * Set false to keep the complete available history without compression.
   */
  contextCompressionEnabled?: boolean;
  /** LLM summary trigger as a percentage of the resolved context window. */
  contextCompressionThresholdPercent?: number;
  /** Recent history and conversation rounds kept verbatim during compression. */
  contextCompressionProtectedRecentRounds?: number;
  /** Model identifier used to resolve a conservative context-window size. */
  contextModelId?: string;
  /** Explicit model context window override, primarily for tests/custom gateways. */
  contextWindowTokens?: number;
  /**
   * Static key-value context injected into every prompt.
   *
   * Use this to pass user-specific or session-specific information to the LLM
   * without embedding it in the task description or systemPromptSuffix.
   *
   * @example
   * ```typescript
   * new AgentLoop({
   *   provider,
   *   context: {
   *     username: 'Matt',
   *     language: 'Spanish',
   *     'preferred-search': 'Google',
   *   },
   * })
   * ```
   */
  context?: Record<string, string>;
  /**
   * Callback invoked after each observation step with the current and maximum
   * step counts. Fires immediately after `onObservation`.
   *
   * Useful for driving a progress bar without consuming the full event stream:
   * ```typescript
   * onProgress: (step, maxSteps) => setProgress(step / maxSteps),
   * ```
   */
  onProgress?: (step: number, maxSteps: number) => void;
}

/** A durable, tool-free dialogue message supplied by the host conversation. */
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Events yielded by the agent loop generator.
 */
export type AgentEvent =
  | {
      type: 'action';
      /** Task-scoped id pairing this call with exactly one tool result. */
      callId?: string;
      tool: string;
      args: Record<string, unknown>;
      /**
       * The value returned by the tool handler after execution.
       * `undefined` while the action is still in-flight.
       * `false` (boolean) or an Error typically indicates failure.
       */
      result?: unknown;
      /** Loop metadata used to compact repeated no-progress history. */
      loop?: {
        fingerprint: string;
        noProgressCount: number;
        blocked?: boolean;
      };
    }
  | { type: 'observation'; screenState: string; step: number; screenshotPath?: ScreenshotImage }
  | { type: 'user_message'; id: string; content: string }
  | { type: 'runtime_guidance'; id: string; content: string }
  /** Durable facts extracted by the model while a specific screenshot was attached. */
  | { type: 'visual_memory'; observationId: string; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'response'; content: string }
  | { type: 'complete'; result: string }
  | { type: 'completion_pending'; result: string }
  | { type: 'failed'; reason: string }
  | { type: 'error'; error: Error }
  | { type: 'max_steps_reached' }
  | { type: 'timeout' };

/**
 * A single action taken by the agent.
 */
export interface AgentAction {
  tool: string;
  args: Record<string, unknown>;
  timestamp: number;
}

/**
 * A parsed tool call extracted from LLM output.
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  /** Provider-native function arguments could not be decoded as a JSON object.
   * AgentLoop reports this as a tool result and must never dispatch the call. */
  argumentParseError?: ToolArgumentParseError;
}

export interface ToolArgumentParseError {
  code: 'MALFORMED_TOOL_ARGUMENTS';
  message: string;
  rawArgumentsPreview: string;
}

export type ToolRiskLevel = 'low' | 'high';
export type ToolRiskDecision = 'execute' | 'deny';

/** Request passed from the tool execution boundary to the host confirmation UI. */
export interface ToolRiskGateRequest {
  toolName: string;
  /** Arguments that will reach the handler; model-only `_risk` is excluded. */
  arguments: Readonly<Record<string, unknown>>;
  risk: Exclude<ToolRiskLevel, 'low'>;
  summary: string;
  /** Sanitized model explanation of the immediate real-world consequence. */
  reason: string;
  /** Stable identity binding one authorization to one exact tool invocation. */
  fingerprint: string;
}

/**
 * Unified wrapper for every tool execution result.
 *
 * All handlers' raw returns (booleans, strings, objects, thrown errors) are
 * normalized to this shape at the ToolRegistry execution boundary, so the
 * model always sees a structured outcome:
 * - ok=true: the action succeeded; `data` carries the raw return value.
 * - ok=false: the action failed; `code`, `error` and optional `details`
 *   describe the observed failure without prescribing an upper-layer policy.
 */
export interface ToolResultMetadata {
  /** Optional image produced by a tool (for example browser screenshot).
   * AgentLoop attaches it to the next vision inference; text history and logs
   * must never serialize its base64 payload. */
  observationImage?: ScreenshotImage;
  /** Marks results such as cookies that require log redaction. */
  sensitive?: boolean;
}

/** Canonical successful tool outcome. Business output exists only in data. */
export interface ToolSuccess<T = unknown> extends ToolResultMetadata {
  ok: true;
  data: T;
}

/** Canonical failed tool outcome, modelled after Claude's is_error results. */
export interface ToolFailure extends ToolResultMetadata {
  ok: false;
  /** Human-readable failure reason; safe to show to the model. */
  error: string;
  /** Stable machine-readable category. */
  code: string;
  /** Optional bounded diagnostics; never contains an Error stack. */
  details?: unknown;
}

/** Unified result leaving the ToolRegistry execution boundary. */
export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

/**
 * Definition of a tool the agent can use.
 */
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  /** 成功 ToolResult.data 中业务值的结构。Provider 工具调用协议只标准化
   * 输入 schema，因此该字段作为 provider-neutral 契约元数据，供校验、测试、
   * 文档及后续协议适配使用；截图等二进制观察附件通过独立通道传输。 */
  outputSchema?: ToolValueSchema;
  /** Runtime observation policy. Omit for custom tools to ask the model for
   * a per-call `_changesScreen` judgment in the generated tool arguments. */
  uiEffect?: 'none' | 'change' | 'wait' | 'user_gate';
}

/**
 * JSON Schema-style parameter definition for a tool.
 */
export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolProperty>;
  required?: string[];
}

/**
 * A single property in a tool's parameter schema.
 */
export interface ToolValueSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  /** Inclusive numeric lower bound. */
  minimum?: number;
  /** Inclusive numeric upper bound. */
  maximum?: number;
  /** Element schema for `array` properties. */
  items?: ToolProperty;
  /** Nested property map for `object` properties. */
  properties?: Record<string, ToolProperty>;
  /** Required keys for nested `object` properties. */
  required?: string[];
  /** 是否允许 `properties` 未声明的字段。 */
  additionalProperties?: boolean;
}

/** 工具输入参数 schema 中的单个字段。 */
export type ToolProperty = ToolValueSchema;

/**
 * A single message in the chat-style conversation passed to providers.
 * Follows the OpenAI messages protocol: system (static guidance), user
 * (task-level runtime context), then alternating assistant (agent actions)
 * and user (tool results/current loop state).
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /**
   * Hint that this message ends a stable prefix worth caching. Mapped to an
   * Anthropic `cache_control: { type: 'ephemeral' }` breakpoint; ignored by
   * OpenAI-compatible endpoints (their automatic prompt caching needs no
   * explicit marker). Marking an unstable message defeats the cache, so only
   * messages whose content never changes between turns should set this.
   */
  cache?: boolean;
}

/** Provider-neutral content stored by AgentLoop. Protocol adapters translate
 * these blocks to OpenAI tool_calls/tool messages, Anthropic
 * tool_use/tool_result blocks, or the legacy text fallback. */
export type ModelContent =
  | { type: 'text'; text: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      arguments: Record<string, unknown>;
      argumentParseError?: ToolArgumentParseError;
    }
  | {
      type: 'tool_result';
      callId: string;
      result: ToolResult;
    };

/** Canonical conversation message. Unlike LLMMessage, tool semantics are not
 * flattened into model-visible XML. */
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: ModelContent[];
  cache?: boolean;
}

/** Canonical result returned by a protocol-aware provider. */
export interface ModelResponse {
  content: Array<Extract<ModelContent, { type: 'text' | 'tool_call' }>>;
  finishReason?: 'stop' | 'tool_call' | 'length' | 'error';
}

/**
 * Screenshot payload passed to `generateWithVision`.
 *
 * The native capture resolves both transports because the consumers differ:
 * on-device Gemma vision decodes a local file path internally, while cloud
 * vision must receive the in-memory base64 payload (RN's fetch cannot read
 * `file://` URIs, so reading the file back on the JS side is impossible).
 */
export interface ScreenshotImage {
  /** Local file path (no `file://` prefix) — used by on-device vision. */
  path?: string;
  /** Base64-encoded PNG bytes — used by cloud vision. */
  base64?: string;
  /** MIME type of the base64 payload (defaults to image/png). */
  mimeType?: string;
  /** Original screenshot width in physical screen pixels. */
  width?: number;
  /** Original screenshot height in physical screen pixels. */
  height?: number;
}

/**
 * Abstract interface that all LLM providers must implement.
 */
export interface LLMProviderInterface {
  /** Generate a plain text response (single-turn planning, no conversation). */
  generate(prompt: string): Promise<string>;
  /**
   * Generate a response with tool-calling support from a chat-style message
   * array. The first message is the system prompt; the rest form the
   * conversation history ending with the current user turn.
   */
  generateWithTools(messages: LLMMessage[], tools: Tool[]): Promise<string>;
  /**
   * Preferred provider-neutral path. Providers implementing this method own
   * the conversion to and from their native API wire protocol. AgentLoop
   * falls back to generateWithTools for local/text-only implementations.
   */
  generateStructuredWithTools?(
    messages: ModelMessage[],
    tools: Tool[],
  ): Promise<ModelResponse>;
  /**
   * Generate a response with tool-calling support and a screenshot image.
   * Providers that do not support vision may fall back to `generateWithTools`.
   * The image is attached to the last user message.
   * @param messages - Chat-style message array (see generateWithTools)
   * @param tools - Available tools
   * @param image - Screenshot payload: `base64` for cloud providers, `path`
   * for on-device providers (see [ScreenshotImage])
   */
  generateWithVision?(
    messages: LLMMessage[],
    tools: Tool[],
    image: ScreenshotImage,
  ): Promise<string>;
  /** Structured equivalent of generateWithVision. */
  generateStructuredWithVision?(
    messages: ModelMessage[],
    tools: Tool[],
    image: ScreenshotImage,
  ): Promise<ModelResponse>;
}

/**
 * State returned by the useAgent hook.
 */
export interface UseAgentState {
  /** Whether the agent is currently running a task. */
  isRunning: boolean;
  /** History of events from the current or most recent task. */
  history: AgentEvent[];
  /** Start executing a task. */
  execute: (task: string) => Promise<void>;
  /** Stop the currently running task. */
  stop: () => void;
}

/**
 * Visual kind of a chat message — controls how the UI renders it.
 *
 *   'text'   — standard chat bubble (user commands, agent summaries, errors)
 *   'action' — action bullet with a status dot (agent tool calls)
 *   'screen' — horizontal divider labelling a screen observation step
 */
export type ChatMessageKind = 'text' | 'action' | 'screen';

/**
 * Chat message in the agent conversation.
 */
export interface ChatMessage {
  /** Unique identifier for this message. */
  id: string;
  role: 'user' | 'agent' | 'system';
  /** Display text for the message. */
  text: string;
  /**
   * Visual kind. Defaults to 'text' when absent.
   * - 'text'   → standard bubble
   * - 'action' → action bullet with status dot
   * - 'screen' → horizontal divider showing observation step
   */
  kind?: ChatMessageKind;
  /**
   * True while an action is still in-flight (dot is grey).
   * False (or absent) once the loop has moved past this action (dot is green).
   */
  pending?: boolean;
  timestamp: number;
}
