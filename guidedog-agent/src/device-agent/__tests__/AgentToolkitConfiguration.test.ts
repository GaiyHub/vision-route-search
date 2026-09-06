import { AgentToolkit } from '../agent/AgentToolkit';
import type { Tool } from '../types';
import { normalizeToolConfigurationOverrides } from '../tools/ToolConfiguration';

const customTool: Tool = {
  name: 'browser_manage',
  description: 'default browser description',
  parameters: {
    type: 'object',
    properties: { operation: { type: 'string' } },
    required: ['operation'],
  },
};

function createToolkit(options: ConstructorParameters<typeof AgentToolkit>[1] = {}) {
  return new AgentToolkit(
    { delay: async () => undefined, notes: new Map<string, string>() },
    options,
  );
}

describe('AgentToolkit per-tool configuration snapshot', () => {
  it('drops every persisted override for internal file_read', () => {
    expect(normalizeToolConfigurationOverrides({
      file_read: { enabled: false, label: '改名', description: '改描述', uiEffect: 'change' },
    })).toEqual({});
  });
  it('removes a disabled phone tool and rejects hallucinated execution', async () => {
    const toolkit = createToolkit({
      toolConfigurationOverrides: { tap: { enabled: false } },
    });
    expect(toolkit.tools.some((tool) => tool.name === 'ui_tap')).toBe(false);
    const result = await toolkit.execute({ name: 'ui_tap', arguments: { x: 1, y: 2 } });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'TOOL_DISABLED' }));
  });

  it('explicitly enables a tool excluded by the preset and customizes only its description', () => {
    const toolkit = createToolkit({
      toolFilter: ['list_apps'],
      toolConfigurationOverrides: {
        tap: { enabled: true, label: '轻点', description: '仅在目标明确时点击。' },
      },
    });
    const tap = toolkit.tools.find((tool) => tool.name === 'ui_tap');
    expect(tap?.description).toBe('仅在目标明确时点击。');
    expect(tap?.parameters).toBeDefined();
    expect(tap?.name).toBe('ui_tap');
  });

  it('does not invoke a disabled custom tool handler', async () => {
    const handler = jest.fn(async () => 'should not run');
    const toolkit = createToolkit({
      extraTools: [{ tool: customTool, handler, enabledByDefault: true }],
      toolConfigurationOverrides: { browser_manage: { enabled: false } },
    });
    expect(toolkit.tools.some((tool) => tool.name === 'browser_manage')).toBe(false);
    const result = await toolkit.execute({ name: 'browser_manage', arguments: { operation: 'list_tabs' } });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'TOOL_DISABLED' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('can place a general-purpose extra tool before the phone tool catalog', () => {
    const toolkit = createToolkit({
      extraTools: [{
        tool: customTool,
        handler: async () => undefined,
        placement: 'front',
      }],
    });
    expect(toolkit.tools[0]?.name).toBe('browser_manage');
  });

  it('keeps screenshot marker guidance focused on marker and coordinate contracts', () => {
    const toolkit = createToolkit({ screenshotNodeMarkersEnabled: true });
    const description = toolkit.tools.find((tool) => tool.name === 'ui_screenshot')?.description ?? '';

    expect(description).toContain('截图会标记可操作节点');
    expect(description).toContain('须携带该截图的 observationId');
    expect(description).not.toContain('需要根据视觉位置执行坐标操作时');
    expect(description).not.toContain('需要物理点击时应使用');
  });

  it('removes OCR from the screenshot contract when OCR enhancement is disabled', () => {
    const toolkit = createToolkit({ ocrEnhancementEnabled: false });
    const screenshot = toolkit.tools.find((tool) => tool.name === 'ui_screenshot')!;

    expect(screenshot.description).not.toContain('includeOcr');
    expect(screenshot.description).not.toContain('OCR 文字');
    expect(screenshot.parameters.properties).not.toHaveProperty('includeOcr');
    expect(screenshot.outputSchema?.properties).not.toHaveProperty('ocr_elements');
    expect(screenshot.outputSchema?.properties).not.toHaveProperty('ocr_status');
  });

  it('keeps OCR automatic without exposing a model parameter when enabled', () => {
    const toolkit = createToolkit({ ocrEnhancementEnabled: true });
    const screenshot = toolkit.tools.find((tool) => tool.name === 'ui_screenshot')!;

    expect(screenshot.description).toContain('自动补充');
    expect(screenshot.parameters.properties).not.toHaveProperty('includeOcr');
    expect(screenshot.outputSchema?.properties).toHaveProperty('ocr_elements');
  });

  it('keeps required termination tools enabled despite a persisted false value', () => {
    const toolkit = createToolkit({
      toolFilter: [],
      toolConfigurationOverrides: {
        task_complete: { enabled: false, description: '自定义完成说明' },
        task_failed: { enabled: false },
      },
    });
    expect(toolkit.tools.find((tool) => tool.name === 'task_complete')?.description)
      .toBe('自定义完成说明');
    expect(toolkit.tools.some((tool) => tool.name === 'task_failed')).toBe(true);
  });

  it('keeps app discovery and launch tools enabled despite persisted false values', () => {
    const toolkit = createToolkit({
      toolFilter: [],
      toolConfigurationOverrides: {
        open_app: { enabled: false },
        list_apps: { enabled: false },
      },
    });
    expect(toolkit.tools.some((tool) => tool.name === 'open_app')).toBe(true);
    expect(toolkit.tools.some((tool) => tool.name === 'list_apps')).toBe(true);
  });

  it('exposes structure and screenshot observation as independent tools', () => {
    const names = createToolkit().tools.map((tool) => tool.name);

    expect(names).toContain('ui_inspect');
    expect(names).toContain('ui_screenshot');
  });

  it('exposes generic wait while hiding specialized waits and keeps UI actions free of wait parameters', () => {
    const tools = createToolkit().tools;
    const names = tools.map((tool) => tool.name);
    const actionNames = [
      'ui_tap',
      'ui_fill',
      'ui_long_press',
      'ui_clear_text',
      'ui_press_enter',
      'ui_swipe',
      'ui_scroll',
      'ui_scroll_page',
      'ui_set_checked',
      'open_app',
      'ui_global_action',
    ];

    expect(names).toContain('wait');
    expect(names).not.toContain('ui_wait_for_node');
    expect(names).not.toContain('ui_wait_for_change');
    for (const name of actionNames) {
      expect(tools.find((tool) => tool.name === name)?.parameters.properties.waitMs)
        .toBeUndefined();
    }
    expect(tools.find((tool) => tool.name === 'ui_inspect')?.parameters.properties)
      .not.toHaveProperty('waitMs');
    expect(tools.find((tool) => tool.name === 'ui_screenshot')?.parameters.properties)
      .not.toHaveProperty('waitMs');
  });

  it('accepts wait as a top-level tool call', () => {
    expect(createToolkit().validateCall({ name: 'wait', arguments: { ms: 0 } })).toBeNull();
  });

  it('rejects stale UI calls that still contain waitMs', async () => {
    await expect(createToolkit().execute({
      name: 'ui_scroll',
      arguments: { direction: 'down', waitMs: 1_000 },
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: 'INVALID_ARGUMENT',
      error: expect.stringContaining('execute_tools'),
    }));
  });

  it('returns a captured image when the auxiliary accessibility tree stalls', async () => {
    const inspectUi = jest.fn(() => new Promise<string>(() => undefined));
    const cancelInspectUi = jest.fn(async () => true);
    const captureScreenshot = jest.fn(async () => ({
      base64: 'image-bytes',
      mimeType: 'image/png',
    }));
    const toolkit = new AgentToolkit(
      {
        delay: async () => undefined,
        notes: new Map<string, string>(),
        inspectUi,
        cancelInspectUi,
        captureScreenshot,
      },
      { ocrEnhancementEnabled: false },
    );

    const result = await toolkit.execute({ name: 'ui_screenshot', arguments: {} });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      data: {
        captured: true,
        observationId: 'shot_1',
        coordinateSpace: 'normalized_1000',
        accessibility_tree: '=== 屏幕元素 === (结构树等待超时，截图仍可用)',
        accessibility_tree_status: 'timeout',
      },
      observationImage: { base64: 'image-bytes', mimeType: 'image/png' },
    }));
    expect(cancelInspectUi).toHaveBeenCalledTimes(1);
  });

  it('preserves the host-foreground reason and tells the model to open the target app', async () => {
    const error = Object.assign(new Error('host foreground'), {
      code: 'HOST_APP_FOREGROUND',
    });
    const toolkit = new AgentToolkit({
      delay: async () => undefined,
      notes: new Map<string, string>(),
      inspectUi: async () => '=== 屏幕元素 === (豆泡宿主界面已忽略)',
      captureScreenshot: async () => { throw error; },
    });

    const result = await toolkit.execute({ name: 'ui_screenshot', arguments: {} });

    expect(result).toMatchObject({
      ok: false,
      code: 'HOST_APP_FOREGROUND',
    });
    expect(result).not.toHaveProperty('retryable');
    expect(result).not.toHaveProperty('hint');
  });
});
