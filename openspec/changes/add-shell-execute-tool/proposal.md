## Why

豆泡当前依赖大量专用手机工具完成操作，缺少一个可组合、可脚本化的数据处理环境，导致网页数据处理、文件转换、诊断和长尾自动化必须不断扩展工具集合。移植 OpenMinis 的 `shell_execute` 分层可以用一个稳定工具覆盖隔离 Linux 命令，并在用户明确授权时通过受控桥接调用 Android 高权限能力。

## What Changes

- 新增 `shell_execute` agent 工具，在豆泡内执行有超时、输出上限和结构化结果的 Shell 命令。
- 为 Android 打包 arm64 PRoot 与 Alpine minirootfs，在应用私有目录维护持久化隔离文件系统。
- 将普通 Linux Shell 与 Android 高权限执行分层：默认命令仅运行在 PRoot 沙箱；Shizuku 能力通过显式、受控入口提供。
- 对高风险命令执行安全预检，并复用豆泡的用户确认流程；禁止绕过式命令拼接执行高风险 Android 操作。
- 长输出只返回尾部摘要和元数据，避免工具结果持续推高模型上下文。
- 在工具预设和配置目录中注册该工具，同时保持浏览器、等待和用户确认等既有敏感工具策略不变。

## Capabilities

### New Capabilities
- `sandbox-shell-execution`: 在 Android 上提供隔离、可超时、可审计的持久化 Linux Shell，并定义可选 Shizuku 桥接的权限边界。

### Modified Capabilities

## Impact

- `guidedog-agent/src/device-agent`：工具 schema、注册和结果历史处理。
- `guidedog-agent/src/agent/agentBridge.ts`：React Native 原生执行桥接与确认策略。
- `guidedog-agent/plugins/android`：PRoot/Alpine 安装、进程执行和可选 Shizuku 后端。
- `guidedog-agent/android/app` 与 Expo config plugin：arm64 原生二进制、rootfs asset、打包配置和依赖。
- APK 体积会增加；首次 Shell 调用需要解压 rootfs，因此需要明确的初始化状态和错误反馈。
