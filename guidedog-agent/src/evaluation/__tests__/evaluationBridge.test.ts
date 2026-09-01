jest.mock('react-native', () => ({ DeviceEventEmitter: { addListener: jest.fn() }, NativeModules: {} }));
jest.mock('../../agent/agentBridge', () => ({
  CommandExecutionRejectedError: class CommandExecutionRejectedError extends Error {},
  processCommand: jest.fn(),
  stopAgent: jest.fn(),
}));
jest.mock('../../agent/otelLogger', () => ({ flush: jest.fn() }));

import { EvaluationBridge } from '../evaluationBridge';
import type { CommandExecutionResult, EvalRequestV1, EvalStatusV1 } from '../contracts';

const request: EvalRequestV1 = {
  schemaVersion: 1,
  requestId: 'req-1',
  requestHash: 'a'.repeat(64),
  runId: 'run-1',
  sampleId: 'sample-1',
  instruction: '打开设置',
  timeoutMs: 30_000,
  conversationMode: 'ISOLATED',
};

const completedResult: CommandExecutionResult = {
  outcome: 'complete',
  summary: '已完成',
  traceId: 'b'.repeat(32),
  startedAt: '2026-09-01T00:00:00.000Z',
  finishedAt: '2026-09-01T00:00:01.000Z',
  durationMs: 1000,
  stepCount: 2,
  actionCount: 1,
  tokens: { prompt: 10, completion: 2, total: 12, cached: 5 },
};

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

function createHarness(execute: jest.Mock) {
  const statuses: EvalStatusV1[] = [];
  const calls: string[] = [];
  let pending: string | null = JSON.stringify(request);
  let timerCallback: (() => void) | undefined;
  const consumePendingEvaluationCancellation = jest.fn<Promise<string | null>, []>(
    async () => null,
  );
  const native = {
    consumePendingEvaluationRequest: jest.fn(async () => {
      const value = pending;
      pending = null;
      return value;
    }),
    writeEvaluationStatus: jest.fn(async (raw: string) => {
      statuses.push(JSON.parse(raw));
      calls.push(`status:${statuses[statuses.length - 1]?.state}`);
      return true;
    }),
    writeEvaluationArtifact: jest.fn(async () => true),
    consumePendingEvaluationCancellation,
  };
  const stop = jest.fn();
  const flushTrace = jest.fn(async () => { calls.push('flush'); });
  const bridge = new EvaluationBridge({
    native,
    execute,
    stop,
    flushTrace,
    setTimer: (callback) => {
      timerCallback = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: jest.fn(),
  });
  return { bridge, native, statuses, calls, stop, flushTrace, fireTimeout: () => timerCallback?.() };
}

describe('EvaluationBridge', () => {
  test('writes ACCEPTED/RUNNING/COMPLETED and flushes trace before terminal status', async () => {
    const execute = jest.fn(async (_command, options) => {
      options.onTraceStarted({
        traceId: completedResult.traceId,
        startedAt: completedResult.startedAt,
      });
      await options.evaluationContext!.writeArtifact!(
        `otel-${completedResult.traceId}.jsonl`,
        'trace-line\n',
        true,
      );
      return completedResult;
    });
    const harness = createHarness(execute);

    await harness.bridge.consumePending();

    expect(execute).toHaveBeenCalledWith('打开设置', expect.objectContaining({ source: 'EVALUATION' }));
    expect(harness.native.writeEvaluationArtifact).toHaveBeenCalledWith(
      request.runId,
      request.sampleId,
      request.requestId,
      `otel-${completedResult.traceId}.jsonl`,
      'trace-line\n',
      true,
    );
    expect(harness.statuses.map((status) => status.state)).toEqual([
      'ACCEPTED', 'RUNNING', 'COMPLETED',
    ]);
    expect(harness.calls).toEqual([
      'status:ACCEPTED', 'status:RUNNING', 'flush', 'status:COMPLETED',
    ]);
  });

  test('only cancels the matching active request and reports CANCELLED', async () => {
    let resolveExecution!: (result: CommandExecutionResult) => void;
    const execute = jest.fn((_command, options) => {
      options.onTraceStarted({
        traceId: completedResult.traceId,
        startedAt: completedResult.startedAt,
      });
      return new Promise<CommandExecutionResult>((resolve) => { resolveExecution = resolve; });
    });
    const harness = createHarness(execute);
    const running = harness.bridge.consumePending();
    await flushPromises();

    await harness.bridge.consumeCancellation('another-request');
    expect(harness.stop).not.toHaveBeenCalled();
    await harness.bridge.consumeCancellation(request.requestId);
    expect(harness.stop).toHaveBeenCalledTimes(1);

    resolveExecution({ ...completedResult, outcome: 'stopped', summary: '已终止。' });
    await running;
    expect(harness.statuses[harness.statuses.length - 1]?.state).toBe('CANCELLED');
  });

  test('maps the request deadline to TIMED_OUT', async () => {
    let resolveExecution!: (result: CommandExecutionResult) => void;
    const execute = jest.fn((_command, options) => {
      options.onTraceStarted({
        traceId: completedResult.traceId,
        startedAt: completedResult.startedAt,
      });
      return new Promise<CommandExecutionResult>((resolve) => { resolveExecution = resolve; });
    });
    const harness = createHarness(execute);
    const running = harness.bridge.consumePending();
    await flushPromises();

    harness.fireTimeout();
    expect(harness.stop).toHaveBeenCalledTimes(1);
    resolveExecution({ ...completedResult, outcome: 'stopped', summary: '已终止。' });
    await running;
    expect(harness.statuses[harness.statuses.length - 1]?.state).toBe('TIMED_OUT');
  });

  test('honors a cancellation persisted before RN becomes ready', async () => {
    const execute = jest.fn();
    const harness = createHarness(execute);
    harness.native.consumePendingEvaluationCancellation.mockResolvedValueOnce(request.requestId);

    await harness.bridge.consumePending();

    expect(execute).not.toHaveBeenCalled();
    expect(harness.statuses.map((status) => status.state)).toEqual(['ACCEPTED', 'CANCELLED']);
  });
});
