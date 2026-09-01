import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readValidatedJson, writeFileAtomic, writeJsonAtomic } from '../../src/storage/atomicFile.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('原子文件存储', () => {
  it('创建父目录并完整替换文件', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'doupao-evaluator-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'nested', 'value.txt');
    await writeFileAtomic(path, '旧值');
    await writeFileAtomic(path, '新值');
    expect(await readFile(path, 'utf8')).toBe('新值');
  });

  it('写入并按 Schema 读取 JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'doupao-evaluator-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'state.json');
    await writeJsonAtomic(path, { state: 'READY' });
    expect(await readValidatedJson(path, z.object({ state: z.literal('READY') }))).toEqual({ state: 'READY' });
  });
});
