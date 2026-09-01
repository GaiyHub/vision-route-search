import { createCommandExecutionResult } from '../commandExecutionResult';

describe('createCommandExecutionResult', () => {
  test('returns a complete immutable snapshot with ISO timestamps', () => {
    const tokens = { prompt: 12, completion: 3, cached: 5, total: 15 };
    const result = createCommandExecutionResult({
      outcome: 'complete',
      summary: '任务完成',
      traceId: 'a'.repeat(32),
      startedAtMs: 1_700_000_000_000,
      finishedAtMs: 1_700_000_001_234,
      stepCount: 4,
      actionCount: 3,
      tokens,
    });

    expect(result).toEqual({
      outcome: 'complete',
      summary: '任务完成',
      traceId: 'a'.repeat(32),
      startedAt: '2023-11-14T22:13:20.000Z',
      finishedAt: '2023-11-14T22:13:21.234Z',
      durationMs: 1234,
      stepCount: 4,
      actionCount: 3,
      tokens,
    });

    tokens.prompt = 99;
    expect(result.tokens.prompt).toBe(12);
  });

  test('normalizes empty summaries, negative duration and counters', () => {
    const result = createCommandExecutionResult({
      outcome: 'timed_out',
      summary: '',
      traceId: 'b'.repeat(32),
      startedAtMs: 20,
      finishedAtMs: 10,
      stepCount: -1,
      actionCount: -2,
      tokens: { prompt: 0, completion: 0, cached: 0, total: 0 },
    });

    expect(result).toMatchObject({
      outcome: 'timed_out',
      summary: '完成。',
      durationMs: 0,
      stepCount: 0,
      actionCount: 0,
    });
  });
});
