export const MIN_AGENT_STEPS = 1;
export const DEFAULT_AGENT_STEPS = 50;
export const MAX_AGENT_STEPS = 200;

export function normalizeAgentSteps(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_AGENT_STEPS;
  return Math.min(MAX_AGENT_STEPS, Math.max(MIN_AGENT_STEPS, Math.round(numeric)));
}
