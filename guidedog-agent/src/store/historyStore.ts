/**
 * Agent session history store.
 *
 * Sessions are persisted to AsyncStorage under the key STORAGE_KEY and
 * restored automatically on startup. The in-memory API remains synchronous;
 * persistence is fire-and-forget on every write.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type SessionOutcome = 'complete' | 'stopped' | 'error';

export interface AgentSession {
  id: string;
  /** The original user command. */
  command: string;
  /** Action texts executed during the session. */
  actions: string[];
  /** Total agent loop steps taken. */
  stepCount: number;
  /** How the session ended. */
  outcome: SessionOutcome;
  /** Short summary or error message from the agent. */
  summary: string;
  /** Unix timestamp (ms) when the session completed. */
  timestamp: number;
  /** Wall-clock duration of the session in milliseconds. Absent on sessions recorded before this field was added. */
  durationMs?: number;
  /** Cloud model tokens consumed by this session. */
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

const STORAGE_KEY = 'deft.sessions';
/** Fallback cap used until setHistoryLimit() receives the configured value. */
const DEFAULT_MAX_STORED = 100;

let _sessions: AgentSession[] = [];
let _listeners: Array<(sessions: AgentSession[]) => void> = [];
let _loaded = false;
let _maxStored = DEFAULT_MAX_STORED;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function persist(): void {
  const toSave = _sessions.slice(0, _maxStored);
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(toSave)).catch(() => {
    // Ignore write errors — history is non-critical data.
  });
}

async function loadFromStorage(): Promise<void> {
  if (_loaded) return;
  _loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: AgentSession[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        _sessions = parsed.slice(0, _maxStored);
        notify();
      }
    }
  } catch {
    // Corrupt data or unavailable storage — start with empty history.
  }
}

// Begin loading as soon as this module is imported.
loadFromStorage();

// ---------------------------------------------------------------------------
// Notification helpers
// ---------------------------------------------------------------------------

function notify() {
  const snapshot = [..._sessions];
  for (const l of _listeners) l(snapshot);
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function subscribeSessions(
  listener: (sessions: AgentSession[]) => void,
): () => void {
  _listeners.push(listener);
  listener([..._sessions]);
  return () => {
    _listeners = _listeners.filter((l) => l !== listener);
  };
}

export function getSessions(): AgentSession[] {
  return [..._sessions];
}

/** Record a completed agent session. Newest sessions appear first. */
export function addSession(
  command: string,
  actions: string[],
  outcome: SessionOutcome,
  summary: string,
  durationMs?: number,
  tokens?: { prompt: number; completion: number; total: number },
): void {
  _sessions = [
    {
      id: uid(),
      command,
      actions,
      stepCount: actions.length,
      outcome,
      summary,
      timestamp: Date.now(),
      durationMs,
      promptTokens: tokens?.prompt,
      completionTokens: tokens?.completion,
      totalTokens: tokens?.total,
    },
    ..._sessions,
  ].slice(0, _maxStored);
  notify();
  persist();
}

/**
 * Cap how many sessions are kept in memory and on disk (most recent first).
 * Called from the host layer whenever the configured limit changes; the
 * in-memory list is trimmed immediately and re-persisted.
 */
export function setHistoryLimit(max: number): void {
  const n = Math.max(1, Math.floor(max) || DEFAULT_MAX_STORED);
  if (n === _maxStored) return;
  _maxStored = n;
  if (_sessions.length > n) {
    _sessions = _sessions.slice(0, n);
    notify();
    persist();
  }
}

export function clearSessions(): void {
  _sessions = [];
  notify();
  AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

export function removeSession(id: string): void {
  _sessions = _sessions.filter((s) => s.id !== id);
  notify();
  persist();
}
