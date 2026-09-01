import { mkdtemp, rm } from 'node:fs/promises';
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
});
