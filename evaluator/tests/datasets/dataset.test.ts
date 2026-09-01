import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatasetError, parseDatasetText } from '../../src/datasets/loader.js';
import { DatasetRepository } from '../../src/datasets/repository.js';

const directories: string[] = [];
const validDataset = {
  schemaVersion: 1,
  id: 'smoke',
  name: '冒烟评测',
  samples: [{
    id: 'answer',
    instruction: '现在几点？',
    assertions: [{ type: 'outcome', equals: 'complete' }],
  }],
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('评测集加载', () => {
  it('将等价 JSON 与 YAML 标准化为同一模型', () => {
    const json = parseDatasetText(JSON.stringify(validDataset), 'json');
    const yaml = parseDatasetText(`
schemaVersion: 1
id: smoke
name: 冒烟评测
samples:
  - id: answer
    instruction: 现在几点？
    assertions:
      - type: outcome
        equals: complete
`, 'yaml');
    expect(yaml).toEqual(json);
    expect(json.samples[0]?.enabled).toBe(true);
  });

  it.each([
    ['重复样本 ID', { ...validDataset, samples: [validDataset.samples[0], validDataset.samples[0]] }],
    ['未知字段', { ...validDataset, dangerous: true }],
    ['未知断言', { ...validDataset, samples: [{ ...validDataset.samples[0], assertions: [{ type: 'shell', command: 'rm' }] }] }],
    ['危险 setup', { ...validDataset, samples: [{ ...validDataset.samples[0], setup: [{ type: 'shell', command: 'adb shell' }] }] }],
    ['无断言和 Judge', { ...validDataset, samples: [{ id: 'empty', instruction: '回答我' }] }],
    ['不安全正则', { ...validDataset, samples: [{ ...validDataset.samples[0], assertions: [{ type: 'finalResponse', matches: '(a+)+$' }] }] }],
    ['倒置数值范围', { ...validDataset, samples: [{ ...validDataset.samples[0], assertions: [{ type: 'steps', min: 3, max: 1 }] }] }],
  ])('在运行前拒绝%s', (_name, input) => {
    expect(() => parseDatasetText(JSON.stringify(input), 'json')).toThrowError(DatasetError);
    try {
      parseDatasetText(JSON.stringify(input), 'json');
    } catch (error) {
      expect(error).toMatchObject({ code: 'DATASET_VALIDATION_ERROR' });
    }
  });
});

describe('评测集工作副本与快照', () => {
  it('导入时不覆盖，显式保存后也不改变既有 Run 快照', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doupao-datasets-'));
    directories.push(root);
    const source = join(root, 'source.json');
    await writeFile(source, JSON.stringify(validDataset), 'utf8');
    const repository = new DatasetRepository(join(root, '.data'));

    await repository.import(source);
    await expect(repository.import(source)).rejects.toMatchObject({ code: 'DATASET_VALIDATION_ERROR' });
    const snapshot = await repository.snapshot('smoke', join(root, '.data', 'runs', 'run-1'));

    await repository.save({ ...validDataset, name: '修改后的名称' });
    expect((await repository.get('smoke')).name).toBe('修改后的名称');
    expect(JSON.parse(await readFile(snapshot.path, 'utf8'))).toEqual(snapshot.dataset);
    expect(snapshot.dataset.name).toBe('冒烟评测');
    expect(snapshot.hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(repository.snapshot('smoke', join(root, '.data', 'runs', 'run-1'))).rejects.toMatchObject({
      code: 'DATASET_VALIDATION_ERROR',
    });
  });
});
