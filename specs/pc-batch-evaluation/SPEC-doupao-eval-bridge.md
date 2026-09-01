# Spec：`doupao-eval-bridge`

## 目标

在 PC ADB 调用与现有 `processCommand` 之间增加评测专用薄桥接，使 PC 无需操作豆泡 UI 即可提交任务、获得结构化终态并关联现有 Trace。

## 现有实现约束

- `processCommand(command)` 已管理 AgentLoop、前台服务、MediaProjection、Heartbeat、完成确认、会话历史和 OTel，但只返回 `Promise<void>`。
- `agentStore.isRunning` 已阻止重叠任务，桥接层必须复用这一事实，不另建并行 Agent 运行时。
- OTel/Todo 已写入 ADB 可读的 `Android/data/com.watchdog.agent/files/tasklogs/`；桥接层不得复制工具事件。
- `plugins/android/` 是 Kotlin 源文件事实来源，`android/app/src/main/` 是 Expo 配置插件生成产物。

## 构建隔离

- 新增 evaluation Variant 或等价的编译期开关 `BuildConfig.EVALUATION_ENABLED`。
- 只有 evaluation 构建声明并处理评测 Intent；普通构建不得暴露该 action、Receiver 或处理分支。
- App 内须清晰显示“评测模式”，防止将评测包误认为正式包。
- evaluation 与普通豆泡使用相同 `applicationId` 和兼容签名，通过覆盖安装保留现有配置；不得使用 `applicationIdSuffix` 创建另一份配置空间。

## ADB 请求契约

PC 使用显式 Activity Intent 启动或唤醒 evaluation APK。请求 JSON 先做 UTF-8 编码，再使用 Base64URL 作为单一 extra 传递，避免中文和特殊字符转义问题。

```ts
interface EvalRequestV1 {
  schemaVersion: 1;
  requestId: string;
  requestHash: string;
  runId: string;
  sampleId: string;
  instruction: string;
  timeoutMs: number;
  conversationMode: 'ISOLATED';
}
```

- `requestId` 标识一次不可变执行意图；传输重试复用同一 ID 和 hash。
- `requestHash` 基于规范化后的完整请求生成，不包含自身字段。
- ID 只允许受限字符集和长度；`instruction` 与整体 payload 均设置明确字节上限。
- 同一 `requestId + requestHash` 返回已有状态；相同 ID 携带不同 hash 返回 `IDEMPOTENCY_CONFLICT`。
- 已有其他任务运行时返回 `RUN_ALREADY_ACTIVE`，不得把请求排入豆泡内部队列。

## Kotlin EvaluationGateway

- `MainActivity` 仅在 evaluation 构建中识别评测 action，并将 payload 交给 `EvaluationRequestStore`。
- RN 尚未就绪时，Native Store 保留一个待消费请求；RN 就绪后通过 Native Module 主动 consume。
- RN 已就绪时，可发出 `evaluation-request` 事件，但 consume API 仍是恢复和去重的事实来源。
- 请求、当前状态和最终状态写入应用 external files 下的 `evaluation/<runId>/<sampleId>/<requestId>/`，采用临时文件加 rename 的原子写入策略。
- Kotlin 边界负责 Base64URL、JSON Schema、大小、ID、hash 和构建开关校验。

## RN 执行契约

以向后兼容方式扩展现有入口：

```ts
interface CommandExecutionOptions {
  source?: 'CHAT' | 'EVALUATION';
  conversationMode?: 'CONTINUOUS' | 'ISOLATED';
  completionPolicy?: 'ASK_USER' | 'AUTO_ACCEPT';
  interactionPolicy?: 'WAIT_FOR_USER' | 'BLOCK';
}

interface CommandExecutionResult {
  outcome: 'complete' | 'stopped' | 'error' | 'blocked' | 'timed_out';
  summary: string;
  traceId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stepCount: number;
  actionCount: number;
  tokens: { prompt: number; completion: number; total: number; cached?: number };
  blockedInteraction?: 'RISK' | 'ASK_USER' | 'USER_ACTION';
}
```

- 所有字段可通过内部执行结果获得，默认调用 `processCommand(command)` 的聊天行为保持不变。
- `ISOLATED` 直接向 AgentLoop 传入空历史，不读取也不清理现有聊天消息。
- evaluation 不调用 `addMessage`、`addSession` 或 `clearMessages`，不写入普通聊天和会话历史。
- evaluation 只统计并返回本次任务 Token，不更新持久化的全局 Token 统计。
- evaluation 不读取、覆盖或删除普通 `deft:resumableTask`；其恢复与幂等完全由评测 request/status 文件承担。
- Settings、Model Profile、API Key、Skills、Favorites、工具配置与权限只能读取，不提供 evaluation 写入接口。
- `beginTrace` 和 Todo 状态携带 `source=EVALUATION`、`runId`、`sampleId`、`requestId`，并与 `traceId` 组成完整关联链。
- `AUTO_ACCEPT` 只跳过普通任务完成确认，不得视为风险授权。
- `BLOCK` 遇到风险确认、`ask_user` 或 `request_user_action` 时立即返回结构化 `blocked`，不弹出卡片、不等待超时。
- 终态写入前必须等待 OTel 和 Todo 的最终 flush 完成，保证 PC 看到终态后对应文件已可拉取。

## 状态契约

```ts
type EvalStatusV1 =
  | { schemaVersion: 1; requestId: string; runId: string; sampleId: string; state: 'ACCEPTED'; updatedAt: string }
  | { schemaVersion: 1; requestId: string; runId: string; sampleId: string; state: 'RUNNING'; traceId: string; startedAt: string; updatedAt: string }
  | { schemaVersion: 1; requestId: string; runId: string; sampleId: string; state: 'COMPLETED'; result: CommandExecutionResult; updatedAt: string }
  | { schemaVersion: 1; requestId: string; runId: string; sampleId: string; state: 'BLOCKED'; result: CommandExecutionResult; updatedAt: string }
  | { schemaVersion: 1; requestId: string; runId: string; sampleId: string; state: 'TIMED_OUT' | 'CANCELLED'; traceId?: string; reason: string; updatedAt: string }
  | { schemaVersion: 1; requestId: string; runId: string; sampleId: string; state: 'ERROR'; traceId?: string; code: string; message: string; updatedAt: string };
```

## 取消

- PC 超时或用户取消时，通过 evaluation-only cancel Intent 传递 `requestId`。
- 只有当前活动 ID 匹配时才调用现有 `stopAgent()`；重复取消保持幂等。
- 取消不能自动启动后续待处理请求。

## 验收标准

- 包含中文、引号、反斜杠和换行的指令可完整到达 `processCommand`。
- 重复 Intent 不会执行同一意图两次；hash 冲突被明确拒绝。
- RN 冷启动和已运行两种情况下均能消费请求。
- 完整回复、`traceId`、统计信息与实际任务一致，且终态出现时 Trace 已完成落盘。
- 普通聊天模式的连续对话、完成确认和人工卡控行为保持不变。
- evaluation 执行前后，用户配置、普通聊天、历史、全局 Token 统计和普通 resumable 数据保持不变。
- 每份 evaluation status、OTel 与 Todo 均包含或可验证完整的 `runId/sampleId/requestId/traceId` 关联。
- 普通 Release APK 无法通过评测 action 启动 Agent 任务。
