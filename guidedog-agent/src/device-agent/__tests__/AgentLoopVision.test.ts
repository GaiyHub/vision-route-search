import { AgentLoop } from '../agent/AgentLoop';
import { PHONE_TOOLS } from '../tools/PhoneTools';
import type {
  LLMMessage,
  LLMProviderInterface,
  ModelMessage,
  ModelResponse,
  ScreenshotImage,
} from '../types';

const captureWithMediaProjection = jest.fn<Promise<{ path: string; base64: string }>, []>();
const takeScreenshot = jest.fn<Promise<{ path: string; base64: string } | null>, []>();
const mockCtrl = {
  getCurrentForegroundApp: jest.fn(async () => ({ packageName: 'external.app', className: 'Main' })),
  getAccessibilityTree: jest.fn<Promise<unknown>, []>(async () => ({
    text: '测试屏幕',
    children: [],
    resourceId: 'test',
    className: 'View',
  })),
  openApp: jest.fn<Promise<boolean>, [string]>(async () => true),
  isMediaProjectionReady: jest.fn<Promise<boolean>, []>(async () => true),
  probeProjectionReady: jest.fn<Promise<boolean>, []>(async () => true),
  takeScreenshot,
  captureWithMediaProjection,
  compareScreenshotFiles: jest.fn(async () => ({
    changed: false,
    changedPixelRatio: 0,
    changedTileRatio: 0,
    meanDelta: 0,
  })),
  recognizeScreenshotText: jest.fn<Promise<{
    elements: Array<{
      text: string;
      bounds: { left: number; top: number; right: number; bottom: number };
    }>;
    imageWidth: number;
    imageHeight: number;
  }>, [string]>(async () => ({ elements: [], imageWidth: 1440, imageHeight: 3200 })),
  scrollNode: jest.fn<Promise<boolean>, [string, string]>(async () => false),
  swipe: jest.fn<Promise<boolean>, [number, number, number, number, number?]>(async () => true),
  suspendOverlayForAutomation: jest.fn<Promise<boolean>, []>(async () => true),
  resumeOverlayAfterAutomation: jest.fn<Promise<void>, []>(async () => undefined),
};

jest.mock('react-native-accessibility-controller', () => mockCtrl);

describe('AgentLoop explicit screen observations', () => {
  beforeEach(() => {
    mockCtrl.getCurrentForegroundApp.mockReset().mockResolvedValue({
      packageName: 'external.app',
      className: 'Main',
    });
    mockCtrl.getAccessibilityTree.mockClear();
    mockCtrl.openApp.mockReset().mockImplementation(async (packageName: string) => {
      mockCtrl.getCurrentForegroundApp.mockResolvedValue({
        packageName,
        className: 'Main',
      });
      return true;
    });
    takeScreenshot.mockReset().mockResolvedValue(null);
    captureWithMediaProjection.mockReset().mockResolvedValue({
      path: '/tmp/explicit.png',
      base64: 'ZXhwbGljaXQ=',
    });
    mockCtrl.probeProjectionReady.mockReset().mockResolvedValue(true);
    mockCtrl.compareScreenshotFiles.mockReset().mockResolvedValue({
      changed: false,
      changedPixelRatio: 0,
      changedTileRatio: 0,
      meanDelta: 0,
    });
    mockCtrl.recognizeScreenshotText.mockReset().mockResolvedValue({
      elements: [],
      imageWidth: 1440,
      imageHeight: 3200,
    });
    mockCtrl.scrollNode.mockReset().mockResolvedValue(false);
    mockCtrl.swipe.mockReset().mockResolvedValue(true);
    mockCtrl.suspendOverlayForAutomation.mockReset().mockResolvedValue(true);
    mockCtrl.resumeOverlayAfterAutomation.mockReset().mockResolvedValue(undefined);
  });

  it('exposes independent structure and visual observation tools', () => {
    const names = PHONE_TOOLS.map((tool) => tool.name);
    expect(names).toContain('ui_inspect');
    expect(names).toContain('ui_dump_raw_tree');
    expect(names).toContain('ui_screenshot');
    expect(PHONE_TOOLS.find((tool) => tool.name === 'ui_dump_raw_tree')?.description)
      .toContain('不过滤');
  });

  it('does not read the tree or capture an image for a direct answer', async () => {
    const provider = {
      generateWithVision: jest.fn(),
      generateWithTools: jest.fn(async () => '直接回答'),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({ provider, useVision: true, requestTimeoutMs: 0 });

    for await (const _event of loop.run('知识问答')) { /* drain */ }

    expect(provider.generateWithTools).toHaveBeenCalledTimes(1);
    expect(provider.generateWithVision).not.toHaveBeenCalled();
    expect(mockCtrl.getAccessibilityTree).not.toHaveBeenCalled();
    expect(takeScreenshot).not.toHaveBeenCalled();
    expect(captureWithMediaProjection).not.toHaveBeenCalled();
  });

  it('reads only the accessibility tree when the model requests a text observation', async () => {
    const messagesList: LLMMessage[][] = [];
    const responses = [
      '{"name":"ui_inspect","arguments":{}}',
      '{"name":"task_complete","arguments":{"summary":"已查看"}}',
    ];
    const provider = {
      generateWithVision: jest.fn(),
      generateWithTools: jest.fn(async (messages: LLMMessage[]) => {
        messagesList.push(messages);
        return responses[messagesList.length - 1];
      }),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({ provider, useVision: true, maxSteps: 3, requestTimeoutMs: 0 });

    for await (const _event of loop.run('读取屏幕')) { /* drain */ }

    expect(mockCtrl.getAccessibilityTree).toHaveBeenCalledTimes(1);
    expect(takeScreenshot).not.toHaveBeenCalled();
    expect(captureWithMediaProjection).not.toHaveBeenCalled();
    expect(messagesList[1].some((message) => message.content.includes('屏幕元素'))).toBe(true);
  });

  it('captures and attaches an image plus the matching tree when screenshot is explicitly called', async () => {
    const images: ScreenshotImage[] = [];
    const messagesList: LLMMessage[][] = [];
    const provider = {
      generateWithTools: jest.fn(async () =>
        '{"name":"ui_screenshot","arguments":{}}'),
      generateWithVision: jest.fn(async (
        messages: LLMMessage[],
        _tools: unknown,
        image: ScreenshotImage,
      ) => {
        messagesList.push(messages);
        images.push(image);
        return '{"name":"task_complete","arguments":{"summary":"已查看"}}';
      }),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({ provider, useVision: true, maxSteps: 3, requestTimeoutMs: 0 });

    for await (const _event of loop.run('视觉查看屏幕')) { /* drain */ }

    expect(provider.generateWithTools).toHaveBeenCalledTimes(1);
    expect(mockCtrl.suspendOverlayForAutomation).toHaveBeenCalled();
    expect(mockCtrl.resumeOverlayAfterAutomation).toHaveBeenCalled();
    expect(mockCtrl.suspendOverlayForAutomation.mock.invocationCallOrder[0])
      .toBeLessThan(takeScreenshot.mock.invocationCallOrder[0]);
    const lastResumeOrder = mockCtrl.resumeOverlayAfterAutomation.mock.invocationCallOrder[
      mockCtrl.resumeOverlayAfterAutomation.mock.invocationCallOrder.length - 1
    ];
    expect(takeScreenshot.mock.invocationCallOrder[0]).toBeLessThan(lastResumeOrder);
    expect(images.map((image) => image.path)).toEqual(['/tmp/explicit.png']);
    expect(mockCtrl.getAccessibilityTree).toHaveBeenCalledTimes(1);
    expect(captureWithMediaProjection).toHaveBeenCalledTimes(1);
    expect(messagesList[0].some((message) =>
      message.content.includes('accessibility_tree:') &&
      message.content.includes('屏幕元素'),
    )).toBe(true);
  });

  it('pauses for host-owned capture permission and retries the same screenshot once', async () => {
    mockCtrl.probeProjectionReady.mockResolvedValue(false);
    const permissionGate = jest.fn(async () => {
      mockCtrl.probeProjectionReady.mockResolvedValue(true);
      return 'granted' as const;
    });
    const provider = {
      generateWithTools: jest.fn(async () =>
        '{"name":"ui_screenshot","arguments":{}}'),
      generateWithVision: jest.fn(async () =>
        '{"name":"task_complete","arguments":{"summary":"已查看"}}'),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({
      provider,
      useVision: true,
      maxSteps: 3,
      requestTimeoutMs: 0,
      screenCapturePermissionGate: permissionGate,
    });

    for await (const _event of loop.run('需要截图')) { /* drain */ }

    expect(permissionGate).toHaveBeenCalledTimes(1);
    expect(takeScreenshot).toHaveBeenCalledTimes(2);
    expect(captureWithMediaProjection).toHaveBeenCalledTimes(1);
    expect(provider.generateWithTools).toHaveBeenCalledTimes(1);
    expect(provider.generateWithVision).toHaveBeenCalledTimes(1);
  });

  it('pauses for host-owned location permission and retries the same shell call once', async () => {
    const shellHandler = jest.fn()
      .mockResolvedValueOnce({ ok: false, code: 'LOCATION_PERMISSION_REQUIRED' })
      .mockResolvedValueOnce({ ok: true, output: '{"latitude":30,"longitude":104}' });
    const permissionGate = jest.fn(async () => 'granted' as const);
    const responses = [
      '{"name":"shell_execute","arguments":{"command":"android-location current"}}',
      '{"name":"task_complete","arguments":{"summary":"已获取位置"}}',
    ];
    const provider = {
      generateWithVision: jest.fn(),
      generateWithTools: jest.fn(async () => responses.shift() ?? responses[1]),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({
      provider,
      maxSteps: 3,
      requestTimeoutMs: 0,
      locationPermissionGate: permissionGate,
      extraTools: [{
        tool: {
          name: 'shell_execute',
          description: '运行宿主命令',
          uiEffect: 'none',
          parameters: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
        handler: shellHandler,
      }],
    });

    for await (const _event of loop.run('获取当前位置')) { /* drain */ }

    expect(permissionGate).toHaveBeenCalledTimes(1);
    expect(shellHandler).toHaveBeenCalledTimes(2);
    expect(shellHandler).toHaveBeenNthCalledWith(1, { command: 'android-location current' });
    expect(shellHandler).toHaveBeenNthCalledWith(2, { command: 'android-location current' });
    expect(provider.generateWithTools).toHaveBeenCalledTimes(2);
  });

  it('automatically passes bundled OCR elements into the immediate screenshot decision', async () => {
    mockCtrl.recognizeScreenshotText.mockResolvedValue({
      elements: [{
        text: '删除',
        bounds: { left: 1200, top: 2880, right: 1380, bottom: 2980 },
      }],
      imageWidth: 1440,
      imageHeight: 3200,
    });
    const visionRequests: LLMMessage[][] = [];
    const provider = {
      generateWithTools: jest.fn(async () =>
        '{"name":"ui_screenshot","arguments":{}}'),
      generateWithVision: jest.fn(async (messages: LLMMessage[]) => {
        visionRequests.push(messages);
        return '{"name":"task_complete","arguments":{"summary":"已定位"}}';
      }),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({ provider, useVision: true, maxSteps: 3, requestTimeoutMs: 0 });

    for await (const _event of loop.run('定位删除按钮')) { /* drain */ }

    expect(mockCtrl.recognizeScreenshotText).toHaveBeenCalledWith('/tmp/explicit.png');
    const prompt = visionRequests[0].map((message) => message.content).join('\n');
    expect(prompt).toContain('ocr_elements:');
    expect(prompt).toContain('"ref":"ocr_1"');
    expect(prompt).toContain('"text":"删除"');
    expect(prompt).toContain('"center":{"x":896,"y":916}');
  });

  it('persists task-relevant visual facts without retaining them as thinking', async () => {
    const followupRequests: LLMMessage[][] = [];
    const visionRequests: LLMMessage[][] = [];
    let textTurn = 0;
    const provider = {
      generateWithTools: jest.fn(async (messages: LLMMessage[]) => {
        textTurn += 1;
        if (textTurn === 1) return '{"name":"ui_screenshot","arguments":{}}';
        followupRequests.push(messages);
        return '{"name":"task_complete","arguments":{"summary":"已完成对比"}}';
      }),
      generateWithVision: jest.fn(async (messages: LLMMessage[]) => {
        visionRequests.push(messages);
        return '<visual_memory observation_id="model_supplied">' +
          '京东页面显示 iPhone 17 256GB，国补到手价 ¥5499。' +
          '</visual_memory>\n接下来打开另一个应用。\n' +
          '<tool_call>{"name":"open_app","arguments":{"packageName":"other.app"}}</tool_call>';
      }),
    } as unknown as LLMProviderInterface;
    const thinking: string[] = [];
    const events: import('../types').AgentEvent[] = [];
    const loop = new AgentLoop({
      provider,
      useVision: true,
      maxSteps: 4,
      settleMs: 0,
      requestTimeoutMs: 0,
      onThinking: (content) => thinking.push(content),
    });

    for await (const event of loop.run('比较两个应用中的价格')) events.push(event);

    const visualPrompt = visionRequests[0].map((message) => message.content).join('\n');
    expect(visualPrompt).toContain('[视觉记忆要求]');
    expect(visualPrompt).toContain('visual_memory');
    const memory = events.find((event) => event.type === 'visual_memory');
    expect(memory).toEqual(expect.objectContaining({
      type: 'visual_memory',
      content: '京东页面显示 iPhone 17 256GB，国补到手价 ¥5499。',
    }));
    expect(memory && memory.type === 'visual_memory' ? memory.observationId : '')
      .not.toBe('model_supplied');
    expect(thinking).toEqual(['接下来打开另一个应用。']);

    const followupPrompt = followupRequests[0]
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n');
    expect(followupPrompt).toContain('京东页面显示 iPhone 17 256GB');
    expect(followupPrompt).toContain('<visual_memory observation_id=');
    expect(followupPrompt).not.toContain('接下来打开另一个应用');
  });

  it('places the two most recent visual memories beside a new screenshot for comparison', async () => {
    const visionRequests: LLMMessage[][] = [];
    let textTurn = 0;
    let visionTurn = 0;
    const provider = {
      generateWithTools: jest.fn(async () => {
        textTurn += 1;
        return '{"name":"ui_screenshot","arguments":{}}';
      }),
      generateWithVision: jest.fn(async (messages: LLMMessage[]) => {
        visionRequests.push(messages);
        visionTurn += 1;
        if (visionTurn === 1) {
          return '<visual_memory>页面显示商品详情，购物车角标为 1。</visual_memory>' +
            '<tool_call>{"name":"mutate_ui","arguments":{}}</tool_call>';
        }
        if (visionTurn === 2) {
          return '<visual_memory>页面显示规格选择浮层。</visual_memory>' +
            '<tool_call>{"name":"mutate_ui","arguments":{}}</tool_call>';
        }
        return '<visual_memory>页面显示商品详情，购物车角标为 2；相较近期状态角标由 1 增至 2。</visual_memory>' +
          '<tool_call>{"name":"task_complete","arguments":{"summary":"已完成"}}</tool_call>';
      }),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({
      provider,
      useVision: true,
      maxSteps: 8,
      settleMs: 0,
      requestTimeoutMs: 0,
      extraTools: [{
        tool: {
          name: 'mutate_ui',
          description: 'changes screen',
          uiEffect: 'change',
          parameters: { type: 'object', properties: {} },
        },
        handler: async () => true,
      }],
    });

    for await (const _event of loop.run('观察状态变化')) { /* drain */ }

    expect(textTurn).toBe(3);
    const secondPrompt = visionRequests[1].map((message) => message.content).join('\n');
    expect(secondPrompt).toContain('[近期视觉状态，仅用于前后变化对照]');
    expect(secondPrompt).toContain('购物车角标为 1');

    const thirdPrompt = visionRequests[2].map((message) => message.content).join('\n');
    expect(thirdPrompt).toContain('购物车角标为 1');
    expect(thirdPrompt).toContain('规格选择浮层');
    expect(thirdPrompt).toContain('明确记录发生的变化');
    expect(thirdPrompt).toContain('ref、坐标和控件状态均不可复用');
  });

  it('consumes a screenshot once and carries its visual memory into text follow-ups', async () => {
    const images: ScreenshotImage[] = [];
    let textTurn = 0;
    let visionTurn = 0;
    const provider = {
      generateWithTools: jest.fn(async () => {
        textTurn += 1;
        return textTurn === 1
          ? '{"name":"ui_screenshot","arguments":{}}'
          : '{"name":"task_complete","arguments":{"summary":"已定位"}}';
      }),
      generateWithVision: jest.fn(async (
        _messages: LLMMessage[],
        _tools: unknown,
        image: ScreenshotImage,
      ) => {
        images.push(image);
        visionTurn += 1;
        return visionTurn === 1
          ? '<visual_memory>页面显示目标入口。</visual_memory>' +
            '<tool_call>{"name":"ui_find_node","arguments":{"text":"目标"}}</tool_call>'
          : '{"name":"task_complete","arguments":{"summary":"已定位"}}';
      }),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({ provider, useVision: true, maxSteps: 4, requestTimeoutMs: 0 });

    for await (const _event of loop.run('定位目标')) { /* drain */ }

    expect(images.map((image) => image.path)).toEqual(['/tmp/explicit.png']);
    expect(provider.generateWithTools).toHaveBeenCalledTimes(2);
    const followupMessages = (provider.generateWithTools as jest.Mock).mock.calls[1]?.[0] as LLMMessage[];
    expect(followupMessages.map((message) => message.content).join('\n'))
      .toContain('页面显示目标入口');
  });

  it('invalidates the cached screenshot after a screen-changing tool', async () => {
    const images: ScreenshotImage[] = [];
    let textTurn = 0;
    const provider = {
      generateWithTools: jest.fn(async () => {
        textTurn += 1;
        return textTurn === 1
          ? '{"name":"ui_screenshot","arguments":{}}'
          : '{"name":"task_complete","arguments":{"summary":"已完成"}}';
      }),
      generateWithVision: jest.fn(async (
        _messages: LLMMessage[],
        _tools: unknown,
        image: ScreenshotImage,
      ) => {
        images.push(image);
        return '{"name":"mutate_ui","arguments":{}}';
      }),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({
      provider,
      useVision: true,
      maxSteps: 4,
      settleMs: 0,
      requestTimeoutMs: 0,
      extraTools: [{
        tool: {
          name: 'mutate_ui',
          description: 'changes screen',
          uiEffect: 'change',
          parameters: { type: 'object', properties: {} },
        },
        handler: async () => true,
      }],
    });

    for await (const _event of loop.run('改变界面')) { /* drain */ }

    expect(images.map((image) => image.path)).toEqual(['/tmp/explicit.png']);
    expect(provider.generateWithTools).toHaveBeenCalledTimes(2);
  });

  it('scroll_page advances nearly one viewport and returns its post-action image', async () => {
    const before = {
      className: 'View',
      text: '第 1 页',
      bounds: { left: 0, top: 0, right: 1000, bottom: 2000 },
      children: [],
    };
    const after = { ...before, text: '第 2 页' };
    mockCtrl.getAccessibilityTree
      .mockReset()
      .mockResolvedValueOnce(before)
      .mockResolvedValue(after);
    mockCtrl.compareScreenshotFiles.mockResolvedValue({
      changed: true,
      changedPixelRatio: 0.4,
      changedTileRatio: 0.5,
      meanDelta: 18,
    });
    const images: ScreenshotImage[] = [];
    const messagesList: LLMMessage[][] = [];
    const provider = {
      generateWithTools: jest.fn(async () =>
        '{"name":"ui_scroll_page","arguments":{"direction":"down"}}'),
      generateWithVision: jest.fn(async (
        messages: LLMMessage[],
        _tools: unknown,
        image: ScreenshotImage,
      ) => {
        messagesList.push(messages);
        images.push(image);
        return '{"name":"task_complete","arguments":{"summary":"已翻页"}}';
      }),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({
      provider,
      useVision: true,
      maxSteps: 3,
      settleMs: 0,
      requestTimeoutMs: 0,
    });

    for await (const _event of loop.run('读取长表格')) { /* drain */ }

    expect(mockCtrl.swipe).toHaveBeenCalledWith(500, 1800, 500, 200, 450);
    expect(images.map((image) => image.path)).toEqual(['/tmp/explicit.png']);
    expect(messagesList[0].some((message) =>
      message.content.includes('"changed":true') &&
      message.content.includes('"atEdge":false'),
    )).toBe(true);
  });

  it('does not observe automatically after a screen-changing action', async () => {
    const responses = [
      '{"name":"open_app","arguments":{"packageName":"com.example"}}',
      '{"name":"task_complete","arguments":{"summary":"已打开"}}',
    ];
    let call = 0;
    const provider = {
      generateWithTools: jest.fn(async () => responses[call++]),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({
      provider,
      useVision: true,
      maxSteps: 3,
      settleMs: 0,
      requestTimeoutMs: 0,
    });

    for await (const _event of loop.run('打开应用')) { /* drain */ }

    expect(mockCtrl.getAccessibilityTree).not.toHaveBeenCalled();
    expect(takeScreenshot).not.toHaveBeenCalled();
    expect(captureWithMediaProjection).not.toHaveBeenCalled();
  });

  it('uses an image returned by another explicit observation tool', async () => {
    const images: ScreenshotImage[] = [];
    const visionMessages: ModelMessage[][] = [];
    const provider = {
      generateWithTools: jest.fn(async () => ''),
      generateWithVision: jest.fn(async () => ''),
      generateStructuredWithTools: jest.fn(async (): Promise<ModelResponse> => ({
        content: [{
          type: 'tool_call',
          id: 'browser_screenshot_1',
          name: 'browser_use',
          arguments: { action: 'ui_screenshot' },
        }],
        finishReason: 'tool_call',
      })),
      generateStructuredWithVision: jest.fn(async (
        messages: ModelMessage[],
        _tools: unknown,
        image: ScreenshotImage,
      ): Promise<ModelResponse> => {
        visionMessages.push(messages);
        images.push(image);
        return {
          content: [{
            type: 'tool_call',
            id: 'task_complete_1',
            name: 'task_complete',
            arguments: { summary: '已查看网页' },
          }],
          finishReason: 'tool_call',
        };
      }),
    } as unknown as LLMProviderInterface;
    const loop = new AgentLoop({
      provider,
      useVision: true,
      maxSteps: 3,
      requestTimeoutMs: 0,
      extraTools: [{
        tool: {
          name: 'browser_use',
          description: 'browser',
          uiEffect: 'none',
          parameters: { type: 'object', properties: { action: { type: 'string' } } },
        },
        handler: async () => ({
          ok: true,
          data: { action: 'ui_screenshot' },
          observationImage: {
            path: '/tmp/browser.png',
            base64: 'YnJvd3Nlcg==',
            mimeType: 'image/png',
          },
        }),
      }],
    });

    for await (const _event of loop.run('查看网页截图')) { /* drain */ }

    expect(images.map((image) => image.path)).toEqual(['/tmp/browser.png']);
    expect(JSON.stringify(visionMessages)).toContain('browser_screenshot_1');
    expect(JSON.stringify(visionMessages)).not.toContain('YnJvd3Nlcg==');
    expect(JSON.stringify(visionMessages)).not.toContain('observationImage');
    expect(mockCtrl.getAccessibilityTree).not.toHaveBeenCalled();
    expect(captureWithMediaProjection).not.toHaveBeenCalled();
  });
});
