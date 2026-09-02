import { describe, expect, it, vi } from 'vitest';
import { JudgeService } from '../../src/judge/service.js';
import type { EvaluationSample } from '../../src/datasets/schema.js';

const sample: EvaluationSample = {
  id: 'answer', enabled: true, instruction: '现在几点？', setup: [], teardown: [], assertions: [], tags: [],
  judge: { enabled: true, rubric: '给出合理时间', threshold: 0.8, evidence: ['finalResponse'] },
};
const evidence = { sample, finalResponse: '现在是 17:10', assertions: { schemaVersion: 1 as const, results: [], summary: { passed: 0, failed: 0, errors: 0 } } };

describe('JudgeService', () => {
  it('不配置时返回基础设施异常且不猜测结果', async () => {
    const result = await new JudgeService().evaluate(evidence);
    expect(result).toMatchObject({ verdict: 'INFRA_ERROR', model: 'UNCONFIGURED' });
  });

  it('校验结构化输出、阈值和证据引用', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: 1, verdict: 'PASS', score: 0.7, reason: '基本合理', evidence: ['finalResponse'] }) } }] }), { status: 200 }));
    const service = new JudgeService({ baseUrl: 'https://judge.example/v1', model: 'judge-model', timeoutMs: 5000, supportsImages: false, apiKey: 'secret' }, fetch as typeof globalThis.fetch);
    const result = await service.evaluate(evidence);
    expect(result.verdict).toBe('FAIL');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('无效输出只修复一次', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: 1, verdict: 'PASS', score: 0.9, reason: '符合', evidence: ['finalResponse'] }) } }] }), { status: 200 }));
    const result = await new JudgeService({ baseUrl: 'https://judge.example/v1', model: 'judge-model', timeoutMs: 5000, supportsImages: false }, fetch as typeof globalThis.fetch).evaluate(evidence);
    expect(result.verdict).toBe('PASS');
    expect(result.attempts).toHaveLength(2);
  });
});
