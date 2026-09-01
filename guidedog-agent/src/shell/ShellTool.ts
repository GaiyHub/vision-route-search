import type { Tool } from '../device-agent/types';

export const SHELL_EXECUTE_TOOL_NAME = 'shell_execute';
export const SHELL_DEFAULT_TIMEOUT_MS = 60_000;
export const SHELL_MIN_TIMEOUT_MS = 1_000;
export const SHELL_MAX_TIMEOUT_MS = 900_000;
export const SHELL_MAX_COMMAND_LENGTH = 1000;

export const SHELL_EXECUTE_TOOL: Tool = {
  name: SHELL_EXECUTE_TOOL_NAME,
  description: [
    '运行 Shell 命令。可由确定性命令完成的任务，优先使用本工具而非 UI 模拟。',
    '',
    '常用命令：',
    '- 环境：`date` 查时间；`uname` 查系统信息；`env` 查环境变量；`ps` 查进程；`du` 统计目录大小。',
    '- 文件：`pwd` 查当前目录；`ls` 列文件；`cat` 读文件；`head`/`tail` 读首尾内容；`find` 查找；`cp` 复制；`mv` 移动或重命名；`mkdir` 建目录；`rm` 删除。',
    '- 文本：`grep` 搜索；`sed` 替换或转换；`awk` 按列处理；`sort` 排序；`uniq` 去重；`wc` 计数；`cut` 提取列；`tr` 字符转换；`xargs` 组装命令参数；`printf` 格式化输出。',
    '- 数据：`base64` 编解码；`sha256sum` 计算校验值；`tar` 归档；`gzip`/`gunzip` 压缩或解压。',
    '- 网络：`wget` 发起 HTTP(S) 请求或下载；`ping` 测连通性；`nc` 进行 TCP/UDP 连接；`ftpget` 从 FTP 下载。',
    '',
    'Android 手机能力：',
    '- 下列 `android-*` 均是 Shell 子命令，只能作为 `shell_execute` 的 `command` 参数执行，不是可独立调用的工具名。',
    '- 正确示例：`shell_execute(command="android-location current")`；`shell_execute(command="android-alarm schedule 10:45 --label \'出发去医院\'")`。',
    '- 错误示例：不要把 `android-location current` 或 `android-alarm schedule` 填入工具的 `name`。',
    '- `android-device all|info|battery|storage`：查全部、设备、电池或存储状态。',
    '- `android-location current`：获取当前经纬度、精度及定位时间等数据。',
    '- `android-communicate sms --to <号码> [--body <内容>]`：打开并预填短信，不发送。',
    '- `android-communicate dial --number <号码>`：打开拨号页，不拨出。',
    '- `android-communicate email --to <地址> [--subject <主题>] [--body <内容>]`：打开并预填邮件，不发送。',
    '- `android-alarm schedule <HH:MM> [--label <备注>]`：请求在系统时钟中直接创建闹钟；部分系统可能打开预填编辑页，需继续确认。`timer <秒数> [--label <备注>]` 请求设置计时器；`open` 仅打开已有闹钟列表，不创建或验证闹钟。',
    '- `android-map search --query <地点>`、`show --latitude <纬度> --longitude <经度> [--label <标签>]`：按关键词搜地点或在地图显示坐标。',
    '- `android-open <URI>`：调用能处理该 URI 的系统应用打开网页、电话、地图、应用商店等。',
    '- `android-calendar insert ...`：打开并预填日历事件，用户确认后才保存。',
    '- `android-settings list|open <target>`：列出或打开指定系统设置页。',
    '- `android-share text ...`：打开系统分享面板并预填文本，不自动发布。',
    '- `android-clipboard get|set <文本>|clear`：读取、写入或清空系统剪贴板。',
    '- `android-notification send --title <标题> [--body <内容>]|clear`：发送或清除豆泡创建的本地通知。',
    '- `android-speak <文本>`：使用系统 TTS 语音朗读。',
    '',
    '命令发现：',
    '- 执行 `shell-help` 查看本工具支持的全部命令。',
    '- 执行 `<command> --help` 查看具体参数。',
  ].join('\n'),
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的 Shell 命令；不要超过 1000 字符',
      },
      timeout_ms: {
        type: 'number',
        description: '超时毫秒数，默认 60000，范围 1000–900000',
      },
    },
    required: ['command'],
  },
};

export type ShellPrivilege = 'sandbox';

export interface NormalizedShellArgs {
  command: string;
  timeoutMs: number;
  privilege: ShellPrivilege;
}

export interface ShellNativeResult {
  ok: boolean;
  output?: string;
  exit_code?: number;
  duration_ms?: number;
  timed_out?: boolean;
  truncated?: boolean;
  output_ref?: string;
  privilege?: string;
  error?: string;
  code?: string;
}

export interface ShellHandlerDeps {
  execute: (
    command: string,
    timeoutMs: number,
    privilege: ShellPrivilege,
    confirmed: boolean,
  ) => Promise<ShellNativeResult>;
}

export function normalizeShellArgs(
  args: Record<string, unknown>,
): { ok: true; value: NormalizedShellArgs } | { ok: false; error: string } {
  const command = typeof args.command === 'string' ? args.command : '';
  const timeoutMs = args.timeout_ms === undefined
    ? SHELL_DEFAULT_TIMEOUT_MS
    : Number(args.timeout_ms);
  const privilege = args.privilege === undefined ? 'sandbox' : String(args.privilege);
  if (!command.trim()) return { ok: false, error: 'command 不能为空' };
  if (command.includes('\0')) return { ok: false, error: 'command 不能包含 NUL 字节' };
  if (command.length > SHELL_MAX_COMMAND_LENGTH) {
    return { ok: false, error: `command 不能超过 ${SHELL_MAX_COMMAND_LENGTH} 个字符` };
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < SHELL_MIN_TIMEOUT_MS || timeoutMs > SHELL_MAX_TIMEOUT_MS) {
    return { ok: false, error: `timeout_ms 必须是 ${SHELL_MIN_TIMEOUT_MS}–${SHELL_MAX_TIMEOUT_MS} 的整数` };
  }
  if (privilege !== 'sandbox') {
    return { ok: false, error: '当前仅支持 sandbox 执行域' };
  }
  return { ok: true, value: { command, timeoutMs, privilege } };
}

export function createShellExecuteHandler(deps: ShellHandlerDeps) {
  return async (args: Record<string, unknown>): Promise<ShellNativeResult> => {
    const normalized = normalizeShellArgs(args);
    if (!normalized.ok) {
      return { ok: false, error: normalized.error, code: 'INVALID_ARGUMENT' };
    }
    const { command, timeoutMs, privilege } = normalized.value;
    return deps.execute(command, timeoutMs, privilege, false);
  };
}
