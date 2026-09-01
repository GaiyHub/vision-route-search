# Spec：`eval-report`

## 目标

为每次 Run 生成可离线打开、可机器解析且能够追溯原始证据的报告。

## 目录与输出

```text
.data/runs/<runId>/
├── run.json
├── events.jsonl
├── report.json
├── report.html
└── samples/<sampleId>/
    ├── raw/
    ├── normalized/
    └── result.json
```

- `report.json`：带 Schema 版本的完整机器可读结果。
- `report.html`：CSS/JS 内嵌、自包含的人工可读报告；截图以相对资源或内嵌方式确保可移植。
- `raw/`：从 Android 拉取和 ADB 采集的不可变原始产物。

## 报告内容

- Run ID、来源重跑关系、时间、评测集快照 hash、设备与豆泡版本。
- 各终态数量与比例、总耗时、均值/P50/P95、步数和 Token/Cache 汇总。
- 每个样本的阶段耗时、完整回复、Agent outcome 和阻塞类型。
- 确定性断言的逐条结论、原因与证据指针。
- Judge Provider/Model、Prompt 模板版本、阈值、分数、结论、原因、证据指针和降级告警。
- 标准化工具时间线、Todo、最终前台包名、截图、UI 层级和基础设施告警。
- 所有原始与派生产物的相对路径和内容 hash。

## 规则

- 相同持久化 Run 数据必须生成顺序稳定的 `report.json`。
- HTML 嵌入前转义评测集、Agent、工具、网页和 Judge 文本。
- 脱敏凭据、Authorization Header 和配置的敏感值；报告中不得出现 API key。
- Run 被取消、设备断开或 PC 异常恢复后仍应生成部分报告，并明确标记未执行与证据不完整项。
- 报告生成失败不得破坏已保存的 Run 和原始证据。

## 验收标准

- `report.json` 通过对应 Schema 校验。
- `report.html` 在后端停止且 Android 设备断开时仍能打开并诊断样本。
- 失败重跑报告可跳转或引用来源 Run，并保留两次结果。
- 取消或部分中断的 Run 也能生成结构完整、语义明确的报告。
