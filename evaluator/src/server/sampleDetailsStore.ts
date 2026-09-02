import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { evalRequestV1Schema, evalStatusV1Schema } from '../contracts/evaluation.js';
import { normalizeEvaluationEvidence } from '../evidence/normalizer.js';
import {
  artifactDescriptorSchema,
  sampleMetricsSchema,
  traceDocumentSchema,
  tracePageSchema,
  type ArtifactDescriptor,
  type SampleMetrics,
  type TraceEvent,
  type TracePage,
} from '../evidence/schema.js';
import { readValidatedJson, writeJsonAtomic } from '../storage/atomicFile.js';
import { evaluationRunSchema, sampleDetailSchema, type SampleDetail, type SampleRun } from './apiTypes.js';

interface ManifestFileMap {
  request: string;
  status: string;
  otel?: string;
  todo?: string;
  trace?: string;
  metrics?: string;
  assertions?: string;
  judge?: string;
}

export class SampleDetailsStore {
  constructor(private readonly dataRoot: string) {}

  async get(runId: string, sampleId: string, attemptId?: string): Promise<SampleDetail> {
    const resolved = await this.resolveSample(runId, sampleId, attemptId);
    await this.ensureNormalized(runId, sampleId, resolved.attemptId);
    const metrics = await this.readMetrics(runId, sampleId, resolved.attemptId);
    const artifacts = await this.listArtifacts(runId, sampleId, resolved.attemptId);
    return sampleDetailSchema.parse({ schemaVersion: 1, runId, sample: resolved.sample, metrics, artifacts });
  }

  async trace(
    runId: string,
    sampleId: string,
    options: { cursor?: string | undefined; limit: number; type?: TraceEvent['type'] | undefined },
    attemptId?: string,
  ): Promise<TracePage> {
    const resolved = await this.resolveSample(runId, sampleId, attemptId);
    await this.ensureNormalized(runId, sampleId, resolved.attemptId);
    const document = await readValidatedJson(this.normalizedPath(runId, sampleId, 'trace.json', resolved.attemptId), traceDocumentSchema);
    const filtered = options.type ? document.events.filter((event) => event.type === options.type) : document.events;
    const offset = decodeCursor(options.cursor);
    if (offset > filtered.length) throw new Error('轨迹 cursor 已失效');
    const events = filtered.slice(offset, offset + options.limit);
    const nextOffset = offset + events.length;
    return tracePageSchema.parse({
      schemaVersion: 1,
      events,
      pagination: {
        cursor: options.cursor ?? null,
        nextCursor: nextOffset < filtered.length ? encodeCursor(nextOffset) : null,
        limit: options.limit,
        totalItems: filtered.length,
      },
    });
  }

  async artifact(runId: string, sampleId: string, artifactId: string, attemptId?: string): Promise<{
    descriptor: ArtifactDescriptor;
    content: Buffer;
  }> {
    const resolved = await this.resolveSample(runId, sampleId, attemptId);
    const descriptor = (await this.listArtifacts(runId, sampleId, resolved.attemptId))
      .find((candidate) => candidate.artifactId === artifactId);
    if (!descriptor) throw new Error(`评测产物不存在：${artifactId}`);
    const path = this.safeArtifactPath(runId, sampleId, descriptor.path, resolved.attemptId);
    return { descriptor, content: await readFile(path) };
  }

  private async resolveSample(runId: string, sampleId: string, attemptId?: string): Promise<{ sample: SampleRun; attemptId?: string }> {
    const run = await readValidatedJson(this.runPath(runId), evaluationRunSchema);
    const sample = run.samples.find((candidate) => candidate.sampleId === sampleId);
    if (!sample) throw new Error(`评测样本不存在：${sampleId}`);
    const resolvedAttemptId = attemptId ?? sample.latestAttemptId;
    if (!resolvedAttemptId) return { sample };
    const attempt = sample.attempts?.find((candidate) => candidate.attemptId === resolvedAttemptId);
    if (!attempt) throw new Error(`样本执行尝试不存在：${resolvedAttemptId}`);
    const { attemptId: selectedAttemptId, attemptNumber: _attemptNumber, ...result } = attempt;
    return {
      sample: { sampleId: sample.sampleId, instruction: sample.instruction, latestAttemptId: selectedAttemptId, attempts: sample.attempts, ...result },
      attemptId: selectedAttemptId,
    };
  }

  private async ensureNormalized(runId: string, sampleId: string, attemptId?: string): Promise<void> {
    try {
      await Promise.all([
        readValidatedJson(this.normalizedPath(runId, sampleId, 'trace.json', attemptId), traceDocumentSchema),
        readValidatedJson(this.normalizedPath(runId, sampleId, 'metrics.json', attemptId), sampleMetricsSchema),
      ]);
      return;
    } catch { /* Derive missing or outdated normalized evidence from immutable raw files. */ }
    let files: ManifestFileMap;
    try { files = (JSON.parse(await readFile(this.normalizedPath(runId, sampleId, 'manifest.json', attemptId), 'utf8')) as { files: ManifestFileMap }).files; }
    catch { return; }
    if (!files?.otel) return;
    const request = evalRequestV1Schema.parse(JSON.parse(await readFile(this.safeArtifactPath(runId, sampleId, files.request, attemptId), 'utf8')));
    const status = evalStatusV1Schema.parse(JSON.parse(await readFile(this.safeArtifactPath(runId, sampleId, files.status, attemptId), 'utf8')));
    const otel = await readFile(this.safeArtifactPath(runId, sampleId, files.otel, attemptId), 'utf8');
    const normalized = normalizeEvaluationEvidence(request, status, otel);
    await Promise.all([
      writeJsonAtomic(this.normalizedPath(runId, sampleId, 'trace.json', attemptId), normalized.trace),
      writeJsonAtomic(this.normalizedPath(runId, sampleId, 'metrics.json', attemptId), normalized.metrics),
    ]);
  }

  private async readMetrics(runId: string, sampleId: string, attemptId?: string): Promise<SampleMetrics | null> {
    try { return await readValidatedJson(this.normalizedPath(runId, sampleId, 'metrics.json', attemptId), sampleMetricsSchema); }
    catch { return null; }
  }

  private async listArtifacts(runId: string, sampleId: string, attemptId?: string): Promise<ArtifactDescriptor[]> {
    let files: ManifestFileMap;
    try { files = (JSON.parse(await readFile(this.normalizedPath(runId, sampleId, 'manifest.json', attemptId), 'utf8')) as { files: ManifestFileMap }).files; }
    catch { return []; }
    const candidates: Array<[string, string | undefined]> = [
      ['request', files.request], ['status', files.status], ['otel', files.otel], ['todo', files.todo],
      ['trace', files.trace ?? 'normalized/trace.json'], ['metrics', files.metrics ?? 'normalized/metrics.json'],
      ['assertions', files.assertions ?? 'normalized/assertions.json'],
      ['judge', files.judge ?? 'normalized/judge.json'],
    ];
    const descriptors: ArtifactDescriptor[] = [];
    for (const [artifactId, path] of candidates) {
      if (!path) continue;
      try {
        const safePath = this.safeArtifactPath(runId, sampleId, path, attemptId);
        const info = await stat(safePath);
        if (!info.isFile()) continue;
        descriptors.push(artifactDescriptorSchema.parse({
          artifactId, path, sizeBytes: info.size, mediaType: mediaType(path),
        }));
      } catch { /* Missing optional artifacts are omitted from the whitelist. */ }
    }
    return descriptors;
  }

  private runPath(runId: string): string { return join(this.dataRoot, 'runs', runId, 'run.json'); }
  private samplePath(runId: string, sampleId: string, attemptId?: string): string {
    const sampleRoot = join(this.dataRoot, 'runs', runId, 'samples', sampleId);
    return attemptId ? join(sampleRoot, 'attempts', attemptId) : sampleRoot;
  }
  private normalizedPath(runId: string, sampleId: string, name: string, attemptId?: string): string {
    return join(this.samplePath(runId, sampleId, attemptId), 'normalized', name);
  }
  private safeArtifactPath(runId: string, sampleId: string, path: string, attemptId?: string): string {
    if (isAbsolute(path)) throw new Error('评测产物路径无效');
    const root = resolve(this.samplePath(runId, sampleId, attemptId));
    const target = resolve(root, path);
    const relation = relative(root, target);
    if (!relation || relation.startsWith('..') || isAbsolute(relation)) throw new Error('评测产物路径越界');
    return target;
  }
}

function encodeCursor(offset: number): string { return Buffer.from(String(offset), 'utf8').toString('base64url'); }
function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^\d+$/.test(decoded)) throw new Error('轨迹 cursor 无效');
  return Number(decoded);
}

function mediaType(path: string): string {
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.jsonl')) return 'application/x-ndjson; charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.xml')) return 'application/xml; charset=utf-8';
  return 'application/octet-stream';
}
