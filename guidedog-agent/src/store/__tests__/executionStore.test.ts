/**
 * Unit tests for the execution step log: step numbering only advances for
 * step-consuming actions; bookkeeping tools (todo_update / wait) display
 * without a step number and don't inflate the panel count.
 */

import {
  addActionStep,
  addContextCompressionSummary,
  beginExecution,
  endExecution,
  getExecutionState,
  updateExecutionThinking,
  updateExecutionStatus,
  updateLastStepResult,
} from '../executionStore';

describe('executionStore step numbering', () => {
  beforeEach(() => {
    beginExecution();
  });

  afterEach(() => {
    endExecution();
  });

  it('numbers only step-consuming actions', () => {
    addActionStep('open_app', '打开应用');
    addActionStep('todo_update', '任务清单已更新', undefined, undefined, false);
    addActionStep('wait', '等待 3000ms', undefined, undefined, false);
    addActionStep('ui_tap', '点击节点');

    const { steps } = getExecutionState();
    expect(steps.map((s) => s.step)).toEqual([1, null, null, 2]);
    // index stays unique for list keys.
    expect(steps.map((s) => s.index)).toEqual([1, 2, 3, 4]);
  });

  it('resets the step counter on a new task', () => {
    addActionStep('ui_tap', '点击节点');
    endExecution();
    beginExecution();
    addActionStep('ui_scroll', '向down滚动');

    const { steps } = getExecutionState();
    expect(steps.map((s) => s.step)).toEqual([1]);
  });

  it('keeps updating the latest step result', () => {
    addActionStep('ui_tap', '点击节点');
    updateLastStepResult('点击成功', false, '{"ok":true}');

    const { steps } = getExecutionState();
    expect(steps[0].resultText).toBe('点击成功');
    expect(steps[0].pending).toBe(false);
  });

  it('keeps transient thinking outside the execution steps and resets it per task', () => {
    updateExecutionThinking('正在检查搜索结果');
    expect(getExecutionState().thinking).toBe('正在检查搜索结果');
    expect(getExecutionState().steps).toEqual([]);

    endExecution();
    beginExecution();
    expect(getExecutionState().thinking).toBe('');
  });

  it('keeps transient host status separate from thinking and clears it', () => {
    updateExecutionStatus('正在压缩会话');
    expect(getExecutionState().status).toBe('正在压缩会话');
    expect(getExecutionState().thinking).toBe('');

    endExecution();
    expect(getExecutionState().status).toBe('');
  });

  it('keeps every completed context summary as a step-exempt process entry', () => {
    addContextCompressionSummary('第一次摘要');
    addContextCompressionSummary('第二次摘要');

    const { steps } = getExecutionState();
    expect(steps).toEqual([
      expect.objectContaining({
        step: null,
        tool: 'context_compression',
        argsText: '已压缩较早会话',
        resultText: '第一次摘要',
        pending: false,
      }),
      expect.objectContaining({
        step: null,
        tool: 'context_compression',
        resultText: '第二次摘要',
        pending: false,
      }),
    ]);
  });
});
