/** Host-side gate for a manual UI step requested through the floating overlay. */

export interface PendingUserAction {
  id: string;
  instruction: string;
}

export type UserActionResult =
  | { completed: true }
  | { completed: false; cancelled: true };

let pending: (PendingUserAction & {
  resolve: (result: UserActionResult) => void;
}) | null = null;

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Wait until the user confirms that the requested foreground-app step is done. */
export function requestManualUserAction(instruction: string): Promise<UserActionResult> {
  const previous = pending;
  if (previous) previous.resolve({ completed: false, cancelled: true });
  return new Promise((resolve) => {
    pending = { id: nextId(), instruction, resolve };
  });
}

/** Resolve the current manual-action gate. Safe when no gate is pending. */
export function completeManualUserAction(): void {
  const current = pending;
  pending = null;
  current?.resolve({ completed: true });
}

/** Cancel without pretending that the requested UI step happened. */
export function cancelManualUserAction(): void {
  const current = pending;
  pending = null;
  current?.resolve({ completed: false, cancelled: true });
}
