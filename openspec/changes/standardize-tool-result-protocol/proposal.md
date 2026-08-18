## Why

豆泡虽然声明了统一 `ToolResult`，但允许 `{ ok, ...任意顶层字段 }` 原样穿透，而 AgentLoop 只读取 `data`，导致 `ask_user.answer` 等有效结果在下一轮上下文中静默丢失。工具结果目前还被拼入 assistant 文本，混淆了模型输出与外部执行结果，偏离 Claude 的 `tool_use` / `tool_result` 信任边界，也让错误恢复依赖各工具自行组织字符串。

## What Changes

- 在 ToolRegistry 边界把所有 handler 返回值和异常规范化为封闭的成功/失败联合类型；成功数据只进入 `data`，失败统一携带结构化 `error.code`、`error.message`、可重试性和可选恢复建议。
- 兼容并迁移现有 legacy `{ ok, error, hint, code, ... }` 返回值，禁止未知顶层业务字段继续静默穿透。
- AgentLoop 将工具调用保留在 assistant 决策侧，将规范化工具结果放到紧邻的 user/tool-result 侧；结果先于屏幕观察出现，并明确成功或 `is_error` 状态。
- 用户澄清回答作为工具结果数据可靠进入下一轮上下文；工具失败原因保持可见且不冒充模型陈述。
- 对日志和视觉附件应用统一的序列化、截断与敏感数据规则，禁止 base64 或敏感载荷进入提示词和普通日志。
- 增加覆盖成功、异常、超时、取消、legacy 返回、批量调用及 `ask_user` 回答传递的协议测试。

## Capabilities

### New Capabilities

- `standard-tool-result-protocol`: 统一工具执行结果、异常分类以及模型上下文中的 tool-result 消费语义。

### Modified Capabilities


## Impact

- 影响 `ToolResult` 类型、ToolRegistry 规范化边界、AgentToolkit/AgentLoop 的超时与异常路径、历史轮次构造和相关测试。
- Host、Browser、Shell 等现有工具可暂时保留 legacy 返回形态，由注册表兼容归一化；新增工具必须遵循标准结果契约。
- 不要求所有 Provider 立即支持原生 content block；内部历史先保持 provider-neutral 的严格调用/结果分层，CloudProvider 可据消息能力映射到各 API。
