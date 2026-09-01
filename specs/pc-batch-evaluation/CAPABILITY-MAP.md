# 豆泡 PC 批量评测能力图

## 能力拆分

| 模块 ID | 职责 | 复用的现有实现 | 依赖 |
| --- | --- | --- | --- |
| `eval-dataset` | 定义、校验、导入并持久化评测集与样本。 | 无 | — |
| `doupao-eval-bridge` | 为评测 APK 提供 ADB 指令入口、运行策略和结构化状态出口。 | `processCommand`、`agentStore`、`chatStore`、`otelLogger`、`todoFileStore` | — |
| `adb-runner` | 发现指定设备，通过显式 Intent 驱动一个样本，并轮询评测状态。 | Android SDK `adb` | `doupao-eval-bridge` |
| `evidence-collector` | 拉取现有 OTel/Todo 文件，并采集最终截图、UI 层级和前台包名。 | `tasklogs/otel-<traceId>.jsonl`、`tasklogs/todo-<traceId>.json` | `adb-runner` |
| `assertion-engine` | 基于标准化证据执行确定性断言。 | 无 | `eval-dataset`、`evidence-collector` |
| `llm-judge` | 通过独立模型，使用文本和可选截图按样本 Rubric 评判结果。 | 无 | `eval-dataset`、`evidence-collector` |
| `eval-orchestrator` | 串行运行样本、控制超时与取消、聚合状态并支持失败重跑。 | 无 | `adb-runner`、`assertion-engine`、`llm-judge` |
| `eval-console` | 提供本地 WebUI 与 HTTP/SSE API。 | 无 | `eval-dataset`、`eval-orchestrator` |
| `eval-report` | 保存运行快照、原始产物，并生成 JSON/HTML 报告。 | 无 | `eval-orchestrator`、`evidence-collector` |

## 依赖与实现顺序

```text
eval-dataset + doupao-eval-bridge
→ adb-runner
→ evidence-collector
→ assertion-engine + llm-judge
→ eval-orchestrator
→ eval-console + eval-report
```

## 边界规则

- 模块 ID 为稳定标识，后续 Plan、Tasks 和目录命名必须沿用。
- PC 端不得解析豆泡 UI 来判断任务是否完成；以 `EvalStatusV1` 为唯一生命周期事实来源。
- `doupao-eval-bridge` 只负责控制与结果关联，不复制 AgentLoop、工具体系或已有 OTel 日志；评测运行对用户配置和普通用户数据保持零写入。
- 所有评测产物必须通过 `runId/sampleId/requestId/traceId` 隔离并可验证关联，不与普通聊天历史混用。
- 评测入口只存在于 evaluation Variant；普通 APK 不声明评测 Intent，不接受评测请求。
- 依赖只按图中方向流动，Provider 模块负责定义跨模块契约。
