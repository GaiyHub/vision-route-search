import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatasetCatalog } from './datasetCatalog.js';
import type { EvaluationRuntime } from './mockRuntime.js';
import { evaluationRunSchema, type EvaluationRun, type SampleRun } from './apiTypes.js';
import { readValidatedJson, writeJsonAtomic } from '../storage/atomicFile.js';

export class RunManager {
  private readonly controllers = new Map<string, AbortController>();

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
    const selected = dataset.samples.filter((sample) => sample.enabled && (!input.sampleIds || input.sampleIds.includes(sample.id)));
    if (selected.length === 0) throw new Error('没有可执行的评测样本');
    const now = new Date().toISOString();
    const run = evaluationRunSchema.parse({
      schemaVersion: 1,
      runId: `run-${randomUUID()}`,
      datasetId: dataset.id,
      datasetName: dataset.name,
      deviceSerial: input.deviceSerial,
      source: 'MOCK',
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
    await writeJsonAtomic(this.path(run.runId), run);
    const controller = new AbortController();
    this.controllers.set(run.runId, controller);
    void this.execute(run, dataset, controller).catch(() => undefined);
    return run;
  }

  async get(runId: string): Promise<EvaluationRun> {
    return readValidatedJson(this.path(runId), evaluationRunSchema);
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
        const result = await this.runtime.execute(definition, controller.signal);
        sample.state = result.verdict;
        sample.phase = 'DONE';
        sample.summary = result.summary;
        sample.traceId = result.traceId;
        sample.tokens = result.tokens;
      } catch {
        sample.state = 'CANCELLED';
        sample.phase = 'DONE';
        sample.summary = '运行已由用户取消';
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
