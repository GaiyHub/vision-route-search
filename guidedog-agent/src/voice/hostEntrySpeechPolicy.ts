/**
 * Distinguishes a user foregrounding DouPao from the one automated foreground
 * transition used to display an ask_user clarification card. AppState itself
 * does not expose who initiated the transition.
 */

const AUTOMATED_FOREGROUND_GRACE_MS = 5_000;
let automatedForegroundUntil = 0;

/** Mark the next near-term foreground transition as app-initiated. */
export function markAutomatedHostForeground(now = Date.now()): void {
  automatedForegroundUntil = now + AUTOMATED_FOREGROUND_GRACE_MS;
}

/**
 * Consume the foreground classification. Returns true for ordinary/user
 * foreground entries, which should interrupt any speech currently playing.
 */
export function shouldInterruptSpeechOnHostEntry(now = Date.now()): boolean {
  const automated = automatedForegroundUntil > 0 && now <= automatedForegroundUntil;
  automatedForegroundUntil = 0;
  return !automated;
}

/** Test/task-reset helper; harmless in production. */
export function resetHostEntrySpeechPolicy(): void {
  automatedForegroundUntil = 0;
}
