import { describe, expect, it, vi } from 'vitest';
import type { AdbClient } from '../../src/adb/adbClient.js';
import type { EvaluationRunner } from '../../src/adb/evaluationRunner.js';
import { hashEvalRequest, type EvalRequestV1, type EvalStatusV1 } from '../../src/contracts/evaluation.js';
import { evaluationSampleSchema } from '../../src/datasets/schema.js';
import { AdbEvaluationRuntime } from '../../src/server/adbRuntime.js';

describe('AdbEvaluationRuntime', () => {
  it('只将安装了兼容评测接口的真机标记为就绪', async () => {
    const adb = {
      listDevices: vi.fn().mockResolvedValue([
        { serial: 'ready', state: 'device', runnable: true, model: 'Pixel_8' },
        { serial: 'offline', state: 'offline', runnable: false, reason: '设备状态：offline' },
      ]),
      readAndroidVersion: vi.fn().mockResolvedValue('15'),
      readPackageVersion: vi.fn().mockResolvedValue('0.1.0'),
      readEvaluationApiVersion: vi.fn().mockResolvedValue(1),
    } as unknown as AdbClient;
    const runtime = new AdbEvaluationRuntime(adb);
    await expect(runtime.listDevices()).resolves.toEqual([
      expect.objectContaining({ serial: 'ready', model: 'Pixel 8', state: 'READY', evaluationApiVersion: 1, mock: false }),
      expect.objectContaining({ serial: 'offline', state: 'OFFLINE', reason: '设备状态：offline', mock: false }),
    ]);
  });

  it('构造不可变请求并映射 APK 完成终态', async () => {
    let submitted: EvalRequestV1 | undefined;
    const completed = {
      schemaVersion: 1,
      requestId: 'placeholder',
      runId: 'run-test',
      sampleId: 'answer-time',
      updatedAt: '2026-09-02T00:00:02.000Z',
      state: 'COMPLETED',
      result: {
        outcome: 'complete',
        summary: '当前时间为 00:00。',
        traceId: 'a'.repeat(32),
        startedAt: '2026-09-02T00:00:00.000Z',
        finishedAt: '2026-09-02T00:00:02.000Z',
        durationMs: 2_000,
        stepCount: 0,
        actionCount: 0,
        tokens: { prompt: 100, completion: 10, total: 110, cached: 80 },
      },
    } satisfies EvalStatusV1;
    const runner = {
      run: vi.fn().mockImplementation(async (_serial: string, request: EvalRequestV1) => {
        submitted = request;
        return { ...completed, requestId: request.requestId };
      }),
    } as unknown as EvaluationRunner;
    const runtime = new AdbEvaluationRuntime({} as AdbClient, runner);
    const sample = evaluationSampleSchema.parse({
      id: 'answer-time',
      instruction: '现在几点？',
      assertions: [{ type: 'outcome', equals: 'complete' }],
    });
    const result = await runtime.execute(sample, {
      runId: 'run-test',
      deviceSerial: 'serial-1',
      defaultTimeoutMs: 30_000,
    }, new AbortController().signal);

    expect(result).toMatchObject({ verdict: 'PASSED', summary: '当前时间为 00:00。', traceId: 'a'.repeat(32) });
    expect(submitted).toMatchObject({ runId: 'run-test', sampleId: 'answer-time', timeoutMs: 30_000 });
    expect(submitted?.requestHash).toBe(hashEvalRequest({
      schemaVersion: 1,
      requestId: submitted!.requestId,
      runId: 'run-test',
      sampleId: 'answer-time',
      instruction: '现在几点？',
      timeoutMs: 30_000,
      conversationMode: 'ISOLATED',
    }));
  });

  it('将 APK 网关错误归类为基础设施错误', async () => {
    const runner = {
      run: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        requestId: 'req-error',
        runId: 'run-test',
        sampleId: 'answer-time',
        updatedAt: '2026-09-02T00:00:00.000Z',
        state: 'ERROR',
        code: 'RUN_ALREADY_ACTIVE',
        message: '当前已有任务在运行',
      }),
    } as unknown as EvaluationRunner;
    const runtime = new AdbEvaluationRuntime({} as AdbClient, runner);
    const sample = evaluationSampleSchema.parse({
      id: 'answer-time',
      instruction: '现在几点？',
      assertions: [{ type: 'outcome', equals: 'complete' }],
    });
    await expect(runtime.execute(sample, {
      runId: 'run-test',
      deviceSerial: 'serial-1',
      defaultTimeoutMs: 30_000,
    }, new AbortController().signal)).resolves.toMatchObject({
      verdict: 'INFRA_ERROR',
      summary: 'RUN_ALREADY_ACTIVE: 当前已有任务在运行',
    });
  });
});
