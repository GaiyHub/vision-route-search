import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, AgentOptions, UseAgentState } from '../types';
import { AgentLoop } from '../agent/AgentLoop';

/**
 * React hook for managing the agent lifecycle.
 *
 * @example
 * ```tsx
 * const { isRunning, history, execute, stop } = useAgent({
 *   provider: new GemmaProvider({ model: GEMMA4_E4B }),
 *   maxSteps: 50,
 *   settleMs: 500,
 *   onAction: (action) => console.log('Action:', action),
 *   onComplete: (result) => console.log('Done:', result),
 * });
 *
 * await execute('Open Settings and turn on Wi-Fi');
 * ```
 */
export function useAgent(options: AgentOptions): UseAgentState {
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState<AgentEvent[]>([]);
  const loopRef = useRef<AgentLoop | null>(null);

  // Keep options in a ref so callbacks (onAction, onComplete, onError) are
  // always current without requiring execute() to be recreated on every render.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // Abort any in-flight loop when the component unmounts.
  useEffect(() => () => { loopRef.current?.abort(); }, []);

  const execute = useCallback(async (task: string) => {
    setIsRunning(true);
    setHistory([]);

    const loop = new AgentLoop(optionsRef.current);
    loopRef.current = loop;

    try {
      for await (const event of loop.run(task)) {
        setHistory((prev) => [...prev, event]);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      setHistory((prev) => [...prev, { type: 'error', error: err }]);
      optionsRef.current.onError?.(err);
    } finally {
      setIsRunning(false);
      loopRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    loopRef.current?.abort();
  }, []);

  return { isRunning, history, execute, stop };
}
