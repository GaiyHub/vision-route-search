import { BROWSER_TOOLS, createBrowserToolRegistrations } from '../BrowserTool';
import { BROWSER_TOOL_NAMES } from '../BrowserTypes';
import { browserSession } from '../BrowserSession';
import { PHONE_TOOLS } from '../../device-agent/tools/PhoneTools';

describe('model-facing browser tools', () => {
  it('exposes high-frequency actions as unambiguous browser_* tools', () => {
    expect(BROWSER_TOOLS.map((tool) => tool.name)).toEqual(Object.values(BROWSER_TOOL_NAMES));
    expect(BROWSER_TOOLS).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'browser_navigate' }),
      expect.objectContaining({ name: 'browser_click' }),
      expect.objectContaining({ name: 'browser_type' }),
      expect.objectContaining({ name: 'browser_read' }),
      expect.objectContaining({ name: 'browser_find' }),
      expect.objectContaining({ name: 'browser_scroll' }),
    ]));
    expect(BROWSER_TOOLS.some((tool) => tool.name === 'browser_use')).toBe(false);
    expect(BROWSER_TOOLS.every((tool) => tool.parameters.properties.action === undefined)).toBe(true);
    const completeCatalog = [...PHONE_TOOLS, ...BROWSER_TOOLS].map((tool) => tool.name);
    expect(completeCatalog).toEqual(expect.arrayContaining(['ui_tap', 'browser_click']));
    expect(completeCatalog).not.toEqual(expect.arrayContaining(['tap', 'click', 'browser_use']));
  });

  it('keeps low-frequency operations under browser_manage', () => {
    const manage = BROWSER_TOOLS.find((tool) => tool.name === 'browser_manage')!;
    expect(manage.parameters.required).toEqual(['operation']);
    expect(manage.parameters.properties.operation.enum).toEqual(expect.arrayContaining([
      'execute_js', 'new_tab', 'list_tabs', 'get_cookies', 'set_cookies', 'set_viewport',
    ]));
    expect(manage.parameters.properties.cookies).toBeDefined();
  });

  it('describes browser screenshots by capability without suppressing their use', () => {
    const screenshot = BROWSER_TOOLS.find((tool) => tool.name === 'browser_screenshot')!;
    expect(screenshot.description).toContain('返回视觉图像');
    expect(screenshot.description).toContain('DOM 未表达');
    expect(screenshot.description).not.toContain('仅在');
  });

  it('translates each public tool into the existing browser session action', async () => {
    const execute = jest.spyOn(browserSession, 'execute').mockResolvedValue({ ok: true });
    const registrations = createBrowserToolRegistrations();
    await registrations.find(({ tool }) => tool.name === 'browser_read')!
      .handler({ mode: 'backbone', max_depth: 3 });
    await registrations.find(({ tool }) => tool.name === 'browser_manage')!
      .handler({ operation: 'list_tabs' });

    expect(execute).toHaveBeenNthCalledWith(1, { action: 'get_backbone', max_depth: 3 });
    expect(execute).toHaveBeenNthCalledWith(2, { action: 'list_tabs' });
    execute.mockRestore();
  });
});
