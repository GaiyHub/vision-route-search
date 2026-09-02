import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { AdbClient } from '../adb/adbClient.js';
import { InfrastructureError } from '../contracts/errors.js';
import {
  evalRequestV1Schema,
  evalStatusV1Schema,
  type EvalRequestV1,
  type EvalStatusV1,
} from '../contracts/evaluation.js';
import { writeJsonAtomic } from '../storage/atomicFile.js';
import { normalizeEvaluationEvidence } from './normalizer.js';

export interface EvidenceManifest {
  schemaVersion: 1;
  requestId: string;
  runId: string;
  sampleId: string;
  traceId?: string;
  collectedAt: string;
  files: { request: string; status: string; otel?: string; todo?: string; trace?: string; metrics?: string; assertions?: string };
  warnings: string[];
}

export class EvidenceCollector {
  constructor(private readonly adb: AdbClient, private readonly dataRoot: string) {}

  async collect(serial: string, request: EvalRequestV1, terminalStatus: EvalStatusV1, attemptId?: string): Promise<EvidenceManifest> {
    const sampleDirectory = attemptId
      ? join(this.dataRoot, 'runs', request.runId, 'samples', request.sampleId, 'attempts', attemptId)
      : join(this.dataRoot, 'runs', request.runId, 'samples', request.sampleId);
    const rawDirectory = join(sampleDirectory, 'raw');
    const normalizedDirectory = join(sampleDirectory, 'normalized');
    const requestRaw = await this.requireArtifact(serial, request, 'request.json');
    const statusRaw = await this.requireArtifact(serial, request, 'status.json');
    const storedRequest = evalRequestV1Schema.parse(JSON.parse(requestRaw));
    const storedStatus = evalStatusV1Schema.parse(JSON.parse(statusRaw));
    this.assertRequestIdentity(request, storedRequest);
    this.assertStatusIdentity(request, terminalStatus, storedStatus);

    const warnings: string[] = [];
    const files: EvidenceManifest['files'] = { request: 'raw/request.json', status: 'raw/status.json' };
    await writeImmutable(join(rawDirectory, 'request.json'), requestRaw);
    await writeImmutable(join(rawDirectory, 'status.json'), statusRaw);

    const traceId = traceIdOf(storedStatus);
    if (traceId) {
      const otelName = `otel-${traceId}.jsonl`;
      const otelRaw = await this.requireArtifact(serial, request, otelName);
      validateOtel(otelRaw, request, traceId);
      await writeImmutable(join(rawDirectory, otelName), otelRaw);
      files.otel = `raw/${otelName}`;
      const normalized = normalizeEvaluationEvidence(request, storedStatus, otelRaw);
      await writeJsonAtomic(join(normalizedDirectory, 'trace.json'), normalized.trace);
      await writeJsonAtomic(join(normalizedDirectory, 'metrics.json'), normalized.metrics);
      files.trace = 'normalized/trace.json';
      files.metrics = 'normalized/metrics.json';

      const todoName = `todo-${traceId}.json`;
      const todoRaw = await this.adb.readEvaluationArtifact(serial, request, todoName, true);
      if (todoRaw === undefined) {
        warnings.push('Todo 证据不存在');
      } else {
        validateTodo(todoRaw, request, traceId);
        await writeImmutable(join(rawDirectory, todoName), todoRaw);
        files.todo = `raw/${todoName}`;
      }
    } else {
      warnings.push('终态不包含 traceId，未采集 OTel/Todo');
    }

    const manifest: EvidenceManifest = {
      schemaVersion: 1,
      requestId: request.requestId,
      runId: request.runId,
      sampleId: request.sampleId,
      ...(traceId ? { traceId } : {}),
      collectedAt: new Date().toISOString(),
      files,
      warnings,
    };
    await writeJsonAtomic(join(normalizedDirectory, 'manifest.json'), manifest);
    return manifest;
  }

  private async requireArtifact(serial: string, request: EvalRequestV1, fileName: string): Promise<string> {
    const content = await this.adb.readEvaluationArtifact(serial, request, fileName);
    if (content === undefined) throw new InfrastructureError('EVIDENCE_MISSING', `评测证据缺失：${fileName}`, false);
    return content;
  }

  private assertRequestIdentity(expected: EvalRequestV1, actual: EvalRequestV1): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new InfrastructureError('EVIDENCE_CORRELATION_INVALID', 'request.json 与提交请求不一致', false);
    }
  }

  private assertStatusIdentity(request: EvalRequestV1, expected: EvalStatusV1, actual: EvalStatusV1): void {
    if (actual.requestId !== request.requestId || actual.runId !== request.runId || actual.sampleId !== request.sampleId
      || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new InfrastructureError('EVIDENCE_CORRELATION_INVALID', 'status.json 关联身份或终态不一致', false);
    }
  }
}

function traceIdOf(status: EvalStatusV1): string | undefined {
  if (status.state === 'COMPLETED' || status.state === 'BLOCKED') return status.result.traceId;
  if (status.state === 'TIMED_OUT' || status.state === 'CANCELLED' || status.state === 'ERROR') return status.traceId;
  return undefined;
}

function validateOtel(raw: string, request: EvalRequestV1, traceId: string): void {
  const lines = raw.trim().split('\n').filter(Boolean);
  if (lines.length === 0 || lines.length > 20_000) throw invalidEvidence('OTel 行数无效');
  const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  if (records.some((record) => record.traceId !== traceId)) throw invalidEvidence('OTel traceId 不一致');
  const root = records.find((record) => record.parentSpanId === null && record.name === 'invoke_agent 豆泡');
  const attributes = root?.attributes as Record<string, unknown> | undefined;
  if (!root?.endTimeUnixNano
    || attributes?.['doupao.source'] !== 'EVALUATION'
    || attributes?.['doupao.request_id'] !== request.requestId
    || attributes?.['doupao.run_id'] !== request.runId
    || attributes?.['doupao.sample_id'] !== request.sampleId) {
    throw invalidEvidence('OTel 根 Span 不完整或关联身份不一致');
  }
}

function validateTodo(raw: string, request: EvalRequestV1, traceId: string): void {
  const todo = JSON.parse(raw) as Record<string, unknown>;
  if (todo.traceId !== traceId || todo.source !== 'EVALUATION' || todo.requestId !== request.requestId
    || todo.runId !== request.runId || todo.sampleId !== request.sampleId) {
    throw invalidEvidence('Todo 关联身份不一致');
  }
}

function invalidEvidence(message: string): InfrastructureError {
  return new InfrastructureError('EVIDENCE_CORRELATION_INVALID', message, false);
}

async function writeImmutable(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, 'wx', 0o600);
    try { await handle.writeFile(content); } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (await readFile(path, 'utf8') !== content) {
      throw new InfrastructureError('EVIDENCE_IMMUTABLE_CONFLICT', `原始证据不可覆盖：${relative(process.cwd(), path)}`, false);
    }
  }
}
