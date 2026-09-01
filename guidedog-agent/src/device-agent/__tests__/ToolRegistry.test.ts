/**
 * Tests for the unified tool-result wrapper: every handler return value and
 * thrown error is normalized to the ToolResult shape at the ToolRegistry
 * boundary, and failures expose factual codes/messages/details without
 * embedding retry policy in the tool protocol.
 */

import { ToolRegistry, normalizeToolResult } from '../tools/ToolRegistry';
import type { Tool } from '../types';

function makeTool(name: string): Tool {
  return { name, description: 'test', parameters: { type: 'object', properties: {} } };
}

describe('normalizeToolResult', () => {
  test('true becomes ok:true with data', () => {
    expect(normalizeToolResult(true)).toEqual({ ok: true, data: true });
  });

  test('false becomes ok:false with a default reason', () => {
    expect(normalizeToolResult(false)).toEqual({
      ok: false,
      error: '操作未成功（无更多信息）',
      code: 'OPERATION_REJECTED',
    });
  });

  test('Error becomes ok:false with the message', () => {
    const r = normalizeToolResult(new Error('boom'));
    expect(r.ok).toBe(false);
    expect((r as { error?: string }).error).toBe('boom');
  });

  test('strings are carried as data', () => {
    expect(normalizeToolResult('node-id-1')).toEqual({ ok: true, data: 'node-id-1' });
  });

  test('null is a successful empty result', () => {
    expect(normalizeToolResult(null)).toEqual({ ok: true, data: null });
  });

  test('legacy wrappers drop policy fields while preserving factual fields', () => {
    const shaped = { ok: false, error: '原因', retryable: true, hint: '建议' };
    expect(normalizeToolResult(shaped)).toEqual({
      ok: false,
      error: '原因',
      code: 'TOOL_EXECUTION_ERROR',
    });
    const okShaped = { ok: true, name: 'x', content: 'y' };
    expect(normalizeToolResult(okShaped)).toEqual({
      ok: true,
      data: { name: 'x', content: 'y' },
    });
  });

  test('ask_user legacy result preserves the exact answer in data', () => {
    expect(normalizeToolResult({
      ok: true,
      answered: true,
      answer: '支付宝，户号14002242',
      message: '用户已补充信息',
    })).toEqual({
      ok: true,
      data: {
        answered: true,
        answer: '支付宝，户号14002242',
        message: '用户已补充信息',
      },
    });
  });
});

describe('ToolRegistry.execute', () => {
  test('unregistered tool yields a structured failure, not a throw', async () => {
    const registry = new ToolRegistry();
    const r = await registry.execute({ name: 'nope', arguments: {} });
    expect(r.ok).toBe(false);
    expect((r as { error?: string }).error).toContain('nope');
  });

  test('handler exceptions are caught and converted to ok:false', async () => {
    const registry = new ToolRegistry();
    registry.register(
      makeTool('boom'),
      async () => {
        throw new Error('handler exploded');
      },
    );
    const r = await registry.execute({ name: 'boom', arguments: {} });
    expect(r).toEqual({
      ok: false,
      error: 'handler exploded',
      code: 'TOOL_EXECUTION_ERROR',
    });
  });

  test('handler raw returns are normalized', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('say'), async () => 'done');
    registry.register(makeTool('nay'), async () => false);
    expect(await registry.execute({ name: 'say', arguments: {} })).toEqual({
      ok: true,
      data: 'done',
    });
    const nay = await registry.execute({ name: 'nay', arguments: {} });
    expect(nay.ok).toBe(false);
  });

  test('normalizes literal boolean strings according to the tool schema', async () => {
    const registry = new ToolRegistry();
    const received: Array<Record<string, unknown>> = [];
    registry.register({
      name: 'boolean_tool',
      description: 'test',
      parameters: {
        type: 'object',
        properties: {
          submit: { type: 'boolean' },
          label: { type: 'string' },
        },
        required: ['submit'],
      },
    }, async (args) => {
      received.push(args);
      return true;
    });

    await expect(registry.execute({
      name: 'boolean_tool',
      arguments: { submit: ' True ', label: 'True' },
    })).resolves.toMatchObject({ ok: true });
    expect(received).toEqual([{ submit: true, label: 'True' }]);

    await expect(registry.execute({
      name: 'boolean_tool',
      arguments: { submit: 'yes', label: 'unchanged' },
    })).resolves.toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
  });
});
