/**
 * Recent command store.
 *
 * Tracks the user's most recently sent commands (deduplicated, newest first)
 * so the chat screen can offer them as quick-fill chips above the input bar.
 * Persisted to AsyncStorage so the list survives app restarts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'deft.recentCommands';
/** Keep more in storage than we display; chips show only the newest N. */
const MAX_STORED_COMMANDS = 20;

let _commands: string[] = [];
let _listeners: Array<(commands: string[]) => void> = [];
let _loaded = false;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function persist(): void {
  const toSave = _commands.slice(0, MAX_STORED_COMMANDS);
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(toSave)).catch(() => {
    // Ignore write errors — recent commands are non-critical data.
  });
}

async function loadFromStorage(): Promise<void> {
  if (_loaded) return;
  _loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: string[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        _commands = parsed.filter((c) => typeof c === 'string' && c.trim().length > 0);
        notify();
      }
    }
  } catch {
    // Corrupt data or unavailable storage — start with an empty list.
  }
}

// Begin loading as soon as this module is imported.
loadFromStorage();

// ---------------------------------------------------------------------------
// Notification helpers
// ---------------------------------------------------------------------------

function notify(): void {
  const snapshot = [..._commands];
  for (const l of _listeners) l(snapshot);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function subscribeRecentCommands(
  listener: (commands: string[]) => void,
): () => void {
  _listeners.push(listener);
  listener([..._commands]);
  return () => {
    _listeners = _listeners.filter((l) => l !== listener);
  };
}

export function getRecentCommands(): string[] {
  return [..._commands];
}

/**
 * Record a newly sent command. Duplicates are moved to the front rather than
 * stored twice; the list stays newest-first.
 */
export function recordCommand(command: string): void {
  const trimmed = command.trim();
  if (!trimmed) return;
  _commands = [
    trimmed,
    ..._commands.filter((c) => c !== trimmed),
  ].slice(0, MAX_STORED_COMMANDS);
  notify();
  persist();
}
