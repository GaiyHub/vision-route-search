import { AgentToolkit, resolveToolUiEffect } from '../agent/AgentToolkit';
import { BROWSER_TOOLS } from '../../browser/BrowserTool';

describe('resolveToolUiEffect', () => {
  it.each([
    ['browser_read', {}, 'none'],
    ['browser_find', {}, 'none'],
    ['browser_screenshot', {}, 'none'],
    ['browser_navigate', {}, 'change'],
    ['browser_click', {}, 'change'],
    ['browser_type', {}, 'change'],
    ['browser_scroll', {}, 'change'],
    ['browser_wait', {}, 'wait'],
    ['browser_manage', { operation: 'list_tabs' }, 'none'],
    ['browser_manage', { operation: 'execute_js' }, 'change'],
  ] as const)('classifies %s as %s', (name, args, effect) => {
    expect(resolveToolUiEffect({ name, arguments: args })).toBe(effect);
  });

  it('downgrades failed UI actions to no effect', () => {
    expect(resolveToolUiEffect(
      { name: 'open_app', arguments: { packageName: 'missing' } },
      { ok: false, error: 'not found' },
    )).toBe('none');
  });

  it('keeps an accepted but unconfirmed launch as screen-changing', () => {
    expect(resolveToolUiEffect(
      { name: 'open_app', arguments: { packageName: 'delayed.app' } },
      {
        ok: false,
        error: 'APP_NOT_FOREGROUND',
        data: { launchAccepted: true, launchConfirmed: false },
      },
    )).toBe('change');
  });

  it('treats an already-foreground launch as a no-op', () => {
    expect(resolveToolUiEffect(
      { name: 'open_app', arguments: { packageName: 'current.app' } },
      {
        ok: true,
        data: { launchAccepted: true, launchConfirmed: true, alreadyForeground: true },
      },
    )).toBe('none');
  });

  it('keeps waits and user gates distinct from mutations', () => {
    expect(resolveToolUiEffect({ name: 'wait', arguments: { ms: 100 } })).toBe('wait');
    expect(resolveToolUiEffect({ name: 'confirm_action', arguments: {} })).toBe('user_gate');
    expect(resolveToolUiEffect({ name: 'ask_user', arguments: {} })).toBe('user_gate');
    expect(resolveToolUiEffect({ name: 'request_user_action', arguments: {} })).toBe('user_gate');
  });

  it('treats unconfigured custom tools conservatively without a model field', async () => {
    const handler = jest.fn(async () => 'ok');
    const toolkit = new AgentToolkit(
      { delay: async () => {}, notes: new Map() },
      { extraTools: [{
        tool: {
          name: 'custom_query',
          description: 'custom',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
        handler,
      }] },
    );
    const exposed = toolkit.tools.find((tool) => tool.name === 'custom_query')!;
    expect(exposed.parameters.required ?? []).not.toContain('_changesScreen');
    expect(exposed.parameters.properties._changesScreen).toBeUndefined();

    const call = {
      name: 'custom_query',
      arguments: { query: 'hello' },
    };
    expect(toolkit.resolveUiEffect(call)).toBe('change');
    await toolkit.execute(call);
    expect(handler).toHaveBeenCalledWith({ query: 'hello' });
  });

  it('uses explicit tool configuration without asking the model', () => {
    const toolkit = new AgentToolkit(
      { delay: async () => {}, notes: new Map() },
      { extraTools: [{
        tool: {
          name: 'background_lookup',
          description: 'lookup',
          parameters: { type: 'object', properties: {} },
          uiEffect: 'none',
        },
        handler: async () => 'ok',
      }] },
    );
    const exposed = toolkit.tools.find((tool) => tool.name === 'background_lookup')!;
    expect(exposed.parameters.properties._changesScreen).toBeUndefined();
    expect(toolkit.resolveUiEffect({ name: 'background_lookup', arguments: {} })).toBe('none');
  });

  it('treats an adaptive override conservatively without a model field', async () => {
    const toolkit = new AgentToolkit(
      { delay: async () => {}, notes: new Map() },
      { toolConfigurationOverrides: { ui_tap: { uiEffect: 'adaptive' } } },
    );
    const tap = toolkit.tools.find((tool) => tool.name === 'ui_tap')!;
    expect(tap.parameters.required ?? []).not.toContain('_changesScreen');
    expect(tap.parameters.properties._changesScreen).toBeUndefined();
    expect(toolkit.resolveUiEffect({
      name: 'ui_tap',
      arguments: { x: 1, y: 1, _changesScreen: false },
    })).toBe('change');
  });

  it('keeps browser and wait semantics runtime-owned', () => {
    const toolkit = new AgentToolkit(
      { delay: async () => {}, notes: new Map() },
      { extraTools: BROWSER_TOOLS.map((tool) => ({ tool, handler: async () => ({ ok: true }) })) },
    );
    const browser = toolkit.tools.find((candidate) => candidate.name === 'browser_navigate')!;
    expect(browser.parameters.required).not.toContain('_changesScreen');
    expect(browser.parameters.properties._changesScreen).toBeUndefined();
    expect(toolkit.resolveUiEffect({ name: 'browser_navigate', arguments: {} })).toBe('change');
    expect(toolkit.resolveUiEffect({ name: 'browser_wait', arguments: {} })).toBe('wait');
    expect(toolkit.resolveUiEffect({
      name: 'browser_manage', arguments: { operation: 'execute_js' },
    })).toBe('change');
    expect(toolkit.resolveUiEffect({
      name: 'browser_manage', arguments: { operation: 'list_tabs' },
    })).toBe('none');

    for (const name of ['wait', 'ui_wait_for_node', 'ui_wait_for_change']) {
      const tool = toolkit.tools.find((candidate) => candidate.name === name);
      if (!tool) continue;
      expect(tool.parameters.required ?? []).not.toContain('_changesScreen');
      expect(tool.parameters.properties._changesScreen).toBeUndefined();
      expect(toolkit.resolveUiEffect({
        name,
        arguments: { ms: 1000, _changesScreen: false },
      })).toBe('wait');
    }
  });

  it('lets yes/no overrides replace intrinsic classifications', () => {
    const toolkit = new AgentToolkit(
      { delay: async () => {}, notes: new Map() },
      { toolConfigurationOverrides: {
        ui_tap: { uiEffect: 'none' },
        list_apps: { uiEffect: 'change' },
      } },
    );
    expect(toolkit.resolveUiEffect({ name: 'ui_tap', arguments: {} })).toBe('none');
    expect(toolkit.resolveUiEffect({ name: 'list_apps', arguments: {} })).toBe('change');
  });
});
