import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { DatasetCatalog } from '../../src/server/datasetCatalog.js';
import { MockEvaluationRuntime } from '../../src/server/mockRuntime.js';
import { RunManager } from '../../src/server/runManager.js';

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
    const app = createApp({ datasets, runtime, runs });

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
    const app = createApp({ datasets, runtime, runs: new RunManager(root, datasets, runtime) });
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
});
