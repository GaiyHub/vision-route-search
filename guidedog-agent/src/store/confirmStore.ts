/**
 * User-confirmation gate for high-risk agent actions.
 *
 * The unified tool execution boundary publishes high-risk calls here
 * before their handlers run. An inline card renders the action + risk, and the
 * blocked dispatch only resumes after the user taps 执行 or 拒绝. The legacy
 * `confirm_action` adapter uses the same store during migration.
 */

export type RiskLevel = 'low' | 'high';

export interface PendingConfirm {
  id: string;
  /** The action the agent wants to perform (e.g. 点击「确认支付」). */
  action: string;
  /** Risk level chosen by the model. */
  risk: RiskLevel;
  /** Why the model flagged this as risky. */
  reason?: string;
  resolve: (choice: 'execute' | 'reject') => void;
}

let _pending: PendingConfirm | null = null;
let _listeners: Array<(pending: PendingConfirm | null) => void> = [];

/**
 * Safety net: a task must never hang forever on a confirmation nobody saw
 * or answered. The timeout defaults to 'reject' — for high-risk actions,
 * pausing the task is always safer than proceeding unconfirmed.
 */
const RISK_CONFIRM_TIMEOUT_MS = 60_000;

function notify(): void {
  const snapshot = _pending;
  for (const l of _listeners) l(snapshot);
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Subscribe to confirmation requests (null clears the modal). */
export function subscribeConfirm(
  listener: (pending: PendingConfirm | null) => void,
): () => void {
  _listeners.push(listener);
  listener(_pending);
  return () => {
    _listeners = _listeners.filter((l) => l !== listener);
  };
}

/**
 * Show a confirmation request and block until the user decides.
 * Resolves 'execute' or 'reject'.
 */
export function requestUserConfirm(
  opts: { action: string; risk: RiskLevel; reason?: string },
): Promise<'execute' | 'reject'> {
  return new Promise((resolve) => {
    const pending: PendingConfirm = {
      id: uid(),
      action: opts.action,
      risk: opts.risk,
      reason: opts.reason,
      resolve,
    };
    _pending = pending;
    notify();
    // Deadline fallback: the closure keeps its own resolve, so a late timeout
    // after the gate settled (or was superseded by a newer request) is a
    // harmless no-op on an already-settled promise.
    setTimeout(() => {
      if (_pending === pending) {
        _pending = null;
        notify();
      }
      resolve('reject');
    }, RISK_CONFIRM_TIMEOUT_MS);
  });
}

/** Resolve the current pending confirmation with the user's choice. */
export function resolveUserConfirm(choice: 'execute' | 'reject'): void {
  const pending = _pending;
  _pending = null;
  notify();
  pending?.resolve(choice);
}
