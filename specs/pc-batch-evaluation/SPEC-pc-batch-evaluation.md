# Spec：豆泡 PC 批量评测框架

## 目标

构建一个运行在 PC 端的本地 WebUI，通过 ADB 批量评测安装在 Android 真机上的豆泡。用户可以配置评测集、选择设备、启动运行、查看样本进度与 Agent 中间过程，并导出 JSON/HTML 报告。首版同时支持确定性断言和 LLM-as-Judge。

该系统用于开发阶段的可重复回归评测，不用于远程设备管理，也不通过坐标模拟豆泡聊天框输入。

## 最新代码事实

- 豆泡为 Expo/React Native 应用，Android 包名为 `com.watchdog.agent`；核心命令入口是 `guidedog-agent/src/agent/agentBridge.ts` 中的 `processCommand(command)`。
- `processCommand` 已拒绝并发任务，但当前只返回 `Promise<void>`，最终结果仅写入聊天和历史 Store，PC 端无法可靠读取完整结果。
- 每次任务已生成 32 位 `traceId`；`otelLogger` 将 OTel JSONL 双写到应用内部目录和 `/storage/emulated/0/Android/data/com.watchdog.agent/files/tasklogs/otel-<traceId>.jsonl`。
- Todo 状态已双写到同一 ADB 可读目录下的 `todo-<traceId>.json`，无需评测框架再设计一套过程日志。
- 当前 `MainActivity` 只有 Launcher Intent；`DeftAgentService` 和各 Receiver 均为 `exported=false`，不存在可从 ADB 提交自然语言任务的稳定入口。
- 当前 Gradle 只有 `debug/release`，不存在 evaluation Variant；评测能力不能直接加入普通生产构建。
- Agent 已包含 `wait`、`ui_wait_for_node`、`ui_wait_for_change`、工具内状态轮询、操作后验验证和循环熔断；评测框架只采集这些行为，不重复实现。

## 实现假设

1. 首版只支持一台已授权真机，单次运行在该设备上串行执行样本。
2. PC 端新增独立 `evaluator/` 工程，使用 Node.js、TypeScript、React 和 Vite；后端仅监听 `127.0.0.1`。
3. evaluation APK 与普通豆泡使用同一 `applicationId`，通过覆盖安装复用模型、API Key、工具开关、Skills 与系统权限；评测运行只读这些配置，不允许修改或迁移它们。
4. 每个样本使用隔离对话上下文，但不清空或改写普通聊天、会话历史、全局 Token 统计、可恢复任务、应用设置或第三方 App 数据。
5. 首版遇到风险确认、`ask_user` 或 `request_user_action` 时不自动授权，样本以 `BLOCKED` 结束。
6. LLM Judge 使用与豆泡运行模型相互独立的 OpenAI-compatible Provider 配置。

## 用户故事

1. 开发者可以创建、导入和编辑带版本的 YAML/JSON 评测集。
2. 开发者可以选择一台处于 `device` 状态的 ADB 设备，并执行所有启用样本。
3. 开发者可以实时查看样本的排队、运行、通过、失败、阻塞、超时和基础设施错误状态。
4. 开发者可以查看完整最终回复、工具调用、错误、耗时、Token/Cache 用量、Todo、最终截图和 UI 层级。
5. 开发者可以独立查看确定性断言结果与 LLM Judge 结果。
6. 开发者可以导出、自包含地打开报告，并只重跑未通过样本。

## 总体架构

```text
React WebUI
    │ HTTP + SSE
    ▼
Node Evaluator Backend
    ├── Dataset / Orchestrator / Assertions / LLM Judge / Report
    └── adb process adapter
             │ explicit evaluation Intent + status/artifact pull
             ▼
Android evaluation Variant
    ├── Kotlin EvaluationGateway：Intent 校验、请求缓存、原子状态文件
    └── RN EvaluationBridge：隔离会话、调用 processCommand、映射交互终态
             │
             ▼
现有 AgentLoop + Tools + OTel/Todo 持久化
```

Android 端只新增薄桥接并扩展 `processCommand` 的可选评测契约，不复制 AgentLoop，不改变聊天入口的默认行为。

## 技术栈

- 移动端：现有 React Native 0.81、Expo 54、TypeScript 5.9、Kotlin、Hermes。
- PC 端：Node.js 20+、TypeScript strict、React、Vite、本地 HTTP/SSE。
- 持久化：Schema 校验后的 YAML/JSON 与本地文件；首版不引入数据库。
- 设备连接：使用参数数组直接调用 `adb`，禁止构造宿主机 Shell 字符串。
- Judge：OpenAI-compatible HTTP Adapter，结构化 JSON 输出；文本必需，图片能力按模型配置启用。

具体新增依赖及版本在 Plan 阶段确定并通过 lockfile 固定。

## 目录结构

```text
evaluator/
├── datasets/                         # 用户维护的 YAML/JSON 评测集
├── src/
│   ├── contracts/                    # PC 端共享 Schema 与错误契约
│   ├── server/                       # localhost HTTP/SSE API
│   ├── adb/                          # adb 进程适配器、Intent 与状态客户端
│   ├── evidence/                     # OTel/Todo/UI/截图采集与标准化
│   ├── assertions/                   # 确定性断言引擎
│   ├── judge/                        # LLM Judge Provider 与 Prompt
│   ├── orchestrator/                 # Run/Sample 状态机
│   ├── reports/                      # JSON/HTML 报告
│   └── web/                          # React WebUI
├── tests/
└── .data/runs/                       # 运行产物，加入 git-ignore

guidedog-agent/
├── src/evaluation/                   # RN EvaluationBridge 与共享类型
├── src/agent/agentBridge.ts          # 向后兼容地增加执行选项和结构化返回值
├── plugins/android/                  # EvaluationGateway 的 Kotlin 源文件
├── plugins/withDeftForegroundService.js
└── android/                          # 由 Expo 配置插件同步的生成产物
```

## 核心执行语义

- PC 为每个样本生成不可变 `runId`、`sampleId`、`requestId` 和 `requestHash`，它们构成评测数据的隔离键。
- 指令通过 evaluation Variant 的显式 Intent 传入；payload 使用 Base64URL 编码并设置大小上限，避免中文、引号和换行的 Shell 转义问题。
- Kotlin 层验证构建开关、Schema、ID、hash 和长度，将请求缓存到 RN 就绪后消费；同一 `requestId + requestHash` 只执行一次。
- RN 层以 `conversationMode='isolated'` 调用 `processCommand`：直接传入空历史但不调用 `clearMessages()`；评测消息不写入 chat/history，全局 Token 统计不累计，普通可恢复任务键不读写。
- OTel 根 Span 与 Todo 产物写入 `source=EVALUATION`、`runId`、`sampleId`、`requestId` 和 `traceId`；PC 端再保存到独立 Run/Sample 目录，禁止按时间戳猜测归属。
- `processCommand` 返回包含完整 `summary`、`outcome`、`traceId`、耗时、步数及本次评测 Token 用量的结构化结果。
- 评测模式自动接受普通完成确认；风险确认、用户澄清和手动操作请求直接映射为 `BLOCKED`，不展示或等待人工卡片。
- RN 在 OTel flush 完成后写入终态，PC 看到终态后再拉取 Trace/Todo，并通过 ADB 采集最终屏幕、UIAutomator 层级和前台包名。
- 样本失败后继续执行下一条；设备断开或运行被取消时停止调度后续样本。

## 命令

PC 端计划命令：

```bash
cd evaluator
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

现有豆泡验证命令：

```bash
cd guidedog-agent
npm run typecheck
npm test -- --runInBand --forceExit
```

Plan 阶段必须确定并记录 evaluation APK 的实际 Gradle 命令；普通 Release 构建继续使用：

```bash
cd guidedog-agent/android
NODE_ENV=production ./gradlew :app:assembleRelease
```

## 代码规范

- TypeScript 使用 strict，外部输入必须在 HTTP、评测集、ADB 状态文件和 Judge 响应边界完成 Schema 校验。
- 生命周期使用可辨识联合类型，避免通过多个布尔值组合状态。
- PC 端注入进程、时钟、文件系统和 Judge Adapter，以便脱离设备测试。
- 对现有 `processCommand` 的扩展必须保持默认参数和现有调用行为兼容。
- Kotlin 插件源文件是事实来源，生成的 `android/` 文件由配置插件同步，禁止只修改生成文件。

示例：

```ts
type SampleState =
  | { type: 'PENDING' }
  | { type: 'RUNNING'; startedAt: string; traceId?: string }
  | { type: 'PASSED'; finishedAt: string; score?: number }
  | { type: 'FAILED'; finishedAt: string; reason: string }
  | { type: 'BLOCKED'; finishedAt: string; interaction: 'RISK' | 'ASK_USER' | 'USER_ACTION' }
  | { type: 'TIMED_OUT' | 'CANCELLED'; finishedAt: string }
  | { type: 'INFRA_ERROR'; finishedAt: string; code: string };
```

## 测试策略

- 契约测试：评测集、Intent payload、`EvalStatusV1`、Judge 结果和报告 Schema。
- PC 单元测试：断言语义、状态转换、聚合、超时、取消与脱敏。
- Fake ADB 集成测试：无设备、多设备、未授权、重复请求、异常状态、设备断开、Trace 部分写入。
- RN 测试：隔离会话、结构化结果、自动完成、三类人工交互映射为 `BLOCKED`，聊天模式行为不变。
- 数据隔离测试：评测前后的 Settings、Model Profile、API Key、Skills、Favorites、Chat、History、全局 Token 与普通 resumable key 保持字节等价；评测产物均带完整隔离 ID。
- Kotlin 测试：仅 evaluation Variant 接收 Intent、payload 校验、幂等冲突、RN 未就绪缓存与原子状态写入。
- 真机验收：至少运行一个普通问答样本、一个 GUI 操作样本、一个预期 `BLOCKED` 样本，并生成报告。

## 安全边界

### 始终执行

- WebUI 后端默认只监听 `127.0.0.1`。
- 每次运行必须明确选择 ADB serial。
- 所有请求、状态、证据和报告通过稳定 ID 关联。
- Judge API key 仅保存在后端进程内存或环境变量中。
- 原始证据不可变，标准化结果和摘要单独保存。
- 设备端用户配置与普通用户数据在 evaluation 运行期间只读。

### 需先确认

- 清除豆泡或第三方 App 数据。
- 在评测 setup 中开放任意宿主机 Shell 或任意 `adb shell` 字符串。
- 将额外敏感屏幕信息发送给远程 Judge Provider。
- 改变普通 APK 的包名、签名或发布构建流程。

### 禁止

- 在普通生产构建中暴露评测 Intent 或自动化入口。
- 从 evaluation 运行写入或清除用户配置、普通聊天、会话历史、全局 Token 统计或普通可恢复任务。
- 自动批准高风险操作、`ask_user` 或 `request_user_action`。
- 将 Judge 网络、认证或解析错误记为产品失败。
- 将 API key 写入评测集、浏览器存储、Trace 或报告。
- 通过 UI 坐标输入作为豆泡指令的主要传输方式。

## 验收标准

- WebUI 可以导入合法评测集、列出授权设备并启动批量运行。
- 中文、引号、换行等指令可稳定传入豆泡，重复投递不会重复执行。
- 每个样本在有限时间内进入明确终态；批量运行不会因完成确认或人工交互无限等待。
- PC 可获得完整最终回复，并正确关联现有 OTel/Todo、最终截图、UI 层级和前台包名。
- 确定性断言与 LLM Judge 独立展示，基础设施错误与产品失败明确区分。
- 运行结束或中途取消后均生成合法 `report.json` 与自包含 `report.html`。
- 普通豆泡聊天、连续对话、风险卡控和生产 Release 行为不因评测功能发生变化。
- evaluation 前后用户配置和普通用户数据保持不变；所有评测状态和证据都可通过隔离 ID 唯一关联。

## 已确认约束

- evaluation APK 与普通豆泡使用相同 `applicationId`，覆盖安装但不影响任何用户配置。
- 首版 WebUI 不编辑豆泡模型、API Key、Skills 或工具配置，只读取设备端现有配置执行评测。
- 评测数据通过 `runId/sampleId/requestId/traceId` 隔离；普通聊天与评测上下文互不进入对方历史。
