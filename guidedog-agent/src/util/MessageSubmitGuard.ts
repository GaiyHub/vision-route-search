/**
 * Guards the chat composer against duplicate submissions caused by a rapid
 * button double-tap or an overlapping keyboard-submit event.
 */
export const MESSAGE_SUBMIT_DEBOUNCE_MS = 800;

export class MessageSubmitGuard {
  private inFlight = false;
  private lastText: string | null = null;
  private lastAcceptedAt = 0;

  constructor(private readonly debounceMs = MESSAGE_SUBMIT_DEBOUNCE_MS) {}

  tryAcquire(text: string, now = Date.now()): boolean {
    const normalized = text.trim();
    if (this.inFlight) return false;
    if (
      this.lastText === normalized &&
      now - this.lastAcceptedAt < this.debounceMs
    ) {
      return false;
    }
    this.inFlight = true;
    this.lastText = normalized;
    this.lastAcceptedAt = now;
    return true;
  }

  release(): void {
    this.inFlight = false;
  }
}
