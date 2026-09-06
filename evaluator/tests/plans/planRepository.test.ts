import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanRepository } from '../../src/plans/repository.js';
import { createEvaluationPlanSchema } from '../../src/plans/schema.js';
import { DatasetCatalog } from '../../src/server/datasetCatalog.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'doupao-plans-'));
  roots.push(root);
  const datasetsDirectory = join(root, 'datasets');
  await mkdir(datasetsDirectory);
  await writeFile(join(datasetsDirectory, 'smoke.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'smoke',
    name: '冒烟评测',
    samples: [
      { id: 'answer', instruction: '回答问题', assertions: [{ type: 'outcome', equals: 'complete' }] },
      { id: 'operate', instruction: '执行操作', assertions: [{ type: 'outcome', equals: 'complete' }] },
    ],
  }));
  return { root, plans: new PlanRepository(root, new DatasetCatalog(datasetsDirectory)) };
}

const input = {
  name: '每日回归',
  datasetId: 'smoke',
  deviceSerial: 'device-offline-is-allowed',
  sampleIds: ['answer'],
  execution: { defaultTimeoutMs: 120_000, continueOnFailure: true },
  judge: { enabled: true },
};

describe('EvaluationPlan', () => {
  it('校验输入边界和重复样本', () => {
    expect(createEvaluationPlanSchema.safeParse(input).success).toBe(true);
    expect(createEvaluationPlanSchema.safeParse({ ...input, sampleIds: [] }).success).toBe(false);
    expect(createEvaluationPlanSchema.safeParse({ ...input, sampleIds: ['answer', 'answer'] }).success).toBe(false);
    expect(createEvaluationPlanSchema.safeParse({ ...input, execution: { ...input.execution, defaultTimeoutMs: 9_999 } }).success).toBe(false);
  });

  it('创建、分页读取和更新计划', async () => {
    const { plans } = await fixture();
    const first = await plans.create(input);
    const second = await plans.create({ ...input, name: '完整回归', sampleIds: ['answer', 'operate'] });
    const page = await plans.list({ limit: 1 });
    expect(page.plans).toHaveLength(1);
    expect(page.pagination.nextCursor).toBeTruthy();
    const next = await plans.list({ limit: 1, cursor: page.pagination.nextCursor! });
    expect(next.plans).toHaveLength(1);
    expect(new Set([page.plans[0]?.planId, next.plans[0]?.planId])).toEqual(new Set([first.planId, second.planId]));
    const updated = await plans.update(first.planId, { ...input, name: '每日核心回归' });
    expect(updated).toMatchObject({ planId: first.planId, createdAt: first.createdAt, name: '每日核心回归' });
  });

  it('拒绝无效引用，并隔离损坏文件', async () => {
    const { root, plans } = await fixture();
    await expect(plans.create({ ...input, datasetId: 'missing' })).rejects.toMatchObject({ code: 'DATASET_NOT_FOUND' });
    await expect(plans.create({ ...input, sampleIds: ['missing'] })).rejects.toMatchObject({ code: 'SAMPLE_NOT_FOUND' });
    const valid = await plans.create(input);
    await writeFile(join(root, 'plans', 'broken.json'), '{');
    expect((await plans.list({ limit: 20 })).plans.map((plan) => plan.planId)).toEqual([valid.planId]);
  });

  it('删除计划后不再返回该计划', async () => {
    const { plans } = await fixture();
    const plan = await plans.create(input);

    await plans.delete(plan.planId);

    await expect(plans.get(plan.planId)).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
    expect((await plans.list({ limit: 20 })).plans).toEqual([]);
  });
});
