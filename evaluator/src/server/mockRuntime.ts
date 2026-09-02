import { randomUUID } from 'node:crypto';
import type { EvaluationSample } from '../datasets/schema.js';
import type { DeviceInfo } from './apiTypes.js';
import type { EvaluationRuntime, SampleExecution } from './runtime.js';

export class MockEvaluationRuntime implements EvaluationRuntime {
  readonly source = 'MOCK' as const;

  constructor(private readonly phaseDelayMs = 350) {}

  async listDevices(): Promise<DeviceInfo[]> {
    return [{
      serial: 'mock-pixel-8',
      model: 'Pixel 8（Mock）',
      androidVersion: '15',
      state: 'READY',
      doupaoVersion: 'mock-1.0.0',
      evaluationApiVersion: 1,
      mock: true,
    }];
  }

  async execute(sample: EvaluationSample, _context: unknown, signal: AbortSignal): Promise<SampleExecution> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.phaseDelayMs);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('运行已取消'));
      }, { once: true });
    });
    const completion = sample.instruction.includes('几点') ? '当前时间为 20:30。' : `已完成：${sample.instruction}`;
    return {
      summary: completion,
      traceId: randomUUID().replaceAll('-', ''),
      tokens: { prompt: 128, completion: 24, total: 152, cached: 64 },
      verdict: 'PASSED',
      agentOutcome: 'complete',
      durationMs: this.phaseDelayMs,
      stepCount: 1,
    };
  }
}
