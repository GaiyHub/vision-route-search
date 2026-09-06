import Fastify from 'fastify';
import { ZodError } from 'zod';
import { z } from 'zod';
import { createRunRequestSchema } from './apiTypes.js';
import { DatasetCatalogError, type DatasetCatalog } from './datasetCatalog.js';
import { DatasetError } from '../datasets/loader.js';
import { evaluationDatasetSchema } from '../datasets/schema.js';
import type { EvaluationRuntime } from './runtime.js';
import { RunManagerError, type RunManager } from './runManager.js';
import type { SampleDetailsStore } from './sampleDetailsStore.js';
import { PlanRepositoryError, type PlanRepository } from '../plans/repository.js';
import { createEvaluationPlanSchema, planIdSchema } from '../plans/schema.js';
import { PlanReportStoreError, type PlanReportStore } from '../reports/planReport.js';
import { judgeConfigInputSchema } from '../judge/schema.js';
import type { JudgeService } from '../judge/service.js';
import { DeviceMirrorError, type DeviceMirrorService } from './deviceMirror.js';
import {
  createMirrorPeerConnectionRequestSchema,
  createMirrorSessionRequestSchema,
  mirrorSessionIdSchema,
  mirrorSubscriptionIdSchema,
} from '../mirror/schema.js';
import { MirrorSessionError, type MirrorSessionService } from '../mirror/sessionManager.js';

export function createApp(dependencies: { datasets: DatasetCatalog; runtime: EvaluationRuntime; runs: RunManager; details: SampleDetailsStore; plans: PlanRepository; reports: PlanReportStore; judge?: JudgeService; mirror?: DeviceMirrorService; mirrorSessions?: MirrorSessionService }) {
  const app = Fastify({ logger: false });
  const datasetParams = z.object({ datasetId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/) });
  const runSampleParams = z.object({
    runId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    sampleId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  });
  const artifactParams = runSampleParams.extend({
    artifactId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  });
  const attemptParams = runSampleParams.extend({
    attemptId: z.string().regex(/^attempt-[0-9a-f-]{36}$/i),
  });
  const attemptArtifactParams = attemptParams.extend({
    artifactId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  });
  const traceQuery = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    type: z.enum(['USER_INPUT', 'MODEL_CALL', 'TOOL_CALL', 'AGENT_EVENT']).optional(),
  });
  const planParams = z.object({ planId: planIdSchema });
  const planListQuery = z.object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });
  const mirrorDeviceParams = z.object({ serial: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/) });
  const mirrorSessionParams = z.object({ sessionId: mirrorSessionIdSchema });
  const mirrorSubscriptionParams = mirrorSessionParams.extend({ subscriptionId: mirrorSubscriptionIdSchema });

  app.get('/api/health', async () => ({ status: 'ok', runtime: dependencies.runtime.source.toLowerCase() }));
  app.get('/api/devices', async () => ({ devices: await dependencies.runtime.listDevices() }));
  app.get('/api/android/devices', async () => ({ devices: await dependencies.mirror?.listDevices() ?? [] }));
  app.get<{ Params: { serial: string } }>('/api/android/devices/:serial/frame', async (request, reply) => {
    if (!dependencies.mirror) throw new DeviceMirrorError('DEVICE_NOT_MIRRORABLE', '当前运行环境未启用真机镜像');
    const { serial } = mirrorDeviceParams.parse(request.params);
    const frame = await dependencies.mirror.captureFrame(serial);
    return reply
      .header('cache-control', 'no-store, no-cache, must-revalidate')
      .header('pragma', 'no-cache')
      .type('image/png')
      .send(frame);
  });
  app.post('/api/android/mirror-sessions', async (request, reply) => {
    if (!dependencies.mirrorSessions) throw new MirrorSessionError('CAPTURE_FAILED', '当前运行环境未启用实时视频流');
    const input = createMirrorSessionRequestSchema.parse(request.body);
    return reply.code(201).send(await dependencies.mirrorSessions.create(input.deviceSerial, input.clientId));
  });
  app.post<{ Params: { sessionId: string } }>('/api/android/mirror-sessions/:sessionId/peer-connections', async (request, reply) => {
    if (!dependencies.mirrorSessions) throw new MirrorSessionError('CAPTURE_FAILED', '当前运行环境未启用实时视频流');
    const { sessionId } = mirrorSessionParams.parse(request.params);
    const input = createMirrorPeerConnectionRequestSchema.parse(request.body);
    return reply.code(201).send(await dependencies.mirrorSessions.createPeerConnection(sessionId, input));
  });
  app.delete<{ Params: { sessionId: string; subscriptionId: string } }>('/api/android/mirror-sessions/:sessionId/subscriptions/:subscriptionId', async (request, reply) => {
    if (!dependencies.mirrorSessions) return reply.code(204).send();
    const { sessionId, subscriptionId } = mirrorSubscriptionParams.parse(request.params);
    await dependencies.mirrorSessions.release(sessionId, subscriptionId);
    return reply.code(204).send();
  });
  app.get('/api/judge/config', async () => dependencies.judge?.publicConfig() ?? ({ configured: false, provider: 'OPENAI_COMPATIBLE', hasApiKey: false }));
  app.put('/api/judge/config', async (request) => {
    if (!dependencies.judge) throw new Error('Judge 服务未启用');
    return dependencies.judge.configure(judgeConfigInputSchema.parse(request.body));
  });
  app.post('/api/judge/test', async (_request, reply) => {
    if (!dependencies.judge) return reply.code(503).send({ schemaVersion: 1, error: { code: 'JUDGE_NOT_READY', message: 'Judge 服务未启用', retryable: false } });
    try { return await dependencies.judge.test(); }
    catch (error) {
      return reply.code(502).send({ schemaVersion: 1, error: { code: 'JUDGE_CONNECTION_FAILED', message: error instanceof Error ? error.message : 'Judge 连接失败', retryable: true } });
    }
  });
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
  app.post('/api/plans', async (request, reply) => {
    const input = createEvaluationPlanSchema.parse(request.body);
    return reply.code(201).send(await dependencies.plans.create(input));
  });
  app.get<{ Querystring: Record<string, unknown> }>('/api/plans', async (request) => {
    return dependencies.plans.list(planListQuery.parse(request.query));
  });
  app.get<{ Params: { planId: string } }>('/api/plans/:planId', async (request) => {
    const { planId } = planParams.parse(request.params);
    return dependencies.plans.get(planId);
  });
  app.put<{ Params: { planId: string } }>('/api/plans/:planId', async (request) => {
    const { planId } = planParams.parse(request.params);
    return dependencies.plans.update(planId, createEvaluationPlanSchema.parse(request.body));
  });
  app.delete<{ Params: { planId: string } }>('/api/plans/:planId', async (request, reply) => {
    const { planId } = planParams.parse(request.params);
    await dependencies.plans.delete(planId);
    return reply.code(204).send();
  });
  app.post<{ Params: { planId: string } }>('/api/plans/:planId/runs', async (request, reply) => {
    const { planId } = planParams.parse(request.params);
    const plan = await dependencies.plans.get(planId);
    return reply.code(202).send(await dependencies.runs.createFromPlan(plan));
  });
  app.get<{ Params: { planId: string } }>('/api/plans/:planId/runs', async (request) => {
    const { planId } = planParams.parse(request.params);
    await dependencies.plans.get(planId);
    return { runs: await dependencies.runs.list(planId) };
  });
  app.get<{ Params: { planId: string; runId: string } }>('/api/plans/:planId/runs/:runId/report', async (request) => {
    const { planId } = planParams.parse(request.params);
    const run = await dependencies.runs.get(request.params.runId);
    if (run.planId !== planId) throw new PlanReportStoreError(`评测报告不属于计划：${planId}`);
    return dependencies.reports.get(run.runId);
  });
  app.post('/api/runs', async (request, reply) => {
    const input = createRunRequestSchema.parse(request.body);
    return reply.code(202).send(await dependencies.runs.create(input));
  });
  app.get('/api/runs', async () => ({ runs: await dependencies.runs.list() }));
  app.get<{ Params: { runId: string } }>('/api/runs/:runId', async (request) => dependencies.runs.get(request.params.runId));
  app.post<{ Params: { runId: string; sampleId: string } }>(
    '/api/runs/:runId/samples/:sampleId/retries',
    async (request, reply) => {
      const params = runSampleParams.parse(request.params);
      return reply.code(202).send(await dependencies.runs.retrySample(params.runId, params.sampleId));
    },
  );
  app.get<{ Params: { runId: string; sampleId: string } }>('/api/runs/:runId/samples/:sampleId', async (request) => {
    const params = runSampleParams.parse(request.params);
    return dependencies.details.get(params.runId, params.sampleId);
  });
  app.get<{ Params: { runId: string; sampleId: string; attemptId: string } }>(
    '/api/runs/:runId/samples/:sampleId/attempts/:attemptId',
    async (request) => {
      const params = attemptParams.parse(request.params);
      return dependencies.details.get(params.runId, params.sampleId, params.attemptId);
    },
  );
  app.get<{ Params: { runId: string; sampleId: string }; Querystring: Record<string, unknown> }>(
    '/api/runs/:runId/samples/:sampleId/trace',
    async (request) => {
      const params = runSampleParams.parse(request.params);
      return dependencies.details.trace(params.runId, params.sampleId, traceQuery.parse(request.query));
    },
  );
  app.get<{ Params: { runId: string; sampleId: string; artifactId: string } }>(
    '/api/runs/:runId/samples/:sampleId/artifacts/:artifactId',
    async (request, reply) => {
      const params = artifactParams.parse(request.params);
      const artifact = await dependencies.details.artifact(params.runId, params.sampleId, params.artifactId);
      return reply.type(artifact.descriptor.mediaType).send(artifact.content);
    },
  );
  app.get<{ Params: { runId: string; sampleId: string; attemptId: string }; Querystring: Record<string, unknown> }>(
    '/api/runs/:runId/samples/:sampleId/attempts/:attemptId/trace',
    async (request) => {
      const params = attemptParams.parse(request.params);
      return dependencies.details.trace(params.runId, params.sampleId, traceQuery.parse(request.query), params.attemptId);
    },
  );
  app.get<{ Params: { runId: string; sampleId: string; attemptId: string; artifactId: string } }>(
    '/api/runs/:runId/samples/:sampleId/attempts/:attemptId/artifacts/:artifactId',
    async (request, reply) => {
      const params = attemptArtifactParams.parse(request.params);
      const artifact = await dependencies.details.artifact(params.runId, params.sampleId, params.artifactId, params.attemptId);
      return reply.type(artifact.descriptor.mediaType).send(artifact.content);
    },
  );
  app.post<{ Params: { runId: string } }>('/api/runs/:runId/cancel', async (request) => dependencies.runs.cancel(request.params.runId));
  app.get<{ Params: { runId: string } }>('/api/runs/:runId/report', async (request) => dependencies.reports.get(request.params.runId));

  app.setErrorHandler((error, _request, reply) => {
    const validation = error instanceof ZodError || error instanceof DatasetError;
    const catalog = error instanceof DatasetCatalogError;
    const runConflict = error instanceof RunManagerError;
    const plan = error instanceof PlanRepositoryError;
    const report = error instanceof PlanReportStoreError;
    const mirror = error instanceof DeviceMirrorError;
    const mirrorSession = error instanceof MirrorSessionError;
    const message = error instanceof Error ? error.message : '未知服务端错误';
    const status = validation || plan && error.code === 'INVALID_CURSOR'
      ? 400
      : mirrorSession && error.code === 'CAPTURE_FAILED'
        ? 503
        : mirrorSession && error.code === 'NEGOTIATION_FAILED'
          ? 502
      : runConflict || mirror && error.code === 'DEVICE_NOT_MIRRORABLE' || catalog && error.code === 'DATASET_CONFLICT'
        ? 409
        : 404;
    void reply.code(status).send({
      schemaVersion: 1,
      error: {
        code: validation || plan && error.code === 'INVALID_CURSOR'
          ? 'INVALID_REQUEST'
          : runConflict || catalog || plan || report || mirror || mirrorSession ? error.code : 'RESOURCE_NOT_FOUND',
        message,
        retryable: false,
      },
    });
  });
  app.addHook('onClose', async () => dependencies.mirrorSessions?.close());
  return app;
}
