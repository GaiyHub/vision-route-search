/**
 * Persistent storage for the per-request todo list.
 *
 * Writes the user's original goal plus the todo items into
 * `tasklogs/todo-<traceId>.json`, in BOTH the app-internal files dir and the
 * external app-files dir, so it can be pulled over adb without root:
 *
 *   adb shell ls /storage/emulated/0/Android/data/<pkg>/files/tasklogs/
 *   adb shell cat .../tasklogs/todo-<traceId>.json
 *
 * Reuses the same dual-channel write pattern as otelLogger.ts.
 */

import type { TodoItem } from '../device-agent';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');

interface TodoFileState {
  traceId: string;
  goal: string;
  createdAt: number;
  updatedAt: number;
  outcome: string | null;
  todos: TodoItem[];
}

let _state: TodoFileState | null = null;

/** Opens the todo file for a new user request. */
export function beginTodoFile(traceId: string, goal: string): void {
  _state = {
    traceId,
    goal,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    outcome: null,
    todos: [],
  };
  void write();
}

/** Rewrites the file with the latest todo items. */
export function saveTodos(items: TodoItem[]): void {
  if (!_state) return;
  _state.todos = items;
  _state.updatedAt = Date.now();
  void write();
}

/** Writes the final outcome and last todo state when the request ends. */
export function finalizeTodoFile(outcome: string): void {
  if (!_state) return;
  _state.outcome = outcome;
  _state.updatedAt = Date.now();
  void write();
  _state = null;
}

async function write(): Promise<void> {
  const state = _state;
  if (!state) return;
  const fileName = `todo-${state.traceId}.json`;
  const content = JSON.stringify(state, null, 2);
  try {
    const internalDir = (FileSystem.documentDirectory ?? '') + 'tasklogs/';
    await FileSystem.makeDirectoryAsync(internalDir, { intermediates: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(internalDir + fileName, content, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    // External files dir: pullable over adb without root / run-as.
    const docDir = FileSystem.documentDirectory ?? '';
    const pkg = docDir.split('/').filter(Boolean).find((part) => part.includes('.')) ?? '';
    if (pkg) {
      const externalDir = `/storage/emulated/0/Android/data/${pkg}/files/tasklogs/`;
      await FileSystem.makeDirectoryAsync(externalDir, { intermediates: true }).catch(() => {});
      await FileSystem.writeAsStringAsync(externalDir + fileName, content, {
        encoding: FileSystem.EncodingType.UTF8,
      });
    }
  } catch {
    // Todo persistence must never break the task flow.
  }
}
