# 豆泡 PC 批量评测实现任务

## 当前阶段：Implement

- [x] 用户批准 `tasks/plan.md`，进入实施阶段（2026-09-01）。
- [x] Task 1 已完成：固化跨端评测契约与 Fixture。
- [ ] 当前任务：Task 10——实现 ADB Runner 的 PC/Fake ADB 部分（PC-first）。
- [ ] Android/RN Task 2—7 暂缓；PC 端先基于共享 Fixture 和 Fake ADB 完成可测试边界，真机闭环阶段再接入普通 APK。

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
- [ ] 普通 release 默认包含评测 alias，ADB shell 可显式调用，普通第三方 App 因缺少系统权限被拒绝。
- [ ] 普通 Launcher 附加评测 action/extra 不进入评测链路，不新增 exported Receiver。
- [ ] Manifest 暴露 `EVALUATION_API_VERSION=1`；普通 release 构建与安装流程保持不变，不产生额外 APK 变体。

**验证：** Manifest/入口测试通过；`cd guidedog-agent/android && NODE_ENV=production ./gradlew :app:assembleRelease`

**依赖：** Task 1

**文件范围：** `guidedog-agent/plugins/withDeftForegroundService.js`、Manifest 测试

### Task 3：实现 Kotlin 请求存储（M）

**描述：** 实现 Base64URL 解码、请求校验、幂等登记、活动请求冲突和 request/status 原子文件写入。

**验收标准：**
- [ ] 同一 `requestId + requestHash` 返回既有状态，同 ID 不同 hash 返回 `IDEMPOTENCY_CONFLICT`。
- [ ] 请求只写入受限的 evaluation 目录，非法 ID、大小和 Schema 均被稳定错误码拒绝。
- [ ] RN 未就绪时保留一个可原子消费的待处理请求。

**验证：** `cd guidedog-agent/android && ./gradlew :app:testReleaseUnitTest`

**依赖：** Task 1、Task 2

**文件范围：** `guidedog-agent/plugins/android/EvaluationRequestStore.kt`、对应 Kotlin tests、配置插件同步清单

### Task 4：接入 Activity Intent 与 Native Module（M）

**描述：** 在普通 APK 中处理来自受保护 alias 的显式 evaluate/cancel Intent，并通过现有 Native Module 暴露 consume、状态写入和取消事件。

**验收标准：**
- [ ] 冷启动和 `onNewIntent` 都能提交请求，消费 API 是唯一事实来源。
- [ ] 普通 Launcher 或非评测组件来源被拒绝，且不新增 exported Receiver。
- [ ] cancel 只影响匹配的当前 `requestId`，重复取消幂等。

**验证：** Kotlin 单测通过；`assembleRelease` 成功。

**依赖：** Task 3

**文件范围：** `guidedog-agent/plugins/android/`、`guidedog-agent/plugins/withDeftForegroundService.js`、生成的 `MainActivity.kt`

### Task 5：扩展 `processCommand` 结构化执行契约（M）

**描述：** 以向后兼容的可选参数扩展命令入口，返回完整结果并提供 trace 生命周期观察点，默认聊天调用语义不变。

**验收标准：**
- [ ] 现有 `processCommand(command)` 调用无需修改且聊天回归测试通过。
- [ ] 结果包含 outcome、完整 summary、traceId、时间、步数、动作数和本次 Token。
- [ ] 并发、停止、异常和超时均映射为明确结果。

**验证：** `cd guidedog-agent && npm run typecheck && npm test -- --runInBand --forceExit`

**依赖：** Task 1

**文件范围：** `guidedog-agent/src/agent/agentBridge.ts`、聚焦测试

### Task 6：实现 evaluation 执行隔离与交互策略（M）

**描述：** 为 evaluation 显式禁用 Chat/History/全局 Token/resumable 写入，使用空会话上下文；自动接受普通完成确认，将三类人工交互映射为 `BLOCKED`。

**验收标准：**
- [ ] 评测前后普通用户数据字节等价，Settings/Skills 等配置只读复用。
- [ ] RISK、ASK_USER、USER_ACTION 均立即返回结构化 blocked，不展示或等待交互卡片。
- [ ] 聊天模式的连续对话、完成确认和风险卡控保持原行为。

**验证：** RN 隔离与聊天回归测试全部通过。

**依赖：** Task 5

**文件范围：** `guidedog-agent/src/agent/agentBridge.ts`、相关 Store 与测试

### Task 7：实现 RN EvaluationBridge（M）

**描述：** 消费 Native 请求、调用隔离 `processCommand`、写入 ACCEPTED/RUNNING/终态，并将 OTel/Todo flush 到 request 对应的独立 evaluation 目录。

**验收标准：**
- [ ] 冷启动、前台请求、重复事件和取消均只执行一次。
- [ ] status、OTel 与 Todo 携带完整关联链，只写 request 对应的 evaluation 目录，不写普通 `tasklogs`。
- [ ] 一个复杂 UTF-8 指令可通过 ADB 获得结构化终态和完整 summary。

**验证：** RN 测试、Android 构建和一条真机冒烟样本通过。

**依赖：** Task 4、Task 5、Task 6

**文件范围：** `guidedog-agent/src/evaluation/`、OTel/Todo 最小扩展、App 启动接线

### Checkpoint A：移动端单样本闭环

- [ ] 普通 release 构建成功，未产生额外 APK 变体。
- [ ] 真机普通问答完成，Trace 在终态前落盘。
- [ ] 普通用户数据和普通日志零写入，普通 Launcher/第三方 App 不响应评测 action。

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

**验证：** adb-runner Fake Process Adapter 集成测试通过。

**依赖：** Task 7、Task 8

**文件范围：** `evaluator/src/adb/`、对应 tests/fixtures

### Task 11：打通单样本本地 API（M）

**描述：** 用最小 Fastify API 串起评测集快照、设备选择、单样本提交与状态查询，默认只监听 `127.0.0.1`。

**验收标准：** `POST /api/runs` 可执行一个样本；`GET /api/runs/:runId` 可在刷新后恢复；错误体符合 `ApiErrorV1`。

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
