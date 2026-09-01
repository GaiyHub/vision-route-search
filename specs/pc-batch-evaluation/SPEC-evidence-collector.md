# Spec：`evidence-collector`

## 目标

复用豆泡现有 OTel/Todo 生成逻辑，但使用评测专用持久化路径，并补充设备最终状态，形成确定性断言和 LLM Judge 共用的可信证据包。

## 证据来源

### 豆泡已有产物

- `evaluation/<runId>/<sampleId>/<requestId>/status.json`：完整执行结果及 `traceId`。
- `evaluation/<runId>/<sampleId>/<requestId>/otel.jsonl`：Agent 根 Span、模型调用、工具调用、结果、错误与事件。
- `evaluation/<runId>/<sampleId>/<requestId>/todo.json`：目标、Todo 项及最终 outcome；文件可能不存在，因为 Todo 为按需工具。

### PC 通过 ADB 补采

- `adb exec-out screencap -p`：最终原始 PNG 截图。
- `uiautomator dump`：最终 UI 层级；失败时记录告警。
- `dumpsys activity` 的有限解析结果：最终前台包名和 Activity。
- 设备型号、Android 版本、应用版本及采集时间。

## 标准化模型

证据包至少包含请求与终态、完整最终回复、Agent outcome、标准化工具时间线、模型调用与 Token/Cache 汇总、步数、Todo、最终设备状态、原始文件路径和采集告警。

### 原始轨迹与逐步模型

- 每次样本执行生成独立的 `trace.json`，按时间稳定排序，首项为用户输入，后续项使用 `MODEL_CALL`、`TOOL_CALL`、`AGENT_EVENT` 三类事件表达。
- `MODEL_CALL` 保存本轮实际提交给模型的消息、工具定义引用、图片引用、模型原始输出、finish reason、输入/输出/缓存 Token、开始结束时间及耗时；仅在 `source=EVALUATION` 时采集完整模型输入输出，避免扩大普通聊天日志范围。
- `TOOL_CALL` 保存工具名、标准化参数、原始结果或错误、step、开始结束时间及耗时；调用参数和结果保持与 OTel 原始 Span 可互相追溯。
- `AGENT_EVENT` 保存 thinking、observation、visual memory、上下文压缩、熔断和人工交互等关键事件，不将其错误计为模型或工具调用。
- 所有事件包含稳定 `eventId`、`sequence`、`traceId`、可选 `spanId/parentSpanId/round/step` 和原始证据指针；相同原始证据重复标准化必须得到相同顺序和 ID。
- 原始 OTel 文件保持不可变；WebUI 默认读取标准化轨迹，必要时可查看或下载原始 JSONL。任何截断都必须同时返回 `isTruncated`、原始大小和原始文件指针。

### 样本关键指标

- `success`：以样本最终聚合 verdict 是否为 `PASSED` 为准，同时保留 Agent outcome、断言和 Judge 结论，避免把“Agent 自报完成”等同于评测成功。
- `tokenUsage`：汇总所有模型调用的 prompt、completion、total、cached Token；缺失值标记为 unavailable，不以 0 冒充。
- `stepCount`：使用 Agent 的实际 step 计数；另行展示 `modelCallCount` 与 `toolCallCount`，避免不同执行动作混用一个口径。
- `cacheHitRate`：当 prompt Token 可用时按 `cachedTokens / promptTokens` 计算；分母为 0 或 Provider 未返回缓存指标时标记 unavailable。
- `toolSuccessRate`：成功工具调用数除以有明确成功状态的工具调用数；未知状态不进入分母，并单独展示 unknown 数量。
- `durationMs`：样本开始至结束的端到端耗时；同时提供模型、工具和各编排阶段耗时，嵌套 Span 不直接相加为总耗时。

## 完整性规则

- 先将原始文件保存到 `.data/runs/<runId>/samples/<sampleId>/raw/`，再生成 normalized 结果。
- 以 OTel 根 `agent.request` Span 已结束作为 Trace 完整证据；状态终态但根 Span 缺失时，在宽限期内继续拉取。
- 安全处理 JSONL 部分写入；限制文件大小、行长度、事件数、截图尺寸和 XML 大小。
- readiness 阶段先验证 ADB shell 可读取 evaluation 目录；不可读取时返回 `EVALUATION_ARTIFACTS_UNAVAILABLE`，不得改写普通 `tasklogs` 或引入 debuggable APK 作为降级。
- 原始产物一经保存不可修改；解析修复、摘要和脱敏副本写入独立目录。
- 可选 Todo、截图或 UI 层级缺失只产生告警；依赖该证据的必选断言返回 `EVIDENCE_MISSING`。
- OTel 根 Span 和 Todo JSON 必须标记 `source=EVALUATION` 及 `runId/sampleId/requestId`；所有文件同时匹配 `runId/sampleId/requestId/traceId` 关联链，禁止仅按时间戳猜测归属，也禁止写入普通 `tasklogs`。

## 数据安全

- 报告与标准化证据默认脱敏 API key、Authorization Header 及用户配置的敏感值。
- 原始截图发送给远程 Judge 前遵循评测集证据配置；未声明时不发送。
- HTML 展示 Agent、工具和网页文本前必须转义。

## 验收标准

- 标准化后的工具调用顺序、错误、耗时和 Token/Cache 用量与代表性现有 OTel Trace 一致。
- 任意已落盘样本均可还原用户输入及每轮模型/工具调用的输入、输出、Token 和耗时；模型调用完整输入输出只存在于评测隔离目录。
- 样本关键指标均注明定义和 unavailable 语义，且可由标准化轨迹重复计算得到相同结果。
- 即使相邻样本时间戳重叠，也不会交叉关联证据。
- 终态文件、OTel 根 Span 和最终屏幕的采集时间关系在报告中可审计。
