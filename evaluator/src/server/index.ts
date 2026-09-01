import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { createApp } from './app.js';
import { AdbClient } from '../adb/adbClient.js';
import { NodeProcessAdapter } from '../adb/processAdapter.js';
import { AdbEvaluationRuntime } from './adbRuntime.js';
import { DatasetCatalog } from './datasetCatalog.js';
import { MockEvaluationRuntime } from './mockRuntime.js';
import { RunManager } from './runManager.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const datasets = new DatasetCatalog(join(root, 'datasets'));
const runtime = process.env.DOUPAO_EVALUATOR_RUNTIME === 'mock'
  ? new MockEvaluationRuntime()
  : new AdbEvaluationRuntime(new AdbClient(new NodeProcessAdapter()));
const runs = new RunManager(process.env.DOUPAO_EVALUATOR_DATA_DIR ?? join(root, '.data'), datasets, runtime);
const app = createApp({ datasets, runtime, runs });
const dist = join(root, 'dist');
try {
  await access(join(dist, 'index.html'));
  await app.register(fastifyStatic, { root: dist, wildcard: false });
  app.get('/*', async (_request, reply) => reply.sendFile('index.html'));
} catch { /* 开发模式由 Vite 托管页面。 */ }
await app.listen({ host: '127.0.0.1', port: 4174 });
console.log(`豆泡评测服务：http://127.0.0.1:4174（${runtime.source}）`);
