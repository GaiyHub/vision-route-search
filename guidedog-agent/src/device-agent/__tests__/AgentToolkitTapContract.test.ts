import { AgentToolkit, parseScreenshotNodeMarkers } from '../agent/AgentToolkit';
import { PHONE_TOOLS } from '../tools/PhoneTools';

type MockSemanticTapResult = {
  found: boolean;
  accepted: boolean;
  method: 'node_action' | 'ancestor_action' | 'coordinate_center' | null;
  matchCount: number;
  selectedIndex: number;
  text: string | null;
  contentDescription: string | null;
  resourceId: string | null;
  bounds: { left: number; top: number; right: number; bottom: number } | null;
  reason: string | null;
};

const semanticResult: MockSemanticTapResult = {
  found: true,
  accepted: true,
  method: 'node_action' as const,
  matchCount: 1,
  selectedIndex: 0,
  text: '搜索',
  contentDescription: null,
  resourceId: 'com.jd.app.mall:id/search',
  bounds: { left: 10, top: 20, right: 200, bottom: 100 },
  reason: null,
};

const mockCtrl = {
  tapByQuery: jest.fn(async () => semanticResult),
  tapByQueryGesture: jest.fn(async (): Promise<MockSemanticTapResult> => ({
    ...semanticResult,
    method: 'coordinate_center',
  })),
  tapByRef: jest.fn(async () => semanticResult),
  tapByRefNode: jest.fn(async () => semanticResult),
  tapByRefGesture: jest.fn(async (): Promise<MockSemanticTapResult> => ({
    ...semanticResult,
    method: 'coordinate_center',
  })),
  getNodeInfoByRef: jest.fn(async (ref: string) => ({
    found: true,
    ref,
    text: '搜索',
    contentDescription: null,
    isEditable: true,
    bounds: { left: 10, top: 20, right: 200, bottom: 100 },
  })),
  getAccessibilityTree: jest.fn(async () => [{
    ref: 'uinput',
    text: '',
    isEditable: true,
    isFocused: true,
    children: [],
  }]),
  setNodeText: jest.fn(async () => true),
  performAction: jest.fn(async () => true),
  tap: jest.fn(async () => true),
  longPressNode: jest.fn(async () => true),
  longPress: jest.fn(async () => true),
  findAccessibilityNodes: jest.fn(async () => ({
    nodes: [] as Record<string, unknown>[],
    truncated: false,
    reason: null,
    visitedNodes: 0,
    returnedNodes: 0,
    durationMs: 0,
  })),
  annotateScreenshot: jest.fn(async () => ({ path: '/tmp/marked.jpg', base64: 'marked' })),
  resizeScreenshotForModel: jest.fn(async (
    path: string,
  ) => ({
    path,
    base64: path.includes('marked') ? 'marked' : 'raw',
    width: 1440,
    height: 3200,
    mimeType: 'image/jpeg',
  })),
  recognizeScreenshotText: jest.fn(async () => ({
    elements: [] as Array<{
      text: string;
      bounds: { left: number; top: number; right: number; bottom: number };
    }>,
    imageWidth: 1440,
    imageHeight: 3200,
  })),
  suspendOverlayForAutomation: jest.fn(async () => false),
  resumeOverlayAfterAutomation: jest.fn(async () => undefined),
};

const mockSetClipboardString = jest.fn(async (_text: string) => undefined);

jest.mock('react-native-accessibility-controller', () => mockCtrl);
jest.mock('expo-clipboard', () => ({ setStringAsync: mockSetClipboardString }));

function makeToolkit(options: ConstructorParameters<typeof AgentToolkit>[1] = {}) {
  return new AgentToolkit({
    delay: async () => undefined,
    notes: new Map(),
    inspectUi: async () => '=== 屏幕元素 ===',
    captureScreenshot: async () => ({
      path: '/tmp/current.png', base64: 'png', width: 1440, height: 3200,
    }),
  }, options);
}

describe('UI tool overlay isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCtrl.suspendOverlayForAutomation.mockResolvedValue(true);
  });

  afterEach(() => {
    mockCtrl.suspendOverlayForAutomation.mockResolvedValue(false);
  });

  it('suspends and restores the overlay around a host-injected ui_* tool', async () => {
    const handler = jest.fn(async () => ({ executed: true }));
    const toolkit = makeToolkit();
    toolkit.registerTool({
      name: 'ui_test_probe',
      description: 'test-only UI probe',
      uiEffect: 'none',
      parameters: { type: 'object', properties: {} },
    }, handler);

    await expect(toolkit.execute({ name: 'ui_test_probe', arguments: {} }))
      .resolves.toMatchObject({ ok: true, data: { executed: true } });

    expect(mockCtrl.suspendOverlayForAutomation).toHaveBeenCalledTimes(1);
    expect(mockCtrl.resumeOverlayAfterAutomation).toHaveBeenCalledTimes(1);
    expect(mockCtrl.suspendOverlayForAutomation.mock.invocationCallOrder[0])
      .toBeLessThan(handler.mock.invocationCallOrder[0]);
    expect(handler.mock.invocationCallOrder[0])
      .toBeLessThan(mockCtrl.resumeOverlayAfterAutomation.mock.invocationCallOrder[0]);
  });

  it('restores the overlay when a UI handler fails', async () => {
    const handler = jest.fn(async () => {
      throw new Error('probe failed');
    });
    const toolkit = makeToolkit();
    toolkit.registerTool({
      name: 'ui_failing_probe',
      description: 'test-only failing UI probe',
      uiEffect: 'none',
      parameters: { type: 'object', properties: {} },
    }, handler);

    await expect(toolkit.execute({ name: 'ui_failing_probe', arguments: {} }))
      .resolves.toMatchObject({ ok: false });

    expect(mockCtrl.suspendOverlayForAutomation).toHaveBeenCalledTimes(1);
    expect(mockCtrl.resumeOverlayAfterAutomation).toHaveBeenCalledTimes(1);
    expect(handler.mock.invocationCallOrder[0])
      .toBeLessThan(mockCtrl.resumeOverlayAfterAutomation.mock.invocationCallOrder[0]);
  });

  it('fails open when native overlay suspension does not answer', async () => {
    mockCtrl.suspendOverlayForAutomation.mockImplementation(
      async () => await new Promise<boolean>(() => {}),
    );
    const handler = jest.fn(async () => ({ executed: true }));
    const toolkit = makeToolkit();
    toolkit.registerTool({
      name: 'ui_timeout_probe',
      description: 'test-only UI probe',
      uiEffect: 'none',
      parameters: { type: 'object', properties: {} },
    }, handler);

    await expect(toolkit.execute({ name: 'ui_timeout_probe', arguments: {} }))
      .resolves.toMatchObject({ ok: true, data: { executed: true } });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(mockCtrl.resumeOverlayAfterAutomation).toHaveBeenCalledTimes(1);
  });

  it('uses one native overlay lease for nested screenshot observation', async () => {
    const toolkit = makeToolkit();

    await expect(toolkit.execute({ name: 'ui_screenshot', arguments: {} }))
      .resolves.toMatchObject({ ok: true, data: { captured: true } });

    expect(mockCtrl.suspendOverlayForAutomation).toHaveBeenCalledTimes(1);
    expect(mockCtrl.resumeOverlayAfterAutomation).toHaveBeenCalledTimes(1);
  });

  it('does not suspend the overlay for a non-UI tool', async () => {
    const toolkit = makeToolkit();

    await expect(toolkit.execute({
      name: 'write_note',
      arguments: { key: 'probe', value: 'ok' },
    })).resolves.toMatchObject({ ok: true });

    expect(mockCtrl.suspendOverlayForAutomation).not.toHaveBeenCalled();
    expect(mockCtrl.resumeOverlayAfterAutomation).not.toHaveBeenCalled();
  });
});

describe('clipboard_set', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes without echoing clipboard contents into the tool result', async () => {
    const secret = '19270731763';
    const result = await makeToolkit().execute({
      name: 'clipboard_set',
      arguments: { text: secret },
    });

    expect(mockSetClipboardString).toHaveBeenCalledWith(secret);
    expect(result).toMatchObject({ ok: true, data: { written: true, length: secret.length } });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(mockCtrl.suspendOverlayForAutomation).not.toHaveBeenCalled();
  });

  it('rejects empty text without touching the clipboard', async () => {
    const result = await makeToolkit().execute({
      name: 'clipboard_set',
      arguments: { text: '' },
    });

    expect(result).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(mockSetClipboardString).not.toHaveBeenCalled();
  });

  it('returns a structured retryable failure when the native write fails', async () => {
    mockSetClipboardString.mockRejectedValueOnce(new Error('native unavailable'));
    const result = await makeToolkit().execute({
      name: 'clipboard_set',
      arguments: { text: '123' },
    });

    expect(result).toMatchObject({ ok: false, code: 'CLIPBOARD_WRITE_FAILED' });
  });
});

describe('explicit atomic tap modes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exposes explicit target modes without a model-facing dispatch switch', () => {
    const tap = PHONE_TOOLS.find((tool) => tool.name === 'ui_tap')!;
    expect(tap.parameters.required).toEqual(['mode']);
    expect(tap.parameters.properties.mode.enum).toEqual([
      'ref', 'text', 'content_description', 'resource_id', 'coordinate',
    ]);
    expect(tap.parameters.properties).not.toHaveProperty('dispatch');
    expect(tap.parameters.properties).not.toHaveProperty('nodeId');
    expect(tap.parameters.properties.x.description).toContain('coordinate 模式必填');
    expect(tap.parameters.properties.y.description).toContain('coordinate 模式必填');
    expect(tap.parameters.properties.x).toMatchObject({ minimum: 0, maximum: 1000 });
    expect(tap.parameters.properties.y).toMatchObject({ minimum: 0, maximum: 1000 });
    expect(tap.parameters.properties.observationId.description).toContain('产生 x、y');
    expect(tap.parameters.properties.observationId.description).toContain('界面变化后失效');
    expect(tap.parameters.properties).not.toHaveProperty('coordinateSpace');
  });

  it('resolves a semantic target and prefers one live-center gesture', async () => {
    const result = await makeToolkit().execute({
      name: 'ui_tap',
      arguments: { mode: 'content_description', contentDescription: '搜索' },
    });
    expect(mockCtrl.tapByQueryGesture).toHaveBeenCalledWith('', '搜索', '', 0);
    expect(mockCtrl.tapByQuery).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, data: { dispatched: true, effect: 'unknown', mode: 'content_description' } });
  });

  it('keeps the former action-first fallback chain when center gestures are disabled', async () => {
    mockCtrl.tapByQuery.mockResolvedValueOnce({
      ...semanticResult,
      accepted: false,
      method: null,
      reason: 'action_rejected',
    });

    const result = await makeToolkit({ nodeTargetGestureTapEnabled: false }).execute({
      name: 'ui_tap',
      arguments: { mode: 'content_description', contentDescription: '搜索' },
    });

    expect(mockCtrl.tap).toHaveBeenCalledWith(105, 60);
    expect(result).toMatchObject({
      ok: true,
      data: { accepted: true, method: 'coordinate_center', bounds: semanticResult.bounds },
    });
  });

  it('does not synthesize a coordinate when the semantic target is absent', async () => {
    mockCtrl.tapByQueryGesture.mockResolvedValueOnce({
      ...semanticResult,
      found: false,
      accepted: false,
      method: null,
      matchCount: 0,
      bounds: null,
      reason: 'no_match',
    });

    const result = await makeToolkit().execute({
      name: 'ui_tap',
      arguments: { mode: 'text', text: '不存在的目标' },
    });

    expect(mockCtrl.tap).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      code: 'ACCESSIBILITY_TARGET_NOT_FOUND',
      details: {
        scope: 'current_accessibility_tree',
        retryableOnSameObservation: false,
      },
    });
  });

  it('uses a short-lived ref to locate one live-center gesture', async () => {
    const result = await makeToolkit().execute({
      name: 'ui_tap',
      arguments: { mode: 'ref', ref: 'u1' },
    });
    expect(mockCtrl.tapByRefGesture).toHaveBeenCalledWith('u1');
    expect(mockCtrl.tapByRef).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, data: { dispatched: true, effect: 'unknown', mode: 'ref' } });
  });

  it('keeps ref action-first fallback when center gestures are disabled', async () => {
    mockCtrl.tapByRef.mockResolvedValueOnce({
      ...semanticResult,
      accepted: false,
      method: null,
      reason: 'action_rejected',
    });

    const result = await makeToolkit({ nodeTargetGestureTapEnabled: false }).execute({
      name: 'ui_tap',
      arguments: { mode: 'ref', ref: 'u1' },
    });

    expect(mockCtrl.tap).toHaveBeenCalledWith(105, 60);
    expect(result).toMatchObject({
      ok: true,
      data: { accepted: true, method: 'coordinate_center', mode: 'ref' },
    });
  });

  it('never adds a physical tap after Android accepts a node action in rollback mode', async () => {
    const result = await makeToolkit({ nodeTargetGestureTapEnabled: false }).execute({
      name: 'ui_tap',
      arguments: { mode: 'ref', ref: 'u1' },
    });

    expect(result).toMatchObject({ ok: true, data: { accepted: true, method: 'node_action' } });
    expect(mockCtrl.tap).not.toHaveBeenCalled();
  });

  it('keeps screenshot markers from changing the tap contract', async () => {
    const toolkit = makeToolkit({ screenshotNodeMarkersEnabled: true });
    const tap = toolkit.tools.find((tool) => tool.name === 'ui_tap')!;
    expect(tap.parameters.properties).toHaveProperty('mode');
    expect(tap.parameters.properties).not.toHaveProperty('dispatch');

    const result = await toolkit.execute({
      name: 'ui_tap',
      arguments: { mode: 'ref', ref: 'u1' },
    });
    expect(result).toMatchObject({ ok: true, data: { mode: 'ref' } });
    expect(mockCtrl.tapByRefGesture).toHaveBeenCalledWith('u1');
  });

  it('accepts legacy semantic mode and dispatch fields for stored history', async () => {
    const toolkit = makeToolkit({
      screenshotNodeMarkersEnabled: true,
      nodeTargetGestureTapEnabled: false,
    });
    const result = await toolkit.execute({
      name: 'ui_tap',
      arguments: { mode: 'semantic', contentDescription: '搜索', dispatch: 'gesture' },
    });

    expect(mockCtrl.tapByQuery).toHaveBeenCalledWith('', '搜索', '', 0);
    expect(result).toMatchObject({
      ok: true,
      data: { dispatched: true, effect: 'unknown', mode: 'content_description' },
    });
  });

  it('uses the same automatic ref dispatch when screenshot markers are disabled', async () => {
    const toolkit = makeToolkit({ screenshotNodeMarkersEnabled: false });
    const tap = toolkit.tools.find((tool) => tool.name === 'ui_tap')!;
    expect(tap.parameters.properties).not.toHaveProperty('dispatch');
    const result = await toolkit.execute({
      name: 'ui_tap',
      arguments: { mode: 'ref', ref: 'u1' },
    });
    expect(result).toMatchObject({ ok: true, data: { mode: 'ref' } });
    expect(mockCtrl.tapByRefGesture).toHaveBeenCalledWith('u1');
    expect(mockCtrl.tapByRef).not.toHaveBeenCalled();
  });

  it('can roll back to the former action-first chain with the settings switch', async () => {
    const toolkit = makeToolkit({ nodeTargetGestureTapEnabled: false });

    await toolkit.execute({
      name: 'ui_tap',
      arguments: { mode: 'content_description', contentDescription: '搜索' },
    });
    await toolkit.execute({
      name: 'ui_tap',
      arguments: { mode: 'ref', ref: 'u1' },
    });

    expect(mockCtrl.tapByQuery).toHaveBeenCalledWith('', '搜索', '', 0);
    expect(mockCtrl.tapByRef).toHaveBeenCalledWith('u1');
    expect(mockCtrl.tapByQueryGesture).not.toHaveBeenCalled();
    expect(mockCtrl.tapByRefGesture).not.toHaveBeenCalled();
  });

  it('maps normalized screenshot coordinates to physical pixels and invalidates them after dispatch', async () => {
    const toolkit = makeToolkit();
    const screenshot = await toolkit.execute({ name: 'ui_screenshot', arguments: {} });
    expect(screenshot).toMatchObject({
      ok: true,
      data: { observationId: 'shot_1', coordinateSpace: 'normalized_1000' },
    });
    expect((screenshot as { data?: Record<string, unknown> }).data)
      .not.toHaveProperty('imageWidth');
    expect((screenshot as { data?: Record<string, unknown> }).data)
      .not.toHaveProperty('imageHeight');

    const first = await toolkit.execute({
      name: 'ui_tap',
      arguments: {
        mode: 'coordinate',
        x: 750,
        y: 250,
        observationId: 'shot_1',
      },
    });
    expect(first).toMatchObject({
      ok: true,
      data: {
        mode: 'coordinate',
        coordinateSpace: 'normalized_1000',
        physicalX: 1079,
        physicalY: 800,
      },
    });
    expect(mockCtrl.tap).toHaveBeenCalledWith(1079, 800);

    const stale = await toolkit.execute({
      name: 'ui_tap',
      arguments: {
        mode: 'coordinate',
        x: 750,
        y: 250,
        observationId: 'shot_1',
      },
    });
    expect(stale).toMatchObject({ ok: false, code: 'STALE_UI_OBSERVATION' });
    expect(mockCtrl.tap).toHaveBeenCalledTimes(1);
  });

  it('rejects coordinates produced by an accessibility-tree observation', async () => {
    const toolkit = makeToolkit();
    const inspection = await toolkit.execute({ name: 'ui_inspect', arguments: {} });
    expect(inspection).toMatchObject({ ok: true, data: expect.stringContaining('observationId=tree_1') });

    const result = await toolkit.execute({
      name: 'ui_tap',
      arguments: {
        mode: 'coordinate',
        x: 105,
        y: 60,
        observationId: 'tree_1',
      },
    });

    expect(result).toMatchObject({ ok: false, code: 'COORDINATE_SPACE_UNAVAILABLE' });
    expect(mockCtrl.tap).not.toHaveBeenCalled();
  });

  it('rejects an explicit physical coordinate space instead of silently mixing spaces', async () => {
    const toolkit = makeToolkit();
    await toolkit.execute({ name: 'ui_screenshot', arguments: {} });

    const result = await toolkit.execute({
      name: 'ui_tap',
      arguments: {
        mode: 'coordinate',
        x: 105,
        y: 60,
        coordinateSpace: 'physical_screen_pixels',
        observationId: 'shot_1',
      },
    });

    expect(result).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(mockCtrl.tap).not.toHaveBeenCalled();
  });

  it('rejects normalized coordinates without screenshot dimensions', async () => {
    const toolkit = makeToolkit();
    await toolkit.execute({ name: 'ui_inspect', arguments: {} });

    const result = await toolkit.execute({
      name: 'ui_tap',
      arguments: {
        mode: 'coordinate',
        x: 500,
        y: 500,
        observationId: 'tree_1',
      },
    });

    expect(result).toMatchObject({ ok: false, code: 'COORDINATE_SPACE_UNAVAILABLE' });
    expect(mockCtrl.tap).not.toHaveBeenCalled();
  });

  it('rejects mixed or unknown arguments before native dispatch', async () => {
    const result = await makeToolkit().execute({
      name: 'ui_tap',
      arguments: { mode: 'ref', ref: 'u1', x: 100 },
    });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(mockCtrl.tapByRef).not.toHaveBeenCalled();
  });
});

describe('compound ui_fill', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exposes focused, ref and semantic input targets', () => {
    const fill = PHONE_TOOLS.find((tool) => tool.name === 'ui_fill')!;
    expect(fill.parameters.required).toEqual(['mode', 'value']);
    expect(fill.parameters.properties.mode.enum).toEqual([
      'focused', 'ref', 'text', 'content_description', 'resource_id',
    ]);
  });

  it('fills a semantic target directly without opening the keyboard and optionally submits', async () => {
    mockCtrl.findAccessibilityNodes.mockResolvedValueOnce({
      nodes: [{
        ref: 'uinput',
        text: '搜地点、查公交、找路线',
        contentDescription: null,
        resourceId: 'search_input',
        isEditable: true,
        isEnabled: true,
        children: [],
      }],
      truncated: false,
      reason: null,
      visitedNodes: 1,
      returnedNodes: 1,
      durationMs: 1,
    });
    const result = await makeToolkit().execute({
      name: 'ui_fill',
      arguments: {
        mode: 'text',
        targetText: '搜地点、查公交、找路线',
        value: '杭州城市阳台',
        submit: true,
      },
    });

    expect(mockCtrl.tapByQueryGesture).not.toHaveBeenCalled();
    expect(mockCtrl.setNodeText).toHaveBeenCalledWith('uinput', '杭州城市阳台');
    expect(mockCtrl.performAction).toHaveBeenCalledWith('uinput', 'imeEnter');
    expect(result).toEqual({
      ok: true,
      data: {
        filled: true,
        submitted: true,
        mode: 'text',
        ref: 'uinput',
        valueLength: 6,
      },
    });
  });

  it('writes to an editable ref without tapping or reading the tree', async () => {
    const result = await makeToolkit().execute({
      name: 'ui_fill',
      arguments: { mode: 'ref', ref: 'u7', value: '123' },
    });

    expect(mockCtrl.tapByRefGesture).not.toHaveBeenCalled();
    expect(mockCtrl.setNodeText).toHaveBeenCalledWith('u7', '123');
    expect(mockCtrl.getAccessibilityTree).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, data: { filled: true, submitted: false, ref: 'u7' } });
  });

  it('falls back to focusing when an input rejects direct text replacement', async () => {
    mockCtrl.setNodeText.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await makeToolkit().execute({
      name: 'ui_fill',
      arguments: { mode: 'ref', ref: 'u7', value: '123' },
    });

    expect(mockCtrl.tapByRefGesture).toHaveBeenCalledWith('u7');
    expect(mockCtrl.setNodeText).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: true, data: { filled: true, submitted: false, ref: 'u7' } });
  });

  it('reports the failing stage when submit is rejected after a successful fill', async () => {
    mockCtrl.performAction
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const result = await makeToolkit().execute({
      name: 'ui_fill',
      arguments: { mode: 'ref', ref: 'u7', value: '123', submit: true },
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'SUBMIT_FAILED',
      details: { stage: 'submit', filled: true },
    });
  });
});

describe('configurable coordinate long press', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses a ref node center when an explicit duration is requested', async () => {
    mockCtrl.getNodeInfoByRef.mockResolvedValueOnce({
      found: true,
      ref: 'u4dv',
      text: '2000',
      contentDescription: null,
      isEditable: false,
      bounds: { left: 122, top: 1137, right: 409, bottom: 1284 },
    });

    const result = await makeToolkit().execute({
      name: 'ui_long_press',
      arguments: { mode: 'ref', ref: 'u4dv', durationMs: 1000 },
    });

    expect(mockCtrl.longPressNode).not.toHaveBeenCalled();
    expect(mockCtrl.longPress).toHaveBeenCalledWith(266, 1211, 1000);
    expect(result).toMatchObject({
      ok: true,
      data: {
        mode: 'ref',
        ref: 'u4dv',
        physicalX: 266,
        physicalY: 1211,
        durationMs: 1000,
      },
    });
  });

  it('preserves native ref long-click when duration is omitted', async () => {
    const result = await makeToolkit().execute({
      name: 'ui_long_press',
      arguments: { mode: 'ref', ref: 'u4dv' },
    });

    expect(mockCtrl.longPressNode).toHaveBeenCalledWith('u4dv');
    expect(mockCtrl.getNodeInfoByRef).not.toHaveBeenCalled();
    expect(mockCtrl.longPress).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true });
  });

  it('exposes durationMs and passes an explicit duration to native', async () => {
    const longPressTool = PHONE_TOOLS.find((tool) => tool.name === 'ui_long_press')!;
    expect(longPressTool.parameters.properties.durationMs).toBeDefined();
    expect(longPressTool.parameters.properties.x).toMatchObject({ minimum: 0, maximum: 1000 });
    expect(longPressTool.parameters.properties.y).toMatchObject({ minimum: 0, maximum: 1000 });

    const toolkit = makeToolkit();
    await toolkit.execute({ name: 'ui_screenshot', arguments: {} });
    const result = await toolkit.execute({
      name: 'ui_long_press',
      arguments: {
        mode: 'coordinate',
        x: 100,
        y: 80,
        observationId: 'shot_1',
        durationMs: 3000,
      },
    });

    expect(mockCtrl.longPress).toHaveBeenCalledWith(144, 256, 3000);
    expect(result).toMatchObject({
      ok: true,
      data: {
        dispatched: true,
        coordinateSpace: 'normalized_1000',
        physicalX: 144,
        physicalY: 256,
        durationMs: 3000,
      },
    });
  });

  it('uses 1000 ms by default and rejects out-of-range durations', async () => {
    const toolkit = makeToolkit();
    await toolkit.execute({ name: 'ui_screenshot', arguments: {} });
    const defaultResult = await toolkit.execute({
      name: 'ui_long_press',
      arguments: { mode: 'coordinate', x: 100, y: 80, observationId: 'shot_1' },
    });
    expect(defaultResult).toMatchObject({ ok: true, data: { durationMs: 1000 } });
    expect(mockCtrl.longPress).toHaveBeenCalledWith(144, 256, 1000);

    await toolkit.execute({ name: 'ui_screenshot', arguments: {} });
    const invalid = await toolkit.execute({
      name: 'ui_long_press',
      arguments: {
        mode: 'coordinate', x: 100, y: 80, observationId: 'shot_2', durationMs: 5001,
      },
    });
    expect(invalid).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(mockCtrl.longPress).toHaveBeenCalledTimes(1);
  });
});

describe('semantic search result ranking', () => {
  beforeEach(() => jest.clearAllMocks());

  const parentMatch = {
    ref: 'u-parent',
    text: '5000 CLOSE 1 2 3 4 5 6 7 8 9 0 BACKSPACE 确定',
    contentDescription: '',
    className: 'android.view.View',
    bounds: { left: 1012, top: 2186, right: 1181, bottom: 2298 },
    isEnabled: true,
  };
  const exactMatch = {
    ref: 'u-backspace',
    text: 'BACKSPACE',
    contentDescription: '',
    className: 'android.widget.GridView',
    bounds: { left: 1081, top: 2465, right: 1440, bottom: 2651 },
    isEnabled: true,
  };

  it('returns all ranked candidates without a default ref when text matching is ambiguous', async () => {
    mockCtrl.findAccessibilityNodes.mockResolvedValueOnce({
      nodes: [parentMatch, exactMatch],
      truncated: false,
      reason: null,
      visitedNodes: 2,
      returnedNodes: 2,
      durationMs: 1,
    });

    const result = await makeToolkit().execute({
      name: 'ui_find_node',
      arguments: { text: 'BACKSPACE' },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        found: true,
        ambiguous: true,
        matchCount: 2,
        matches: [
          {
            ref: 'u-backspace',
            text: 'BACKSPACE',
            className: 'android.widget.GridView',
            bounds: { left: 1081, top: 2465, right: 1440, bottom: 2651 },
            center: { x: 1260.5, y: 2558 },
            isEnabled: true,
          },
          {
            ref: 'u-parent',
            text: '5000 CLOSE 1 2 3 4 5 6 7 8 9 0 BACKSPACE 确定',
            isEnabled: true,
          },
        ],
      },
    });
    expect((result as { data?: Record<string, unknown> }).data).not.toHaveProperty('ref');
  });

  it('keeps the unique candidate at the top level for direct ref use', async () => {
    mockCtrl.findAccessibilityNodes.mockResolvedValueOnce({
      nodes: [exactMatch],
      truncated: false,
      reason: null,
      visitedNodes: 1,
      returnedNodes: 1,
      durationMs: 1,
    });

    const result = await makeToolkit().execute({
      name: 'ui_find_node',
      arguments: { text: 'BACKSPACE' },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        found: true,
        ambiguous: false,
        matchCount: 1,
        ref: 'u-backspace',
        matches: [{ ref: 'u-backspace', text: 'BACKSPACE' }],
      },
    });
  });
});

describe('short-lived ref metadata reads', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads complete node metadata with one live ref lookup', async () => {
    const toolkit = makeToolkit();
    const result = await toolkit.execute({
      name: 'ui_get_node',
      arguments: { ref: 'u1' },
    });

    expect(mockCtrl.getNodeInfoByRef).toHaveBeenCalledTimes(1);
    expect(mockCtrl.getNodeInfoByRef).toHaveBeenCalledWith('u1');
    expect(result).toEqual({
      ok: true,
      data: {
        ref: 'u1',
        text: '搜索',
        contentDescription: null,
        resourceId: null,
        className: null,
        bounds: { left: 10, top: 20, right: 200, bottom: 100 },
        center: { x: 105, y: 60 },
        isClickable: false,
        isScrollable: false,
        isEditable: true,
        isFocused: false,
        isCheckable: false,
        isChecked: false,
        isEnabled: false,
      },
    });
  });

});

describe('screenshot node markers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps actionable refs, drops scroll-only and duplicate rectangles', () => {
    expect(parseScreenshotNodeMarkers([
      '=== 屏幕元素 ===',
      '[1] ViewPager "(无文本)" 中心(720,1600) 边界(0,0,1440,3200) 可滚动 ref=u1',
      '[2] LinearLayout "(无文本)" 中心(720,602) 边界(28,536,1412,667) 可点击 ref=u2',
      '[3] TextView "重复" 中心(720,602) 边界(28,536,1412,667) 可点击 ref=u3',
      '[4] EditText "搜索" 中心(720,220) 边界(200,160,1240,280) 可编辑 ref=u4',
    ].join('\n'))).toEqual([
      { ref: 'u2', bounds: { left: 28, top: 536, right: 1412, bottom: 667 } },
      { ref: 'u4', bounds: { left: 200, top: 160, right: 1240, bottom: 280 } },
    ]);
  });

  it('drops full-screen wrappers and prefers the tighter nested hit target', () => {
    expect(parseScreenshotNodeMarkers([
      '=== 屏幕元素 ===',
      '[1] FrameLayout "(无文本)" 中心(720,1600) 边界(0,0,1440,3200) 可点击 ref=u1',
      '[2] LinearLayout "(无文本)" 中心(1220,210) 边界(1120,150,1320,270) 可点击 ref=u2',
      '[3] TextView "管理" 中心(1220,210) 边界(1160,170,1280,250) 可点击 ref=u3',
    ].join('\n'))).toEqual([
      { ref: 'u3', bounds: { left: 1160, top: 170, right: 1280, bottom: 250 } },
    ]);
  });

  it('sends the annotated copy only when the switch is enabled', async () => {
    const toolkit = new AgentToolkit({
      delay: async () => await new Promise<void>(() => {}),
      notes: new Map(),
      inspectUi: async () =>
        '[1] LinearLayout "产品" 中心(100,100) 边界(20,20,180,180) 可点击 ref=u9',
      captureScreenshot: async () => ({
        path: '/tmp/current.png', base64: 'raw', width: 1440, height: 3200,
      }),
    }, { screenshotNodeMarkersEnabled: true });

    const result = await toolkit.execute({ name: 'ui_screenshot', arguments: {} });
    expect(mockCtrl.annotateScreenshot).toHaveBeenCalledWith(
      '/tmp/current.png',
      [{
        ref: 'u9',
        bounds: { left: 20, top: 20, right: 180, bottom: 180 },
        kind: 'accessibility',
      }],
      1440,
      3200,
    );
    expect(result).toMatchObject({
      data: {
        coordinateSpace: 'normalized_1000',
      },
      observationImage: {
        path: '/tmp/marked.jpg',
        base64: 'marked',
        width: 1440,
        height: 3200,
        mimeType: 'image/jpeg',
      },
    });
    expect((result as { data?: Record<string, unknown> }).data)
      .not.toHaveProperty('imageWidth');
    expect((result as { data?: Record<string, unknown> }).data)
      .not.toHaveProperty('imageHeight');
    expect(toolkit.enrichToolCallForCircuitBreaker({
      name: 'ui_tap',
      arguments: { ref: 'u9' },
    }).arguments).toMatchObject({
      _resolvedBounds: { left: 20, top: 20, right: 180, bottom: 180 },
    });
  });

  it('downscales only the model copy and keeps physical dimensions for coordinate taps', async () => {
    mockCtrl.resizeScreenshotForModel.mockResolvedValueOnce({
      path: '/tmp/model-900x2000.jpg',
      base64: 'resized',
      width: 900,
      height: 2000,
      mimeType: 'image/jpeg',
    });
    const toolkit = new AgentToolkit({
      delay: async () => await new Promise<void>(() => {}),
      notes: new Map(),
      inspectUi: async () => '=== 屏幕元素 ===',
      captureScreenshot: async () => ({
        path: '/tmp/current.png', base64: 'png', width: 1440, height: 3200,
      }),
    }, {
      screenshotNodeMarkersEnabled: false,
      screenshotDownscalingEnabled: true,
    });

    const screenshot = await toolkit.execute({ name: 'ui_screenshot', arguments: {} });
    expect(mockCtrl.resizeScreenshotForModel).toHaveBeenCalledWith(
      '/tmp/current.png',
      2000,
      85,
    );
    expect(screenshot).toMatchObject({
      observationImage: {
        width: 900,
        height: 2000,
        mimeType: 'image/jpeg',
      },
    });

    await toolkit.execute({
      name: 'ui_tap',
      arguments: { mode: 'coordinate', x: 500, y: 500, observationId: 'shot_1' },
    });
    expect(mockCtrl.tap).toHaveBeenCalledWith(720, 1600);
  });

  it('emits segmented screenshot preprocessing timings without image contents', async () => {
    const timing: Array<Record<string, unknown>> = [];
    const toolkit = new AgentToolkit({
      delay: async () => await new Promise<void>(() => {}),
      notes: new Map(),
      inspectUi: async () => '=== 屏幕元素 ===',
      captureScreenshot: async () => ({
        path: '/tmp/current.png', base64: 'private-image', width: 1440, height: 3200,
      }),
      onTimingDiagnostic: (event) => timing.push(event),
    }, {
      screenshotNodeMarkersEnabled: false,
      screenshotDownscalingEnabled: true,
      ocrEnhancementEnabled: true,
    });

    await toolkit.execute({ name: 'ui_screenshot', arguments: {} });

    expect(timing).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'vision_screenshot_capture', status: 'ok' }),
      expect.objectContaining({ stage: 'vision_accessibility_tree', status: 'ok' }),
      expect.objectContaining({ stage: 'vision_ocr' }),
      expect.objectContaining({ stage: 'vision_annotation' }),
      expect.objectContaining({
        stage: 'vision_resize',
        sourceWidth: 1440,
        sourceHeight: 3200,
        modelWidth: 1440,
        modelHeight: 3200,
      }),
    ]));
    expect(timing.every((event) => !JSON.stringify(event).includes('private-image'))).toBe(true);
  });

  it('does not downscale the model screenshot when the switch is disabled', async () => {
    const toolkit = makeToolkit({ screenshotDownscalingEnabled: false });

    const screenshot = await toolkit.execute({ name: 'ui_screenshot', arguments: {} });

    expect(mockCtrl.resizeScreenshotForModel).not.toHaveBeenCalled();
    expect(screenshot).toMatchObject({
      observationImage: { width: 1440, height: 3200 },
    });
  });

  it('merges requested OCR visual refs into the marked screenshot', async () => {
    mockCtrl.recognizeScreenshotText.mockResolvedValueOnce({
      elements: [
        {
          text: '产品',
          bounds: { left: 30, top: 30, right: 160, bottom: 100 },
        },
        {
          text: '删除',
          bounds: { left: 1200, top: 2880, right: 1380, bottom: 2980 },
        },
      ],
      imageWidth: 1440,
      imageHeight: 3200,
    });
    const toolkit = new AgentToolkit({
      delay: async () => await new Promise<void>(() => {}),
      notes: new Map(),
      inspectUi: async () =>
        '[1] LinearLayout "产品" 中心(100,100) 边界(20,20,180,180) 可点击 ref=u9',
      captureScreenshot: async () => ({
        path: '/tmp/current.png', base64: 'raw', width: 1440, height: 3200,
      }),
    }, { screenshotNodeMarkersEnabled: true });

    const result = await toolkit.execute({ name: 'ui_screenshot', arguments: {} });

    expect(mockCtrl.annotateScreenshot).toHaveBeenCalledWith(
      '/tmp/current.png',
      [
        {
          ref: 'u9',
          bounds: { left: 20, top: 20, right: 180, bottom: 180 },
          kind: 'accessibility',
        },
        {
          ref: 'ocr_2',
          bounds: { left: 1200, top: 2880, right: 1380, bottom: 2979 },
          kind: 'ocr',
        },
      ],
      1440,
      3200,
    );
    expect(result).toMatchObject({
      data: {
        ocr_elements: [
          { ref: 'ocr_1', text: '产品' },
          { ref: 'ocr_2', text: '删除' },
        ],
      },
    });

    const tapResult = await toolkit.execute({
      name: 'ui_tap',
      arguments: { mode: 'ref', ref: 'ocr_2' },
    });
    expect(mockCtrl.tap).toHaveBeenCalledWith(1290, 2930);
    expect(tapResult).toMatchObject({
      ok: true,
      data: {
        mode: 'ref',
        source: 'ocr',
        ref: 'ocr_2',
        text: '删除',
        observationId: 'shot_1',
      },
    });
    const staleTap = await toolkit.execute({
      name: 'ui_tap',
      arguments: { mode: 'ref', ref: 'ocr_2' },
    });
    expect(staleTap).toMatchObject({ ok: false, code: 'STALE_TARGET_REF' });
  });

  it('does not run OCR when OCR enhancement is disabled', async () => {
    const toolkit = new AgentToolkit({
      delay: async () => await new Promise<void>(() => {}),
      notes: new Map(),
      inspectUi: async () => '=== 屏幕元素 ===',
      captureScreenshot: async () => ({
        path: '/tmp/current.png', base64: 'raw', width: 1440, height: 3200,
      }),
    }, {
      screenshotNodeMarkersEnabled: true,
      ocrEnhancementEnabled: false,
    });

    const result = await toolkit.execute({
      name: 'ui_screenshot',
      arguments: {},
    });

    expect(mockCtrl.recognizeScreenshotText).not.toHaveBeenCalled();
    expect(result).toMatchObject({ data: { captured: true } });
    expect((result as { data?: Record<string, unknown> }).data).not.toHaveProperty('ocr_elements');
  });

  it('keeps ref-based circuit-breaker enrichment when markers are disabled', async () => {
    jest.clearAllMocks();
    const toolkit = new AgentToolkit({
      delay: async () => await new Promise<void>(() => {}),
      notes: new Map(),
      inspectUi: async () =>
        '[1] LinearLayout "产品" 中心(100,100) 边界(20,20,180,180) 可点击 ref=u9',
      captureScreenshot: async () => ({
        path: '/tmp/current.png', base64: 'raw', width: 1440, height: 3200,
      }),
    }, { screenshotNodeMarkersEnabled: false });

    const result = await toolkit.execute({ name: 'ui_screenshot', arguments: {} });
    expect(mockCtrl.annotateScreenshot).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      observationImage: { path: '/tmp/current.png', base64: 'raw' },
    });
    expect(toolkit.enrichToolCallForCircuitBreaker({
      name: 'ui_tap',
      arguments: { ref: 'u9' },
    }).arguments).toMatchObject({
      _resolvedBounds: { left: 20, top: 20, right: 180, bottom: 180 },
    });
  });
});
