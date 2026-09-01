import {
  SHELL_EXECUTE_TOOL,
  createShellExecuteHandler,
  normalizeShellArgs,
} from '../ShellTool';
import { TOOL_CIRCUIT_BREAKER_CATALOG } from '../../device-agent/tools/ToolCircuitBreakerPolicy';
import { UI_EFFECT_LOCKED_TOOLS } from '../../device-agent/tools/ToolConfiguration';

describe('shell_execute tool', () => {
  test('exposes a sandbox-only schema', () => {
    expect(SHELL_EXECUTE_TOOL.name).toBe('shell_execute');
    expect(SHELL_EXECUTE_TOOL.parameters.required).toEqual(['command']);
    expect(SHELL_EXECUTE_TOOL.parameters.properties.privilege).toBeUndefined();
    expect(TOOL_CIRCUIT_BREAKER_CATALOG.map((entry) => entry.name)).toContain('shell_execute');
    expect(UI_EFFECT_LOCKED_TOOLS.has('shell_execute')).toBe(true);
  });

  test('describes execution-backed and Android host capabilities', () => {
    expect(SHELL_EXECUTE_TOOL.description).toContain('常用命令：');
    expect(SHELL_EXECUTE_TOOL.description).toContain('环境：');
    expect(SHELL_EXECUTE_TOOL.description).toContain('文件：');
    expect(SHELL_EXECUTE_TOOL.description).toContain('文本：');
    expect(SHELL_EXECUTE_TOOL.description).toContain('网络：');
    expect(SHELL_EXECUTE_TOOL.description).toContain('Android 手机能力');
    expect(SHELL_EXECUTE_TOOL.description).toContain('均是 Shell 子命令');
    expect(SHELL_EXECUTE_TOOL.description).toContain('只能作为 `shell_execute` 的 `command` 参数执行');
    expect(SHELL_EXECUTE_TOOL.description).toContain('不是可独立调用的工具名');
    expect(SHELL_EXECUTE_TOOL.description).toContain('shell_execute(command="android-location current")');
    expect(SHELL_EXECUTE_TOOL.description).toContain('不要把 `android-location current`');
    expect(SHELL_EXECUTE_TOOL.description).toContain('优先使用本工具而非 UI 模拟');
    expect(SHELL_EXECUTE_TOOL.description).toContain('android-location current');
    expect(SHELL_EXECUTE_TOOL.description).toContain('android-communicate sms --to <号码>');
    expect(SHELL_EXECUTE_TOOL.description).toContain('打开并预填短信，不发送');
    expect(SHELL_EXECUTE_TOOL.description).toContain('android-alarm schedule <HH:MM> [--label <备注>]');
    expect(SHELL_EXECUTE_TOOL.description).toContain('在系统时钟中直接创建闹钟');
    expect(SHELL_EXECUTE_TOOL.description).toContain('部分系统可能打开预填编辑页');
    expect(SHELL_EXECUTE_TOOL.description).toContain('`open` 仅打开已有闹钟列表');
    expect(SHELL_EXECUTE_TOOL.description).toContain('android-map search --query <地点>');
    expect(SHELL_EXECUTE_TOOL.description).toContain('android-calendar insert');
    expect(SHELL_EXECUTE_TOOL.description).toContain('android-clipboard get|set');
    expect(SHELL_EXECUTE_TOOL.description).toContain('android-speak <文本>');
    expect(SHELL_EXECUTE_TOOL.description).toContain('`tar` 归档');
    expect(SHELL_EXECUTE_TOOL.description).toContain('shell-help');
    expect(SHELL_EXECUTE_TOOL.description).toContain('<command> --help');
    expect(SHELL_EXECUTE_TOOL.description).toContain('查看本工具支持的全部命令');
    expect(SHELL_EXECUTE_TOOL.description).not.toContain('android-help');
    expect(SHELL_EXECUTE_TOOL.description).not.toContain('必要时再继续 UI 操作');
    expect(SHELL_EXECUTE_TOOL.description).not.toContain('不提供 Android 原生 Shell');
    expect(SHELL_EXECUTE_TOOL.description).not.toContain('每次调用为独立进程');
    expect(SHELL_EXECUTE_TOOL.description).not.toContain('隔离 Shell');
    expect(SHELL_EXECUTE_TOOL.description).not.toContain('Alpine Linux');
    expect(SHELL_EXECUTE_TOOL.description).not.toContain('不是 Android Shell');
    expect(SHELL_EXECUTE_TOOL.description).not.toContain('普通问答能可靠直接回答');
    expect(SHELL_EXECUTE_TOOL.description).not.toContain('更合适的专用工具');
    expect(SHELL_EXECUTE_TOOL.description).not.toContain('smsto:');
    expect(SHELL_EXECUTE_TOOL.description.length).toBeLessThan(2500);
  });

  test('normalizes defaults and rejects invalid input', () => {
    expect(normalizeShellArgs({ command: 'printf ok' })).toEqual({
      ok: true,
      value: { command: 'printf ok', timeoutMs: 60_000, privilege: 'sandbox' },
    });
    expect(normalizeShellArgs({ command: '' }).ok).toBe(false);
    expect(normalizeShellArgs({ command: 'x', timeout_ms: 999 }).ok).toBe(false);
    expect(normalizeShellArgs({ command: 'x', privilege: 'root' }).ok).toBe(false);
  });

  test('routes sandbox calls without confirmation', async () => {
    const execute = jest.fn(async (_command, _timeout, privilege, confirmed) => ({
      ok: true, privilege, confirmed,
    }));
    const handler = createShellExecuteHandler({ execute });

    await expect(handler({ command: 'printf ok' })).resolves.toMatchObject({ ok: true });
    expect(execute).toHaveBeenNthCalledWith(1, 'printf ok', 60_000, 'sandbox', false);
  });

  test('rejects non-sandbox execution domains', async () => {
    const execute = jest.fn(async () => ({ ok: true }));
    const handler = createShellExecuteHandler({ execute });
    await expect(handler({ command: 'getprop ro.build.version.release', privilege: 'device' }))
      .resolves.toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(execute).not.toHaveBeenCalled();
  });
});
