import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadDataset } from '../datasets/loader.js';
import type { EvaluationDataset } from '../datasets/schema.js';

export class DatasetCatalog {
  constructor(private readonly directory: string) {}

  async list(): Promise<EvaluationDataset[]> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    const datasets = await Promise.all(entries
      .filter((entry) => entry.isFile() && /\.(?:json|ya?ml)$/i.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => loadDataset(join(this.directory, entry.name))));
    return datasets;
  }

  async get(datasetId: string): Promise<EvaluationDataset | undefined> {
    return (await this.list()).find((dataset) => dataset.id === datasetId);
  }
}
