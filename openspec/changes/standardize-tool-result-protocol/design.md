## Context

当前 Provider 抽象接收 `LLMMessage.content: string`，工具调用由模型响应解析为 `{ name, arguments }`，所以 AgentLoop 无法直接保存 Anthropic 原生 content blocks。执行侧已有 `ToolRegistry.normalizeToolResult`，但它把任何带 `ok` 的对象原样放行；消费侧又只读取 `data`，使 `{ ok: true, answer: ... }` 这类返回在执行日志中存在、在下一轮模型上下文中却变成“成功”。同时结果被附加在 assistant 行中，外部数据看起来像模型自己的陈述。

Anthropic 的公开工具协议要求 assistant `tool_use` 与紧随其后的 user `tool_result` 一一对应，失败通过 `is_error` 标记，工具数据与后续指令分离。豆泡需要在现有多 Provider 字符串抽象上保持同样的语义边界。

## Goals / Non-Goals

**Goals:**

- 所有工具执行离开 ToolRegistry 时都具有唯一、可预测、无业务顶层字段泄漏的结果结构。
- handler 抛异常、返回 false、legacy 失败对象、超时、取消和熔断都映射成一致的错误码与错误文本。
- 每个执行过的调用在历史中拥有稳定 call id、assistant 调用记录和紧邻的 user 工具结果；屏幕观察在工具结果之后。
- `ask_user` 等用户门禁工具的回答完整进入下一轮，且不会被描述成 assistant 自己生成的内容。
- 保持现有工具 handler 可渐进迁移，避免一次性重写 Browser/Shell/Phone 全部实现。

**Non-Goals:**

- 本次不把 Provider 接口整体改成 Anthropic/OpenAI 原生 content block 联合类型。
- 不改变工具选择、UI effect、完成门禁或风险确认产品逻辑。
- 不把工具返回中的提示文本提升为系统指令；工具结果仍被视为数据。

## Decisions

1. **采用封闭的判别联合，而不是开放接口。** 标准结果为 `ToolSuccess<T> = { ok: true, data: T, ...metadata }` 或 `ToolFailure = { ok: false, error: string, code: string, retryable: boolean, hint?: string, details?: unknown, ...metadata }`。保持 `error` 为字符串而不是嵌套对象，减少现有消费方迁移成本，同时用必填 `code` 与 `retryable` 标准化异常分类。

2. **ToolRegistry 是唯一规范化边界。** 原始 handler 可以返回普通值或 legacy `{ ok, ... }`：
   - 普通值进入 `data`；`false` 转为 `OPERATION_REJECTED`。
   - legacy 成功对象若已有 `data` 则使用它；否则除 `ok` 和保留元数据外的所有业务字段整体移入 `data`，因此 `answer` 不会丢失。
   - legacy 失败对象将 string/Error/unknown 错误转成文本，补齐稳定 code、retryable 和 hint，剩余字段放进 `details`。
   - 抛出的异常统一为 `TOOL_EXECUTION_ERROR`，不向模型暴露 stack。

3. **循环自身产生的失败也走相同 helper。** 超时、禁用、找不到 handler、取消和熔断分别使用稳定错误码；AgentLoop 不再手写半标准 `{ ok:false,error }`。

4. **在现有字符串消息能力上实现 Claude 语义，而不是伪造原生 API block。** 每个 action 生成任务内单调 call id。assistant 历史只记录 `<tool_use id name>arguments</tool_use>`；下一条 user 历史首先记录对应 `<tool_result tool_use_id is_error>content</tool_result>`，随后才是屏幕观察。批量调用的所有结果保持原顺序集中出现。

5. **结果序列化以数据为中心。** 成功 content 是 `data` 的 JSON/文本；失败 content 是包含 code/message/retryable/hint/details 的 JSON。空成功显式写为 `null`。附件与内部元数据不进入 content；敏感结果只提供已脱敏摘要。统一长度上限保留尾部截断标记。

6. **`read_skill` 不再拥有绕过通用结果协议的顶层字段假设。** 它的完整正文从标准 `data` 读取并位于 user/tool-result 侧；必要时保留专用长度策略，但不回到 assistant 文本。

7. **兼容旧日志和 UI 观察者。** `AgentEvent.result` 仍暴露标准对象；新增 `callId` 是可选兼容字段。日志继续记录标准对象，视觉附件不序列化 base64。

## Risks / Trade-offs

- [字符串标签不等同于原生 Anthropic content block] → 当前所有 Provider 都能稳定消费，且信任边界和顺序一致；未来扩展 LLMMessage blocks 时可直接映射，不再改执行契约。
- [legacy 对象中的辅助字段被移入 data/details 后影响旧代码] → 只在 ToolRegistry 出口收口，并迁移 AgentLoop/CircuitBreaker 等直接消费方；handler 内部逻辑不变。
- [工具结果增加 token] → 使用统一上限、结果摘要和历史轮次裁剪；不重复把结果放在 assistant 与 user 两侧。
- [错误码推断不准确] → 显式 code 优先，已知文本仅做有限映射，未知统一 `TOOL_EXECUTION_ERROR`，测试固定边界。

## Migration Plan

1. 引入标准结果类型、构造器和兼容 normalizer，并迁移 ToolRegistry/AgentToolkit/AgentLoop 自身错误路径。
2. 改造历史轮次为 tool-use/tool-result 分层，同时更新 skill、todo 与熔断消费逻辑。
3. 增加协议与 ask_user 回归测试，运行全量测试和类型检查。
4. 构建 release 并装机；若出现 Provider 兼容问题，可回滚历史渲染，结果规范化契约可独立保留。

## Open Questions

无。
