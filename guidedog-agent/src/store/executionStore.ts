/**
 * Execution step log for the current task.
 *
 * Feeds the collapsible ReAct process panel shown under the user's latest
 * command: collapsed by default (latest step only), expandable to show every
 * step's action, input, and output.
 */

export interface ExecutionStep {
  /** Unique display sequence for keying the list (every action, including bookkeeping). */
  index: number;
  /** 1-based step number among step-consuming actions; null = step-exempt bookkeeping (todo_update / wait). */
  step: number | null;
  tool: string;
  /** Human-readable summary of the action's input (shown in chat bubbles). */
  argsText: string;
  /** Full raw input payload as JSON (shown expanded in the process panel). */
  argsJson?: string;
  /** Truncated summary of the tool output. */
  resultText: string;
  /** Full raw output payload as JSON (shown expanded in the process panel). */
  resultJson?: string;
  /** Skill recalled by this step (read_skill); undefined = no recall. */
  skill?: string;
  pending: boolean;
}

export interface ExecutionState {
  steps: ExecutionStep[];
  running: boolean;
  /** Latest ephemeral model thought; never occupies a chat-message slot. */
  thinking: string;
  /** Transient host-side phase, separate from model thinking and history. */
  status: string;
}

let _steps: ExecutionStep[] = [];
let _running = false;
let _thinking = '';
let _status = '';
/** Step counter that only advances for step-consuming actions. */
let _stepNumber = 0;
const _listeners = new Set<() => void>();

function notify(): void {
  _listeners.forEach((fn) => fn());
}

/** Start a new task: clears the previous step log. */
export function beginExecution(): void {
  _steps = [];
  _stepNumber = 0;
  _running = true;
  _thinking = '';
  _status = '';
  notify();
}

/** Task finished / stopped / errored. Steps are kept for display. */
export function endExecution(): void {
  _running = false;
  _status = '';
  notify();
}

/**
 * Append an action to the step log. Bookkeeping tools (todo_update, wait)
 * pass [consumeStep] = false so they display without a step number and do
 * not inflate the panel's step count.
 */
export function addActionStep(
  tool: string,
  argsText: string,
  argsJson?: string,
  skill?: string,
  consumeStep = true,
): void {
  if (consumeStep) {
    _stepNumber += 1;
  }
  _steps = [
    ..._steps,
    {
      index: _steps.length + 1,
      step: consumeStep ? _stepNumber : null,
      tool,
      argsText,
      argsJson,
      skill,
      resultText: '',
      pending: true,
    },
  ];
  notify();
}

/** Append one completed context-compression summary to the visible process log. */
export function addContextCompressionSummary(summary: string): void {
  const content = summary.trim();
  if (!content) return;
  _steps = [
    ..._steps,
    {
      index: _steps.length + 1,
      step: null,
      tool: 'context_compression',
      argsText: '已压缩较早会话',
      resultText: content,
      pending: false,
    },
  ];
  notify();
}

/**
 * Update the latest step's output text (tool result / screen summary).
 * resultJson carries the full, untruncated tool result for the process panel.
 */
export function updateLastStepResult(
  resultText: string,
  pending = false,
  resultJson?: string,
): void {
  _steps = _steps.map((s, i) =>
    i === _steps.length - 1 ? { ...s, resultText, resultJson, pending } : s,
  );
  notify();
}

/** Update the task's transient thought shown in the execution panel. */
export function updateExecutionThinking(thinking: string): void {
  _thinking = thinking;
  notify();
}

/** Update a transient host-side phase without adding it to model thinking history. */
export function updateExecutionStatus(status: string): void {
  _status = status;
  notify();
}

export function getExecutionState(): ExecutionState {
  return { steps: _steps, running: _running, thinking: _thinking, status: _status };
}

export function subscribeExecution(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}
