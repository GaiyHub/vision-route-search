import { describe, expect, it, vi } from 'vitest';
import requestFixture from '../../../specs/pc-batch-evaluation/fixtures/eval-request-v1.json' with { type: 'json' };
import statusFixture from '../../../specs/pc-batch-evaluation/fixtures/eval-status-v1.json' with { type: 'json' };
import { EvaluationRunner, type RunnerClock } from '../../src/adb/evaluationRunner.js';
import type { AdbClient } from '../../src/adb/adbClient.js';
import { AdbRunnerError } from '../../src/adb/errors.js';
import { evalRequestV1Schema, evalStatusV1Schema } from '../../src/contracts/evaluation.js';

function fakeClock(): RunnerClock & { time: number } {
  return {
    time: 0,
    now() { return this.time; },
    async sleep(milliseconds) { this.time += milliseconds; },
  };
}

describe('EvaluationRunner', () => {
  it('轮询到终态且不会改变请求身份', async () => {
    const request = evalRequestV1Schema.parse(requestFixture.request);
    const statuses = [undefined, evalStatusV1Schema.parse(statusFixture.statuses[1]), evalStatusV1Schema.parse(statusFixture.statuses[2])];
    const adb = {
      assertRunnableDevice: vi.fn().mockResolvedValue({ serial: 'serial-1' }),
      assertPackageInstalled: vi.fn().mockResolvedValue(undefined),
      submit: vi.fn().mockResolvedValue(undefined),
      readStatus: vi.fn().mockImplementation(async () => statuses.shift()),
      cancel: vi.fn(),
    } as unknown as AdbClient;
    const runner = new EvaluationRunner(adb, { clock: fakeClock(), pollIntervalMs: 100 });
    await expect(runner.run('serial-1', request)).resolves.toMatchObject({ state: 'COMPLETED' });
    expect(adb.submit).toHaveBeenCalledWith('serial-1', request);
    expect(adb.cancel).not.toHaveBeenCalled();
  });

  it('超时后先取消并等待宽限期', async () => {
    const request = evalRequestV1Schema.parse({ ...requestFixture.request, timeoutMs: 1_000 });
    const clock = fakeClock();
    const adb = {
      assertRunnableDevice: vi.fn().mockResolvedValue({ serial: 'serial-1' }),
      assertPackageInstalled: vi.fn().mockResolvedValue(undefined),
      submit: vi.fn().mockResolvedValue(undefined),
      readStatus: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
    } as unknown as AdbClient;
    const runner = new EvaluationRunner(adb, { clock, pollIntervalMs: 250, cancelGraceMs: 500 });
    await expect(runner.run('serial-1', request)).rejects.toMatchObject({ code: 'SAMPLE_TIMEOUT' });
    expect(adb.cancel).toHaveBeenCalledWith('serial-1', request.requestId);
    expect(clock.time).toBe(1_500);
  });

  it('传输重试严格复用同一个不可变请求', async () => {
    const request = evalRequestV1Schema.parse(requestFixture.request);
    const completed = evalStatusV1Schema.parse(statusFixture.statuses[2]);
    const adb = {
      assertRunnableDevice: vi.fn().mockResolvedValue({ serial: 'serial-1' }),
      assertPackageInstalled: vi.fn().mockResolvedValue(undefined),
      submit: vi.fn()
        .mockRejectedValueOnce(new AdbRunnerError('DEVICE_LOST', '瞬时传输失败', true))
        .mockResolvedValueOnce(undefined),
      readStatus: vi.fn().mockResolvedValue(completed),
      cancel: vi.fn(),
    } as unknown as AdbClient;
    const runner = new EvaluationRunner(adb, { clock: fakeClock(), transportRetries: 1 });
    await expect(runner.run('serial-1', request)).resolves.toMatchObject({ state: 'COMPLETED' });
    expect(adb.submit).toHaveBeenNthCalledWith(1, 'serial-1', request);
    expect(adb.submit).toHaveBeenNthCalledWith(2, 'serial-1', request);
  });
});
