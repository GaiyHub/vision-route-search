export type AdbErrorCode =
  | 'ADB_NOT_FOUND'
  | 'DEVICE_NOT_SELECTED'
  | 'DEVICE_UNAUTHORIZED'
  | 'DEVICE_OFFLINE'
  | 'DOUPAO_PACKAGE_MISSING'
  | 'EVALUATION_ENTRY_UNAVAILABLE'
  | 'EVALUATION_PERMISSION_DENIED'
  | 'EVALUATION_API_INCOMPATIBLE'
  | 'EVALUATION_ARTIFACTS_UNAVAILABLE'
  | 'REQUEST_REJECTED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RUN_ALREADY_ACTIVE'
  | 'STATUS_INVALID'
  | 'SAMPLE_TIMEOUT'
  | 'DEVICE_LOST';

export class AdbRunnerError extends Error {
  constructor(
    public readonly code: AdbErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly details?: Readonly<Record<string, unknown>>,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'AdbRunnerError';
  }
}
