import { useCallback, useRef, useState } from 'react';
import { TaskPlanner } from '../agent/TaskPlanner';
import type { PlannerEvent, SubTask, TaskPlannerOptions } from '../agent/TaskPlanner';

export interface UseTaskPlannerState {
  /** Whether the planner is currently running. */
  isRunning: boolean;
  /** The decomposed plan, available after the 'plan' event fires. */
  plan: SubTask[] | null;
  /** The subtask currently executing, or null when not running. */
  currentSubtask: SubTask | null;
  /** Results collected from each completed subtask. */
  results: string[];
  /** All planner events emitted so far (resets on each execute call). */
  events: PlannerEvent[];
  /** Start executing a high-level task. */
  execute: (task: string) => Promise<void>;
  /** Abort the planner and the currently running subtask immediately. */
  stop: () => void;
}

/**
 * React hook for managing the TaskPlanner lifecycle.
 *
 * @example
 * ```tsx
 * const { isRunning, plan, currentSubtask, results, execute } = useTaskPlanner({
 *   provider: new GemmaProvider({ model: GEMMA4_E4B }),
 *   maxSteps: 10,
 *   maxSubTasks: 5,
 * });
 *
 * await execute('Send a WhatsApp message to Alice saying hi');
 * console.log('Plan:', plan);
 * console.log('Results:', results);
 * ```
 */
export function useTaskPlanner(options: TaskPlannerOptions): UseTaskPlannerState {
  const [isRunning, setIsRunning] = useState(false);
  const [plan, setPlan] = useState<SubTask[] | null>(null);
  const [currentSubtask, setCurrentSubtask] = useState<SubTask | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [events, setEvents] = useState<PlannerEvent[]>([]);

  const stoppedRef = useRef(false);
  const plannerRef = useRef<TaskPlanner | null>(null);
  const optionsRef = useRef(options);
  // Keep options current without re-creating execute on every render.
  optionsRef.current = options;

  const execute = useCallback(async (task: string) => {
    stoppedRef.current = false;
    setIsRunning(true);
    setPlan(null);
    setCurrentSubtask(null);
    setResults([]);
    setEvents([]);

    const planner = new TaskPlanner(optionsRef.current);
    plannerRef.current = planner;

    try {
      for await (const event of planner.run(task)) {
        if (stoppedRef.current) break;

        setEvents((prev) => [...prev, event]);

        if (event.type === 'plan') {
          setPlan(event.subtasks);
        } else if (event.type === 'subtask_start') {
          setCurrentSubtask(event.subtask);
        } else if (event.type === 'subtask_complete') {
          setResults((prev) => [...prev, event.result]);
          setCurrentSubtask(null);
        } else if (event.type === 'subtask_error') {
          setCurrentSubtask(null);
        } else if (event.type === 'complete' || event.type === 'error') {
          setCurrentSubtask(null);
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      setEvents((prev) => [...prev, { type: 'error', error: err }]);
    } finally {
      plannerRef.current = null;
      setIsRunning(false);
      setCurrentSubtask(null);
    }
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    plannerRef.current?.abort();
  }, []);

  return { isRunning, plan, currentSubtask, results, events, execute, stop };
}
