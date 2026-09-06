/** Host-side gate for a manual UI step requested through the floating overlay. */

export interface PendingUserAction {
  id: string;
  instruction: string;
}

export type UserActionResult =
  | { completed: true }
  | { completed: false; cancelled: true }
  | { completed: false; timedOut: true };

let pending: (PendingUserAction & {
  resolve: (result: UserActionResult) => void;
  timer?: ReturnType<typeof setTimeout>;
}) | null = null;

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Wait until the user confirms that the requested foreground-app step is done. */
export function requestManualUserAction(instruction: string, timeoutMs?: number): Promise<UserActionResult> {
  const previous = pending;
  if (previous) {
    if (previous.timer) clearTimeout(previous.timer);
    previous.resolve({ completed: false, cancelled: true });
  }
  return new Promise((resolve) => {
    const request: NonNullable<typeof pending> = { id: nextId(), instruction, resolve };
    if (timeoutMs !== undefined) {
      request.timer = setTimeout(() => {
        if (pending !== request) return;
        pending = null;
        resolve({ completed: false, timedOut: true });
      }, timeoutMs);
    }
    pending = request;
  });
}

/** Resolve the current manual-action gate. Safe when no gate is pending. */
export function completeManualUserAction(): void {
  const current = pending;
  pending = null;
  if (current?.timer) clearTimeout(current.timer);
  current?.resolve({ completed: true });
}

/** Cancel without pretending that the requested UI step happened. */
export function cancelManualUserAction(): void {
  const current = pending;
  pending = null;
  if (current?.timer) clearTimeout(current.timer);
  current?.resolve({ completed: false, cancelled: true });
}
