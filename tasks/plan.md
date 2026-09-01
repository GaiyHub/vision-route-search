# 实施计划：豆泡 PC 批量评测框架

## 1. 计划状态

- 当前阶段：Plan
- 规格入口：`specs/pc-batch-evaluation/SPEC-pc-batch-evaluation.md`
- 能力索引：`specs/pc-batch-evaluation/CAPABILITY-MAP.md`
- 任务清单：Plan 获得确认后，在 Tasks 阶段补充到 `tasks/todo.md`
- 本计划不授权实现、装机或修改发布配置。

## 2. 建设目标

新增一个运行在 PC 端的本地 WebUI，通过 ADB 驱动 Android 真机上的豆泡 evaluation APK，按评测集串行执行指令，复用现有 OTel/Todo 过程数据，执行确定性断言与 LLM-as-Judge，并生成可审计的 JSON/HTML 报告。

实施优先级是先打通“一个中文指令 → 真机 Agent → 结构化终态 → Trace 拉取”的最小纵向链路，再扩展批量编排、Judge、报告和 WebUI，避免先完成大面积 PC UI 后才暴露移动端桥接风险。

## 3. 已确认的代码基础

| 现有能力 | 代码位置 | 计划中的处理 |
| --- | --- | --- |
| Agent 主入口与运行生命周期 | `guidedog-agent/src/agent/agentBridge.ts` | 向后兼容地增加执行选项、结构化结果和生命周期观察点 |
| 并发保护 | `guidedog-agent/src/store/agentStore.ts` | 继续作为 Android 运行中状态事实来源 |
| 会话消息 | `guidedog-agent/src/store/chatStore.ts` | evaluation 使用隔离上下文，不清除设置与 Skills |
| OTel Trace | `guidedog-agent/src/agent/otelLogger.ts` | 复用 external files 下的 `otel-<traceId>.jsonl` |
| Todo 产物 | `guidedog-agent/src/agent/todoFileStore.ts` | 复用 `todo-<traceId>.json`，允许不存在 |
| 人工交互工具 | `agentBridge.ts` 中 completion、risk、ask_user、request_user_action | 通过运行策略注入 evaluation 行为，不复制工具实现 |
| Expo Android 配置 | `guidedog-agent/plugins/withDeftForegroundService.js` | 作为 Kotlin 源同步和 Build Type 配置的事实来源 |
| Android Host Module | `guidedog-agent/plugins/android/DeftAgentModule.kt` | 增加 evaluation-only 请求消费、状态写入和取消能力 |

## 4. 架构决策

### 4.1 evaluation Build Type 使用相同 applicationId，用户配置零写入

首版在现有 `debug/release` 之外增加 `evaluation` Build Type：

- `applicationId` 继续使用 `com.watchdog.agent`，通过 `adb install -r` 覆盖安装，以原样保留模型配置、API Key、Skills、工具开关及既有权限。
- `defaultConfig` 和普通 `release` 设置 `BuildConfig.EVALUATION_ENABLED=false`；仅 `evaluation` 覆盖为 `true`。
- `evaluation` 继承 `release` 的 JS Bundle 行为，使用当前开发签名，设置 `matchingFallbacks=['release']`；是否启用 `debuggable` 只按 ADB 证据访问需要决定，主链路不依赖 `run-as`。
- 计划构建命令：

```bash
cd guidedog-agent/android
NODE_ENV=production ./gradlew :app:assembleEvaluation
adb install -r app/build/outputs/apk/evaluation/app-evaluation.apk
```

选择同 applicationId 的原因是首版必须只读使用用户真实配置，且不能安全复制明文密钥。evaluation 运行不得修改任何用户配置或普通用户数据。代价是 evaluation APK 与普通 APK 不能并存；恢复普通 APK 时重新安装 Release。

### 4.2 使用显式 Activity Intent 作为指令入口

- PC 调用 `adb -s <serial> shell am start -n com.watchdog.agent/.MainActivity -a com.watchdog.agent.action.EVALUATE --es payload <base64url>`。
- 不增加 exported Receiver；复用当前已导出的 Launcher Activity，在 `onCreate` 和 `onNewIntent` 中仅当 `EVALUATION_ENABLED=true` 时处理 action。
- 请求 JSON 采用 UTF-8 + Base64URL，单一 extra 传递；Kotlin 校验解码后字节数、Schema、ID、hash 和 timeout。
- 取消使用独立 action `com.watchdog.agent.action.CANCEL_EVALUATION`，只接受与当前 `requestId` 匹配的请求。
- 普通 Release 即使被显式启动，也会忽略评测 action，不进入 RN 评测链路。

### 4.3 Kotlin 只负责安全边界与持久化

新增 `EvaluationRequestStore.kt`，职责保持有限：

- 接收、校验并幂等登记一个请求；同 ID 不同 hash 返回冲突。
- RN 未就绪时缓存一个待消费请求，RN 通过 `consumePendingEvaluationRequest()` 获取。
- 通过 `DeviceEventEmitter` 提醒已运行的 RN，但实际消费仍走原子 consume，防止事件丢失。
- 在 `getExternalFilesDir("evaluation")/<runId>/<sampleId>/<requestId>/` 原子写入 `request.json` 与 `status.json`。
- 保存当前活动 requestId；接收取消后通知 RN，不直接实现 Agent 生命周期。

不在 Kotlin 中实现任务队列、断言、Judge、Trace 解析或报告。

### 4.4 RN 通过策略化 `processCommand` 复用 Agent

对 `processCommand` 做加法式扩展：默认参数保持现有聊天语义，evaluation 传入：

```ts
{
  source: 'EVALUATION',
  conversationMode: 'ISOLATED',
  completionPolicy: 'AUTO_ACCEPT',
  interactionPolicy: 'BLOCK'
}
```

实施方式：

- `processCommand` 返回 `CommandExecutionResult`；现有调用方可忽略返回值，不构成破坏性修改。
- 增加内部 lifecycle observer，在 `beginTrace()` 后暴露 `traceId`，供 RN Bridge 写入 `RUNNING`。
- evaluation 不读取或清理历史对话，不向聊天和历史 Store 追加评测消息；前台服务、MediaProjection、Heartbeat、AgentLoop 和 Tools 保持复用。
- Token 只累计到本次 `CommandExecutionResult`，不更新持久化全局 Token 统计；evaluation 不读取、覆盖或删除普通 `deft:resumableTask`。
- `beginTrace` 与 Todo 增加 `source=EVALUATION`、`runId`、`sampleId`、`requestId` 属性，保留原 `traceId` 文件命名并形成完整关联链。
- 普通 completion 立即返回 `complete`；risk、`ask_user`、`request_user_action` 统一抛出内部 `InteractionBlockedError`，在 `processCommand` 边界映射为 `blocked`。
- 评测终态写入前调用并等待现有 OTel flush；完整 summary 进入 `status.json`，不依赖根 Span 中的 200 字符摘要。
- 取消复用现有 `stopAgent()`，且只允许当前 requestId 触发。

### 4.5 用户配置零写入与评测数据隔离

同一 App 身份只用于读取真实运行配置，不表示评测可以写入普通数据空间：

| 数据 | evaluation 行为 |
| --- | --- |
| Settings、Model Profile、API Key、工具配置 | 只读，不提供修改入口 |
| Skills、Favorites | 只读，不增删、不更新启停状态 |
| Chat、History | 不读取为上下文，不追加、不清空 |
| 全局 Token 统计 | 不累计；仅返回本次评测 Token |
| `deft:resumableTask` | 不读写；评测恢复使用 request/status 文件 |
| OTel/Todo | 继续写现有产物，但必须携带 evaluation 来源与四级关联 ID |
| evaluation request/status | 写入 `evaluation/<runId>/<sampleId>/<requestId>/` |
| PC 端证据与报告 | 写入 `.data/runs/<runId>/samples/<sampleId>/` |

实现时对 Store 写入口采用显式 execution scope，而不是在评测前后备份再恢复；备份恢复无法覆盖崩溃窗口，也可能覆盖用户并发产生的新数据。

### 4.6 PC 端采用独立 TypeScript 工作区

在仓库根目录新增 `evaluator/`，首版依赖控制为：

- Server：`fastify`，静态资源使用 `@fastify/static`，SSE 使用原生流式响应。
- Schema：`zod`；YAML：`yaml`。
- Web：`react`、`react-dom`、`vite`，不引入额外状态管理库。
- Tests：`vitest`、`@testing-library/react`；Fake ADB 通过注入 Process Adapter 实现。
- Judge：使用 Node 原生 `fetch`，不引入模型厂商 SDK。
- 报告：服务端模板与安全转义，不引入浏览器自动化或数据库。

新增依赖在实现前固定精确版本并提交 `package-lock.json`。

### 4.7 文件持久化代替数据库

```text
evaluator/.data/
├── datasets/
└── runs/<runId>/
    ├── run.json
    ├── events.jsonl
    ├── report.json
    ├── report.html
    └── samples/<sampleId>/
        ├── raw/
        ├── normalized/
        └── result.json
```

- 所有写入使用临时文件加 rename；事件 JSONL 只追加。
- Run 启动时快照评测集和非敏感 Judge 配置。
- 原始证据不可变，解析、脱敏、摘要结果分目录保存。
- PC 重启时将未终态 Run 标记为 `INTERRUPTED`，不得自动重提未知结果请求。

## 5. 模块依赖图

```text
共享 contracts
├── eval-dataset
└── doupao-eval-bridge
        │
        ▼
    adb-runner
        │
        ▼
evidence-collector
    ├── assertion-engine
    └── llm-judge
          │
          ▼
    eval-orchestrator
      ├── eval-report
      └── eval-console
```

跨端共享的是版本化 JSON 契约，不共享 TypeScript/Kotlin 源码。PC 与 RN 各自维护 Schema/类型，并通过同一 Fixture 做契约测试。

## 6. 纵向实施切片

### 切片 A：契约与 Android/RN 单样本闭环

目标：尽早验证最危险的跨端链路。

- 固化 `EvalRequestV1`、`EvalStatusV1`、`CommandExecutionResult` 与错误码 Fixture。
- 建立 `evaluation` Build Type 和 Kotlin Intent Gateway。
- 扩展 `processCommand` 的评测策略和结果返回，增加 RN EvaluationBridge。
- 为 Chat、History、全局 Token 和 resumable persistence 增加 execution scope，验证 evaluation 路径零写入。
- 用 ADB 发送一个包含中文、引号和换行的普通问答；获得 `COMPLETED`、完整 summary 与 traceId。
- 验证普通 Release 忽略相同 action，聊天模式回归测试通过，评测前后用户配置与普通数据一致。

检查点 A：真机单样本闭环成功后，才继续大规模 PC 开发。

### 切片 B：PC 最小运行器与评测集

目标：在没有 WebUI 的情况下，通过测试或最小后端 API 完成一个样本。

- 初始化 evaluator 工程、共享 Schema、错误契约和文件系统抽象。
- 实现 YAML/JSON 评测集校验与快照。
- 实现 ADB 设备发现、显式 serial、Intent 提交、状态轮询、超时与取消。
- 提供最小 `POST /api/runs` 和 `GET /api/runs/:runId`，只执行单样本。

检查点 B：Fake ADB 集成测试与一条真机 Sample 通过。

### 切片 C：证据与确定性评测

目标：将“任务完成”升级为“结果可验证”。

- 拉取 status、OTel、可选 Todo，并补采 screencap、UIAutomator 和前台包名。
- 校验 status、OTel 与 Todo 的 `runId/sampleId/requestId/traceId` 关联链，拒绝无标识或错配证据。
- 标准化工具时间线、模型调用、错误、步数与 Token/Cache。
- 实现首版断言及 `PASS/FAIL/ERROR` 语义。
- 形成完整 `result.json`，基础设施错误与产品失败分离。

检查点 C：固定 Trace Fixture 的断言结果确定，真机问答和 GUI 样本可诊断。

### 切片 D：LLM-as-Judge

目标：支持确定性规则无法覆盖的语义判断。

- 实现独立 Provider 配置、连接测试、文本输入和可选图片输入。
- 构造不可信证据边界、版本化 Prompt、结构化响应校验和单次修复。
- 将网络/认证/超时/解析问题映射为 `INFRA_ERROR`，保留原始 Judge attempt。
- 将 Judge 结果并入样本聚合，但与确定性断言独立展示。

检查点 D：文本、多模态、Prompt Injection、拒绝和超时 Fixture 全部通过。

### 切片 E：批量编排、恢复与报告

目标：从单样本扩展为稳定的批量评测。

- 实现串行 Run/Sample 状态机、setup/teardown 白名单、总超时与取消。
- 每个样本终态落盘后才启动下一条；设备断开停止 Run。
- 支持失败项重跑，创建带 `sourceRunId` 的新 Run。
- 生成确定性 `report.json` 和自包含 `report.html`；取消和部分中断也可生成报告。

检查点 E：多样本 Fake ADB 运行、取消、设备断开、恢复和失败重跑通过。

### 切片 F：WebUI 闭环

目标：让开发者无需终端完成操作。

- 完成评测集管理、设备选择与 readiness 展示。
- 完成 Judge 配置、Run 启动和 SSE 实时进度。
- 完成样本详情、证据按需加载、报告历史与失败重跑。
- 构建后由 Fastify 提供静态资源，开发环境由 Vite 代理本地 API。

检查点 F：浏览器刷新可恢复运行；完整主流程无需终端。

### 切片 G：真机验收与安全回归

目标：验证产品边界而非只验证 Mock。

- 执行普通问答、GUI 操作、预期 `BLOCKED` 三类样本。
- 验证重复 Intent、取消、冷启动、App 已运行、MediaProjection 缺失和设备断开。
- 验证普通 Release 不响应评测 action，普通聊天连续对话与人工卡控不变。
- 更新 README 中的 evaluation APK 构建、安装、使用和恢复 Release 方法。

## 7. 并行与串行关系

### 必须串行

- 跨端契约 → Kotlin/RN 单样本桥接 → ADB Runner。
- Evidence Schema → Assertion/Judge 输入 → Orchestrator 聚合。
- Orchestrator API → WebUI 实时状态与报告页面。

### 契约冻结后可并行

- `eval-dataset` 与 Android/RN Bridge。
- Assertion Engine 与 Judge Adapter，但都必须等待 Evidence Schema 稳定。
- Report Renderer 与 WebUI 的只读详情页，但都必须消费同一 Run Snapshot。
- Fake ADB Fixture 与 Android 契约 Fixture。

任何并行工作不得各自定义状态枚举或错误格式；共享契约先合入，再分支实现。

## 8. 验证策略与命令

### 移动端每个检查点

```bash
cd guidedog-agent
npm run typecheck
npm test -- --runInBand --forceExit

cd android
NODE_ENV=production ./gradlew :app:assembleEvaluation
NODE_ENV=production ./gradlew :app:assembleRelease
```

### PC 端每个检查点

```bash
cd evaluator
npm run typecheck
npm test
npm run build
```

### 真机验收

```bash
adb devices -l
adb install -r guidedog-agent/android/app/build/outputs/apk/evaluation/app-evaluation.apk
```

真机命令的 serial 必须显式传入；最终验收通过 WebUI 发起，不以手工构造 Intent 代替产品流程。

## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
| --- | --- | --- |
| RN 冷启动时 Intent 事件早于 JS 订阅 | 高 | Kotlin Store 持久/缓存待消费请求；事件仅作提示，consume 才是事实来源 |
| evaluation 覆盖普通 APK | 中 | 安装前 UI/CLI 明确提示；保留设置但记录恢复 Release 命令；Plan 审阅时再次确认 |
| 改造 `processCommand` 破坏聊天模式 | 高 | 所有新参数有默认值；先补聊天回归测试；新增行为只在 `source='EVALUATION'` 启用 |
| evaluation 污染用户配置或普通历史 | 高 | 使用显式 execution scope 禁用 Chat/History/全局 Token/resumable 写入；Store Mock 与真机前后对比双重验证 |
| 评测 Trace 与普通 Trace 混淆 | 高 | 根 Span、Todo、status 全部携带四级关联 ID；Evidence Collector 校验完整链后才接受 |
| 人工交互仍进入等待导致批任务卡住 | 高 | 统一 `InteractionBlockedError`；risk/ask_user/user_action 三条路径分别测试 |
| status 先完成而 OTel 尚未 flush | 高 | evaluation Bridge 显式 await flush 后再写终态；PC 仍验证根 Span 完整性 |
| Android/data 在部分系统上读取不稳定 | 中 | 启动前 readiness probe；证据拉取统一超时与错误码；必要时 Plan 变更为 evaluation debuggable + `run-as` |
| MediaProjection 未授权导致截图不可用 | 中 | readiness 中提示；样本可继续但图片证据告警，依赖截图的断言返回 `EVIDENCE_MISSING` |
| UIAutomator 与最终状态存在时间偏差 | 中 | 记录采集时间；终态后立即采集；报告不声称与 Agent 最后一帧同帧 |
| LLM Judge 不稳定或遭 Prompt Injection | 中 | 低随机性、版本化 Prompt、证据分隔、结构化校验、Fixture 与单次修复 |
| PC 进程退出造成未知执行结果 | 中 | 先持久化 intent 再提交；恢复时查询同 requestId，绝不自动生成新 ID 重试 |
| 工作区已有未提交移动端改动 | 高 | 实现时逐文件检查 diff，避免覆盖；桥接改动采用小步提交和聚焦测试 |

## 10. 非目标

- 多设备并行调度和云端设备农场。
- 远程部署、多人权限和账号系统。
- 任意宿主机 Shell 或任意 `adb shell` setup 脚本。
- 自动回答 `ask_user`、自动完成用户手动操作或批准高风险动作。
- 在 PC 端修改豆泡模型、API Key、Skills 或工具配置。
- 将 evaluator 做成通用第三方移动 Agent 评测平台。

## 11. Plan 验收条件

- 架构边界与能力图一致，未重复实现 AgentLoop、工具体系或 OTel。
- 先完成高风险单样本跨端闭环，再扩展批量和 WebUI。
- 每个实施切片都有可执行验证检查点。
- 普通 Release 与普通聊天行为的回归保护明确。
- 用户配置零写入和 `runId/sampleId/requestId/traceId` 数据隔离已成为强制验收条件。
- 风险、非目标、并行边界和回滚方式清晰。
- 用户确认本计划后，才进入 Tasks 阶段拆分单次会话可完成的任务。

## 12. 已确认约束

1. evaluation APK 与普通豆泡使用相同 `applicationId`，通过覆盖安装只读复用现有配置和权限。
2. evaluation 不影响任何用户配置，也不写入普通聊天、历史、全局 Token 统计或普通 resumable task。
3. 评测数据使用 `runId/sampleId/requestId/traceId` 标识隔离，并保存到独立的 Android evaluation 目录和 PC Run/Sample 目录。
4. 首版仅使用设备端已有豆泡配置，不在 WebUI 中管理模型与 Skills。

当前无阻塞性架构问题；仍需用户批准更新后的 Plan，之后才能进入 Tasks 阶段。
