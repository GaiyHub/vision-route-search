/** Host-side state for the model's `ask_user` clarification gate. */

export const CLARIFICATION_MAX_LENGTH = 2000;

export interface PendingClarification {
  id: string;
  question: string;
  placeholder?: string;
}

export type ClarificationResult =
  | { answered: true; answer: string }
  | { answered: false; cancelled: true };

export type ClarificationSubmitResult =
  | { ok: true }
  | { ok: false; error: 'empty' | 'too_long' | 'not_pending' };

let pending: (PendingClarification & {
  resolve: (result: ClarificationResult) => void;
}) | null = null;
let listeners: Array<(value: PendingClarification | null) => void> = [];

function notify(): void {
  const snapshot = pending
    ? { id: pending.id, question: pending.question, placeholder: pending.placeholder }
    : null;
  for (const listener of listeners) listener(snapshot);
}

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function subscribeClarification(
  listener: (value: PendingClarification | null) => void,
): () => void {
  listeners.push(listener);
  listener(pending);
  return () => {
    listeners = listeners.filter((candidate) => candidate !== listener);
  };
}

/** Show one clarification gate and wait until the user answers or the task stops. */
export function requestUserClarification(opts: {
  question: string;
  placeholder?: string;
}): Promise<ClarificationResult> {
  const previous = pending;
  if (previous) previous.resolve({ answered: false, cancelled: true });
  return new Promise((resolve) => {
    pending = {
      id: nextId(),
      question: opts.question,
      placeholder: opts.placeholder,
      resolve,
    };
    notify();
  });
}

export function submitUserClarification(answer: string): ClarificationSubmitResult {
  const trimmed = answer.trim();
  if (!trimmed) return { ok: false, error: 'empty' };
  if (trimmed.length > CLARIFICATION_MAX_LENGTH) {
    return { ok: false, error: 'too_long' };
  }
  const current = pending;
  if (!current) return { ok: false, error: 'not_pending' };
  pending = null;
  notify();
  // Let the caller append the accepted user text to chat before the waiting
  // agent resumes and can emit its next response.
  void Promise.resolve().then(() => current.resolve({ answered: true, answer: trimmed }));
  return { ok: true };
}

/** Cancel the pending gate without inventing an answer. Safe when idle. */
export function cancelUserClarification(): void {
  const current = pending;
  pending = null;
  notify();
  current?.resolve({ answered: false, cancelled: true });
}
