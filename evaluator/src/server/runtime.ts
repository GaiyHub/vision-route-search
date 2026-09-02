import type { EvaluationSample } from '../datasets/schema.js';
import type { DeviceInfo, SampleRun } from './apiTypes.js';

export interface SampleExecution {
  summary: string;
  traceId?: string;
  tokens?: { prompt: number; completion: number; total: number; cached?: number | undefined };
  verdict: Extract<SampleRun['state'], 'PASSED' | 'FAILED' | 'BLOCKED' | 'INFRA_ERROR' | 'TIMED_OUT' | 'CANCELLED'>;
  requestId?: string;
  evidence?: {
    collectedAt: string;
    files: { request: string; status: string; otel?: string; todo?: string; trace?: string; metrics?: string };
    warnings: string[];
  };
}

export interface SampleExecutionContext {
  runId: string;
  attemptId?: string;
  deviceSerial: string;
  defaultTimeoutMs: number;
}

export interface EvaluationRuntime {
  readonly source: 'MOCK' | 'ADB';
  listDevices(): Promise<DeviceInfo[]>;
  execute(sample: EvaluationSample, context: SampleExecutionContext, signal: AbortSignal): Promise<SampleExecution>;
}
