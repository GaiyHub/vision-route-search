import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { DatasetCatalog } from '../../src/server/datasetCatalog.js';
import { MockEvaluationRuntime } from '../../src/server/mockRuntime.js';
import { RunManager } from '../../src/server/runManager.js';
import { SampleDetailsStore } from '../../src/server/sampleDetailsStore.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('本地评测 API', () => {
  it('通过 Mock 设备完成评测集到 Run 结果的闭环', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'doupao-webui-'));
    roots.push(dataRoot);
    const datasets = new DatasetCatalog(resolve(process.cwd(), 'datasets'));
    const runtime = new MockEvaluationRuntime(0);
    const runs = new RunManager(dataRoot, datasets, runtime);
    const app = createApp({ datasets, runtime, runs, details: new SampleDetailsStore(dataRoot) });

    const devices = await app.inject({ method: 'GET', url: '/api/devices' });
    expect(devices.json().devices[0]).toMatchObject({ serial: 'mock-pixel-8', state: 'READY', mock: true });
    const created = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { datasetId: 'doupao-smoke', deviceSerial: 'mock-pixel-8' },
    });
    expect(created.statusCode).toBe(202);
    const runId = created.json().runId as string;
    let result = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
    for (let attempt = 0; attempt < 20 && result.json().state !== 'COMPLETED'; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      result = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
    }
    expect(result.json()).toMatchObject({ state: 'COMPLETED', samples: [{ state: 'PASSED' }] });
    await app.close();
  });

  it('通过 API 创建、更新并幂等删除评测集', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doupao-dataset-api-'));
    roots.push(root);
    const datasetDirectory = join(root, 'datasets');
    await mkdir(datasetDirectory);
    await writeFile(join(datasetDirectory, 'seed.json'), JSON.stringify({
      schemaVersion: 1, id: 'seed', name: '初始评测集',
      samples: [{ id: 'answer', instruction: '回答 1', assertions: [{ type: 'outcome', equals: 'complete' }] }],
    }));
    const datasets = new DatasetCatalog(datasetDirectory);
    const runtime = new MockEvaluationRuntime(0);
    const app = createApp({
      datasets, runtime, runs: new RunManager(root, datasets, runtime), details: new SampleDetailsStore(root),
    });
    const createdBody = {
      schemaVersion: 1, id: 'managed', name: '页面创建',
      samples: [{ id: 'sample-1', instruction: '回答 2', assertions: [{ type: 'outcome', equals: 'complete' }] }],
    };

    expect((await app.inject({ method: 'POST', url: '/api/datasets', payload: createdBody })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/datasets', payload: createdBody })).statusCode).toBe(409);
    const updated = await app.inject({
      method: 'PUT', url: '/api/datasets/managed', payload: { ...createdBody, name: '已更新' },
    });
    expect(updated.json().name).toBe('已更新');
    expect((await app.inject({ method: 'DELETE', url: '/api/datasets/managed' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: '/api/datasets/managed' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/datasets/managed' })).statusCode).toBe(404);
    await app.close();
  });

  it('按需读取样本指标、分页轨迹和白名单原始产物', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'doupao-details-api-'));
    roots.push(dataRoot);
    const datasets = new DatasetCatalog(resolve(process.cwd(), 'datasets'));
    const runtime = new MockEvaluationRuntime(0);
    const runs = new RunManager(dataRoot, datasets, runtime);
    const app = createApp({ datasets, runtime, runs, details: new SampleDetailsStore(dataRoot) });
    const created = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { datasetId: 'doupao-smoke', deviceSerial: 'mock-pixel-8' },
    });
    const runId = created.json().runId as string;
    let run = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
    for (let attempt = 0; attempt < 20 && run.json().state !== 'COMPLETED'; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      run = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
    }
    const sampleRoot = join(dataRoot, 'runs', runId, 'samples', 'answer-time');
    await mkdir(join(sampleRoot, 'raw'), { recursive: true });
    await mkdir(join(sampleRoot, 'normalized'), { recursive: true });
    const events = [
      {
        eventId: 'event-000001', sequence: 0, type: 'USER_INPUT',
        occurredAt: '2026-09-02T00:00:00.000Z', source: { artifactId: 'request' }, input: '现在几点？',
      },
      {
        eventId: 'event-000002', sequence: 1, type: 'MODEL_CALL', model: 'doubao',
        occurredAt: '2026-09-02T00:00:00.100Z', durationMs: 500,
        source: { artifactId: 'otel-trace', line: 1 },
        usage: { prompt: 100, completion: 20, total: 120, cached: 80 },
      },
    ];
    await writeFile(join(sampleRoot, 'raw', 'request.json'), '{"instruction":"现在几点？"}\n');
    await writeFile(join(sampleRoot, 'normalized', 'manifest.json'), JSON.stringify({
      files: { request: 'raw/request.json', status: 'raw/status.json', todo: '../../outside.json' },
    }));
    await writeFile(join(sampleRoot, 'normalized', 'trace.json'), JSON.stringify({
      schemaVersion: 1, runId, sampleId: 'answer-time', requestId: 'request-1', traceId: 'trace-1',
      generatedAt: '2026-09-02T00:00:01.000Z', events,
    }));
    await writeFile(join(sampleRoot, 'normalized', 'metrics.json'), JSON.stringify({
      schemaVersion: 1, success: true, verdict: 'PASSED',
      tokenUsage: { prompt: 100, completion: 20, total: 120, cached: 80 },
      stepCount: 0, modelCallCount: 1, toolCallCount: 0,
      cacheHitRate: 0.8, toolSuccessRate: null,
      toolCalls: { succeeded: 0, failed: 0, unknown: 0 },
      durationMs: 600, modelDurationMs: 500, toolDurationMs: null,
      unavailable: ['toolSuccessRate'],
    }));

    const detail = await app.inject({ method: 'GET', url: `/api/runs/${runId}/samples/answer-time` });
    expect(detail.json()).toMatchObject({ metrics: { cacheHitRate: 0.8 } });
    expect(detail.json().artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifactId: 'request' }),
    ]));
    expect(detail.json().artifacts.some((item: { artifactId: string }) => item.artifactId === 'todo')).toBe(false);
    const first = await app.inject({ method: 'GET', url: `/api/runs/${runId}/samples/answer-time/trace?limit=1` });
    expect(first.json()).toMatchObject({ events: [{ type: 'USER_INPUT' }], pagination: { totalItems: 2 } });
    const second = await app.inject({
      method: 'GET',
      url: `/api/runs/${runId}/samples/answer-time/trace?limit=1&cursor=${first.json().pagination.nextCursor}`,
    });
    expect(second.json()).toMatchObject({ events: [{ type: 'MODEL_CALL' }], pagination: { nextCursor: null } });
    const artifact = await app.inject({
      method: 'GET', url: `/api/runs/${runId}/samples/answer-time/artifacts/request`,
    });
    expect(artifact.body).toContain('现在几点');
    await app.close();
  });
});
