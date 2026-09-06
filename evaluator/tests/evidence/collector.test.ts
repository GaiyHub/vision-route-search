import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
      durationMs: 1_000, stepCount: 1, actionCount: 1,
      tokens: { prompt: 100, completion: 20, total: 120, cached: 80 },
    },
  });
  const model = {
    traceId, spanId: 'c'.repeat(16), parentSpanId: 'b'.repeat(16), name: 'chat doubao',
    startTimeUnixNano: '1788307200100000000', endTimeUnixNano: '1788307200600000000',
    attributes: {
      'gen_ai.operation.name': 'chat', 'gen_ai.request.model': 'doubao',
      'gen_ai.provider.name': 'openai_compatible', 'doupao.agent.round': 1, 'doupao.agent.step': 0,
      'gen_ai.input.messages': JSON.stringify([{ role: 'user', content: [{ type: 'text', text: '评测任务' }] }]),
      'gen_ai.output.messages': JSON.stringify({ content: [{ type: 'tool_call', name: 'wait', arguments: { ms: 100 } }] }),
      'gen_ai.usage.input_tokens': 100, 'gen_ai.usage.output_tokens': 20,
      'gen_ai.usage.cache_read.input_tokens': 80,
    },
    status: { code: 'UNSET' },
  };
  const tool = {
    traceId, spanId: 'd'.repeat(16), parentSpanId: 'b'.repeat(16), name: 'execute_tool wait',
    startTimeUnixNano: '1788307200700000000', endTimeUnixNano: '1788307200800000000',
    attributes: {
      'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'wait',
      'doupao.agent.step': 1, 'gen_ai.tool.call.arguments': JSON.stringify({ ms: 100 }),
      'gen_ai.tool.call.result': JSON.stringify({ ok: true }),
    },
    status: { code: 'UNSET' },
  };
  const root = {
    traceId, spanId: 'b'.repeat(16), parentSpanId: null, name: 'invoke_agent 豆泡',
    startTimeUnixNano: '1788307200000000000', endTimeUnixNano: '1788307201000000000',
    attributes: {
      'doupao.source': 'EVALUATION', 'doupao.request_id': request.requestId,
      'doupao.run_id': request.runId, 'doupao.sample_id': request.sampleId,
    },
    events: [{ name: 'thinking', timeUnixNano: '1788307200650000000', attributes: { 'doupao.content': '准备等待' } }],
  };
  const otel = `${[model, tool, root].map((record) => JSON.stringify(record)).join('\n')}\n`;
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
    const adb = {
      readEvaluationArtifact: vi.fn(async (_serial, _request, name) => artifacts.get(name)),
      pullEvaluationArtifact: vi.fn(async (_serial, _request, name, destination) => writeFile(destination, artifacts.get(name)!)),
      captureScreenshot: vi.fn(async () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      dumpUiHierarchy: vi.fn(async () => '<?xml version="1.0"?><hierarchy text="完成"/>'),
      readForegroundActivity: vi.fn(async () => ({ packageName: 'com.example.app', activityName: '.MainActivity' })),
    } as unknown as AdbClient;
    const collector = new EvidenceCollector(adb, root);
    const manifest = await collector.collect('serial-1', request, status);
    expect(manifest).toMatchObject({ requestId: 'request-1', traceId, warnings: [] });
    const raw = join(root, 'runs', 'run-1', 'samples', 'sample-1', 'raw');
    await expect(readFile(join(raw, `otel-${traceId}.jsonl`), 'utf8')).resolves.toBe(otel);
    const normalized = join(root, 'runs', 'run-1', 'samples', 'sample-1', 'normalized');
    const trace = JSON.parse(await readFile(join(normalized, 'trace.json'), 'utf8'));
    expect(trace.events.map((event: { type: string }) => event.type)).toEqual([
      'USER_INPUT', 'MODEL_CALL', 'AGENT_EVENT', 'TOOL_CALL',
    ]);
    const metrics = JSON.parse(await readFile(join(normalized, 'metrics.json'), 'utf8'));
    expect(metrics).toMatchObject({
      success: true, stepCount: 1, modelCallCount: 1, toolCallCount: 1,
      cacheHitRate: 0.8, toolSuccessRate: 1,
    });
    await expect(readFile(join(raw, 'final-screenshot.png'))).resolves.toHaveLength(8);
    await expect(readFile(join(raw, 'ui-hierarchy.xml'), 'utf8')).resolves.toContain('完成');
    await expect(readFile(join(normalized, 'device-state.json'), 'utf8')).resolves.toContain('com.example.app');
    await expect(collector.collect('serial-1', request, status)).resolves.toMatchObject({ traceId });
    const attemptId = 'attempt-11111111-1111-4111-8111-111111111111';
    await collector.collect('serial-1', request, status, attemptId);
    await expect(readFile(join(root, 'runs', 'run-1', 'samples', 'sample-1', 'attempts', attemptId, 'raw', 'request.json'), 'utf8'))
      .resolves.toBe(JSON.stringify(request));
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
    const adb = {
      readEvaluationArtifact: vi.fn(async (_serial, _request, name) => artifacts.get(name)),
      pullEvaluationArtifact: vi.fn(async (_serial, _request, name, destination) => writeFile(destination, artifacts.get(name)!)),
    } as unknown as AdbClient;
    await expect(new EvidenceCollector(adb, root).collect('serial-1', request, status)).rejects.toMatchObject({
      code: 'EVIDENCE_CORRELATION_INVALID',
    });
  });
});
