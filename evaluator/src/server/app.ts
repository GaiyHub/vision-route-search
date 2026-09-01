import Fastify from 'fastify';
import { ZodError } from 'zod';
import { z } from 'zod';
import { createRunRequestSchema } from './apiTypes.js';
import { DatasetCatalogError, type DatasetCatalog } from './datasetCatalog.js';
import { DatasetError } from '../datasets/loader.js';
import { evaluationDatasetSchema } from '../datasets/schema.js';
import type { EvaluationRuntime } from './runtime.js';
import type { RunManager } from './runManager.js';

export function createApp(dependencies: { datasets: DatasetCatalog; runtime: EvaluationRuntime; runs: RunManager }) {
  const app = Fastify({ logger: false });
  const datasetParams = z.object({ datasetId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/) });

  app.get('/api/health', async () => ({ status: 'ok', runtime: dependencies.runtime.source.toLowerCase() }));
  app.get('/api/devices', async () => ({ devices: await dependencies.runtime.listDevices() }));
  app.get('/api/datasets', async () => ({ datasets: await dependencies.datasets.list() }));
  app.get<{ Params: { datasetId: string } }>('/api/datasets/:datasetId', async (request) => {
    const { datasetId } = datasetParams.parse(request.params);
    const dataset = await dependencies.datasets.get(datasetId);
    if (!dataset) throw new DatasetCatalogError('DATASET_NOT_FOUND', `评测集不存在：${datasetId}`);
    return dataset;
  });
  app.post('/api/datasets', async (request, reply) => {
    const dataset = evaluationDatasetSchema.parse(request.body);
    return reply.code(201).send(await dependencies.datasets.create(dataset));
  });
  app.put<{ Params: { datasetId: string } }>('/api/datasets/:datasetId', async (request) => {
    const { datasetId } = datasetParams.parse(request.params);
    return dependencies.datasets.replace(datasetId, evaluationDatasetSchema.parse(request.body));
  });
  app.delete<{ Params: { datasetId: string } }>('/api/datasets/:datasetId', async (request, reply) => {
    const { datasetId } = datasetParams.parse(request.params);
    await dependencies.datasets.delete(datasetId);
    return reply.code(204).send();
  });
  app.post('/api/runs', async (request, reply) => {
    const input = createRunRequestSchema.parse(request.body);
    return reply.code(202).send(await dependencies.runs.create(input));
  });
  app.get<{ Params: { runId: string } }>('/api/runs/:runId', async (request) => dependencies.runs.get(request.params.runId));
  app.post<{ Params: { runId: string } }>('/api/runs/:runId/cancel', async (request) => dependencies.runs.cancel(request.params.runId));

  app.setErrorHandler((error, _request, reply) => {
    const validation = error instanceof ZodError || error instanceof DatasetError;
    const catalog = error instanceof DatasetCatalogError;
    const message = error instanceof Error ? error.message : '未知服务端错误';
    const status = validation ? 400 : catalog && error.code === 'DATASET_CONFLICT' ? 409 : 404;
    void reply.code(status).send({
      schemaVersion: 1,
      error: {
        code: validation ? 'INVALID_REQUEST' : catalog ? error.code : 'RESOURCE_NOT_FOUND',
        message,
        retryable: false,
      },
    });
  });
  return app;
}
