import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeEvalRequestForHash,
  encodeEvalRequestPayload,
  evalRequestV1Schema,
  evalStatusV1Schema,
  hashEvalRequest,
} from '../../src/contracts/evaluation.js';

async function fixture(name: string): Promise<unknown> {
  const path = resolve(process.cwd(), '..', 'specs', 'pc-batch-evaluation', 'fixtures', name);
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

describe('跨端评测契约', () => {
  it('与请求 Fixture 的规范化、hash 和 Base64URL 保持一致', async () => {
    const raw = await fixture('eval-request-v1.json') as Record<string, unknown>;
    const request = evalRequestV1Schema.parse(raw.request);
    const { requestHash: _requestHash, ...hashInput } = request;
    expect(canonicalizeEvalRequestForHash(hashInput)).toBe(raw.canonicalHashInput);
    expect(hashEvalRequest(hashInput)).toBe(request.requestHash);
    expect(encodeEvalRequestPayload(request)).toBe(raw.encodedPayload);
  });

  it('接受共享 Fixture 中的完整状态生命周期', async () => {
    const raw = await fixture('eval-status-v1.json') as { statuses: unknown[] };
    expect(raw.statuses.map((status) => evalStatusV1Schema.parse(status))).toHaveLength(7);
  });

  it('拒绝未知字段和语义不一致的结果', async () => {
    const raw = await fixture('eval-status-v1.json') as { statuses: Array<Record<string, unknown>> };
    expect(() => evalStatusV1Schema.parse({ ...raw.statuses[0], extra: true })).toThrow();
    const source = raw.statuses[2];
    if (!source) throw new Error('Fixture 缺少 COMPLETED 状态');
    const completed = structuredClone(source);
    (completed.result as Record<string, unknown>).outcome = 'error';
    expect(() => evalStatusV1Schema.parse(completed)).toThrow();
  });
});
