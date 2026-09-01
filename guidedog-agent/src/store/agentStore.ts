/**
 * Agent state store.
 *
 * Tracks whether the agent loop is currently running and what it is doing.
 * Components subscribe to observe running state, current step, and the last
 * screen snapshot so they can reflect progress without polling.
 *
 * agentBridge.ts writes to this store; UI components read from it.
 */

import { DEFAULT_AGENT_STEPS } from '../device-agent/agent/AgentLimits';

export type CompletionPhase = 'decision' | 'supplement';

export interface AgentState {
  /** True while the agent loop is actively running. */
  isRunning: boolean;
  /** The task that was submitted (null when idle). */
  currentTask: string | null;
  /** How many observe→act cycles have completed. */
  currentStep: number;
  /** Maximum steps allowed for this run (from settings). */
  maxSteps: number;
  /** Most recent serialized screen state from the agent loop. */
  currentScreenState: string | null;
  /** Number of tool actions dispatched so far in this run. */
  actionCount: number;
  /** Model's completion verdict awaiting user confirmation (null when idle
   *  or no verdict pending). Shared by the host card and floating overlay. */
  completionPending: { result: string; phase: CompletionPhase } | null;
}

const IDLE: AgentState = {
  isRunning: false,
  currentTask: null,
  currentStep: 0,
  maxSteps: DEFAULT_AGENT_STEPS,
  currentScreenState: null,
  actionCount: 0,
  completionPending: null,
};

let _state: AgentState = { ...IDLE };
let _listeners: Array<(state: AgentState) => void> = [];

function notify(): void {
  const snap = { ..._state };
  for (const l of _listeners) l(snap);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function getAgentState(): AgentState {
  return { ..._state };
}

export function subscribeAgentState(
  listener: (state: AgentState) => void,
): () => void {
  _listeners.push(listener);
  listener({ ..._state });
  return () => {
    _listeners = _listeners.filter((l) => l !== listener);
  };
}

// ---------------------------------------------------------------------------
// Write (called by agentBridge.ts)
// ---------------------------------------------------------------------------

/** Mark the agent as active for the given task. */
export function agentStarted(task: string, maxSteps: number = DEFAULT_AGENT_STEPS): void {
  _state = { isRunning: true, currentTask: task, currentStep: 0, maxSteps, currentScreenState: null, actionCount: 0, completionPending: null };
  notify();
}

/** Update step counter and last known screen state. */
export function agentStepped(step: number, screenState?: string): void {
  _state = {
    ..._state,
    currentStep: step,
    currentScreenState: screenState ?? _state.currentScreenState,
  };
  notify();
}

/**
 * Raise the run's step ceiling (the user rejected a completion verdict and
 * the loop guaranteed more iterations). Keeps the progress UI denominator
 * in sync with the loop's effective limit.
 */
export function agentMaxStepsRaised(maxSteps: number): void {
  if (!_state.isRunning || maxSteps <= _state.maxSteps) return;
  _state = { ..._state, maxSteps };
  notify();
}

/** Increment the action counter for the current run. */
export function agentActioned(): void {
  _state = { ..._state, actionCount: _state.actionCount + 1 };
  notify();
}

/** Publish the model's completion verdict for the user to confirm. */
export function agentCompletionPending(result: string): void {
  _state = { ..._state, completionPending: { result, phase: 'decision' } };
  notify();
}

/** Pause completion settlement while the user writes additional context. */
export function agentCompletionSupplementStarted(): void {
  if (!_state.completionPending) return;
  _state = {
    ..._state,
    completionPending: { ..._state.completionPending, phase: 'supplement' },
  };
  notify();
}

/** Return to the three-option decision and restart its timeout generation. */
export function agentCompletionDecisionRestored(): void {
  if (!_state.completionPending) return;
  _state = {
    ..._state,
    completionPending: { ..._state.completionPending, phase: 'decision' },
  };
  notify();
}

/** Clear a resolved / rejected completion verdict (user answered). */
export function agentCompletionResolved(): void {
  _state = { ..._state, completionPending: null };
  notify();
}

/** Mark the agent as idle again (complete, error, or stopped). */
export function agentStopped(): void {
  _state = { ...IDLE };
  notify();
}
