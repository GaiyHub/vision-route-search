import {
  EvaluationContractError,
  parseCommandExecutionResult,
  parseEvalStatus,
} from '..';

const fixture = require('../../../../specs/pc-batch-evaluation/fixtures/eval-status-v1.json') as {
  statuses: unknown[];
};

function expectInvalidStatus(action: () => unknown): void {
  try {
    action();
    throw new Error('expected EvaluationContractError');
  } catch (error) {
    expect(error).toBeInstanceOf(EvaluationContractError);
    expect((error as EvaluationContractError).code).toBe('INVALID_STATUS');
  }
}

describe('EvalStatusV1 contract', () => {
  test('accepts every status variant in the shared fixture', () => {
    expect(fixture.statuses.map(parseEvalStatus)).toEqual(fixture.statuses);
  });

  test('rejects state-specific fields and outcome mismatches', () => {
    const accepted = fixture.statuses[0] as Record<string, unknown>;
    expectInvalidStatus(() => parseEvalStatus({ ...accepted, traceId: 'a'.repeat(32) }));

    const completed = fixture.statuses[2] as Record<string, unknown>;
    expectInvalidStatus(() => parseEvalStatus({
      ...completed,
      result: { ...(completed.result as object), outcome: 'blocked', blockedInteraction: 'RISK' },
    }));
  });

  test('requires internally consistent token and blocked result data', () => {
    const blocked = (fixture.statuses[3] as { result: Record<string, unknown> }).result;
    expectInvalidStatus(() => parseCommandExecutionResult({ ...blocked, blockedInteraction: undefined }));
    expectInvalidStatus(() => parseCommandExecutionResult({
      ...blocked,
      tokens: { prompt: 5, completion: 3, total: 7, cached: 2 },
    }));
  });

  test('rejects invalid timestamps, trace IDs and unknown status versions', () => {
    const running = fixture.statuses[1] as Record<string, unknown>;
    expectInvalidStatus(() => parseEvalStatus({ ...running, traceId: 'short' }));
    expectInvalidStatus(() => parseEvalStatus({ ...running, startedAt: 'yesterday' }));
    expect(() => parseEvalStatus({ ...running, schemaVersion: 2 })).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA_VERSION' }),
    );
  });
});
