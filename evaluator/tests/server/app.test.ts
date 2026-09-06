import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { DatasetCatalog } from '../../src/server/datasetCatalog.js';
import { MockEvaluationRuntime } from '../../src/server/mockRuntime.js';
import { RunManager } from '../../src/server/runManager.js';
import { SampleDetailsStore } from '../../src/server/sampleDetailsStore.js';
import { PlanRepository } from '../../src/plans/repository.js';
import { PlanReportStore } from '../../src/reports/planReport.js';
import { JudgeService } from '../../src/judge/service.js';
import type { DeviceMirrorService } from '../../src/server/deviceMirror.js';
import type { MirrorSessionService } from '../../src/mirror/sessionManager.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('本地评测 API', () => {
  it('独立列出安卓设备并返回只读镜像帧', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'doupao-mirror-api-'));
    roots.push(dataRoot);
    const datasets = new DatasetCatalog(resolve(process.cwd(), 'datasets'));
    const runtime = new MockEvaluationRuntime(0);
    const mirror: DeviceMirrorService = {
      listDevices: async () => [{ serial: 'emulator-5554', model: 'Pixel 8', androidVersion: '15', state: 'ONLINE', canMirror: true }],
      captureFrame: async () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    };
    const app = createApp({
      datasets,
      runtime,
      runs: new RunManager(dataRoot, datasets, runtime),
      details: new SampleDetailsStore(dataRoot),
      plans: new PlanRepository(dataRoot, datasets),
      reports: new PlanReportStore(dataRoot),
      mirror,
    });

    const devices = await app.inject({ method: 'GET', url: '/api/android/devices' });
    expect(devices.json()).toMatchObject({ devices: [{ serial: 'emulator-5554', state: 'ONLINE', canMirror: true }] });
    const frame = await app.inject({ method: 'GET', url: '/api/android/devices/emulator-5554/frame' });
    expect(frame.statusCode).toBe(200);
    expect(frame.headers['content-type']).toBe('image/png');
    expect(frame.headers['cache-control']).toContain('no-store');
    await app.close();
  });

  it('创建 WebRTC 镜像订阅、交换 SDP 并释放资源', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'doupao-stream-api-'));
    roots.push(dataRoot);
    const datasets = new DatasetCatalog(resolve(process.cwd(), 'datasets'));
    const runtime = new MockEvaluationRuntime(0);
    const release = vi.fn(async () => undefined);
    const mirrorSessions: MirrorSessionService = {
      create: async (deviceSerial) => ({
        schemaVersion: 1, sessionId: 'mirror-11111111-1111-4111-8111-111111111111',
        subscriptionId: 'subscription-22222222-2222-4222-8222-222222222222', deviceSerial,
        state: 'STREAMING', transport: 'WEBRTC', createdAt: '2026-09-04T00:00:00.000Z', subscriberCount: 1,
      }),
      createPeerConnection: async () => ({
        schemaVersion: 1, peerConnectionId: 'peer-33333333-3333-4333-8333-333333333333',
        answer: { type: 'answer', sdp: 'v=0\r\n' },
      }),
      release,
      close: async () => undefined,
    };
    const app = createApp({
      datasets, runtime, runs: new RunManager(dataRoot, datasets, runtime),
      details: new SampleDetailsStore(dataRoot), plans: new PlanRepository(dataRoot, datasets),
      reports: new PlanReportStore(dataRoot), mirrorSessions,
    });
    const created = await app.inject({ method: 'POST', url: '/api/android/mirror-sessions', payload: { schemaVersion: 1, deviceSerial: 'device-1' } });
    expect(created.statusCode).toBe(201);
    const session = created.json();
    const negotiated = await app.inject({
      method: 'POST', url: `/api/android/mirror-sessions/${session.sessionId}/peer-connections`,
      payload: { schemaVersion: 1, subscriptionId: session.subscriptionId, offer: { type: 'offer', sdp: 'v=0\r\n' } },
    });
    expect(negotiated.statusCode).toBe(201);
    expect(negotiated.json()).toMatchObject({ answer: { type: 'answer' } });
    expect((await app.inject({ method: 'DELETE', url: `/api/android/mirror-sessions/${session.sessionId}/subscriptions/${session.subscriptionId}` })).statusCode).toBe(204);
    expect(release).toHaveBeenCalledWith(session.sessionId, session.subscriptionId);
    await app.close();
  });

  it('通过 Mock 设备完成评测集到 Run 结果的闭环', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'doupao-webui-'));
    roots.push(dataRoot);
    const datasets = new DatasetCatalog(resolve(process.cwd(), 'datasets'));
    const runtime = new MockEvaluationRuntime(0);
    const runs = new RunManager(dataRoot, datasets, runtime);
    const app = createApp({ datasets, runtime, runs, details: new SampleDetailsStore(dataRoot), plans: new PlanRepository(dataRoot, datasets), reports: new PlanReportStore(dataRoot) });

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
    const history = await app.inject({ method: 'GET', url: '/api/runs' });
    expect(history.json()).toMatchObject({ runs: [{ runId, state: 'COMPLETED' }] });
    const retried = await app.inject({
      method: 'POST',
      url: `/api/runs/${runId}/samples/answer-time/retries`,
    });
    expect(retried.statusCode).toBe(409);
    expect(retried.json()).toMatchObject({ error: { code: 'RUN_NOT_RETRYABLE' } });
    await app.close();
  });

  it('以确定性断言而非 Agent 自报完成决定样本结果', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doupao-assert-run-'));
    roots.push(root);
    const datasetDirectory = join(root, 'datasets');
    await mkdir(datasetDirectory);
    await writeFile(join(datasetDirectory, 'assert.json'), JSON.stringify({
      schemaVersion: 1, id: 'assert-run', name: '断言聚合',
      samples: [{ id: 'answer', instruction: '回答问题', assertions: [{ type: 'finalResponse', contains: '不会出现', caseSensitive: true }] }],
    }));
    const datasets = new DatasetCatalog(datasetDirectory);
    const runtime = new MockEvaluationRuntime(0);
    const runs = new RunManager(root, datasets, runtime);
    const app = createApp({ datasets, runtime, runs, details: new SampleDetailsStore(root), plans: new PlanRepository(root, datasets), reports: new PlanReportStore(root) });
    const created = await app.inject({ method: 'POST', url: '/api/runs', payload: { datasetId: 'assert-run', deviceSerial: 'mock-pixel-8' } });
    const runId = created.json().runId as string;
    let run = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
    for (let attempt = 0; attempt < 20 && run.json().state !== 'COMPLETED'; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      run = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
    }
    expect(run.json()).toMatchObject({ samples: [{ state: 'FAILED', assertions: { summary: { failed: 1 } } }] });
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
      datasets, runtime, runs: new RunManager(root, datasets, runtime), details: new SampleDetailsStore(root), plans: new PlanRepository(root, datasets), reports: new PlanReportStore(root),
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

  it('配置并测试 Judge 时不回显 API Key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doupao-judge-api-'));
    roots.push(root);
    const datasets = new DatasetCatalog(resolve(process.cwd(), 'datasets'));
    const runtime = new MockEvaluationRuntime(0);
    const judge = new JudgeService(undefined, async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: 1, verdict: 'PASS', score: 1, reason: '连接正常', evidence: ['finalResponse'] }) } }] }), { status: 200 }));
    const app = createApp({ datasets, runtime, runs: new RunManager(root, datasets, runtime, judge), details: new SampleDetailsStore(root), plans: new PlanRepository(root, datasets), reports: new PlanReportStore(root), judge });
    const configured = await app.inject({ method: 'PUT', url: '/api/judge/config', payload: { baseUrl: 'https://judge.example/v1', model: 'judge-model', timeoutMs: 5000, supportsImages: false, apiKey: 'secret' } });
    expect(configured.json()).toMatchObject({ configured: true, model: 'judge-model', hasApiKey: true });
    expect(configured.body).not.toContain('secret');
    expect((await app.inject({ method: 'POST', url: '/api/judge/test' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/judge/config' })).body).not.toContain('secret');
    await app.close();
  });

  it('通过 API 管理评测计划且不会启动运行', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'doupao-plan-api-'));
    roots.push(dataRoot);
    const datasets = new DatasetCatalog(resolve(process.cwd(), 'datasets'));
    const runtime = new MockEvaluationRuntime(0);
    const runs = new RunManager(dataRoot, datasets, runtime);
    const app = createApp({
      datasets,
      runtime,
      runs,
      details: new SampleDetailsStore(dataRoot),
      plans: new PlanRepository(dataRoot, datasets),
      reports: new PlanReportStore(dataRoot),
    });
    const payload = {
      name: '真机核心回归',
      datasetId: 'doupao-smoke',
      deviceSerial: 'mock-pixel-8',
      sampleIds: ['answer-time'],
      execution: { defaultTimeoutMs: 120_000, continueOnFailure: true },
      judge: { enabled: false },
    };

    const created = await app.inject({ method: 'POST', url: '/api/plans', payload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject(payload);
    const planId = created.json().planId as string;
    expect((await app.inject({ method: 'GET', url: '/api/runs' })).json().runs).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/api/plans/${planId}` })).json()).toMatchObject({ planId });
    const listed = await app.inject({ method: 'GET', url: '/api/plans?limit=1' });
    expect(listed.json()).toMatchObject({ plans: [{ planId }], pagination: { nextCursor: null } });
    const updated = await app.inject({ method: 'PUT', url: `/api/plans/${planId}`, payload: { ...payload, name: '已更新回归' } });
    expect(updated.json()).toMatchObject({ planId, name: '已更新回归', createdAt: created.json().createdAt });
    const invalid = await app.inject({ method: 'POST', url: '/api/plans', payload: { ...payload, sampleIds: ['missing'] } });
    expect(invalid.statusCode).toBe(404);
    expect(invalid.json()).toMatchObject({ error: { code: 'SAMPLE_NOT_FOUND' } });

    const started = await app.inject({ method: 'POST', url: `/api/plans/${planId}/runs` });
    expect(started.statusCode).toBe(202);
    const runId = started.json().runId as string;
    expect(started.json()).toMatchObject({
      planId,
      planSnapshot: { plan: { name: '已更新回归' }, dataset: { id: 'doupao-smoke' } },
      samples: [{ sampleId: 'answer-time', attempts: [{ attemptNumber: 1 }] }],
    });
    let run = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
    for (let attempt = 0; attempt < 20 && run.json().state !== 'COMPLETED'; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      run = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
    }
    const retried = await app.inject({ method: 'POST', url: `/api/runs/${runId}/samples/answer-time/retries` });
    expect(retried.statusCode).toBe(202);
    expect(retried.json().runId).toBe(runId);
    expect(retried.json().samples[0].attempts).toHaveLength(2);
    expect(retried.json().samples[0].attempts[0].state).toBe('PASSED');
    const firstAttemptId = retried.json().samples[0].attempts[0].attemptId as string;
    const firstAttempt = await app.inject({
      method: 'GET',
      url: `/api/runs/${runId}/samples/answer-time/attempts/${firstAttemptId}`,
    });
    expect(firstAttempt.json()).toMatchObject({ sample: { latestAttemptId: firstAttemptId, state: 'PASSED' }, metrics: null });
    let retriedRun = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
    for (let attempt = 0; attempt < 20 && retriedRun.json().state !== 'COMPLETED'; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      retriedRun = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
    }
    const report = await app.inject({ method: 'GET', url: `/api/plans/${planId}/runs/${runId}/report` });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({ planId, runId, summary: { total: 1, passed: 1 }, samples: [{ attemptNumber: 2 }] });
    const planRuns = await app.inject({ method: 'GET', url: `/api/plans/${planId}/runs` });
    expect(planRuns.json()).toMatchObject({ runs: [{ runId, planId }] });
    const deleted = await app.inject({ method: 'DELETE', url: `/api/plans/${planId}` });
    expect(deleted.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/plans/${planId}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/runs/${runId}` })).json()).toMatchObject({ runId, planId });
    await app.close();
  });

  it('按需读取样本指标、分页轨迹和白名单原始产物', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'doupao-details-api-'));
    roots.push(dataRoot);
    const datasets = new DatasetCatalog(resolve(process.cwd(), 'datasets'));
    const runtime = new MockEvaluationRuntime(0);
    const runs = new RunManager(dataRoot, datasets, runtime);
    const app = createApp({ datasets, runtime, runs, details: new SampleDetailsStore(dataRoot), plans: new PlanRepository(dataRoot, datasets), reports: new PlanReportStore(dataRoot) });
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
