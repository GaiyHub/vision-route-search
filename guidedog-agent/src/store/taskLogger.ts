/**
 * Compatibility facade for former task-log call sites.
 * Task events now live in the request's single trace-*.jsonl stream.
 */

import { flush, getTraceId, logEvent } from '../agent/otelLogger';

export function beginTaskLog(_task: string): void {
  // beginTrace already records the command as the root observation input.
}

export function appendTaskLog(phase: string, data: Record<string, unknown>): void {
  if (getTraceId()) logEvent(phase, data);
}

export async function flushTaskLog(): Promise<void> {
  await flush();
}
