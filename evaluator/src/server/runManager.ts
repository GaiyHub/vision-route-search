import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatasetCatalog } from './datasetCatalog.js';
import type { EvaluationRuntime } from './runtime.js';
import { evaluationRunSchema, type EvaluationRun, type SampleRun } from './apiTypes.js';
import { readValidatedJson, writeJsonAtomic } from '../storage/atomicFile.js';

export class RunManagerError extends Error {
  constructor(
    public readonly code: 'RUN_NOT_RETRYABLE' | 'SAMPLE_NOT_RETRYABLE' | 'DEVICE_BUSY',
    message: string,
  ) {
    super(message);
    this.name = 'RunManagerError';
  }
}

export class RunManager {
  private readonly controllers = new Map<string, AbortController>();
  private readonly activeDeviceSerials = new Set<string>();

  constructor(
    private readonly dataRoot: string,
    private readonly datasets: DatasetCatalog,
    private readonly runtime: EvaluationRuntime,
  ) {}

  private path(runId: string): string {
    return join(this.dataRoot, 'runs', runId, 'run.json');
  }

  async create(input: { datasetId: string; deviceSerial: string; sampleIds?: string[] | undefined }): Promise<EvaluationRun> {
    const dataset = await this.datasets.get(input.datasetId);
    if (!dataset) throw new Error(`评测集不存在：${input.datasetId}`);
    const devices = await this.runtime.listDevices();
    if (!devices.some((device) => device.serial === input.deviceSerial && device.state === 'READY')) {
      throw new Error(`设备未就绪：${input.deviceSerial}`);
    }
    if (this.activeDeviceSerials.has(input.deviceSerial)) {
      throw new RunManagerError('DEVICE_BUSY', `设备已有评测任务在运行：${input.deviceSerial}`);
    }
    const selected = dataset.samples.filter((sample) => sample.enabled && (!input.sampleIds || input.sampleIds.includes(sample.id)));
    if (selected.length === 0) throw new Error('没有可执行的评测样本');
    const now = new Date().toISOString();
    const run = evaluationRunSchema.parse({
      schemaVersion: 1,
      runId: `run-${randomUUID()}`,
      datasetId: dataset.id,
      datasetName: dataset.name,
      deviceSerial: input.deviceSerial,
      source: this.runtime.source,
      state: 'PENDING',
      createdAt: now,
      cancelRequested: false,
      samples: selected.map((sample): SampleRun => ({
        sampleId: sample.id,
        instruction: sample.instruction,
        state: 'PENDING',
        phase: 'QUEUED',
      })),
    });
    this.activeDeviceSerials.add(input.deviceSerial);
    try {
      await writeJsonAtomic(this.path(run.runId), run);
      const controller = new AbortController();
      this.controllers.set(run.runId, controller);
      void this.execute(run, dataset, controller)
        .catch(() => undefined)
        .finally(() => this.activeDeviceSerials.delete(input.deviceSerial));
      return run;
    } catch (error) {
      this.activeDeviceSerials.delete(input.deviceSerial);
      throw error;
    }
  }

  async get(runId: string): Promise<EvaluationRun> {
    return readValidatedJson(this.path(runId), evaluationRunSchema);
  }

  async list(): Promise<EvaluationRun[]> {
    let entries;
    try { entries = await readdir(join(this.dataRoot, 'runs'), { withFileTypes: true }); }
    catch { return []; }
    const runs = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      try { return await this.get(entry.name); }
      catch { return null; }
    }));
    return runs
      .filter((run): run is EvaluationRun => run !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async retrySample(runId: string, sampleId: string): Promise<EvaluationRun> {
    const source = await this.get(runId);
    if (source.state === 'PENDING' || source.state === 'RUNNING') {
      throw new RunManagerError('RUN_NOT_RETRYABLE', '当前批次尚未结束，请结束后重试样本');
    }
    const sample = source.samples.find((candidate) => candidate.sampleId === sampleId);
    if (!sample || sample.state === 'PENDING' || sample.state === 'RUNNING') {
      throw new RunManagerError('SAMPLE_NOT_RETRYABLE', `样本当前不可重试：${sampleId}`);
    }
    return this.create({
      datasetId: source.datasetId,
      deviceSerial: source.deviceSerial,
      sampleIds: [sampleId],
    });
  }

  async cancel(runId: string): Promise<EvaluationRun> {
    const run = await this.get(runId);
    if (run.state === 'COMPLETED' || run.state === 'CANCELLED') return run;
    run.cancelRequested = true;
    await writeJsonAtomic(this.path(runId), run);
    this.controllers.get(runId)?.abort();
    return run;
  }

  private async execute(run: EvaluationRun, dataset: Awaited<ReturnType<DatasetCatalog['get']>>, controller: AbortController): Promise<void> {
    if (!dataset) return;
    run.state = 'RUNNING';
    run.startedAt = new Date().toISOString();
    await writeJsonAtomic(this.path(run.runId), run);
    for (const sample of run.samples) {
      if (controller.signal.aborted) break;
      const definition = dataset.samples.find((candidate) => candidate.id === sample.sampleId);
      if (!definition) continue;
      sample.state = 'RUNNING';
      sample.phase = 'SUBMIT';
      sample.startedAt = new Date().toISOString();
      await writeJsonAtomic(this.path(run.runId), run);
      try {
        const result = await this.runtime.execute(definition, {
          runId: run.runId,
          deviceSerial: run.deviceSerial,
          defaultTimeoutMs: dataset.defaults.timeoutMs,
        }, controller.signal);
        sample.state = result.verdict;
        sample.phase = 'DONE';
        sample.summary = result.summary;
        sample.traceId = result.traceId;
        sample.requestId = result.requestId;
        sample.tokens = result.tokens;
        sample.evidence = result.evidence;
      } catch (error) {
        sample.state = controller.signal.aborted ? 'CANCELLED' : 'INFRA_ERROR';
        sample.phase = 'DONE';
        sample.summary = controller.signal.aborted
          ? '运行已由用户取消'
          : error instanceof Error ? error.message : '评测基础设施异常';
      }
      sample.finishedAt = new Date().toISOString();
      sample.durationMs = Date.parse(sample.finishedAt) - Date.parse(sample.startedAt);
      await writeJsonAtomic(this.path(run.runId), run);
    }
    if (controller.signal.aborted) {
      run.state = 'CANCELLED';
      run.cancelRequested = true;
      for (const sample of run.samples) {
        if (sample.state === 'PENDING') sample.state = 'CANCELLED';
      }
    } else {
      run.state = 'COMPLETED';
    }
    run.finishedAt = new Date().toISOString();
    this.controllers.delete(run.runId);
    await writeJsonAtomic(this.path(run.runId), run);
  }
}
