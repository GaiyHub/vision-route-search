import type { CommandExecutionResult, CommandOutcome } from './contracts';
import type { TokenUsage } from '../store/tokenStats';

export interface CommandExecutionResultInput {
  outcome: CommandOutcome;
  summary: string;
  traceId: string;
  startedAtMs: number;
  finishedAtMs: number;
  stepCount: number;
  actionCount: number;
  tokens: TokenUsage;
  blockedInteraction?: CommandExecutionResult['blockedInteraction'];
}

/** Freeze mutable runtime counters into the versioned evaluation contract. */
export function createCommandExecutionResult(
  input: CommandExecutionResultInput,
): CommandExecutionResult {
  return {
    outcome: input.outcome,
    summary: input.summary || '完成。',
    traceId: input.traceId,
    startedAt: new Date(input.startedAtMs).toISOString(),
    finishedAt: new Date(input.finishedAtMs).toISOString(),
    durationMs: Math.max(0, input.finishedAtMs - input.startedAtMs),
    stepCount: Math.max(0, Math.floor(input.stepCount)),
    actionCount: Math.max(0, Math.floor(input.actionCount)),
    tokens: { ...input.tokens },
    ...(input.blockedInteraction
      ? { blockedInteraction: input.blockedInteraction }
      : {}),
  };
}
