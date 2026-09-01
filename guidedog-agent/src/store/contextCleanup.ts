/**
 * Clear user-visible conversation history and local execution artifacts.
 *
 * This intentionally does not coordinate with, stop, or reset a running
 * AgentLoop. It is a settings-only fallback for removing historical data.
 */

import { clearMessages } from './chatStore';
import { clearSessions } from './historyStore';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');

export async function clearHistoricalContextAndLocalFiles(): Promise<void> {
  clearMessages();
  clearSessions();

  const documentDirectory = FileSystem.documentDirectory ?? '';
  const directories = [
    documentDirectory ? `${documentDirectory}tasklogs/` : '',
    documentDirectory ? `${documentDirectory}agent-tool-results/` : '',
  ];
  const packageName = documentDirectory
    .split('/')
    .filter(Boolean)
    .find((part) => part.includes('.'));
  if (packageName) {
    directories.push(
      `file:///storage/emulated/0/Android/data/${packageName}/files/tasklogs/`,
    );
  }

  await Promise.all(
    directories
      .filter(Boolean)
      .map((uri) => FileSystem.deleteAsync(uri, { idempotent: true })),
  );
}
