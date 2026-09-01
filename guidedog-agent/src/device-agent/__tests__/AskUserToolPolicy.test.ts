import {
  REQUIRED_ENABLED_TOOLS,
  UI_EFFECT_LOCKED_TOOLS,
  isToolEnabled,
  normalizeToolConfigurationOverrides,
} from '../tools/ToolConfiguration';
import {
  ASK_USER_DEFAULT_DESCRIPTION,
  TOOL_CIRCUIT_BREAKER_CATALOG,
} from '../tools/ToolCircuitBreakerPolicy';

test('ask_user is always enabled and its UI effect cannot be overridden', () => {
  expect(REQUIRED_ENABLED_TOOLS.has('ask_user')).toBe(true);
  expect(UI_EFFECT_LOCKED_TOOLS.has('ask_user')).toBe(true);
  const overrides = normalizeToolConfigurationOverrides({
    ask_user: { enabled: false, uiEffect: 'none', label: '澄清' },
  });
  expect(overrides.ask_user).toEqual({ label: '澄清' });
  expect(isToolEnabled('ask_user', false, overrides)).toBe(true);
});

test('ask_user is circuit-breaker exempt and exposes a concise interaction contract', () => {
  const entry = TOOL_CIRCUIT_BREAKER_CATALOG.find((tool) => tool.name === 'ask_user');
  expect(entry).toMatchObject({
    label: '用户澄清',
    family: 'exempt',
    behavior: 'exempt',
    blockThreshold: null,
  });
  expect(ASK_USER_DEFAULT_DESCRIPTION).toContain('只能由用户提供');
  expect(ASK_USER_DEFAULT_DESCRIPTION).toContain('仅有多种执行方式时不得调用');
  expect(ASK_USER_DEFAULT_DESCRIPTION).toContain('一次只问一个');
  expect(ASK_USER_DEFAULT_DESCRIPTION).toContain('工具结果返回');
  expect(ASK_USER_DEFAULT_DESCRIPTION.length).toBeLessThan(120);
});
