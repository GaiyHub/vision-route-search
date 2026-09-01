import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { constants } from 'node:fs';
import { DatasetError, loadDataset, validateDataset } from './loader.js';
import { evaluationDatasetSchema, type EvaluationDataset } from './schema.js';
import { readValidatedJson, writeJsonAtomic } from '../storage/atomicFile.js';

export interface DatasetSnapshot {
  dataset: EvaluationDataset;
  hash: string;
  path: string;
}

function canonicalDatasetJson(dataset: EvaluationDataset): string {
  return `${JSON.stringify(dataset, null, 2)}\n`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export class DatasetRepository {
  constructor(private readonly dataRoot: string) {}

  private workingCopyPath(datasetId: string): string {
    return join(this.dataRoot, 'datasets', `${datasetId}.json`);
  }

  async import(sourcePath: string, options: { overwrite?: boolean } = {}): Promise<EvaluationDataset> {
    const dataset = await loadDataset(sourcePath);
    const destination = this.workingCopyPath(dataset.id);
    if (!options.overwrite && await exists(destination)) {
      throw new DatasetError('DATASET_VALIDATION_ERROR', `评测集已存在：${dataset.id}`, 'id');
    }
    await writeJsonAtomic(destination, dataset);
    return dataset;
  }

  async save(dataset: unknown): Promise<EvaluationDataset> {
    const parsed = validateDataset(dataset);
    await writeJsonAtomic(this.workingCopyPath(parsed.id), parsed);
    return parsed;
  }

  async get(datasetId: string): Promise<EvaluationDataset> {
    return readValidatedJson(this.workingCopyPath(datasetId), evaluationDatasetSchema);
  }

  async snapshot(datasetId: string, runDirectory: string): Promise<DatasetSnapshot> {
    const dataset = structuredClone(await this.get(datasetId));
    const contents = canonicalDatasetJson(dataset);
    const hash = createHash('sha256').update(contents, 'utf8').digest('hex');
    const path = join(runDirectory, 'dataset.snapshot.json');
    if (await exists(path)) {
      throw new DatasetError('DATASET_VALIDATION_ERROR', '该 Run 已存在评测集快照，禁止覆盖');
    }
    await writeJsonAtomic(path, dataset);
    const persisted = await readFile(path, 'utf8');
    if (createHash('sha256').update(persisted, 'utf8').digest('hex') !== hash) {
      throw new Error('评测集快照写入校验失败');
    }
    return { dataset, hash, path };
  }
}
