# Spec：`eval-orchestrator`

## 目标

管理 Run 与 Sample 状态机，保证在一台设备上有边界、串行、可恢复地执行评测。

## Run 启动

- 快照标准化评测集、设备信息、豆泡版本、Judge 非敏感配置和运行参数。
- 为 Run 和每个 Sample 生成稳定 ID；同一次 Sample 的 ADB 传输重试复用 `requestId`。
- 同一 serial 同时只允许一个活动 Run；PC 进程内使用互斥锁，Android 桥接再做第二层冲突保护。

## 样本流水线

```text
SETUP
→ SUBMIT
→ WAIT_TERMINAL
→ COLLECT_EVIDENCE
→ ASSERT
→ JUDGE（启用时）
→ AGGREGATE
→ TEARDOWN
→ PERSIST
```

- 每个阶段有独立超时、开始/结束时间和错误码。
- `teardown` 在样本已提交后尽最大努力执行，但不得覆盖主要失败原因。
- 当前样本终态和产物索引持久化后，才允许启动下一样本。
- 设备仍可用时，`FAILED`、`BLOCKED`、`INCONCLUSIVE` 和单样本 `INFRA_ERROR` 不阻塞后续样本。

## 聚合规则

- `PASSED`：所有必选断言为 `PASS`，且启用 Judge 时 Judge 返回达到阈值的 `PASS`。
- `FAILED`：至少一条断言为 `FAIL`，或 Judge 返回 `FAIL`/低于阈值。
- `INCONCLUSIVE`：Judge 返回 `INCONCLUSIVE`，且不存在确定性 `FAIL` 或 `ERROR`。
- `BLOCKED`：豆泡请求风险授权、澄清或用户手动操作。
- `INFRA_ERROR`：ADB、桥接、证据、断言执行或 Judge 基础设施导致无法形成有效判断。
- `TIMED_OUT`：样本超过总超时并完成取消流程。
- `CANCELLED`：用户主动取消当前 Sample 或整个 Run。

若同时存在产品失败和基础设施错误，保留全部明细，顶层优先标记为 `INFRA_ERROR`，避免将不完整评测误判为产品失败。

## 进度事件

- 每个 Run 事件包含单调递增 `sequence`、`runId`、可选 `sampleId`、阶段、时间和 payload。
- SSE 断线重连使用 `Last-Event-ID`；服务端可从持久化事件恢复当前快照。
- 事件只传递展示所需摘要，大型证据通过独立 API 按需读取。

## 取消与重跑

- 取消 Run 后不再启动新样本；活动样本通过 `adb-runner` 请求取消并在宽限期后收集证据。
- “仅重跑未通过项”创建新 Run，并通过 `sourceRunId` 关联原 Run；不得覆写原结果。
- 重跑范围默认包含 `FAILED`、`INCONCLUSIVE`、`BLOCKED`、`INFRA_ERROR` 和 `TIMED_OUT`，用户可进一步选择。

## 恢复

- PC 重启后可重新打开已完成 Run。
- 重启时发现非终态 Run，标记为 `INTERRUPTED`，先读取 Android 当前状态；只有能证明 requestId 已完成时才补采证据，不自动重提未知状态任务。

## 验收标准

- 任何样本都不会无限停留在非终态。
- 取消 Run 后不会启动下一样本。
- 传输重试、SSE 重连和进程恢复均不会造成重复执行。
- 失败重跑与原 Run 的关联和差异在报告中清晰可见。
