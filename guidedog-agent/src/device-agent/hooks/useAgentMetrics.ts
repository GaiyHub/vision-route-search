import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent } from '../types';

export type AgentOutcome =
  | 'complete'
  | 'failed'
  | 'timeout'
  | 'max_steps_reached'
  | 'error';

export interface AgentMetrics {
  /** Number of observation events (screen reads) — equals the loop step count. */
  stepCount: number;
  /** Number of action events fired. */
  actionCount: number;
  /** Wall-clock time since the session started (ms). Updates every 500 ms while running. */
  elapsedMs: number;
  /** Average milliseconds per step. 0 if no steps have completed yet. */
  averageStepMs: number;
  /** Terminal outcome of the session, or null while still running. */
  outcome: AgentOutcome | null;
}

/**
 * Derives live performance metrics from a running (or completed) agent session.
 *
 * Designed to pair with `useAgent`:
 * ```tsx
 * const { isRunning, history, execute, stop } = useAgent(options);
 * const metrics = useAgentMetrics(history, isRunning);
 * ```
 */
export function useAgentMetrics(
  history: AgentEvent[],
  isRunning: boolean,
): AgentMetrics {
  const startTimeRef = useRef<number | null>(null);
  const endTimeRef = useRef<number | null>(null);
  const [tick, setTick] = useState(0);

  // Track session boundaries.
  useEffect(() => {
    if (isRunning && startTimeRef.current === null) {
      startTimeRef.current = Date.now();
      endTimeRef.current = null;
    } else if (!isRunning && startTimeRef.current !== null && endTimeRef.current === null) {
      endTimeRef.current = Date.now();
    }
  }, [isRunning]);

  // Tick every 500 ms while running so elapsedMs updates live.
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [isRunning]);

  return useMemo(() => {
    let stepCount = 0;
    let actionCount = 0;
    let outcome: AgentOutcome | null = null;

    for (const event of history) {
      switch (event.type) {
        case 'observation':      stepCount++;   break;
        case 'action':           actionCount++; break;
        case 'complete':         outcome = 'complete';          break;
        case 'failed':           outcome = 'failed';            break;
        case 'timeout':          outcome = 'timeout';           break;
        case 'max_steps_reached': outcome = 'max_steps_reached'; break;
        case 'error':            outcome = 'error';             break;
        default: break;
      }
    }

    const start = startTimeRef.current ?? Date.now();
    const end = endTimeRef.current ?? (isRunning ? Date.now() : start);
    const elapsedMs = end - start;
    const averageStepMs = stepCount > 0 ? Math.round(elapsedMs / stepCount) : 0;

    return { stepCount, actionCount, elapsedMs, averageStepMs, outcome };
    // tick is intentionally included so the memo re-runs while the agent is live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, isRunning, tick]);
}
