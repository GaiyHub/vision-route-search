# 豆泡 PC 批量评测实现任务

## 当前阶段：Implement

- [x] 用户批准 `tasks/plan.md`，进入实施阶段（2026-09-01）。
- [x] Task 1 已完成：固化跨端评测契约与 Fixture。
- [x] Checkpoint A 的普通问答单样本真机闭环已完成（2026-09-01）。
- [ ] 当前任务：补齐最终设备状态证据并实现确定性断言。

## 阶段 A：契约与 Android/RN 单样本闭环

### Task 1：固化跨端评测契约与 Fixture（S）

**描述：** 定义版本化的 `EvalRequestV1`、`EvalStatusV1`、`CommandExecutionResult`、ID/大小限制与稳定错误码，并用包含中文、引号、反斜杠和换行的共享 Fixture 锁定编码及校验语义。

**验收标准：**
- [x] RN 侧可解析合法请求和全部状态联合类型，并拒绝未知版本、非法 ID、超限内容与不一致字段。
- [x] Base64URL 往返不损坏任意合法 UTF-8 指令，`requestHash` 的规范化输入定义唯一。
- [x] 共享 JSON Fixture 可供 RN、Kotlin和 PC 后续契约测试复用。

**验证：** `cd guidedog-agent && npm run typecheck && npm test -- --runInBand --forceExit src/evaluation`

**依赖：** 无

**文件范围：** `guidedog-agent/src/evaluation/`、`specs/pc-batch-evaluation/fixtures/`

### Task 2：实现普通 APK 的受保护评测入口（S）

**描述：** 不新增 APK、Build Type 或配对能力；普通豆泡默认声明独立 `EvaluationEntryActivity` activity-alias，要求 `android.permission.DUMP`，与普通 Launcher 隔离。

**验收标准：**
- [ ] 普通 release 默认包含评测 alias；ADB shell 可调用、第三方 App 被拒绝仍待真机验证。
- [x] 普通 Launcher 附加评测 action/extra 不进入评测链路，不新增 exported Receiver。
- [x] Manifest 暴露 `EVALUATION_API_VERSION=1`；普通 release 构建与安装流程保持不变，不产生额外 APK 变体。

**状态：** 实现已完成（2026-09-01）；Manifest 契约测试、RN typecheck 和普通 `assembleRelease` 均通过，任务最终完成取决于 Checkpoint A 的真机权限验证。

**验证：** Manifest/入口测试通过；`cd guidedog-agent/android && NODE_ENV=production ./gradlew :app:assembleRelease`

**依赖：** Task 1

**文件范围：** `guidedog-agent/plugins/withDeftForegroundService.js`、Manifest 测试

### Task 3：实现 Kotlin 请求存储（M）

**描述：** 实现 Base64URL 解码、请求校验、幂等登记、活动请求冲突和 request/status 原子文件写入。

**验收标准：**
- [x] 同一 `requestId + requestHash` 返回既有状态，同 ID 不同 hash 返回 `IDEMPOTENCY_CONFLICT`。
- [x] 请求只写入受限的 evaluation 目录，非法 ID、大小和 Schema 均被稳定错误码拒绝。
- [x] RN 未就绪时保留一个可原子消费的待处理请求。

**状态：** [x] 已完成（2026-09-01）；实现严格 Base64URL/UTF-8/JSON 边界、跨端 hash 校验、单活动请求、幂等登记和原子 request/status/pending 写入，3 项 Kotlin 单测通过。

**验证：** `cd guidedog-agent/android && ./gradlew :app:testReleaseUnitTest`

**依赖：** Task 1、Task 2

**文件范围：** `guidedog-agent/plugins/android/EvaluationRequestStore.kt`、对应 Kotlin tests、配置插件同步清单

### Task 4：接入 Activity Intent 与 Native Module（M）

**描述：** 在普通 APK 中处理来自受保护 alias 的显式 evaluate/cancel Intent，并通过现有 Native Module 暴露 consume、状态写入和取消事件。

**验收标准：**
- [x] 冷启动和 `onNewIntent` 都能提交请求，消费 API 是唯一事实来源。
- [x] 普通 Launcher 或非评测组件来源被拒绝，且不新增 exported Receiver。
- [x] cancel 只影响匹配的当前 `requestId`，重复取消幂等。

**状态：** [x] 已完成（2026-09-01）；评测 Intent 网关同时覆盖冷启动与 `onNewIntent`，严格校验 alias 来源，Native Module 提供请求消费、状态写入与取消消费接口。

**验证：** Kotlin 单测通过；`assembleRelease` 成功。

**依赖：** Task 3

**文件范围：** `guidedog-agent/plugins/android/`、`guidedog-agent/plugins/withDeftForegroundService.js`、生成的 `MainActivity.kt`

### Task 5：扩展 `processCommand` 结构化执行契约（M）

**描述：** 以向后兼容的可选参数扩展命令入口，返回完整结果并提供 trace 生命周期观察点，默认聊天调用语义不变。

**验收标准：**
- [x] 现有 `processCommand(command)` 调用无需修改且聊天回归测试通过。
- [x] 结果包含 outcome、完整 summary、traceId、时间、步数、动作数和本次 Token。
- [x] 并发、停止、异常和超时均映射为明确结果。

**状态：** [x] 已完成（2026-09-01）；命令入口返回版本化结构结果并同步暴露 Trace 生命周期，聊天并发语义保持兼容，评测并发返回稳定错误码，AgentLoop 超时独立映射为 `timed_out`。

**验证：** `cd guidedog-agent && npm run typecheck && npm test -- --runInBand --forceExit`

**依赖：** Task 1

**文件范围：** `guidedog-agent/src/agent/agentBridge.ts`、聚焦测试

### Task 6：实现 evaluation 执行隔离与交互策略（M）

**描述：** 为 evaluation 显式禁用 Chat/History/全局 Token/resumable 写入，使用空会话上下文；自动接受普通完成确认，将三类人工交互映射为 `BLOCKED`。

**验收标准：**
- [x] 评测前后普通用户数据字节等价，Settings/Skills 等配置只读复用。
- [x] RISK、ASK_USER、USER_ACTION 均立即返回结构化 blocked，不展示或等待交互卡片。
- [x] 聊天模式的连续对话、完成确认和风险卡控保持原行为。

**状态：** [x] 已完成（2026-09-01）；评测执行策略默认强制空会话、完成自动接受和人工交互阻断，禁止写入 Chat、History、全局 Token、普通 Todo 与 resumable 数据；聊天默认策略及全量测试保持通过。

**验证：** RN 隔离与聊天回归测试全部通过。

**依赖：** Task 5

**文件范围：** `guidedog-agent/src/agent/agentBridge.ts`、相关 Store 与测试

### Task 7：实现 RN EvaluationBridge（M）

**描述：** 消费 Native 请求、调用隔离 `processCommand`、写入 ACCEPTED/RUNNING/终态，并将 OTel/Todo flush 到 request 对应的独立 evaluation 目录。

**验收标准：**
- [x] 冷启动、前台请求、重复事件和取消均只执行一次。
- [x] status、OTel 与 Todo 携带完整关联链，只写 request 对应的 evaluation 目录，不写普通 `tasklogs`。
- [x] 一个复杂 UTF-8 指令可通过 ADB 获得结构化终态和完整 summary。

**状态：** [x] 已完成（2026-09-01）；RN Bridge 已接入 App 启动流程，覆盖请求串行消费、进程重启恢复、状态迁移、匹配取消、冻结安全超时及终态前 Trace/Todo flush；真机复杂 UTF-8 样本在 2.57 秒内完成，中文、引号、反斜杠和换行均无损。

**验证：** RN 测试、Android 构建和一条真机冒烟样本通过。

**依赖：** Task 4、Task 5、Task 6

**文件范围：** `guidedog-agent/src/evaluation/`、OTel/Todo 最小扩展、App 启动接线

### Checkpoint A：移动端单样本闭环

- [x] 普通 release 构建成功，未产生额外 APK 变体。
- [x] 真机普通问答完成，Trace 与 Todo 在独立评测目录落盘。
- [ ] 普通用户数据和普通日志零写入，普通 Launcher/第三方 App 不响应评测 action（已确认未创建普通 `tasklogs`，其余边界待专项验收）。

## 阶段 B：PC 最小运行器

### Task 8：初始化 evaluator 与共享边界 Schema（M）

**描述：** 创建 Node 20+/TypeScript strict/Vitest 工作区，建立 contracts、原子文件写入和统一 API/基础设施错误。

**验收标准：** 外部输入均经 Zod 校验；`.data` 被忽略；依赖精确锁定；共享 Fixture 全部通过。

**状态：** [x] 已完成（2026-09-01）；建立 React/Vite/TypeScript strict/Vitest 工程、跨端请求与状态 Schema、统一错误类型及原子 JSON 存储，5 项测试及生产构建通过。

**验证：** `cd evaluator && npm run typecheck && npm test && npm run build`

**依赖：** Task 1

**文件范围：** `evaluator/package*.json`、`evaluator/src/contracts/`、`evaluator/src/storage/`

### Task 9：实现评测集加载、校验与快照（M）

**描述：** 支持 YAML/JSON 标准化、稳定顺序、字段级错误与安全的工作副本/Run 快照。

**验收标准：** 等价 YAML/JSON 结果一致；非法断言、重复 ID、危险 setup 和无 Judge/断言样本在运行前拒绝；快照不可被后续编辑影响。

**状态：** [x] 已完成（2026-09-01）；实现版本化 Schema、YAML/JSON 标准化、白名单 setup、断言/Judge 预校验、工作副本和不可覆盖 Run 快照，累计 14 项测试通过。

**验证：** dataset 单元与文件系统集成测试通过。

**依赖：** Task 8

**文件范围：** `evaluator/src/datasets/`、`evaluator/datasets/`、对应 tests

### Task 10：实现 ADB Runner（M）

**描述：** 通过参数数组实现设备发现、readiness、Intent 投递、指定状态轮询、有限传输重试、超时取消和设备断开检测。

**验收标准：** 每次调用显式 serial 且不经 Shell；重试复用不可变请求；Fake ADB 覆盖异常设备、冲突、超时与取消。

**进度：** [x] 已完成（2026-09-02）：参数数组 Process Adapter、设备状态解析、显式 serial、Base64URL Intent、关联状态读取、有限幂等重试与超时取消；真实 Runtime 可读取 Android/豆泡版本并校验受保护入口，当前真机已识别为 API v1 READY。

**验证：** adb-runner Fake Process Adapter 集成测试通过。

**依赖：** Task 7、Task 8

**文件范围：** `evaluator/src/adb/`、对应 tests/fixtures

### Task 11：打通单样本本地 API（M）

**描述：** 用最小 Fastify API 串起评测集快照、设备选择、单样本提交与状态查询，默认只监听 `127.0.0.1`。

**验收标准：** `POST /api/runs` 可执行一个样本；`GET /api/runs/:runId` 可在刷新后恢复；错误体符合 `ApiErrorV1`。

**进度：** Mock 与真实 ADB Runtime 已接入（2026-09-02）：设备/评测集 API、Run 创建/查询/取消、串行执行及文件持久化保持统一契约；首条 PC 真机请求已送达 APK，因手机存在普通任务返回 `RUN_ALREADY_ACTIVE`，并已正确归类为 `INFRA_ERROR`，待设备空闲后完成成功态验收。

**验证：** Fake ADB API 集成测试及一条真机 Sample 通过。

**依赖：** Task 9、Task 10

**文件范围：** `evaluator/src/server/`、`evaluator/src/orchestrator/`、对应 tests

### Checkpoint B：PC 单样本闭环

- [ ] evaluator typecheck、tests、build 全通过。
- [ ] 无 WebUI 条件下可从本地 API 驱动一条真机样本。

## 阶段 C：证据与确定性评测

### Task 12：实现证据采集与关联校验（M）

**描述：** 拉取 status/OTel/可选 Todo，补采截图、UI 层级和前台包名，先保存不可变 raw 再标准化。

**验收标准：** 四级 ID 与 traceId 错配会拒绝；部分 JSONL 和可选证据缺失可诊断；大小和数量均有上限。

**进度：** [x] 已完成 status/OTel/可选 Todo 拉取、四级 ID 与 traceId 关联校验、原始证据不可变落盘和采集清单；[ ] 最终截图、UI 层级、前台包名及对应大小限制待下一增量补齐。

**验证：** 代表性 Trace Fixture 与 Fake ADB 采集测试通过。

**依赖：** Task 10、Task 11

**文件范围：** `evaluator/src/evidence/`、对应 fixtures/tests

### Task 13：实现确定性断言引擎（M）

**描述：** 实现首版断言类型与 PASS/FAIL/ERROR 语义，所有断言均执行且结果顺序稳定。

**验收标准：** 每类断言覆盖通过、失败、证据缺失；受限正则不会阻塞进程；相同输入产生字节稳定结果。

**验证：** assertion-engine 参数化单元测试通过。

**依赖：** Task 9、Task 12

**文件范围：** `evaluator/src/assertions/`、对应 tests

### Checkpoint C：结果可验证

- [ ] 问答与 GUI Fixture 均可生成可诊断的 `result.json`。
- [ ] 产品失败与证据/基础设施错误明确分离。

## 阶段 D：LLM-as-Judge

### Task 14：实现 OpenAI-compatible Judge（M）

**描述：** 使用原生 fetch 实现独立 Provider、文本与可选图片证据、版本化 Prompt、结构化响应校验及一次修复。

**验收标准：** API key 不持久化或回显；Prompt Injection 不改变 Rubric/输出契约；网络、认证、超时和解析问题映射为 `INFRA_ERROR`。

**验证：** 文本、多模态、降级、注入、拒绝、修复和超时 Fixture 通过。

**依赖：** Task 12、Task 13

**文件范围：** `evaluator/src/judge/`、对应 tests

### Checkpoint D：语义评测

- [ ] 确定性断言与 Judge 独立展示、独立失败。
- [ ] Judge attempt、Prompt 版本和证据 hash 可审计。

## 阶段 E：批量、报告与 WebUI

### Task 15：实现串行编排、取消与失败重跑（M）

**描述：** 落地 Run/Sample 状态机、白名单 setup/teardown、持久化事件、设备互斥、取消、恢复和新 Run 失败重跑。

**验收标准：** 样本有限时间内终止；持久化后才启动下一条；设备断开停止 Run；重启不自动重提未知请求。

**验证：** 多样本、取消、断开、恢复与重跑集成测试通过。

**依赖：** Task 11、Task 12、Task 13、Task 14

**文件范围：** `evaluator/src/orchestrator/`、对应 tests

### Task 16：生成 JSON/HTML 报告（M）

**描述：** 从持久化 Run 生成顺序稳定的机器报告和转义、脱敏、自包含的 HTML 报告。

**验收标准：** 完整、取消和中断 Run 均可生成合法报告；敏感信息不泄露；离线可打开并追溯原始证据。

**验证：** Schema、快照、XSS 与脱敏测试通过。

**依赖：** Task 15

**文件范围：** `evaluator/src/reports/`、对应 tests

### Task 17：实现本地 WebUI 与 SSE（M）

**描述：** 完成评测集、设备、Judge、运行进度、样本详情、报告历史和失败重跑主流程。

**进度：** 运行主流程、评测集管理、运行历史恢复与证据详情已完成（2026-09-02）：支持真实/Mock 设备状态、样本选择、启动/取消、进度轮询、历史 Run 切换，以及样本指标和分页轨迹查看；支持评测集新建、编辑、复制、删除，以及样本输入、断言和 Judge 标准配置；[ ] SSE 与报告生成/导出随对应后端能力接入。

**验收标准：** readiness 不满足时明确禁用启动；SSE 按 sequence 恢复；大型证据按需加载；刷新不丢状态。

**验证：** React 组件测试、API/SSE 集成测试和 production build 通过。

**依赖：** Task 15、Task 16

**文件范围：** `evaluator/src/web/`、`evaluator/src/server/`、对应 tests

### Task 18：真机验收与文档（M）

**描述：** 使用用户当前安装的普通 APK 执行问答、GUI、预期 BLOCKED 三类样本及故障回归，补齐评测接口、ADB readiness 和使用文档。

**验收标准：** WebUI 无需终端完成主流程；普通 release/chat 行为不变；评测前后用户配置与普通数据一致；报告完整可审计。

**验证：** 移动端与 evaluator 全量验证命令、真机验收清单全部通过。

**依赖：** Task 17

**文件范围：** 根 README、`guidedog-agent/README.md`、验收记录/fixtures

### Checkpoint E：首版完成

- [ ] 移动端和 evaluator 全量测试、类型检查、构建通过。
- [ ] 真机批量评测及 LLM-as-Judge 报告通过验收。
- [ ] 无未解释的用户数据变化或生产构建能力暴露。

## 增量阶段 F：样本轨迹与关键指标

### Task 19：定义轨迹、指标与详情 API 契约（S）

**状态：** [x] 已完成（2026-09-02）。

**描述：** 定义 `TraceEventV1`、`SampleMetricsV1`、分页 Trace 响应和受清单约束的 Artifact 响应 Schema。

**验收标准：** 事件类型可区分用户输入、模型、工具和 Agent 事件；指标具有明确 unavailable 语义；大型 Trace 不进入 Run 摘要。

**验证：** `cd evaluator && npm run typecheck && npm test`

**依赖：** Task 12

### Task 20：补齐 evaluation-only 模型 I/O 轨迹（M）

**状态：** [x] 已完成（2026-09-02）。

**描述：** 在不改变普通聊天遥测范围的前提下，为评测执行记录每轮模型实际输入、原始输出、Token 和耗时。

**验收标准：** 模型请求/响应可与 round、step 和模型 Span 关联；普通聊天 OTel 不新增完整模型正文；凭据不进入轨迹。

**验证：** `cd guidedog-agent && npm run typecheck && npm test -- --runInBand --forceExit`

**依赖：** Task 19

### Task 21：标准化轨迹并计算关键指标（M）

**状态：** [x] 已完成（2026-09-02）。

**描述：** 从原始 request/status/OTel 生成稳定 `trace.json` 和 `metrics.json`，覆盖成功、Token、步数、缓存命中率、工具成功率与耗时。

**验收标准：** 可由代表性真机 Trace 重建全部指标；未知缓存/工具状态不记为零；重复解析结果稳定。

**验证：** Evidence Fixture 单测；`cd evaluator && npm run typecheck && npm test`

**依赖：** Task 19、Task 20

### Checkpoint F1：数据链路

- [x] 移动端与 evaluator 测试通过。
- [x] 一个既有真机 Run 可生成逐步轨迹和指标，且原始文件不被修改。

### Task 22：实现样本详情、Trace 与 Artifact API（M）

**状态：** [x] 已完成（2026-09-02）。

**描述：** 增加按需加载的详情接口、Trace 分页过滤和 manifest 白名单 Artifact 读取。

**验收标准：** 刷新后可从落盘 Run 查询；非法 ID/路径穿越被拒绝；Trace 不污染 Run 列表响应。

**验证：** Fastify API 集成测试；`cd evaluator && npm run build`

**依赖：** Task 21

### Task 23：实现 WebUI 指标卡与原始轨迹视图（M）

**状态：** [x] 已完成（2026-09-02）。

**描述：** 在每次样本执行详情中展示关键指标，并提供可展开、可过滤、分页加载的原始轨迹时间线。

**验收标准：** 可查看用户输入、每轮模型/工具输入输出、逐步 Token 和耗时；缺失指标明确显示“不可用”；大型 Trace 页面仍可操作。

**验证：** React 测试、production build、已有真机 Run 手工验收。

**依赖：** Task 22

### Checkpoint F2：可观测性闭环

- [x] 浏览器断开手机后仍可通过落盘 Run 查看每次样本执行的完整轨迹和关键指标。
- [x] evaluator 全量 typecheck、tests、build 通过。

## 增量阶段 G：评测计划化

### Task 24：实现评测计划管理（M）

**状态：** [x] 已完成（2026-09-02）。

**描述：** 实现 `EvaluationPlanV1` Schema、JSON Repository 和分页 CRUD API，保存前校验评测集与样本引用。

**验收标准：**
- [x] 可创建、分页列出、查看和更新计划，保存计划不会启动 Run。
- [x] 重复/空样本、无效引用和非法超时返回统一错误；设备离线不阻止保存。
- [x] 计划写入原子化，损坏文件不影响其他计划读取。

**验证：** `cd evaluator && npm run typecheck && npm test && npm run build`

**依赖：** Task 9

### Task 25：实现 PlanRun 与 SampleAttempt（M）

**状态：** [x] 已完成（2026-09-02）。

**描述：** 从计划创建不可变执行快照，建立 `planId/runId/sampleId/attemptId` 归属，并将单样本重试改为原 Run 新 Attempt。

**验收标准：**
- [x] 启动计划前重新检查数据集、样本和设备 readiness；每次启动生成独立 Run。
- [x] 更新计划不改变历史 Run 快照；重试保留旧 Attempt 和证据。
- [x] 既有 Run 可继续只读查看，旧客户端查询接口不被破坏。

**验证：** RunManager 与 API 集成测试；`cd evaluator && npm run typecheck && npm test && npm run build`

**依赖：** Task 24

### Task 26：生成 PlanRun 整体报告（M）

**描述：** 聚合每个样本最新终态 Attempt 的结果和关键指标，生成并持久化一份计划执行报告。

**验收标准：**
- [ ] 完成、取消和中断 Run 均能产生结构稳定的报告。
- [ ] 样本重试后报告按最新 Attempt 重新计算，历史 Attempt 保持可审计。
- [ ] 提供计划 Run 报告查询 API，缺失报告返回统一错误。

**验证：** 报告聚合与 API 测试；`cd evaluator && npm run typecheck && npm test && npm run build`

**依赖：** Task 25

### Task 27：重构评测 WebUI 信息架构（M）

**描述：** 新增“评测计划”一级页作为唯一执行入口，保留“评测集”资产管理和“执行记录”查询页，并串联 Attempt、轨迹和整体报告。

**验收标准：**
- [ ] 创建计划时可选择评测集、样本、设备和运行配置，并可从计划启动评测。
- [ ] 执行记录按计划与 Run 浏览；样本可查看 Attempt、指标、轨迹并手动重试。
- [ ] 每次 Run 可查看整体报告；旧 Run 在历史评测中只读可见。

**验证：** React 组件测试、production build、本地浏览器主流程验收。

**依赖：** Task 24、Task 25、Task 26

### Checkpoint G：计划化评测闭环

- [ ] evaluator 全量 typecheck、tests、build 通过。
- [ ] 评测集不再出现执行入口，计划创建到整体报告主流程可用。
- [ ] 旧 Run 与移动端用户数据均未发生破坏性迁移。
