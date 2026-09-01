export interface CommandExecutionOptions {
  source?: 'CHAT' | 'EVALUATION';
  conversationMode?: 'CONTINUOUS' | 'ISOLATED';
  completionPolicy?: 'ASK_USER' | 'AUTO_ACCEPT';
  interactionPolicy?: 'WAIT_FOR_USER' | 'BLOCK';
  onTraceStarted?: (event: { traceId: string; startedAt: string }) => void;
}

export interface CommandExecutionPolicy {
  source: 'CHAT' | 'EVALUATION';
  conversationMode: 'CONTINUOUS' | 'ISOLATED';
  completionPolicy: 'ASK_USER' | 'AUTO_ACCEPT';
  interactionPolicy: 'WAIT_FOR_USER' | 'BLOCK';
  persistUserData: boolean;
  persistGlobalTokens: boolean;
  persistResumableTask: boolean;
  persistTodoArtifacts: boolean;
}

/** Evaluation is safe-by-default even if a caller omits individual switches. */
export function resolveCommandExecutionPolicy(
  options: CommandExecutionOptions = {},
): CommandExecutionPolicy {
  const evaluation = options.source === 'EVALUATION';
  return {
    source: evaluation ? 'EVALUATION' : 'CHAT',
    conversationMode: evaluation ? 'ISOLATED' : (options.conversationMode ?? 'CONTINUOUS'),
    completionPolicy: evaluation ? 'AUTO_ACCEPT' : (options.completionPolicy ?? 'ASK_USER'),
    interactionPolicy: evaluation ? 'BLOCK' : (options.interactionPolicy ?? 'WAIT_FOR_USER'),
    persistUserData: !evaluation,
    persistGlobalTokens: !evaluation,
    persistResumableTask: !evaluation,
    persistTodoArtifacts: !evaluation,
  };
}
