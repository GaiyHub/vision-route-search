// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  AgentOptions,
  AgentEvent,
  AgentAction,
  ToolCall,
  ToolRiskLevel,
  ToolRiskDecision,
  ToolRiskGateRequest,
  Tool,
  ToolResult,
  ToolParameters,
  ToolProperty,
  ToolValueSchema,
  ModelContent,
  ModelMessage,
  ModelResponse,
  LLMProviderInterface,
  UseAgentState,
  ChatMessage,
  ChatMessageKind,
} from './types';

// ---------------------------------------------------------------------------
// Agent core
// ---------------------------------------------------------------------------

export { AgentLoop } from './agent/AgentLoop';
export { ContextCompressionManager, ContextCompressionError } from './agent/ContextCompressionManager';
export type {
  ContextCheckpoint,
  ContextCompressionManagerOptions,
  ContextHistoryRound,
  ContextPrepareResult,
} from './agent/ContextCompressionManager';
export { AgentToolkit } from './agent/AgentToolkit';
export type { AgentToolkitDeps, AgentToolkitOptions } from './agent/AgentToolkit';
export { SCREEN_CHANGING_TOOLS } from './agent/AgentToolkit';
export { TodoList } from './agent/TodoList';
export type { TodoItem, TodoSeedItem, TodoStatus } from './agent/TodoList';
export { ScreenSerializer } from './agent/ScreenSerializer';
export { ScreenshotPreprocessor } from './agent/ScreenshotPreprocessor';
export type { PreprocessedScreenshot } from './agent/ScreenshotPreprocessor';
export { ToolParser } from './agent/ToolParser';
export { TaskPlanner } from './agent/TaskPlanner';
export type { SubTask, PlannerEvent, TaskPlannerOptions } from './agent/TaskPlanner';

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export { ToolRegistry } from './tools/ToolRegistry';
export { PHONE_TOOLS, PHONE_TOOL_PRESETS } from './tools/PhoneTools';
export {
  TOOL_CIRCUIT_BREAKER_CATALOG,
  TOOL_LOOP_HISTORY_SIZE,
  canonicalToolName,
  normalizeToolCircuitBreakerOverrides,
  resolveToolCircuitBreakerPolicy,
} from './tools/ToolCircuitBreakerPolicy';
export {
  MAX_TOOL_DESCRIPTION_LENGTH,
  MAX_TOOL_LABEL_LENGTH,
  REQUIRED_ENABLED_TOOLS,
  NON_CONFIGURABLE_TOOLS,
  applyToolConfiguration,
  isToolEnabled,
  normalizeToolConfigurationOverrides,
} from './tools/ToolConfiguration';
export type {
  ToolConfigurationOverride,
  ToolConfigurationOverrides,
} from './tools/ToolConfiguration';
export type {
  ToolActionFamily,
  ToolCircuitBreakerBehavior,
  ToolCircuitBreakerCatalogEntry,
  ToolCircuitBreakerOverrides,
  ToolCircuitBreakerThreshold,
} from './tools/ToolCircuitBreakerPolicy';
export {
  TODO_CREATE_TOOL,
  TODO_CREATE_TOOL_NAME,
  TODO_UPDATE_TOOL,
  TODO_UPDATE_TOOL_NAME,
  createTodoCreateHandler,
  createTodoUpdateHandler,
} from './tools/TodoTool';
export type { TodoToolResult } from './tools/TodoTool';
export { READ_SKILL_TOOL, READ_SKILL_TOOL_NAME, createReadSkillHandler } from './tools/SkillTool';
export type { ReadSkillResult } from './tools/SkillTool';
export {
  FILE_READ_TOOL,
  FILE_READ_TOOL_NAME,
  ToolResultArtifactStore,
} from './tools/ToolResultArtifactStore';
export { toOpenAIFunction, toAnthropicTool, toGemmaFunction, validateArgs } from './tools/ToolSchema';
export { ToolBuilder } from './tools/ToolBuilder';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export { LLMProvider } from './providers/LLMProvider';
export { GemmaProvider } from './providers/GemmaProvider';
export type { GemmaProviderOptions } from './providers/GemmaProvider';
export { CloudProvider } from './providers/CloudProvider';
export type { CloudProviderOptions } from './providers/CloudProvider';
export { FallbackProvider } from './providers/FallbackProvider';
export type { FallbackProviderOptions, ComplexityHeuristics } from './providers/FallbackProvider';
export { CloudFirstFallbackProvider } from './providers/CloudFirstFallbackProvider';
export type { CloudFirstFallbackProviderOptions } from './providers/CloudFirstFallbackProvider';
export { FunctionGemmaProvider } from './providers/FunctionGemmaProvider';
export type { FunctionGemmaProviderOptions } from './providers/FunctionGemmaProvider';
export { DualModelProvider } from './providers/DualModelProvider';
export type { DualModelProviderOptions } from './providers/DualModelProvider';

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

export { useAgent } from './hooks/useAgent';
export { useAgentChat } from './hooks/useAgentChat';
export type { UseAgentChatState } from './hooks/useAgentChat';
export { useTaskPlanner } from './hooks/useTaskPlanner';
export type { UseTaskPlannerState } from './hooks/useTaskPlanner';
export { useTaskQueue } from './hooks/useTaskQueue';
export type { UseTaskQueueState, TaskQueueItem, TaskQueueResult } from './hooks/useTaskQueue';
export { useAgentMetrics } from './hooks/useAgentMetrics';
export type { AgentMetrics, AgentOutcome } from './hooks/useAgentMetrics';
