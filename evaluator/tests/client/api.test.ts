// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../../src/client/api.js';

afterEach(() => vi.unstubAllGlobals());

describe('requestJson', () => {
  it('解析 JSON 响应', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ value: 1 })));
    await expect(requestJson<{ value: number }>('/api/value')).resolves.toEqual({ value: 1 });
  });

  it('允许没有响应体的成功删除请求', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(requestJson<void>('/api/plans/plan-1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('为空响应提供可定位的错误信息', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    await expect(requestJson('/api/runs/run-1')).rejects.toThrow('请求 /api/runs/run-1 返回空响应（HTTP 200）');
  });

  it('保留服务端 JSON 错误信息', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: '设备离线' } }, { status: 409 })));
    await expect(requestJson('/api/runs')).rejects.toThrow('设备离线');
  });
});
