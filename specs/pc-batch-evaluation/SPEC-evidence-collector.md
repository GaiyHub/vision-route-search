# Spec：`evidence-collector`

## 目标

复用豆泡现有 OTel/Todo 产物，并补充设备最终状态，形成确定性断言和 LLM Judge 共用的可信证据包。

## 证据来源

### 豆泡已有产物

- `evaluation/<runId>/<sampleId>/<requestId>/status.json`：完整执行结果及 `traceId`。
- `tasklogs/otel-<traceId>.jsonl`：Agent 根 Span、模型调用、工具调用、结果、错误与事件。
- `tasklogs/todo-<traceId>.json`：目标、Todo 项及最终 outcome；文件可能不存在，因为 Todo 为按需工具。

### PC 通过 ADB 补采

- `adb exec-out screencap -p`：最终原始 PNG 截图。
- `uiautomator dump`：最终 UI 层级；失败时记录告警。
- `dumpsys activity` 的有限解析结果：最终前台包名和 Activity。
- 设备型号、Android 版本、应用版本及采集时间。

## 标准化模型

证据包至少包含请求与终态、完整最终回复、Agent outcome、标准化工具时间线、模型调用与 Token/Cache 汇总、步数、Todo、最终设备状态、原始文件路径和采集告警。

## 完整性规则

- 先将原始文件保存到 `.data/runs/<runId>/samples/<sampleId>/raw/`，再生成 normalized 结果。
- 以 OTel 根 `agent.request` Span 已结束作为 Trace 完整证据；状态终态但根 Span 缺失时，在宽限期内继续拉取。
- 安全处理 JSONL 部分写入；限制文件大小、行长度、事件数、截图尺寸和 XML 大小。
- 原始产物一经保存不可修改；解析修复、摘要和脱敏副本写入独立目录。
- 可选 Todo、截图或 UI 层级缺失只产生告警；依赖该证据的必选断言返回 `EVIDENCE_MISSING`。
- OTel 根 Span 和 Todo JSON 必须标记 `source=EVALUATION` 及 `runId/sampleId/requestId`；所有文件同时匹配 `runId/sampleId/requestId/traceId` 关联链，禁止仅按时间戳猜测归属。

## 数据安全

- 报告与标准化证据默认脱敏 API key、Authorization Header 及用户配置的敏感值。
- 原始截图发送给远程 Judge 前遵循评测集证据配置；未声明时不发送。
- HTML 展示 Agent、工具和网页文本前必须转义。

## 验收标准

- 标准化后的工具调用顺序、错误、耗时和 Token/Cache 用量与代表性现有 OTel Trace 一致。
- 即使相邻样本时间戳重叠，也不会交叉关联证据。
- 终态文件、OTel 根 Span 和最终屏幕的采集时间关系在报告中可审计。
