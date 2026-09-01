/**
 * End-to-end tests for tool-result rendering in the prompt: a failed tap
 * carries its error and hint into the next inference round verbatim, and a
 * successful short result (e.g. a found nodeId) is inlined so the model can
 * act on it without another tool call. Also covers the tap auto-resolution
 * paths: numeric [N] list indexes and coordinate fallback after explicitly
 * rejected node actions. An accepted action is never dispatched twice.
 */

import { AgentLoop } from '../agent/AgentLoop';
import type {
  AgentEvent,
  LLMMessage,
  LLMProviderInterface,
  ModelMessage,
  ModelResponse,
} from '../types';

const mockCtrl = {
  getAccessibilityTree: jest.fn<Promise<unknown>, []>(async () => ({
    text: '测试屏幕',
    children: [],
    resourceId: 'test',
    className: 'View',
  })),
  tapNode: jest.fn<Promise<boolean>, [string]>(async () => false),
  tapNodeAt: jest.fn<Promise<boolean>, [string, number, number]>(async () => false),
  tapByQuery: jest.fn<Promise<{
    found: boolean;
    accepted: boolean;
    method: 'node_action' | 'ancestor_action' | 'coordinate_center' | null;
    matchCount: number;
    selectedIndex: number;
    text: string | null;
    contentDescription: string | null;
    resourceId: string | null;
    bounds: { left: number; top: number; right: number; bottom: number } | null;
    center?: { x: number; y: number };
    reason: string | null;
  }>, [string, string, string, number]>(async () => ({
    found: false,
    accepted: false,
    method: null,
    matchCount: 0,
    selectedIndex: 0,
    text: null,
    contentDescription: null,
    resourceId: null,
    bounds: null,
    reason: 'no_match',
  })),
  tap: jest.fn<Promise<boolean>, [number, number]>(async () => false),
  isMediaProjectionReady: jest.fn<Promise<boolean>, []>(async () => true),
  captureWithMediaProjection: jest.fn<Promise<{ path: string; base64: string }>, []>(
    async () => ({ path: '/tmp/tap-frame.jpg', base64: 'frame' }),
  ),
  compareScreenshotFiles: jest.fn<Promise<{
    changed: boolean;
    changedPixelRatio: number;
    changedTileRatio: number;
    meanDelta: number;
  }>, [string, string]>(async () => ({
    changed: false,
    changedPixelRatio: 0,
    changedTileRatio: 0,
    meanDelta: 0,
  })),
  getCurrentForegroundApp: jest.fn<Promise<{ packageName: string; className: string }>, []>(
    async () => ({ packageName: 'com.test', className: 'MainActivity' }),
  ),
  suspendOverlayForAutomation: jest.fn<Promise<boolean>, []>(async () => false),
  resumeOverlayAfterAutomation: jest.fn<Promise<void>, []>(async () => undefined),
  openApp: jest.fn<Promise<boolean>, [string]>(async () => true),
  getInstalledApps: jest.fn<Promise<unknown>, []>(async () => []),
};

jest.mock('react-native-accessibility-controller', () => mockCtrl);

interface ProviderCapture {
  provider: LLMProviderInterface;
  messagesList: LLMMessage[][];
}

function makeProvider(responses: string[]): ProviderCapture {
  const messagesList: LLMMessage[][] = [];
  const generateWithTools = jest.fn(async (messages: LLMMessage[]) => {
    messagesList.push(messages);
    const idx = messagesList.length - 1;
    return idx < responses.length ? responses[idx] : '';
  });
  return {
    provider: { generateWithTools } as unknown as LLMProviderInterface,
    messagesList,
  };
}

async function collectEvents(loop: AgentLoop): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of loop.run('测试任务')) events.push(e);
  return events;
}

const taskComplete = '{"name": "task_complete", "arguments": {"summary": "已完成"}}';

/** Interactive button with a bounds rect (the serializer's filter keeps it). */
function buttonNode(
  overrides: Partial<{
    text: string | null;
    nodeId: string;
    className: string;
    bounds: { left: number; top: number; right: number; bottom: number };
    isEditable: boolean;
  }>,
) {
  return {
    className: 'android.widget.Button',
    text: null,
    isClickable: true,
    children: [],
    bounds: { left: 0, top: 0, right: 200, bottom: 100 },
    ...overrides,
  };
}

describe('tool-result rendering in the prompt', () => {
  beforeEach(() => {
    mockCtrl.getAccessibilityTree.mockReset().mockImplementation(async () => ({
      text: '测试屏幕',
      children: [],
      resourceId: 'test',
      className: 'View',
    }));
    mockCtrl.tapNode.mockReset().mockImplementation(async () => false);
    mockCtrl.tapNodeAt.mockReset().mockImplementation(async () => false);
    mockCtrl.tapByQuery.mockReset().mockImplementation(async () => ({
      found: false,
      accepted: false,
      method: null,
      matchCount: 0,
      selectedIndex: 0,
      text: null,
      contentDescription: null,
      resourceId: null,
      bounds: null,
      reason: 'no_match',
    }));
    mockCtrl.tap.mockReset().mockImplementation(async () => false);
    mockCtrl.isMediaProjectionReady.mockReset().mockImplementation(async () => true);
    mockCtrl.captureWithMediaProjection.mockReset().mockImplementation(async () => ({
      path: '/tmp/tap-frame.jpg',
      base64: 'frame',
    }));
    mockCtrl.compareScreenshotFiles.mockReset().mockImplementation(async () => ({
      changed: false,
      changedPixelRatio: 0,
      changedTileRatio: 0,
      meanDelta: 0,
    }));
    mockCtrl.getCurrentForegroundApp.mockReset().mockImplementation(async () => ({
      packageName: 'com.test',
      className: 'MainActivity',
    }));
    mockCtrl.suspendOverlayForAutomation.mockReset().mockImplementation(async () => false);
    mockCtrl.resumeOverlayAfterAutomation.mockReset().mockImplementation(async () => undefined);
    mockCtrl.openApp.mockReset().mockImplementation(async () => true);
    mockCtrl.getInstalledApps.mockReset().mockImplementation(async () => []);
  });

  test('emits privacy-safe timing diagnostics for a decision round', async () => {
    const { provider } = makeProvider([
      '{"name":"list_apps","arguments":{}}',
      taskComplete,
    ]);
    const timing: Array<Record<string, unknown>> = [];

    await collectEvents(new AgentLoop({
      provider,
      maxSteps: 3,
      settleMs: 0,
      onTimingDiagnostic: (event) => timing.push(event),
    }));

    expect(timing).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'context_build', round: 1, status: 'ok' }),
      expect.objectContaining({ stage: 'inference_attempt', round: 1, status: 'ok' }),
      expect.objectContaining({ stage: 'inference_total', round: 1 }),
      expect.objectContaining({ stage: 'tool_execute', round: 1, tool: 'list_apps', ok: true }),
      expect.objectContaining({ stage: 'round_complete', round: 1, toolCallCount: 1 }),
    ]));
    expect(timing.some((event) => 'args' in event || 'result' in event)).toBe(false);
  });

  test.skip('failed tap renders error and hint into the next prompt', async () => {
    // A stale nodeId that is not in the mocked (empty) accessibility tree.
    const tapCall = '{"name": "ui_tap", "arguments": {"nodeId": "1:stale"}}';
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    const loop = new AgentLoop({ provider, maxSteps: 3, settleMs: 0 });
    await collectEvents(loop);

    // The assistant contains only tool_use; the following user turn carries
    // the paired error result and recovery hint.
    const secondAssistant = messagesList[1].find((m) => m.role === 'assistant');
    const secondUser = messagesList[1].find((m) => m.role === 'user' && m.content.includes('<tool_result'));
    expect(secondAssistant?.content).toContain('<tool_use id="toolu_1" name="ui_tap">');
    expect(secondAssistant?.content).not.toContain('不在当前屏幕');
    expect(secondUser?.content).toContain('tool_use_id="toolu_1" is_error="true"');
    expect(secondUser?.content).toContain('nodeId \\"1:stale\\" 不在当前屏幕元素列表中');
    expect(secondUser?.content).toContain('请根据当前屏幕元素列表重新选择 nodeId');
  });

  test.skip('a stale nodeId with coordinates is rejected instead of silently becoming a visual tap', async () => {
    mockCtrl.getAccessibilityTree.mockResolvedValue([]);
    const tapCall = '{"name":"ui_tap","arguments":{"nodeId":"1:stale","x":640,"y":200}}';
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    expect(mockCtrl.tap).not.toHaveBeenCalled();
    expect(mockCtrl.tapNode).not.toHaveBeenCalled();
    expect(mockCtrl.tapNodeAt).not.toHaveBeenCalled();
    const result = messagesList[1].find(
      (message) => message.role === 'user' && message.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('is_error="true"');
    expect(result).toContain('nodeId \\"1:stale\\" 不在当前屏幕元素列表中');
    expect(result).toContain('不要携带过期 nodeId');
  });

  test.skip('a node position conflict is rejected without dispatching either target', async () => {
    const unrelatedNode = buttonNode({
      text: '3C开学季',
      nodeId: '1:com.test:id/card',
      bounds: { left: 100, top: 500, right: 900, bottom: 900 },
    });
    mockCtrl.getAccessibilityTree.mockResolvedValue([unrelatedNode]);

    const tapCall = '{"name":"ui_tap","arguments":{"nodeId":"1:com.test:id/card","x":640,"y":200}}';
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    expect(mockCtrl.tap).not.toHaveBeenCalled();
    expect(mockCtrl.tapNode).not.toHaveBeenCalled();
    expect(mockCtrl.tapNodeAt).not.toHaveBeenCalled();
    const result = messagesList[1].find(
      (message) => message.role === 'user' && message.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('is_error="true"');
    expect(result).toContain('TARGET_CONFLICT');
    expect(result).toContain('未派发点击');
  });

  test.skip('a scroll-only root container is rejected as a tap target', async () => {
    mockCtrl.getAccessibilityTree.mockResolvedValue([{
      className: 'androidx.viewpager.widget.ViewPager',
      nodeId: '1:com.test:id/root',
      isScrollable: true,
      bounds: { left: 0, top: 0, right: 1440, bottom: 3025 },
    }]);
    const tapCall = '{"name":"ui_tap","arguments":{"nodeId":"1:com.test:id/root","x":400,"y":180}}';
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    expect(mockCtrl.tap).not.toHaveBeenCalled();
    expect(mockCtrl.tapNode).not.toHaveBeenCalled();
    expect(mockCtrl.tapNodeAt).not.toHaveBeenCalled();
    const result = messagesList[1].find(
      (message) => message.role === 'user' && message.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('TARGET_NOT_ACTIONABLE');
    expect(result).toContain('纯滚动');
  });

  test.skip('tap without valid arguments explains what is missing', async () => {
    const tapCall = '{"name": "ui_tap", "arguments": {}}';
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    const loop = new AgentLoop({ provider, maxSteps: 3, settleMs: 0 });
    await collectEvents(loop);

    const secondUser = messagesList[1].find((m) => m.role === 'user' && m.content.includes('<tool_result'));
    expect(secondUser?.content).toContain('tap 缺少有效参数');
    expect(secondUser?.content).toContain('请提供当前屏幕元素列表中的 nodeId');
  });

  test.skip('find_node explains that an empty match only applies to the current accessibility tree', async () => {
    const findCall = '{"name": "ui_find_node", "arguments": {"className": "android.widget.Button"}}';
    const { provider, messagesList } = makeProvider([findCall, taskComplete]);
    const loop = new AgentLoop({ provider, maxSteps: 3, settleMs: 0 });
    await collectEvents(loop);

    // The empty mock tree yields a scoped no-match result rather than a bare null.
    const secondUser = messagesList[1].find((m) => m.role === 'user' && m.content.includes('<tool_result'));
    expect(secondUser?.content).toContain('is_error="false"');
    expect(secondUser?.content).toContain('"found":false');
    expect(secondUser?.content).toContain('"reason":"NO_MATCH_IN_CURRENT_ACCESSIBILITY_TREE"');
    expect(secondUser?.content).toContain('"scope":"current_accessibility_tree"');
    expect(secondUser?.content).toContain('"matchCount":0');
  });

  test.skip('find_node returns a structured target with bounds, center and match count', async () => {
    mockCtrl.getAccessibilityTree.mockResolvedValue([
      buttonNode({
        text: '搜索',
        nodeId: '1:com.test:id/desc',
        bounds: { left: 400, top: 2800, right: 680, bottom: 3000 },
      }),
      buttonNode({
        text: '搜索推荐',
        nodeId: '1:com.test:id/recommend',
        bounds: { left: 40, top: 400, right: 400, bottom: 520 },
      }),
    ]);
    const findCall = '{"name":"ui_find_node","arguments":{"text":"搜索"}}';
    const { provider, messagesList } = makeProvider([findCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    const result = messagesList[1].find(
      (m) => m.role === 'user' && m.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('"nodeId":"1:com.test:id/desc"');
    expect(result).toContain('"text":"搜索"');
    expect(result).toContain('"bounds":{"left":400,"top":2800,"right":680,"bottom":3000}');
    expect(result).toContain('"center":{"x":540,"y":2900}');
    expect(result).toContain('"matchCount":2');
  });

  test.skip('explicit UI inspection is returned only as a tool result', async () => {
    const inspectUi = '{"name":"ui_inspect","arguments":{}}';
    const { provider, messagesList } = makeProvider([inspectUi, taskComplete]);
    const loop = new AgentLoop({ provider, maxSteps: 2, settleMs: 0 });
    await collectEvents(loop);

    const secondUser = messagesList[1].find((m) => m.role === 'user' && m.content.includes('<tool_result'));
    expect(secondUser?.content).toContain('is_error="false"');
    expect(secondUser?.content).toContain('屏幕元素');
    expect(secondUser?.content).not.toContain('屏幕观察状态');
  });

  test.skip('numeric nodeId resolves to the Nth element and taps its center', async () => {
    // The serialized list numbers elements [1]..[N]; the model often passes
    // that number as nodeId. It must resolve to the element, not be rejected.
    const tree = [
      buttonNode({
        text: '第一个',
        bounds: { left: 0, top: 0, right: 200, bottom: 100 },
      }),
      buttonNode({
        text: '第二个',
        bounds: { left: 100, top: 200, right: 300, bottom: 300 },
      }),
    ];
    mockCtrl.getAccessibilityTree
      .mockResolvedValueOnce(tree)
      .mockResolvedValue([{ ...tree[0], text: '新页面', isFocused: true }, buttonNode({ text: '页面内容' })]);
    mockCtrl.tap.mockResolvedValue(true);

    const tapCall = '{"name": "ui_tap", "arguments": {"nodeId": "2"}}';
    const { provider } = makeProvider([tapCall, taskComplete]);
    const loop = new AgentLoop({ provider, maxSteps: 3, settleMs: 0 });
    await collectEvents(loop);

    // Element #2 has no nodeId → tap its center coordinates directly.
    expect(mockCtrl.tap).toHaveBeenCalledWith(200, 250);
    expect(mockCtrl.tapNode).not.toHaveBeenCalled();
  });

  test.skip('numeric nodeId with coordinates dispatches only the supplied coordinate tap', async () => {
    const tree = [buttonNode({
      text: '搜索框',
      nodeId: '1:com.test:id/search',
      bounds: { left: 100, top: 120, right: 900, bottom: 280 },
    })];
    mockCtrl.getAccessibilityTree
      .mockResolvedValueOnce(tree)
      .mockResolvedValue([buttonNode({ text: '搜索页面', isEditable: true })]);
    mockCtrl.tap.mockResolvedValue(true);
    mockCtrl.suspendOverlayForAutomation.mockResolvedValue(true);

    const tapCall = '{"name":"ui_tap","arguments":{"nodeId":"1","x":640,"y":200}}';
    const { provider } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    expect(mockCtrl.tap).toHaveBeenCalledTimes(1);
    expect(mockCtrl.tap).toHaveBeenCalledWith(640, 200);
    expect(mockCtrl.tapNodeAt).not.toHaveBeenCalled();
    expect(mockCtrl.tapNode).not.toHaveBeenCalled();
    expect(mockCtrl.suspendOverlayForAutomation).toHaveBeenCalledTimes(1);
    expect(mockCtrl.resumeOverlayAfterAutomation).toHaveBeenCalledTimes(1);
    expect(mockCtrl.suspendOverlayForAutomation.mock.invocationCallOrder[0])
      .toBeLessThan(mockCtrl.tap.mock.invocationCallOrder[0]);
    expect(mockCtrl.tap.mock.invocationCallOrder[0])
      .toBeLessThan(mockCtrl.resumeOverlayAfterAutomation.mock.invocationCallOrder[0]);
  });

  test.skip('numeric nodeId rejects stale coordinates outside the resolved element', async () => {
    mockCtrl.getAccessibilityTree.mockResolvedValue([buttonNode({
      text: '搜索框',
      bounds: { left: 100, top: 120, right: 900, bottom: 280 },
    })]);
    const tapCall = '{"name":"ui_tap","arguments":{"nodeId":"1","x":1200,"y":200}}';
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    expect(mockCtrl.tap).not.toHaveBeenCalled();
    expect(mockCtrl.tapNodeAt).not.toHaveBeenCalled();
    expect(mockCtrl.tapNode).not.toHaveBeenCalled();
    const result = messagesList[1].find(
      (message) => message.role === 'user' && message.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('TARGET_CHANGED');
    expect(result).toContain('不在序号 1 对应元素的当前边界内');
  });

  test.skip('numeric nodeId beyond the list explains the current size', async () => {
    const tapCall = '{"name": "ui_tap", "arguments": {"nodeId": "99"}}';
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    const loop = new AgentLoop({ provider, maxSteps: 3, settleMs: 0 });
    await collectEvents(loop);

    const secondUser = messagesList[1].find((m) => m.role === 'user' && m.content.includes('<tool_result'));
    expect(secondUser?.content).toContain('序号 99 超出当前屏幕元素列表范围');
    expect(mockCtrl.tap).not.toHaveBeenCalled();
  });

  test.skip('rejected node action auto-retries via the element center coordinates', async () => {
    // Node exists in the tree but ACTION_CLICK is rejected (finance-app style
    // blocking): tap must fall back to coordinates without model involvement.
    const tree = [
      buttonNode({
        text: '按钮',
        nodeId: '1:com.test:id/btn',
        bounds: { left: 10, top: 20, right: 210, bottom: 120 },
      }),
    ];
    mockCtrl.getAccessibilityTree
      .mockResolvedValueOnce(tree)
      .mockResolvedValueOnce(tree)
      .mockResolvedValueOnce(tree)
      .mockResolvedValue([{ ...tree[0], text: '新页面', isFocused: true }, buttonNode({ text: '页面内容' })]);
    mockCtrl.tapNode.mockResolvedValue(false);
    mockCtrl.tap.mockResolvedValue(true);

    const tapCall = '{"name": "ui_tap", "arguments": {"nodeId": "1:com.test:id/btn"}}';
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    const loop = new AgentLoop({ provider, maxSteps: 3, settleMs: 0 });
    await collectEvents(loop);

    expect(mockCtrl.tapNode).toHaveBeenCalledWith('1:com.test:id/btn');
    expect(mockCtrl.tap).toHaveBeenCalledWith(110, 70);
    const secondUser = messagesList[1].find((m) => m.role === 'user' && m.content.includes('<tool_result'));
    expect(secondUser?.content).toContain('is_error="false"');
  });

  test.skip('semantic tap searches and clicks natively without a model-side tree read', async () => {
    mockCtrl.tapByQuery.mockResolvedValue({
      found: true,
      accepted: true,
      method: 'ancestor_action',
      matchCount: 1,
      selectedIndex: 0,
      text: null,
      contentDescription: '搜索',
      resourceId: 'com.jingdong.app.mall:id/a8q',
      bounds: { left: 80, top: 170, right: 1280, bottom: 310 },
      center: { x: 680, y: 240 },
      reason: null,
    });
    mockCtrl.captureWithMediaProjection
      .mockResolvedValueOnce({ path: '/tmp/semantic-before.jpg', base64: 'before' })
      .mockResolvedValueOnce({ path: '/tmp/semantic-after.jpg', base64: 'after' });
    mockCtrl.compareScreenshotFiles.mockResolvedValue({
      changed: true,
      changedPixelRatio: 0.35,
      changedTileRatio: 0.42,
      meanDelta: 38,
    });

    const tapCall = '{"name":"ui_tap","arguments":{"contentDescription":"搜索"}}';
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    expect(mockCtrl.tapByQuery).toHaveBeenCalledWith('', '搜索', '', 0);
    expect(mockCtrl.getAccessibilityTree).not.toHaveBeenCalled();
    expect(mockCtrl.tap).not.toHaveBeenCalled();
    expect(mockCtrl.compareScreenshotFiles).toHaveBeenCalledWith(
      '/tmp/semantic-before.jpg',
      '/tmp/semantic-after.jpg',
    );
    const result = messagesList[1].find(
      (message) => message.role === 'user' && message.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('is_error="false"');
    expect(result).toContain('"method":"semantic"');
    expect(result).toContain('"contentDescription":"搜索"');
    expect(result).toContain('"x":680');
  });

  test.skip('semantic tap reports a native no-match without guessing coordinates', async () => {
    const tapCall = '{"name":"ui_tap","arguments":{"text":"不存在的目标"}}';
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    expect(mockCtrl.tapByQuery).toHaveBeenCalledWith('不存在的目标', '', '', 0);
    expect(mockCtrl.tap).not.toHaveBeenCalled();
    expect(mockCtrl.tapNode).not.toHaveBeenCalled();
    const result = messagesList[1].find(
      (message) => message.role === 'user' && message.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('TARGET_NOT_FOUND');
    expect(result).toContain('当前无障碍树中没有找到语义点击目标');
  });

  test.skip('coordinate tap restores the overlay when gesture dispatch throws', async () => {
    const tree = [buttonNode({
      text: '搜索框',
      bounds: { left: 100, top: 120, right: 900, bottom: 280 },
    })];
    mockCtrl.getAccessibilityTree.mockResolvedValue(tree);
    mockCtrl.suspendOverlayForAutomation.mockResolvedValue(true);
    mockCtrl.tap.mockRejectedValue(new Error('gesture channel unavailable'));

    const tapCall = '{"name":"ui_tap","arguments":{"nodeId":"1","x":640,"y":200}}';
    const { provider } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    expect(mockCtrl.suspendOverlayForAutomation).toHaveBeenCalledTimes(1);
    expect(mockCtrl.resumeOverlayAfterAutomation).toHaveBeenCalledTimes(1);
    expect(mockCtrl.tap.mock.invocationCallOrder[0])
      .toBeLessThan(mockCtrl.resumeOverlayAfterAutomation.mock.invocationCallOrder[0]);
  });

  test.skip('accepted node action with verified unchanged UI never dispatches a coordinate retry', async () => {
    const sharedId = '1:com.alipay:id/product_card';
    const tree = [buttonNode({
      className: 'android.widget.LinearLayout',
      text: '长钱保·五年领年金',
      nodeId: sharedId,
      bounds: { left: 120, top: 480, right: 1320, bottom: 760 },
    })];
    mockCtrl.getAccessibilityTree.mockResolvedValue(tree);
    mockCtrl.tapNodeAt.mockResolvedValue(true);
    mockCtrl.tap.mockResolvedValue(true);

    const tapCall = `{"name":"ui_tap","arguments":{"nodeId":"${sharedId}","x":720,"y":620}}`;
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    expect(mockCtrl.tapNodeAt).toHaveBeenCalledWith(sharedId, 720, 620);
    expect(mockCtrl.tap).not.toHaveBeenCalled();
    const result = messagesList[1].find(
      (message) => message.role === 'user' && message.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('is_error="true"');
    expect(result).toContain('UI_UNCHANGED');
    expect(result).toContain('"screenChanged":false');
  });

  test.skip('accepted stateful control action does not auto-dispatch a second coordinate tap', async () => {
    const nodeId = '1:com.test:id/submit';
    const tree = [buttonNode({
      text: '确认提交',
      nodeId,
      bounds: { left: 400, top: 2600, right: 1040, bottom: 2820 },
    })];
    mockCtrl.getAccessibilityTree.mockResolvedValue(tree);
    mockCtrl.tapNodeAt.mockResolvedValue(true);

    const tapCall = `{"name":"ui_tap","arguments":{"nodeId":"${nodeId}","x":720,"y":2710}}`;
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    expect(mockCtrl.tap).not.toHaveBeenCalled();
    const result = messagesList[1].find(
      (message) => message.role === 'user' && message.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('is_error="true"');
    expect(result).toContain('未检测到有意义的页面变化');
  });

  test.skip('visual-only WebView change is verified locally without a second tap', async () => {
    const nodeId = '1:com.alipay:id/payment_mode';
    const tree = [buttonNode({
      className: 'android.view.View',
      text: '按期交纳保费',
      nodeId,
      bounds: { left: 892, top: 69, right: 1350, bottom: 254 },
    })];
    mockCtrl.getAccessibilityTree.mockResolvedValue(tree);
    mockCtrl.tapNodeAt.mockResolvedValue(true);
    mockCtrl.captureWithMediaProjection
      .mockResolvedValueOnce({ path: '/tmp/before.jpg', base64: 'before' })
      .mockResolvedValueOnce({ path: '/tmp/after.jpg', base64: 'after' });
    mockCtrl.compareScreenshotFiles.mockResolvedValue({
      changed: true,
      changedPixelRatio: 0.31,
      changedTileRatio: 0.4,
      meanDelta: 42,
    });

    const tapCall = `{"name":"ui_tap","arguments":{"nodeId":"${nodeId}","x":1121,"y":162}}`;
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    expect(mockCtrl.tapNodeAt).toHaveBeenCalledTimes(1);
    expect(mockCtrl.tap).not.toHaveBeenCalled();
    expect(mockCtrl.compareScreenshotFiles).toHaveBeenCalledWith(
      '/tmp/before.jpg',
      '/tmp/after.jpg',
    );
    const result = messagesList[1].find(
      (message) => message.role === 'user' && message.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('is_error="false"');
    expect(result).toContain('"verification":"visual_diff"');
    expect(result).toContain('"verificationStatus":"verified_changed"');
  });

  test.skip('accepted click without visual comparison returns UI_CHANGE_UNVERIFIED and never retries', async () => {
    const nodeId = '1:com.test:id/custom_view';
    const tree = [buttonNode({
      className: 'android.view.View',
      text: '自定义控件',
      nodeId,
      bounds: { left: 200, top: 400, right: 800, bottom: 620 },
    })];
    mockCtrl.getAccessibilityTree.mockResolvedValue(tree);
    mockCtrl.tapNodeAt.mockResolvedValue(true);
    mockCtrl.isMediaProjectionReady.mockResolvedValue(false);

    const tapCall = `{"name":"ui_tap","arguments":{"nodeId":"${nodeId}","x":500,"y":510}}`;
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    expect(mockCtrl.tapNodeAt).toHaveBeenCalledTimes(1);
    expect(mockCtrl.tap).not.toHaveBeenCalled();
    const result = messagesList[1].find(
      (message) => message.role === 'user' && message.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('UI_CHANGE_UNVERIFIED');
    expect(result).toContain('"verificationStatus":"accepted_unverified"');
  });

  test.skip('a duplicated nodeId cannot be tapped without disambiguating coordinates', async () => {
    const sharedId = '1:com.test:id/desc';
    mockCtrl.getAccessibilityTree.mockResolvedValue([
      buttonNode({
        text: '首页',
        nodeId: sharedId,
        bounds: { left: 100, top: 2800, right: 360, bottom: 3000 },
      }),
      buttonNode({
        text: '搜索',
        nodeId: sharedId,
        bounds: { left: 400, top: 2800, right: 680, bottom: 3000 },
      }),
    ]);
    const tapCall = `{"name":"ui_tap","arguments":{"nodeId":"${sharedId}"}}`;
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    const result = messagesList[1].find(
      (m) => m.role === 'user' && m.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('AMBIGUOUS_NODE_ID');
    expect(result).toContain('出现 2 次');
    expect(result).toContain('"matchCount":2');
    expect(mockCtrl.tapNode).not.toHaveBeenCalled();
    expect(mockCtrl.tapNodeAt).not.toHaveBeenCalled();
  });

  test.skip('a duplicated nodeId with center coordinates uses tapNodeAt and verifies change', async () => {
    const sharedId = '1:com.test:id/desc';
    const tree = [
      buttonNode({ text: '首页', nodeId: sharedId, bounds: { left: 100, top: 2800, right: 360, bottom: 3000 } }),
      buttonNode({ text: '搜索', nodeId: sharedId, bounds: { left: 400, top: 2800, right: 680, bottom: 3000 } }),
    ];
    mockCtrl.getAccessibilityTree
      .mockResolvedValueOnce(tree)
      .mockResolvedValue([buttonNode({ text: '搜索页面' }), buttonNode({ text: '输入框' })]);
    mockCtrl.tapNodeAt.mockResolvedValue(true);
    const tapCall = `{"name":"ui_tap","arguments":{"nodeId":"${sharedId}","x":540,"y":2900}}`;
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    expect(mockCtrl.tapNodeAt).toHaveBeenCalledWith(sharedId, 540, 2900);
    expect(mockCtrl.tapNode).not.toHaveBeenCalled();
    const result = messagesList[1].find(
      (m) => m.role === 'user' && m.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('is_error="false"');
    expect(result).toContain('"screenChanged":true');
  });

  test.skip('native tap acceptance without a meaningful UI change returns UI_UNCHANGED', async () => {
    const tree = [buttonNode({ text: '首页', nodeId: '1:com.test:id/home' })];
    mockCtrl.getAccessibilityTree.mockResolvedValue(tree);
    mockCtrl.tapNode.mockResolvedValue(true);
    const tapCall = '{"name":"ui_tap","arguments":{"nodeId":"1:com.test:id/home"}}';
    const { provider, messagesList } = makeProvider([tapCall, taskComplete]);
    await collectEvents(new AgentLoop({
      provider,
      maxSteps: 3,
      settleMs: 0,
    }));

    const result = messagesList[1].find(
      (m) => m.role === 'user' && m.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('is_error="true"');
    expect(result).toContain('UI_UNCHANGED');
    expect(result).toContain('"actionAccepted":true');
    expect(result).toContain('"screenChanged":false');
  });

  test('list_apps array result is fully inlined so the model sees real packages', async () => {
    // Enumeration tools return large arrays; they must not collapse to a
    // bare success marker — the model needs the package names to open apps.
    mockCtrl.getInstalledApps.mockResolvedValue([
      { label: '浏览器', packageName: 'com.android.browser' },
      { label: '日历', packageName: 'com.android.calendar' },
      { label: '音乐', packageName: 'com.miui.player' },
    ]);

    const listCall = '{"name": "list_apps", "arguments": {}}';
    const { provider, messagesList } = makeProvider([listCall, taskComplete]);
    const loop = new AgentLoop({ provider, maxSteps: 3, settleMs: 0 });
    await collectEvents(loop);

    const secondAssistant = messagesList[1].find((m) => m.role === 'assistant');
    const secondUser = messagesList[1].find((m) => m.role === 'user' && m.content.includes('<tool_result'));
    expect(secondAssistant?.content).toContain('name="list_apps"');
    // Every installed app must be visible in the result, not assistant text.
    expect(secondAssistant?.content).not.toContain('com.android.browser');
    expect(secondUser?.content).toContain('浏览器');
    expect(secondUser?.content).toContain('com.android.browser');
    expect(secondUser?.content).toContain('音乐');
    expect(secondUser?.content).toContain('com.miui.player');
  });

  test('batched calls receive ordered ids and ordered results before observation', async () => {
    mockCtrl.getInstalledApps.mockResolvedValue([{ label: '日历', packageName: 'calendar' }]);
    const batch = JSON.stringify([
      { name: 'list_apps', arguments: {} },
      { name: 'ui_find_node', arguments: { text: '确认' } },
    ]);
    const { provider, messagesList } = makeProvider([batch, taskComplete]);
    const loop = new AgentLoop({ provider, maxSteps: 3, settleMs: 0 });
    await collectEvents(loop);

    const assistant = messagesList[1].find((m) => m.role === 'assistant')?.content ?? '';
    const user = messagesList[1].find((m) => m.role === 'user' && m.content.includes('<tool_result'))?.content ?? '';
    expect(assistant.indexOf('id="toolu_1" name="list_apps"')).toBeLessThan(
      assistant.indexOf('id="toolu_2" name="ui_find_node"'),
    );
    expect(user.indexOf('tool_use_id="toolu_1"')).toBeLessThan(
      user.indexOf('tool_use_id="toolu_2"'),
    );
    expect(user.indexOf('tool_use_id="toolu_2"')).toBeLessThan(user.indexOf('工具调用结束'));
  });

  test('sensitive and binary payloads are excluded from prompt history', async () => {
    const secretTool = {
      name: 'secret_lookup',
      description: 'test',
      parameters: { type: 'object' as const, properties: {} },
      uiEffect: 'none' as const,
    };
    const { provider, messagesList } = makeProvider([
      '{"name":"secret_lookup","arguments":{}}',
      taskComplete,
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 3,
      settleMs: 0,
      extraTools: [{
        tool: secretTool,
        handler: async () => ({
          ok: true,
          data: { token: 'super-secret' },
          sensitive: true,
          observationImage: { base64: 'raw-image-bytes', mimeType: 'image/png' },
        }),
      }],
    });
    await collectEvents(loop);
    const prompt = messagesList[1].map((m) => m.content).join('\n');
    expect(prompt).toContain('敏感工具结果已从提示词隐藏');
    expect(prompt).not.toContain('super-secret');
    expect(prompt).not.toContain('raw-image-bytes');
  });

  test('list_apps forwards the complete result without a length cap', async () => {
    mockCtrl.getInstalledApps.mockResolvedValue([
      { label: 'x'.repeat(13_000), packageName: 'large.app' },
    ]);
    const { provider, messagesList } = makeProvider([
      '{"name":"list_apps","arguments":{}}',
      taskComplete,
    ]);
    const loop = new AgentLoop({ provider, maxSteps: 3, settleMs: 0 });
    await collectEvents(loop);
    const result = messagesList[1].find(
      (m) => m.role === 'user' && m.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).not.toContain('…[已截断]');
    expect(result).toContain('large.app');
  });

  test('inspect_ui forwards the complete accessibility tree without a length cap', async () => {
    mockCtrl.getAccessibilityTree.mockResolvedValue(
      Array.from({ length: 40 }, (_, index) => buttonNode({
        text: index === 39 ? '列表末尾目标' : `元素-${index}-${'x'.repeat(80)}`,
        nodeId: `1:app:id/item_${index}`,
        bounds: { left: 0, top: index * 20, right: 300, bottom: index * 20 + 18 },
      })),
    );
    const { provider, messagesList } = makeProvider([
      '{"name":"ui_inspect","arguments":{}}',
      taskComplete,
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 3,
      settleMs: 0,
      maxScreenLength: 100,
    });

    await collectEvents(loop);

    const result = messagesList[1].find(
      (message) => message.role === 'user' && message.content.includes('<tool_result'),
    )?.content ?? '';
    expect(result).toContain('列表末尾目标');
    expect(result).not.toContain('…[已截断]');
  });

  test('keeps a stable compact observation after a successful screen-changing action', async () => {
    mockCtrl.getAccessibilityTree.mockResolvedValue(buttonNode({
      text: '只属于旧界面的联系人列表',
      nodeId: '1:app:id/old_list',
    }));
    const { provider, messagesList } = makeProvider([
      '{"name":"ui_inspect","arguments":{}}',
      '{"name":"mutate_ui","arguments":{}}',
      taskComplete,
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 4,
      settleMs: 0,
      extraTools: [{
        tool: {
          name: 'mutate_ui',
          description: 'test screen mutation',
          uiEffect: 'change',
          parameters: { type: 'object', properties: {} },
        },
        handler: async () => ({ ok: true, data: { dispatched: true } }),
      }],
    });

    await collectEvents(loop);

    const afterMutation = messagesList[2].map((message) => message.content).join('\n');
    expect(afterMutation).toContain('transientStructure');
    expect(afterMutation).toContain('ui_inspect_toolu_1');
    expect(afterMutation).not.toContain('只属于旧界面的联系人列表');
  });

  test('does not resend a consumed accessibility observation after a failed action', async () => {
    mockCtrl.getAccessibilityTree.mockResolvedValue(buttonNode({
      text: '失败动作后仍有效的联系人列表',
      nodeId: '1:app:id/current_list',
    }));
    const { provider, messagesList } = makeProvider([
      '{"name":"ui_inspect","arguments":{}}',
      '{"name":"mutate_ui","arguments":{}}',
      taskComplete,
    ]);
    const loop = new AgentLoop({
      provider,
      maxSteps: 4,
      settleMs: 0,
      extraTools: [{
        tool: {
          name: 'mutate_ui',
          description: 'test failed screen mutation',
          uiEffect: 'change',
          parameters: { type: 'object', properties: {} },
        },
        handler: async () => ({ ok: false, error: 'not dispatched' }),
      }],
    });

    await collectEvents(loop);

    const afterFailure = messagesList[2].map((message) => message.content).join('\n');
    expect(afterFailure).toContain('transientStructure');
    expect(afterFailure).not.toContain('失败动作后仍有效的联系人列表');
    expect(afterFailure).not.toContain('observationInvalidated');
  });

  test('sends a full accessibility tree once, keeps raw AgentEvent data, and places it after the cache breakpoint', async () => {
    mockCtrl.getAccessibilityTree.mockResolvedValue(buttonNode({
      text: '只发送一次的页面目标',
      nodeId: '1:app:id/one_shot',
    }));
    const { provider, messagesList } = makeProvider([
      '{"name":"ui_inspect","arguments":{}}',
      '{"name":"list_apps","arguments":{}}',
      taskComplete,
    ]);
    const events = await collectEvents(new AgentLoop({ provider, maxSteps: 4, settleMs: 0 }));

    const immediate = messagesList[1];
    const immediateText = immediate.map((message) => message.content).join('\n');
    const laterText = messagesList[2].map((message) => message.content).join('\n');
    expect(immediateText).toContain('<current_ui_observation');
    expect(immediateText).toContain('只发送一次的页面目标');
    expect(laterText).not.toContain('只发送一次的页面目标');
    expect(laterText).toContain('transientStructure');

    const cacheBoundary = immediate.reduce(
      (latest, message, index) => message.cache ? index : latest,
      -1,
    );
    const transientIndex = immediate.findIndex((message) =>
      message.content.includes('<current_ui_observation'));
    expect(cacheBoundary).toBeGreaterThanOrEqual(0);
    expect(transientIndex).toBeGreaterThan(cacheBoundary);

    const inspectEvent = events.find(
      (event): event is Extract<AgentEvent, { type: 'action' }> =>
        event.type === 'action' && event.tool === 'ui_inspect',
    );
    expect(JSON.stringify(inspectEvent?.result)).toContain('只发送一次的页面目标');
  });

  test('reuses the identical transient tree across inference retries', async () => {
    mockCtrl.getAccessibilityTree.mockResolvedValue(buttonNode({
      text: '重试期间保持不变',
      nodeId: '1:app:id/retry_tree',
    }));
    const attempts: LLMMessage[][] = [];
    let call = 0;
    const provider = {
      generateWithTools: jest.fn(async (messages: LLMMessage[]) => {
        attempts.push(messages);
        call += 1;
        if (call === 1) return '{"name":"ui_inspect","arguments":{}}';
        if (call === 2) throw new Error('temporary network error');
        return taskComplete;
      }),
    } as unknown as LLMProviderInterface;

    await collectEvents(new AgentLoop({
      provider,
      maxSteps: 3,
      settleMs: 0,
      retryOnError: 1,
      requestTimeoutMs: 0,
    }));

    const firstAttempt = attempts[1].map((message) => message.content).join('\n');
    const retryAttempt = attempts[2].map((message) => message.content).join('\n');
    expect(firstAttempt).toContain('重试期间保持不变');
    expect(retryAttempt).toBe(firstAttempt);
  });

  test('top-level click is rejected instead of being executed as tap', async () => {
    const clickCall = '{"name":"click","arguments":{"mode":"text","text":"按钮"}}';
    const { provider } = makeProvider([clickCall, taskComplete]);
    const events = await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));

    const clickEvent = events.find(
      (event): event is Extract<AgentEvent, { type: 'action' }> =>
        event.type === 'action' && event.tool === 'click',
    );
    expect(clickEvent?.result).toMatchObject({ ok: false, code: 'TOOL_NOT_FOUND' });
    expect(mockCtrl.tapByQuery).not.toHaveBeenCalled();
  });

  test('protocol-aware providers receive structured tool history without XML wrappers', async () => {
    const captured: ModelMessage[][] = [];
    const responses: ModelResponse[] = [
      {
        content: [{
          type: 'tool_call',
          id: 'provider_call_1',
          name: 'list_apps',
          arguments: {},
        }],
        finishReason: 'tool_call',
      },
      {
        content: [{
          type: 'tool_call',
          id: 'provider_call_2',
          name: 'task_complete',
          arguments: { summary: '已完成' },
        }],
        finishReason: 'tool_call',
      },
    ];
    const provider = {
      generateWithTools: jest.fn(async () => {
        throw new Error('legacy path should not run');
      }),
      generateStructuredWithTools: jest.fn(async (messages: ModelMessage[]) => {
        captured.push(messages);
        return responses[captured.length - 1];
      }),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({ provider, maxSteps: 3, settleMs: 0 });
    await collectEvents(loop);

    expect(provider.generateWithTools).not.toHaveBeenCalled();
    const assistant = captured[1].find((message) => message.role === 'assistant');
    const user = captured[1].find(
      (message) => message.role === 'user' &&
        message.content.some((item) => item.type === 'tool_result'),
    );
    expect(assistant?.content).toEqual([
      { type: 'tool_call', id: 'provider_call_1', name: 'list_apps', arguments: {} },
    ]);
    expect(user?.content[0]).toMatchObject({
      type: 'tool_result',
      callId: 'provider_call_1',
      result: { ok: true },
    });
    expect(JSON.stringify(captured[1])).not.toContain('<tool_use');
  });

  test('malformed native tool arguments are reported without reaching the tool handler', async () => {
    const malformed = '{"mode":"ref","ref":"u56r","_risk":{"level":"low","summary":"点击"咻咻满"搜索"}}';
    const captured: ModelMessage[][] = [];
    const responses: ModelResponse[] = [
      {
        content: [{
          type: 'tool_call',
          id: 'bad_call',
          name: 'ui_tap',
          arguments: {},
          argumentParseError: {
            code: 'MALFORMED_TOOL_ARGUMENTS',
            message: 'Unexpected token',
            rawArgumentsPreview: malformed,
          },
        }],
        finishReason: 'tool_call',
      },
      {
        content: [{
          type: 'tool_call',
          id: 'done_call',
          name: 'task_complete',
          arguments: { summary: '已纠正' },
        }],
        finishReason: 'tool_call',
      },
    ];
    const provider = {
      generateWithTools: jest.fn(async () => {
        throw new Error('legacy path should not run');
      }),
      generateStructuredWithTools: jest.fn(async (messages: ModelMessage[]) => {
        captured.push(messages);
        return responses[captured.length - 1];
      }),
    } as unknown as LLMProviderInterface;

    const events = await collectEvents(new AgentLoop({ provider, maxSteps: 3, settleMs: 0 }));
    const malformedEvent = events.find(
      (event): event is Extract<AgentEvent, { type: 'action' }> =>
        event.type === 'action' && event.callId === 'bad_call',
    );

    expect(malformedEvent?.result).toMatchObject({
      ok: false,
      code: 'MALFORMED_TOOL_ARGUMENTS',
      details: { rawArgumentsPreview: malformed },
    });
    expect(mockCtrl.tapByQuery).not.toHaveBeenCalled();
    expect(mockCtrl.tap).not.toHaveBeenCalled();
    expect(JSON.stringify(captured[1])).toContain('MALFORMED_TOOL_ARGUMENTS');
    expect(JSON.stringify(captured[1])).toContain('英文双引号必须转义');
  });
});
