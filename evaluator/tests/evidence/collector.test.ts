import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdbClient } from '../../src/adb/adbClient.js';
import { evalRequestV1Schema, evalStatusV1Schema, hashEvalRequest } from '../../src/contracts/evaluation.js';
import { EvidenceCollector } from '../../src/evidence/collector.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function fixture() {
  const base = {
    schemaVersion: 1 as const,
    requestId: 'request-1',
    runId: 'run-1',
    sampleId: 'sample-1',
    instruction: '评测任务',
    timeoutMs: 30_000,
    conversationMode: 'ISOLATED' as const,
  };
  const request = evalRequestV1Schema.parse({ ...base, requestHash: hashEvalRequest(base) });
  const traceId = 'a'.repeat(32);
  const status = evalStatusV1Schema.parse({
    schemaVersion: 1,
    requestId: request.requestId,
    runId: request.runId,
    sampleId: request.sampleId,
    updatedAt: '2026-09-02T00:00:01.000Z',
    state: 'COMPLETED',
    result: {
      outcome: 'complete', summary: '完成', traceId,
      startedAt: '2026-09-02T00:00:00.000Z', finishedAt: '2026-09-02T00:00:01.000Z',
      durationMs: 1_000, stepCount: 0, actionCount: 0,
      tokens: { prompt: 10, completion: 2, total: 12 },
    },
  });
  const otel = `${JSON.stringify({
    traceId, spanId: 'b'.repeat(16), parentSpanId: null, name: 'invoke_agent 豆泡',
    endTimeUnixNano: '1',
    attributes: {
      'doupao.source': 'EVALUATION', 'doupao.request_id': request.requestId,
      'doupao.run_id': request.runId, 'doupao.sample_id': request.sampleId,
    },
  })}\n`;
  const todo = JSON.stringify({
    traceId, source: 'EVALUATION', requestId: request.requestId,
    runId: request.runId, sampleId: request.sampleId, todos: [],
  });
  return { request, status, traceId, otel, todo };
}

describe('EvidenceCollector', () => {
  it('校验关联身份并保存不可变 raw 证据', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doupao-evidence-'));
    roots.push(root);
    const { request, status, traceId, otel, todo } = fixture();
    const artifacts = new Map([
      ['request.json', JSON.stringify(request)], ['status.json', JSON.stringify(status)],
      [`otel-${traceId}.jsonl`, otel], [`todo-${traceId}.json`, todo],
    ]);
    const adb = { readEvaluationArtifact: vi.fn(async (_serial, _request, name) => artifacts.get(name)) } as unknown as AdbClient;
    const collector = new EvidenceCollector(adb, root);
    const manifest = await collector.collect('serial-1', request, status);
    expect(manifest).toMatchObject({ requestId: 'request-1', traceId, warnings: [] });
    const raw = join(root, 'runs', 'run-1', 'samples', 'sample-1', 'raw');
    await expect(readFile(join(raw, `otel-${traceId}.jsonl`), 'utf8')).resolves.toBe(otel);
    await expect(collector.collect('serial-1', request, status)).resolves.toMatchObject({ traceId });
  });

  it('拒绝与请求不一致的 OTel 身份', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doupao-evidence-'));
    roots.push(root);
    const { request, status, traceId, otel, todo } = fixture();
    const artifacts = new Map([
      ['request.json', JSON.stringify(request)], ['status.json', JSON.stringify(status)],
      [`otel-${traceId}.jsonl`, otel.replace('request-1', 'request-other')],
      [`todo-${traceId}.json`, todo],
    ]);
    const adb = { readEvaluationArtifact: vi.fn(async (_serial, _request, name) => artifacts.get(name)) } as unknown as AdbClient;
    await expect(new EvidenceCollector(adb, root).collect('serial-1', request, status)).rejects.toMatchObject({
      code: 'EVIDENCE_CORRELATION_INVALID',
    });
  });
});
