## Context

豆泡的 agent loop 运行在 React Native，工具 schema 与调度位于 TypeScript，Android 能力通过 `DeftAgentModule` 暴露。现有工具面向 UI 自动化；没有持久 Linux 用户空间，也没有统一的命令执行结果协议。OpenMinis Android 使用 PRoot + Alpine 作为普通 Shell，以 Shizuku native offload 作为显式的 Android 高权限扩展。豆泡应保留这一权限分层，但以现有 RN bridge 和 `confirm_action` 风险确认机制实现。

当前构建由 Expo config plugin 复制 Kotlin 源并修补 Gradle，因此新增原生源、资产、Shizuku 依赖和 `noCompress` 配置都必须由 plugin 持久化，不能只修改生成后的 `android/` 目录。当前 APK 只支持 `arm64-v8a`，第一版可使用单架构 PRoot。

## Goals / Non-Goals

**Goals:**

- 提供与 OpenMinis 核心语义一致的持久 Alpine/PRoot `shell_execute`。
- 普通命令始终在应用私有沙箱内执行，返回 exit code、stdout/stderr 合并输出、耗时和截断信息。
- 提供可选 `privilege=shizuku` 模式，通过 Shizuku 执行 Android shell，而不让普通 PRoot 命令隐式获得系统权限。
- 将命令长度、超时、并发、输出大小和危险命令限制固化在宿主端，不能仅依赖模型提示词。
- 工具结果保持足够短，避免新的工具反而放大上下文成本。

**Non-Goals:**

- 第一版不提供交互式 PTY、终端 UI、后台守护进程或跨 ABI 支持。
- 不移植 OpenMinis 的全部 native-offload CLI、文件浏览器、包镜像 UI和会话终端。
- 不允许 PRoot 沙箱直接访问其他 App 私有数据。
- 不以 `shell_execute` 替代无障碍 UI 工具或 `browser_use`。

## Decisions

### 使用 PRoot + Alpine，而不是直接 `/system/bin/sh`

普通执行后端打包 OpenMinis 同类的 arm64 PRoot 原生库和 Alpine minirootfs。rootfs 首次调用时解压到 `filesDir/shell/rootfs`，后续任务复用；工作目录固定为 `/workspace` 并绑定到应用私有目录。

直接 `/system/bin/sh` 虽然实现简单，但只拥有 App UID、命令集合不稳定，也无法提供可安装软件包和一致 Linux 环境，因此不满足“移植 OpenMinis 能力”的目标。

### 单工具、显式权限域

工具参数包含 `command`、`timeout_ms` 和 `privilege`。`privilege` 默认为 `sandbox`；只有显式指定 `shizuku` 才走 Shizuku SDK。两种后端返回同一结构，模型无需学习第二个工具。

不在 PRoot 内模拟一个可被任意脚本调用的透明 Shizuku CLI。这样权限提升发生在宿主工具边界，便于确认、审计和命令解析，也避免 Shell 拼接绕开规则。未来若需要兼容 OpenMinis CLI，可在相同策略层之上增加受控 wrapper。

### 宿主端安全分级

TypeScript 工具描述负责告诉模型使用场景；Kotlin 执行器负责不可绕过的校验：

- sandbox：禁止超长命令、NUL 字节、无限超时；文件访问受 PRoot rootfs/bind mount 限制。
- shizuku：只读命令白名单可以直接执行；修改包、权限、设置、输入、文件和进程状态的命令必须先经过 `confirm_action`；清数据、卸载、递归删除、重启等高危命令默认拒绝。
- 同一时刻只运行一个命令；停止任务或超时必须销毁进程树。

第一版在 agent bridge 中为 Shizuku 写操作调用既有确认通道，并在 Kotlin 再次分类验证，形成双层防护。

### 输出采用尾部保留和本地完整记录

原生层最多采集有限字节，返回内容再限制为适合模型读取的长度。超限时保留开头诊断和最新尾部，设置 `truncated=true`，并将完整输出写入应用私有日志文件，返回 `output_ref`。历史 prompt 仍受现有单工具结果 2000 字符上限保护。

### 构建资产由 Expo plugin 管理

新增 `plugins/android/shell/` 存放 Kotlin 源，新增 `assets/shell/` 存放 rootfs，并由 config plugin：

- 复制原生源到生成项目；
- 复制 `libproot.so` 到 `jniLibs/arm64-v8a`；
- 复制 rootfs 到 Android assets 并配置不压缩；
- 添加 Shizuku API/provider 依赖。

生成后的 Android 工程同时更新，保证当前工作树可直接构建；plugin 是后续 `expo prebuild` 的来源真相。

## Risks / Trade-offs

- [APK 体积与首次解压时间增加] → 使用 Alpine minirootfs、惰性安装并返回明确初始化状态。
- [PRoot 在不同 Android 内核上的兼容性] → 固定 arm64 构建、设备冒烟测试，并在失败时返回后端诊断而非自动降级到宿主 shell。
- [Shizuku 权限扩大攻击面] → 默认 sandbox、显式 privilege、宿主白名单/拒绝表、复用用户确认、无授权时清晰失败。
- [任意 Shell 可产生大量输出或长时间运行] → 超时上限、串行锁、进程销毁、输出采集上限和本地 offload。
- [从 OpenMinis 复制二进制或代码涉及许可证追踪] → 保留上游许可证/来源说明，仅移植必要组件；构建脚本固定上游版本和校验值。

## Migration Plan

1. 新增工具但默认纳入 `full`，不加入最小只读/导航预设。
2. 发布 arm64 release，在测试设备首次执行 `printf`、文件持久化、超时和长输出用例。
3. 在未安装、未运行、未授权三种 Shizuku 状态下验证错误反馈，再验证只读命令。
4. 若运行时出现兼容问题，可从工具注册表禁用 `shell_execute`；现有工具路径不受影响，rootfs 数据可随应用数据清除。

## Open Questions

- 是否在后续版本提供用户可见的 Shell 存储管理和清理入口。
- 是否需要兼容 OpenMinis 的 `android-shizuku-cli` 命令表面，或继续保持显式 `privilege` 参数。
