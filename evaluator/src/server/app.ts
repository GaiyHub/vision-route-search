import Fastify from 'fastify';
import { ZodError } from 'zod';
import { createRunRequestSchema } from './apiTypes.js';
import type { DatasetCatalog } from './datasetCatalog.js';
import type { EvaluationRuntime } from './runtime.js';
import type { RunManager } from './runManager.js';

export function createApp(dependencies: { datasets: DatasetCatalog; runtime: EvaluationRuntime; runs: RunManager }) {
  const app = Fastify({ logger: false });

  app.get('/api/health', async () => ({ status: 'ok', runtime: dependencies.runtime.source.toLowerCase() }));
  app.get('/api/devices', async () => ({ devices: await dependencies.runtime.listDevices() }));
  app.get('/api/datasets', async () => ({ datasets: await dependencies.datasets.list() }));
  app.post('/api/runs', async (request, reply) => {
    const input = createRunRequestSchema.parse(request.body);
    return reply.code(202).send(await dependencies.runs.create(input));
  });
  app.get<{ Params: { runId: string } }>('/api/runs/:runId', async (request) => dependencies.runs.get(request.params.runId));
  app.post<{ Params: { runId: string } }>('/api/runs/:runId/cancel', async (request) => dependencies.runs.cancel(request.params.runId));

  app.setErrorHandler((error, _request, reply) => {
    const validation = error instanceof ZodError;
    const message = error instanceof Error ? error.message : '未知服务端错误';
    void reply.code(validation ? 400 : 404).send({
      schemaVersion: 1,
      error: {
        code: validation ? 'INVALID_REQUEST' : 'RESOURCE_NOT_FOUND',
        message,
        retryable: false,
      },
    });
  });
  return app;
}
