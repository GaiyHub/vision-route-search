import { DeviceEventEmitter, NativeModules } from 'react-native';
import { flush as flushTrace } from '../agent/otelLogger';
import {
  CommandExecutionRejectedError,
  processCommand,
  stopAgent,
} from '../agent/agentBridge';
import type { CommandExecutionResult, EvalRequestV1, EvalStatusV1 } from './contracts';
import { parseEvalRequest } from './requestCodec';
import { parseEvalStatus } from './statusCodec';

interface NativeEvaluationModule {
  consumePendingEvaluationRequest(): Promise<string | null>;
  recoverActiveEvaluationRequest?(): Promise<string | null>;
  writeEvaluationStatus(statusJson: string): Promise<boolean>;
  consumePendingEvaluationCancellation(): Promise<string | null>;
  writeEvaluationArtifact?(
    runId: string,
    sampleId: string,
    requestId: string,
    fileName: string,
    content: string,
    append: boolean,
  ): Promise<boolean>;
  waitFor?(delayMs: number): Promise<boolean>;
}

interface EvaluationBridgeDependencies {
  native: NativeEvaluationModule;
  execute: typeof processCommand;
  stop: typeof stopAgent;
  flushTrace: (traceId: string) => Promise<void>;
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
}

type ActiveEvaluation = {
  request: EvalRequestV1;
  traceId?: string;
  cancelRequested: boolean;
  timedOut: boolean;
};

function statusBase(request: EvalRequestV1) {
  return {
    schemaVersion: 1 as const,
    requestId: request.requestId,
    runId: request.runId,
    sampleId: request.sampleId,
    updatedAt: new Date().toISOString(),
  };
}

function artifactDirectory(request: EvalRequestV1): string {
  return 'file:///storage/emulated/0/Android/data/com.watchdog.agent/files/evaluation/'
    + `${request.runId}/${request.sampleId}/${request.requestId}`;
}

/** Serializes native requests into the process-wide single Agent runtime. */
export class EvaluationBridge {
  private active: ActiveEvaluation | null = null;
  private consuming = false;
  private recoveryChecked = false;

  constructor(private readonly dependencies: EvaluationBridgeDependencies) {}

  async consumePending(): Promise<void> {
    if (this.consuming || this.active) return;
    this.consuming = true;
    try {
      while (!this.active) {
        let raw = await this.dependencies.native.consumePendingEvaluationRequest();
        if (!raw && !this.recoveryChecked) {
          this.recoveryChecked = true;
          raw = await this.dependencies.native.recoverActiveEvaluationRequest?.() ?? null;
        }
        if (!raw) return;
        const request = parseEvalRequest(JSON.parse(raw));
        await this.run(request);
      }
    } catch (error) {
      // Native/Kotlin has already persisted a rejection for malformed payloads.
      // A consume failure without a trustworthy request ID cannot be reported.
      console.warn(`[EVALUATION] consume failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.consuming = false;
    }
  }

  async consumeCancellation(requestId?: string): Promise<void> {
    const storedId = await this.dependencies.native.consumePendingEvaluationCancellation();
    const pendingId = requestId ?? storedId;
    if (!pendingId || this.active?.request.requestId !== pendingId) return;
    this.active.cancelRequested = true;
    this.dependencies.stop();
  }

  private async write(status: EvalStatusV1): Promise<void> {
    const validated = parseEvalStatus(status);
    await this.dependencies.native.writeEvaluationStatus(JSON.stringify(validated));
  }

  private async run(request: EvalRequestV1): Promise<void> {
    const active: ActiveEvaluation = {
      request,
      cancelRequested: false,
      timedOut: false,
    };
    this.active = active;
    let statusQueue = Promise.resolve();
    const queueStatus = (status: EvalStatusV1) => {
      statusQueue = statusQueue.then(() => this.write(status));
    };

    queueStatus({ ...statusBase(request), state: 'ACCEPTED' });
    await this.consumeCancellation();
    if (active.cancelRequested) {
      await statusQueue;
      await this.write({
        ...statusBase(request),
        state: 'CANCELLED',
        reason: '收到 PC 端取消请求',
      });
      this.active = null;
      return;
    }
    let settled = false;
    const triggerTimeout = () => {
      if (settled || this.active !== active) return;
      active.timedOut = true;
      this.dependencies.stop();
    };
    const timer = this.dependencies.setTimer(triggerTimeout, request.timeoutMs);
    void this.dependencies.native.waitFor?.(request.timeoutMs)
      .then(triggerTimeout)
      .catch(() => {});
    const pollCancellation = async () => {
      if (!this.dependencies.native.waitFor) return;
      while (!settled && this.active === active) {
        await this.dependencies.native.waitFor(1_000).catch(() => false);
        if (settled || this.active !== active) return;
        await this.consumeCancellation().catch(() => {});
      }
    };
    void pollCancellation();

    try {
      const result = await this.dependencies.execute(request.instruction, {
        source: 'EVALUATION',
        evaluationContext: {
          requestId: request.requestId,
          runId: request.runId,
          sampleId: request.sampleId,
          artifactDirectory: artifactDirectory(request),
          writeArtifact: this.dependencies.native.writeEvaluationArtifact
            ? async (fileName, content, append) => {
                await this.dependencies.native.writeEvaluationArtifact!(
                  request.runId,
                  request.sampleId,
                  request.requestId,
                  fileName,
                  content,
                  append,
                );
              }
            : undefined,
        },
        onTraceStarted: ({ traceId, startedAt }) => {
          active.traceId = traceId;
          queueStatus({
            ...statusBase(request),
            state: 'RUNNING',
            traceId,
            startedAt,
          });
        },
      });
      await statusQueue;
      await this.dependencies.flushTrace(result.traceId);

      if (active.timedOut) {
        await this.write({
          ...statusBase(request),
          state: 'TIMED_OUT',
          traceId: result.traceId,
          reason: '超过样本执行超时时间',
        });
      } else if (active.cancelRequested || result.outcome === 'stopped') {
        await this.write({
          ...statusBase(request),
          state: 'CANCELLED',
          traceId: result.traceId,
          reason: active.cancelRequested ? '收到 PC 端取消请求' : 'Agent 执行已停止',
        });
      } else if (result.outcome === 'blocked') {
        await this.write({ ...statusBase(request), state: 'BLOCKED', result });
      } else if (result.outcome === 'complete') {
        await this.write({ ...statusBase(request), state: 'COMPLETED', result });
      } else if (result.outcome === 'timed_out') {
        await this.write({
          ...statusBase(request),
          state: 'TIMED_OUT',
          traceId: result.traceId,
          reason: result.summary || 'Agent 执行超时',
        });
      } else {
        await this.write({
          ...statusBase(request),
          state: 'ERROR',
          traceId: result.traceId,
          code: 'AGENT_EXECUTION_FAILED',
          message: result.summary || 'Agent 执行失败',
        });
      }
    } catch (error) {
      await statusQueue.catch(() => {});
      await this.write({
        ...statusBase(request),
        state: 'ERROR',
        ...(active.traceId ? { traceId: active.traceId } : {}),
        code: error instanceof CommandExecutionRejectedError
          ? error.code
          : 'EVALUATION_EXECUTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      }).catch(() => {});
    } finally {
      settled = true;
      this.dependencies.clearTimer(timer);
      this.active = null;
    }
  }
}

let stopProductionBridge: (() => void) | null = null;

export function startEvaluationBridge(): () => void {
  if (stopProductionBridge) return stopProductionBridge;
  const native = NativeModules.DeftAgentModule as NativeEvaluationModule | undefined;
  if (!native?.consumePendingEvaluationRequest || !native.writeEvaluationStatus) return () => {};

  const bridge = new EvaluationBridge({
    native,
    execute: processCommand,
    stop: stopAgent,
    flushTrace: (traceId) => flushTrace(traceId),
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (timer) => clearTimeout(timer),
  });
  const requestSubscription = DeviceEventEmitter.addListener(
    'evaluation-request',
    () => void bridge.consumePending(),
  );
  const cancelSubscription = DeviceEventEmitter.addListener(
    'evaluation-cancel',
    (payload: { requestId?: string }) => void bridge.consumeCancellation(payload?.requestId),
  );
  void bridge.consumePending();

  stopProductionBridge = () => {
    requestSubscription.remove();
    cancelSubscription.remove();
    stopProductionBridge = null;
  };
  return stopProductionBridge;
}
