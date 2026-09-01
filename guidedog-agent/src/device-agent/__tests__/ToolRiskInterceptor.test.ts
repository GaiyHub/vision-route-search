import type { Tool, ToolCall, ToolRiskGateRequest } from '../types';
import {
  MAX_RISK_REASON_CODE_POINTS,
  ToolRiskInterceptor,
  addToolRiskAssessment,
  sanitizeRiskReason,
} from '../tools/ToolRiskInterceptor';
import { AgentToolkit } from '../agent/AgentToolkit';

const tapTool: Tool = {
  name: 'ui_tap',
  description: '点击目标',
  parameters: {
    type: 'object',
    properties: { ref: { type: 'string' } },
    required: ['ref'],
  },
};

function tapCall(level: 'low' | 'high'): ToolCall {
  return {
    name: 'ui_tap',
    arguments: {
      ref: 'uae',
      _risk: level === 'high'
        ? { level, reason: '点击删除按钮将立即删除真实数据' }
        : { level },
    },
  };
}

describe('ToolRiskInterceptor', () => {
  it('adds a required common risk envelope only to state-changing tools', () => {
    const decorated = addToolRiskAssessment(tapTool);
    expect(decorated.parameters.required).toEqual(['ref', '_risk']);
    expect(decorated.parameters.properties._risk).toMatchObject({
      type: 'object',
      required: ['level'],
      additionalProperties: false,
      properties: {
        level: { type: 'string', enum: ['low', 'high'] },
        reason: { type: 'string' },
      },
    });
    expect(decorated.parameters.properties._risk.description)
      .toContain('不继承整体目标');
    expect(decorated.parameters.properties._risk.description)
      .toContain('high 必须用 reason 说明');

    const readTool: Tool = {
      name: 'ui_inspect',
      description: '读取结构',
      parameters: { type: 'object', properties: {} },
    };
    expect(addToolRiskAssessment(readTool)).toBe(readTool);
  });

  it('executes low-risk calls without opening the gate and strips metadata', async () => {
    const gate = jest.fn<Promise<'execute' | 'deny'>, [ToolRiskGateRequest]>();
    const interceptor = new ToolRiskInterceptor({ gate });
    const result = await interceptor.intercept(tapCall('low'));

    expect(result).toEqual({
      ok: true,
      call: { name: 'ui_tap', arguments: { ref: 'uae' } },
    });
    expect(gate).not.toHaveBeenCalled();
  });

  it('blocks a high-risk call and resumes the exact frozen arguments after approval', async () => {
    let captured: ToolRiskGateRequest | undefined;
    const interceptor = new ToolRiskInterceptor({
      gate: async (request) => {
        captured = request;
        return 'execute';
      },
    });
    const result = await interceptor.intercept(tapCall('high'));

    expect(captured).toMatchObject({
      toolName: 'ui_tap',
      risk: 'high',
      reason: '点击删除按钮将立即删除真实数据',
      summary: '点击当前界面目标',
      arguments: { ref: 'uae' },
    });
    expect(Object.isFrozen(captured?.arguments)).toBe(true);
    expect(result).toEqual({
      ok: true,
      call: { name: 'ui_tap', arguments: { ref: 'uae' } },
    });
  });

  it('does not override the model risk from target keywords', async () => {
    const gate = jest.fn(async () => 'execute' as const);
    const interceptor = new ToolRiskInterceptor({
      gate,
      describeTarget: () => 'Button "立即缴费"',
    });
    const result = await interceptor.intercept(tapCall('low'));

    expect(result).toEqual({
      ok: true,
      call: { name: 'ui_tap', arguments: { ref: 'uae' } },
    });
    expect(gate).not.toHaveBeenCalled();
  });

  it('does not upgrade a harmless preparation target', async () => {
    const gate = jest.fn(async () => 'execute' as const);
    const interceptor = new ToolRiskInterceptor({
      gate,
      describeTarget: () => 'CheckBox "全选"',
    });

    const result = await interceptor.intercept(tapCall('low'));

    expect(result).toEqual({
      ok: true,
      call: { name: 'ui_tap', arguments: { ref: 'uae' } },
    });
    expect(gate).not.toHaveBeenCalled();
  });

  it('uses the concrete target in confirmation when the model declares high risk', async () => {
    const gate = jest.fn(async () => 'execute' as const);
    const interceptor = new ToolRiskInterceptor({
      gate,
      describeTarget: () => 'Button "删除"',
    });

    await interceptor.intercept(tapCall('high'));

    expect(gate).toHaveBeenCalledWith(expect.objectContaining({
      risk: 'high',
      summary: '点击「Button "删除"」',
    }));
  });

  it('does not dispatch a denied call', async () => {
    const interceptor = new ToolRiskInterceptor({ gate: async () => 'deny' });
    const result = await interceptor.intercept(tapCall('high'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toMatchObject({
        ok: false,
        code: 'USER_DENIED_RISK_ACTION',
      });
    }
  });

  it('rejects missing risk metadata when the production gate is installed', async () => {
    const interceptor = new ToolRiskInterceptor({ gate: async () => 'execute' });
    const result = await interceptor.intercept({
      name: 'ui_tap',
      arguments: { ref: 'uae' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('INVALID_ARGUMENT');
  });

  it('keeps the concrete handler blocked and never forwards risk metadata', async () => {
    let decide: ((decision: 'execute' | 'deny') => void) | undefined;
    const gate = jest.fn(() => new Promise<'execute' | 'deny'>((resolve) => {
      decide = resolve;
    }));
    const handler = jest.fn(async () => ({ accepted: true }));
    const browserClick: Tool = {
      name: 'browser_click',
      description: '点击网页元素',
      uiEffect: 'change',
      parameters: {
        type: 'object',
        properties: { ref: { type: 'string' } },
        required: ['ref'],
      },
    };
    const toolkit = new AgentToolkit(
      { delay: async () => {}, notes: new Map() },
      {
        toolRiskGate: gate,
        extraTools: [{ tool: browserClick, handler }],
      },
    );

    expect(toolkit.tools.find((tool) => tool.name === 'browser_click')?.parameters.required)
      .toContain('_risk');
    const pending = toolkit.execute({
      name: 'browser_click',
      arguments: {
        ref: 'checkout',
        _risk: { level: 'high', reason: '点击后将提交真实订单' },
      },
    });
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();

    decide?.('execute');
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(handler).toHaveBeenCalledWith({ ref: 'checkout' });
  });

  it('rejects malformed arguments before showing a risk confirmation', async () => {
    const gate = jest.fn(async () => 'execute' as const);
    const handler = jest.fn(async () => ({ accepted: true }));
    const browserClick: Tool = {
      name: 'browser_click',
      description: '点击网页元素',
      uiEffect: 'change',
      parameters: {
        type: 'object',
        properties: { ref: { type: 'string' } },
        required: ['ref'],
      },
    };
    const toolkit = new AgentToolkit(
      { delay: async () => {}, notes: new Map() },
      { toolRiskGate: gate, extraTools: [{ tool: browserClick, handler }] },
    );

    await expect(toolkit.execute({
      name: 'browser_click',
      arguments: {
        unexpected: true,
        _risk: { level: 'high', reason: '点击后将产生真实外部影响' },
      },
    })).resolves.toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(gate).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects high-risk calls without a semantic reason', async () => {
    const gate = jest.fn(async () => 'execute' as const);
    const interceptor = new ToolRiskInterceptor({ gate });

    const result = await interceptor.intercept({
      name: 'ui_tap',
      arguments: { ref: 'uae', _risk: { level: 'high' } },
    });

    expect(result).toMatchObject({ ok: false, failure: { code: 'INVALID_ARGUMENT' } });
    expect(gate).not.toHaveBeenCalled();
  });

  it('normalizes control characters and lone surrogates in risk reasons', async () => {
    const gate = jest.fn(async () => 'execute' as const);
    const interceptor = new ToolRiskInterceptor({ gate });

    await interceptor.intercept({
      name: 'ui_tap',
      arguments: {
        ref: 'uae',
        _risk: { level: 'high', reason: '  支付\u0000 1元\n水费\uD800  ' },
      },
    });

    expect(gate).toHaveBeenCalledWith(expect.objectContaining({
      reason: '支付 1元 水费�',
    }));
  });

  it('truncates risk reasons by Unicode code point', () => {
    const normalized = sanitizeRiskReason('💧'.repeat(MAX_RISK_REASON_CODE_POINTS + 20));

    expect(Array.from(normalized ?? '')).toHaveLength(MAX_RISK_REASON_CODE_POINTS);
    expect(normalized?.endsWith('…')).toBe(true);
  });
});
