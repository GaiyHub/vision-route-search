# Spec：`doupao-eval-bridge`

## 目标

在 PC ADB 调用与现有 `processCommand` 之间增加评测专用薄桥接，使 PC 无需操作豆泡 UI 即可提交任务、获得结构化终态并关联现有 Trace。

## 现有实现约束

- `processCommand(command)` 已管理 AgentLoop、前台服务、MediaProjection、Heartbeat、完成确认、会话历史和 OTel，但只返回 `Promise<void>`。
- `agentStore.isRunning` 已阻止重叠任务，桥接层必须复用这一事实，不另建并行 Agent 运行时。
- OTel/Todo 已写入 ADB 可读的 `Android/data/com.watchdog.agent/files/tasklogs/`；桥接层不得复制工具事件。
- `plugins/android/` 是 Kotlin 源文件事实来源，`android/app/src/main/` 是 Expo 配置插件生成产物。

## 普通 APK 内的入口隔离

- 不新增 evaluation Variant、独立 APK、`applicationIdSuffix` 或覆盖安装流程；直接使用用户当前安装的普通豆泡 APK。
- 普通 APK 默认提供评测接口，不实现开关、会话、配对、密钥或 HMAC。
- 不复用无权限保护的普通 Launcher 作为评测入口；新增指向 `MainActivity` 的独立 `EvaluationEntryActivity` activity-alias，设置 `exported=true` 且要求 `android.permission.DUMP`。
- Manifest 声明只读能力标识 `com.watchdog.agent.EVALUATION_API_VERSION=1`，PC 在提交任务前校验版本；该标识不是运行开关，不写用户配置。
- PC 仅通过 `adb shell am start -n com.watchdog.agent/.EvaluationEntryActivity` 调用；Android 在组件分发前完成权限校验，普通第三方 App 无权调用。
- evaluate 与 cancel 使用同一受保护入口和不同 action；普通 Launcher、聊天和设置行为不变。
- `android.permission.DUMP` 在目标 Android/ROM 上的 shell 可用性必须通过真机测试；不满足时返回明确的 readiness 错误，不降级为无权限入口。

## ADB 请求契约

PC 使用显式 Activity Intent 启动或唤醒用户已安装的普通豆泡 APK。请求 JSON 先做 UTF-8 编码，再使用 Base64URL 作为单一 payload extra，避免中文和特殊字符转义问题。

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

- 只有从受保护 activity-alias 进入且 action 匹配时，`MainActivity` 才将 payload 交给 `EvaluationRequestStore`。
- RN 尚未就绪时，Native Store 保留一个待消费请求；RN 就绪后通过 Native Module 主动 consume。
- RN 已就绪时，可发出 `evaluation-request` 事件，但 consume API 仍是恢复和去重的事实来源。
- 请求、当前状态、最终状态、OTel 与 Todo 写入应用 external files 下的 `evaluation/<runId>/<sampleId>/<requestId>/`，采用临时文件加 rename 的原子写入策略；评测日志不得写入普通 `tasklogs`。
- Kotlin 边界负责入口来源、Base64URL、JSON Schema、大小、ID 和 hash 校验。

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

- PC 超时或用户取消时，通过同一受系统权限保护的入口发送 cancel Intent 并传递 `requestId`。
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
- ADB shell 可默认调用评测入口；普通第三方 App 调用被系统权限拒绝；普通 Launcher 无法通过附加评测 extra 绕过独立入口。
- PC 可从普通 APK 的 Manifest 能力标识判断协议兼容性；版本不兼容时不得尝试提交任务。
