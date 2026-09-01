export const EVALUATION_SCHEMA_VERSION = 1 as const;
export const EVALUATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const EVALUATION_HASH_PATTERN = /^[a-f0-9]{64}$/;
export const EVALUATION_INSTRUCTION_MAX_BYTES = 32 * 1024;
export const EVALUATION_PAYLOAD_MAX_BYTES = 64 * 1024;
export const EVALUATION_TIMEOUT_MIN_MS = 1_000;
export const EVALUATION_TIMEOUT_MAX_MS = 30 * 60 * 1_000;

export type EvaluationContractErrorCode =
  | 'PAYLOAD_TOO_LARGE'
  | 'PAYLOAD_INVALID_BASE64URL'
  | 'PAYLOAD_INVALID_UTF8'
  | 'PAYLOAD_INVALID_JSON'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'INVALID_REQUEST'
  | 'INVALID_STATUS';

export class EvaluationContractError extends Error {
  constructor(
    public readonly code: EvaluationContractErrorCode,
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = 'EvaluationContractError';
  }
}

export interface EvalRequestV1 {
  schemaVersion: 1;
  requestId: string;
  requestHash: string;
  runId: string;
  sampleId: string;
  instruction: string;
  timeoutMs: number;
  conversationMode: 'ISOLATED';
}

export type CommandOutcome =
  | 'complete'
  | 'stopped'
  | 'error'
  | 'blocked'
  | 'timed_out';

export type BlockedInteraction = 'RISK' | 'ASK_USER' | 'USER_ACTION';

export interface CommandExecutionResult {
  outcome: CommandOutcome;
  summary: string;
  traceId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stepCount: number;
  actionCount: number;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
    cached?: number;
  };
  blockedInteraction?: BlockedInteraction;
}

interface EvalStatusBaseV1 {
  schemaVersion: 1;
  requestId: string;
  runId: string;
  sampleId: string;
  updatedAt: string;
}

export type EvalStatusV1 =
  | (EvalStatusBaseV1 & { state: 'ACCEPTED' })
  | (EvalStatusBaseV1 & {
      state: 'RUNNING';
      traceId: string;
      startedAt: string;
    })
  | (EvalStatusBaseV1 & {
      state: 'COMPLETED' | 'BLOCKED';
      result: CommandExecutionResult;
    })
  | (EvalStatusBaseV1 & {
      state: 'TIMED_OUT' | 'CANCELLED';
      traceId?: string;
      reason: string;
    })
  | (EvalStatusBaseV1 & {
      state: 'ERROR';
      traceId?: string;
      code: string;
      message: string;
    });

export function canonicalizeEvalRequestForHash(
  request: Omit<EvalRequestV1, 'requestHash'>,
): string {
  return JSON.stringify({
    schemaVersion: request.schemaVersion,
    requestId: request.requestId,
    runId: request.runId,
    sampleId: request.sampleId,
    instruction: request.instruction,
    timeoutMs: request.timeoutMs,
    conversationMode: request.conversationMode,
  });
}
