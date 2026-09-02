import { randomUUID } from 'node:crypto';
import { AdbClient } from '../adb/adbClient.js';
import { EvaluationRunner } from '../adb/evaluationRunner.js';
import { evalRequestV1Schema, hashEvalRequest, type EvalStatusV1 } from '../contracts/evaluation.js';
import type { EvaluationSample } from '../datasets/schema.js';
import type { DeviceInfo } from './apiTypes.js';
import type { EvidenceCollector } from '../evidence/collector.js';
import type { EvaluationRuntime, SampleExecution, SampleExecutionContext } from './runtime.js';

export class AdbEvaluationRuntime implements EvaluationRuntime {
  readonly source = 'ADB' as const;
  private readonly runner: EvaluationRunner;

  constructor(
    private readonly adb: AdbClient,
    runner?: EvaluationRunner,
    private readonly evidenceCollector?: EvidenceCollector,
  ) {
    this.runner = runner ?? new EvaluationRunner(adb);
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const devices = await this.adb.listDevices();
    return Promise.all(devices.map(async (device): Promise<DeviceInfo> => {
      const base = {
        serial: device.serial,
        model: (device.model ?? device.device ?? 'Android 设备').replaceAll('_', ' '),
        androidVersion: '未知',
        mock: false,
      };
      if (device.state !== 'device') {
        return {
          ...base,
          state: device.state === 'unauthorized' ? 'UNAUTHORIZED' : 'OFFLINE',
          ...(device.reason ? { reason: device.reason } : {}),
        };
      }
      const [androidVersion, doupaoVersion, evaluationApiVersion] = await Promise.all([
        this.adb.readAndroidVersion(device.serial),
        this.adb.readPackageVersion(device.serial),
        this.adb.readEvaluationApiVersion(device.serial),
      ]);
      const ready = Boolean(doupaoVersion && evaluationApiVersion === 1);
      return {
        ...base,
        androidVersion,
        state: ready ? 'READY' : 'OFFLINE',
        ...(doupaoVersion ? { doupaoVersion } : {}),
        ...(evaluationApiVersion ? { evaluationApiVersion } : {}),
        ...(!ready ? { reason: doupaoVersion ? '豆泡评测接口不可用' : '未安装豆泡' } : {}),
      };
    }));
  }

  async execute(
    sample: EvaluationSample,
    context: SampleExecutionContext,
    signal: AbortSignal,
  ): Promise<SampleExecution> {
    const requestWithoutHash = {
      schemaVersion: 1 as const,
      requestId: `req-${randomUUID()}`,
      runId: context.runId,
      sampleId: sample.id,
      instruction: sample.instruction,
      timeoutMs: sample.timeoutMs ?? context.defaultTimeoutMs,
      conversationMode: 'ISOLATED' as const,
    };
    const request = evalRequestV1Schema.parse({
      ...requestWithoutHash,
      requestHash: hashEvalRequest(requestWithoutHash),
    });
    const status = await this.runner.run(context.deviceSerial, request, signal);
    const evidence = await this.evidenceCollector?.collect(context.deviceSerial, request, status, context.attemptId);
    return {
      ...mapStatus(status),
      requestId: request.requestId,
      ...(evidence ? {
        evidence: {
          collectedAt: evidence.collectedAt,
          files: evidence.files,
          warnings: evidence.warnings,
        },
      } : {}),
    };
  }
}

function mapStatus(status: EvalStatusV1): SampleExecution {
  if (status.state === 'COMPLETED' || status.state === 'BLOCKED') {
    return {
      verdict: status.state === 'COMPLETED' ? 'PASSED' : 'BLOCKED',
      summary: status.result.summary,
      traceId: status.result.traceId,
      tokens: status.result.tokens,
    };
  }
  if (status.state === 'TIMED_OUT') {
    return { verdict: 'TIMED_OUT', summary: status.reason, ...(status.traceId ? { traceId: status.traceId } : {}) };
  }
  if (status.state === 'CANCELLED') {
    return { verdict: 'CANCELLED', summary: status.reason, ...(status.traceId ? { traceId: status.traceId } : {}) };
  }
  if (status.state === 'ERROR') {
    return { verdict: 'INFRA_ERROR', summary: `${status.code}: ${status.message}`, ...(status.traceId ? { traceId: status.traceId } : {}) };
  }
  throw new Error(`评测请求返回非终态：${status.state}`);
}
