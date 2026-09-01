import type { EvalRequestV1, EvalStatusV1 } from '../contracts/evaluation.js';
import { AdbRunnerError } from './errors.js';
import type { AdbClient } from './adbClient.js';

export interface RunnerClock {
  now(): number;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

const systemClock: RunnerClock = {
  now: () => Date.now(),
  sleep: async (milliseconds, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new Error('等待已取消'));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  }),
};

const TERMINAL_STATES = new Set<EvalStatusV1['state']>(['COMPLETED', 'BLOCKED', 'TIMED_OUT', 'CANCELLED', 'ERROR']);

export interface EvaluationRunnerOptions {
  pollIntervalMs?: number;
  cancelGraceMs?: number;
  transportRetries?: number;
  clock?: RunnerClock;
}

export class EvaluationRunner {
  private readonly pollIntervalMs: number;
  private readonly cancelGraceMs: number;
  private readonly transportRetries: number;
  private readonly clock: RunnerClock;

  constructor(private readonly adb: AdbClient, options: EvaluationRunnerOptions = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.cancelGraceMs = options.cancelGraceMs ?? 5_000;
    this.transportRetries = options.transportRetries ?? 1;
    this.clock = options.clock ?? systemClock;
  }

  async run(serial: string, request: EvalRequestV1, signal?: AbortSignal): Promise<EvalStatusV1> {
    await this.adb.assertRunnableDevice(serial);
    await this.adb.assertPackageInstalled(serial);
    await this.submitWithRetry(serial, request);
    const deadline = this.clock.now() + request.timeoutMs;

    while (this.clock.now() < deadline) {
      if (signal?.aborted) {
        await this.adb.cancel(serial, request.requestId);
        throw new AdbRunnerError('REQUEST_REJECTED', '评测运行已取消', false);
      }
      const status = await this.adb.readStatus(serial, request);
      if (status && TERMINAL_STATES.has(status.state)) return status;
      try {
        await this.clock.sleep(Math.min(this.pollIntervalMs, Math.max(0, deadline - this.clock.now())), signal);
      } catch (error) {
        if (!signal?.aborted) throw error;
        await this.adb.cancel(serial, request.requestId);
        throw new AdbRunnerError('REQUEST_REJECTED', '评测运行已取消', false, undefined, error);
      }
    }

    await this.adb.cancel(serial, request.requestId);
    const graceDeadline = this.clock.now() + this.cancelGraceMs;
    while (this.clock.now() < graceDeadline) {
      const status = await this.adb.readStatus(serial, request);
      if (status && TERMINAL_STATES.has(status.state)) {
        throw new AdbRunnerError('SAMPLE_TIMEOUT', `样本执行超过 ${request.timeoutMs}ms`, false, {
          requestId: request.requestId,
          terminalStatus: status,
        });
      }
      await this.clock.sleep(Math.min(this.pollIntervalMs, Math.max(0, graceDeadline - this.clock.now())));
    }
    throw new AdbRunnerError('SAMPLE_TIMEOUT', `样本执行超过 ${request.timeoutMs}ms`, false, { requestId: request.requestId });
  }

  private async submitWithRetry(serial: string, request: EvalRequestV1): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.transportRetries; attempt += 1) {
      try {
        await this.adb.submit(serial, request);
        return;
      } catch (error) {
        lastError = error;
        if (!(error instanceof AdbRunnerError) || !error.retryable || attempt === this.transportRetries) throw error;
      }
    }
    throw lastError;
  }
}
