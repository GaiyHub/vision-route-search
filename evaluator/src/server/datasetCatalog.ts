import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { loadDataset } from '../datasets/loader.js';
import type { EvaluationDataset } from '../datasets/schema.js';
import { writeJsonAtomic } from '../storage/atomicFile.js';

export class DatasetCatalogError extends Error {
  constructor(public readonly code: 'DATASET_NOT_FOUND' | 'DATASET_CONFLICT', message: string) {
    super(message);
    this.name = 'DatasetCatalogError';
  }
}

export class DatasetCatalog {
  constructor(private readonly directory: string) {}

  private async entries(): Promise<Array<{ dataset: EvaluationDataset; path: string }>> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    return Promise.all(entries
      .filter((entry) => entry.isFile() && /\.(?:json|ya?ml)$/i.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const path = join(this.directory, entry.name);
        return { dataset: await loadDataset(path), path };
      }));
  }

  async list(): Promise<EvaluationDataset[]> {
    return (await this.entries()).map((entry) => entry.dataset);
  }

  async get(datasetId: string): Promise<EvaluationDataset | undefined> {
    return (await this.entries()).find((entry) => entry.dataset.id === datasetId)?.dataset;
  }

  async create(dataset: EvaluationDataset): Promise<EvaluationDataset> {
    if (await this.get(dataset.id)) {
      throw new DatasetCatalogError('DATASET_CONFLICT', `评测集已存在：${dataset.id}`);
    }
    await writeJsonAtomic(join(this.directory, `${dataset.id}.json`), dataset);
    return dataset;
  }

  async replace(datasetId: string, dataset: EvaluationDataset): Promise<EvaluationDataset> {
    if (dataset.id !== datasetId) {
      throw new DatasetCatalogError('DATASET_CONFLICT', '评测集 ID 不允许通过更新接口修改');
    }
    const entry = (await this.entries()).find((candidate) => candidate.dataset.id === datasetId);
    if (!entry) throw new DatasetCatalogError('DATASET_NOT_FOUND', `评测集不存在：${datasetId}`);
    await writeJsonAtomic(entry.path, dataset);
    return dataset;
  }

  async delete(datasetId: string): Promise<void> {
    const entry = (await this.entries()).find((candidate) => candidate.dataset.id === datasetId);
    if (entry) await unlink(entry.path);
  }
}
