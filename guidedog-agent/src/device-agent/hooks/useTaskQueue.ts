import { useCallback, useRef, useState } from 'react';
import type { AgentEvent, AgentOptions } from '../types';
import { AgentLoop } from '../agent/AgentLoop';

export interface TaskQueueItem {
  /** Unique identifier for this queued task. */
  id: string;
  /** Natural language task description. */
  task: string;
}

export interface TaskQueueResult {
  id: string;
  task: string;
  /** Final event that ended this task (complete, failed, error, max_steps_reached, timeout). */
  outcome: Extract<AgentEvent, { type: 'complete' | 'failed' | 'error' | 'max_steps_reached' | 'timeout' }>;
}

export interface UseTaskQueueState {
  /** Tasks waiting to run. Does not include the currently running task. */
  queue: TaskQueueItem[];
  /** True while a task is actively running. */
  isRunning: boolean;
  /** The task currently being executed, or null when idle. */
  currentTask: TaskQueueItem | null;
  /** Results of all completed tasks since the queue was created or last cleared. */
  results: TaskQueueResult[];
  /** Events emitted by the currently running task (cleared between tasks). */
  currentEvents: AgentEvent[];
  /** Add one or more tasks to the end of the queue. */
  enqueue: (...tasks: string[]) => void;
  /** Remove all pending tasks from the queue (does not stop the running task). */
  clearQueue: () => void;
  /** Stop the running task and discard all pending tasks. */
  stop: () => void;
}

let _nextId = 0;
function nextId(): string {
  return String(++_nextId);
}

/**
 * Run a queue of tasks sequentially through the agent loop.
 *
 * Tasks added via `enqueue()` are run one after another with the same
 * AgentOptions. Adding tasks while the queue is running appends them to the
 * end. Call `stop()` to abort the current task and discard pending ones.
 *
 * @example
 * ```tsx
 * const { queue, isRunning, currentTask, results, enqueue, stop } = useTaskQueue({
 *   provider: new CloudProvider({ apiKey: '...', model: 'claude-sonnet-4-6' }),
 * });
 *
 * enqueue('Open Settings', 'Turn on Wi-Fi', 'Go back to home screen');
 * ```
 */
export function useTaskQueue(
  agentOptions: AgentOptions,
): UseTaskQueueState {
  const [queue, setQueue] = useState<TaskQueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentTask, setCurrentTask] = useState<TaskQueueItem | null>(null);
  const [results, setResults] = useState<TaskQueueResult[]>([]);
  const [currentEvents, setCurrentEvents] = useState<AgentEvent[]>([]);

  const loopRef = useRef<AgentLoop | null>(null);
  const stoppedRef = useRef(false);
  const runningRef = useRef(false);
  // Keep a ref to the latest queue so the runner closure can read updates.
  const queueRef = useRef<TaskQueueItem[]>([]);

  const runNext = useCallback(async () => {
    if (runningRef.current) return;

    const next = queueRef.current[0];
    if (!next) {
      setIsRunning(false);
      setCurrentTask(null);
      runningRef.current = false;
      return;
    }

    // Remove from queue
    queueRef.current = queueRef.current.slice(1);
    setQueue([...queueRef.current]);
    setCurrentTask(next);
    setCurrentEvents([]);
    setIsRunning(true);
    runningRef.current = true;

    const loop = new AgentLoop(agentOptions);
    loopRef.current = loop;

    let outcome: TaskQueueResult['outcome'] | null = null;

    try {
      for await (const event of loop.run(next.task)) {
        if (stoppedRef.current) break;
        setCurrentEvents((prev) => [...prev, event]);

        if (
          event.type === 'complete' ||
          event.type === 'failed' ||
          event.type === 'error' ||
          event.type === 'max_steps_reached' ||
          event.type === 'timeout'
        ) {
          outcome = event as TaskQueueResult['outcome'];
        }
      }
    } catch {
      // Swallow unexpected generator errors; the loop already emits error events.
    }

    loopRef.current = null;

    if (outcome) {
      setResults((prev) => [
        ...prev,
        { id: next.id, task: next.task, outcome },
      ]);
    }

    runningRef.current = false;

    if (stoppedRef.current) {
      stoppedRef.current = false;
      queueRef.current = [];
      setQueue([]);
      setIsRunning(false);
      setCurrentTask(null);
      return;
    }

    // Schedule next tick — let React flush state updates first.
    setTimeout(runNext, 0);
  }, [agentOptions]);

  const enqueue = useCallback(
    (...tasks: string[]) => {
      const items: TaskQueueItem[] = tasks.map((t) => ({ id: nextId(), task: t }));
      queueRef.current = [...queueRef.current, ...items];
      setQueue([...queueRef.current]);
      // Start the runner if idle.
      if (!runningRef.current) {
        runNext();
      }
    },
    [runNext],
  );

  const clearQueue = useCallback(() => {
    queueRef.current = [];
    setQueue([]);
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    loopRef.current?.abort();
  }, []);

  return {
    queue,
    isRunning,
    currentTask,
    results,
    currentEvents,
    enqueue,
    clearQueue,
    stop,
  };
}
