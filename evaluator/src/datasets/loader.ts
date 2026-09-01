import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';
import { evaluationDatasetSchema, type EvaluationDataset } from './schema.js';

export type DatasetFormat = 'json' | 'yaml';
export type DatasetErrorCode = 'DATASET_PARSE_ERROR' | 'DATASET_VALIDATION_ERROR' | 'DATASET_FORMAT_UNSUPPORTED';

export class DatasetError extends Error {
  constructor(
    public readonly code: DatasetErrorCode,
    message: string,
    public readonly path?: string,
    public readonly issues?: ReadonlyArray<{ path: string; message: string }>,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'DatasetError';
  }
}

export function inferDatasetFormat(path: string): DatasetFormat {
  const extension = extname(path).toLowerCase();
  if (extension === '.json') return 'json';
  if (extension === '.yaml' || extension === '.yml') return 'yaml';
  throw new DatasetError('DATASET_FORMAT_UNSUPPORTED', `不支持的评测集格式：${extension || '无扩展名'}`);
}

export function parseDatasetText(contents: string, format: DatasetFormat): EvaluationDataset {
  let raw: unknown;
  try {
    raw = format === 'json' ? JSON.parse(contents) : parseYaml(contents, { uniqueKeys: true, maxAliasCount: 0 });
  } catch (error) {
    throw new DatasetError('DATASET_PARSE_ERROR', `无法解析 ${format.toUpperCase()} 评测集`, undefined, undefined, error);
  }
  return validateDataset(raw);
}

export function validateDataset(raw: unknown): EvaluationDataset {
  try {
    return evaluationDatasetSchema.parse(raw);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    const issues = error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    const first = issues[0];
    throw new DatasetError(
      'DATASET_VALIDATION_ERROR',
      first ? `${first.path || '<root>'}: ${first.message}` : '评测集校验失败',
      first?.path,
      issues,
    );
  }
}

export async function loadDataset(path: string): Promise<EvaluationDataset> {
  return parseDatasetText(await readFile(path, 'utf8'), inferDatasetFormat(path));
}
