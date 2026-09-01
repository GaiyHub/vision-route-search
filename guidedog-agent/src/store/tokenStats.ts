/**
 * Token consumption statistics.
 *
 * - Per-task: reset on task start, accumulated while the task runs, recorded
 *   into the session history on completion.
 * - Global: cumulative across all tasks, persisted to AsyncStorage and shown
 *   in the model API settings block (user can clear it manually).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TokenUsage {
  prompt: number;
  completion: number;
  /** Tokens served from the provider's prompt cache (subset of prompt). */
  cached: number;
  total: number;
}

const STORAGE_KEY = '@watchdog/token_stats';

let _global: TokenUsage = { prompt: 0, completion: 0, cached: 0, total: 0 };
let _task: TokenUsage = { prompt: 0, completion: 0, cached: 0, total: 0 };
let _loaded = false;
const _listeners = new Set<() => void>();

function zero(): TokenUsage {
  return { prompt: 0, completion: 0, cached: 0, total: 0 };
}

function notify(): void {
  _listeners.forEach((fn) => fn());
}

async function load(): Promise<void> {
  if (_loaded) return;
  _loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      _global = { ...zero(), ...JSON.parse(raw) };
    }
  } catch {
    // Corrupt/unavailable storage — start from zero.
  }
}

// Begin loading as soon as the module is imported.
void load();

/** Reset the per-task counter (called at task start). */
export function resetTaskTokens(): void {
  _task = zero();
  notify();
}

/** Accumulate a cloud model response's token usage. */
export function addTokens(prompt: number, completion: number, cached = 0): void {
  const p = Math.max(0, Math.round(prompt || 0));
  const c = Math.max(0, Math.round(completion || 0));
  const ck = Math.max(0, Math.round(cached || 0));
  _task.prompt += p;
  _task.completion += c;
  _task.cached += ck;
  _task.total += p + c;
  _global.prompt += p;
  _global.completion += c;
  _global.cached += ck;
  _global.total += p + c;
  notify();
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(_global)).catch(() => {});
}

export function getTaskTokens(): TokenUsage {
  return { ..._task };
}

export function getGlobalTokens(): TokenUsage {
  return { ..._global };
}

/** Prompt-cache hit ratio. Completion tokens are outputs and therefore never
 * belong in the denominator of an input-prefix cache metric. */
export function getPromptCacheHitRate(usage: Pick<TokenUsage, 'prompt' | 'cached'>): number {
  if (usage.prompt <= 0) return 0;
  return Math.max(0, Math.min(1, usage.cached / usage.prompt));
}

export async function clearGlobalTokens(): Promise<void> {
  _global = zero();
  notify();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(_global)).catch(() => {});
}

export function subscribeTokenStats(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}
