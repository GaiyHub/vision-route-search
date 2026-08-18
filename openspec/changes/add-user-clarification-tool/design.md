## Context

豆泡的工具结果会自动进入下一次 LLM 请求，但目前没有用于“向用户提问并等待回答”的 host tool。`confirm_action` 已证明 host tool 可以阻塞 agent loop、拉起主应用弹框、等待用户输入后恢复外部应用；澄清工具可以复用这条运行时模式，但它不是风险授权，也不能复用确认结果缓存或 60 秒拒绝策略。

Claude Code 的 AskUserQuestion 核心交互语义是：仅在缺少继续所需信息时主动提问，等待用户回答，再利用回答继续当前任务。本实现采用这个语义，但针对手机端需求使用单个自由文本问题，而不是选项问卷。

## Goals / Non-Goals

**Goals:**

- 模型可提出一个具体、可回答的澄清问题，并在原任务内等待。
- 弹框收集非空自由文本，回答作为工具结果自然进入后续 LLM 上下文。
- 澄清等待不被普通 10 秒动作超时中断；用户停止任务时立即关闭等待。
- 清楚区分澄清、风险确认和普通文字回复。

**Non-Goals:**

- 不实现多题、单选、多选问卷。
- 不把澄清工具作为风险操作授权替代品。
- 不允许从工具配置页禁用该协议工具或覆盖其 UI effect。

## Decisions

1. **使用独立 `ask_user` host tool。** 参数为必填 `question` 和可选 `placeholder`。名称直观且与现有工具风格一致；工具描述负责约束适用时机，系统提示词只保留一条路由原则。

2. **使用独立 clarification store 管理 Promise。** store 暴露订阅、请求、提交和取消接口。提交返回 `{ok:true, answer}`；停止任务调用取消接口，防止孤立弹框。相较把回答注入普通 chat correction，工具结果能保持 assistant tool-call / tool-result 的因果关系，并自动进入当前 loop 历史。

3. **不设置自动超时。** 澄清问题没有安全默认答案，静默超时会让模型基于错误假设继续。它被标记为 user-decision tool，只与 agent abort waiter 竞争；明确停止任务才取消。

4. **复用 host foreground / previous-app handoff 模式。** 工具打开前记录当前目标包，拉起豆泡展示 modal；提交后 best-effort 返回目标应用，然后把结果交回 loop。UI effect 为 `user_gate`，因此不触发无意义的普通动作截图等待。

5. **单问题、自由文本输入。** 手机弹框保持轻量，限制 2000 字并拒绝空白回答。模型若仍缺信息，可在看到回答后再次调用工具，但每次必须提出新的具体问题。

6. **协议工具始终可用。** 加入 required-enabled、UI-effect locked 和 circuit-breaker exempt 集合。配置页仍显示基本信息，但敏感配置折叠区不提供启停/UI-effect 修改。

7. **系统提示词目标保持能力层表达。** 目标章节只区分直接回答、访问外部环境或代用户执行、主动澄清三类能力边界；点击、输入等具体动作及使用条件留在工具描述和工作循环中，避免目标层枚举工具行为。

## Risks / Trade-offs

- [模型过度提问] → 工具描述明确禁止询问可从上下文、屏幕或现有工具自行获得的信息，提示词只在“缺少继续所必需的信息”时路由。
- [应用后台拉起被系统限制] → 使用现有 native host foreground 能力；主应用恢复后 store 中 pending 状态仍会渲染弹框。
- [连续或重叠提问] → store 在新请求到来时取消旧请求，保证只有一个 pending gate。
- [用户强制停止后 handler 仍挂起] → `stopAgent()` 同步取消 clarification store，AgentLoop abort waiter同时终止当前执行。

## Migration Plan

1. 添加 store、工具注册和运行时分类。
2. 添加聊天页 modal 与提示词路由。
3. 通过单元测试、TypeScript 检查和 Android release 构建验证。
4. 回滚时移除 `ask_user` 注册和 modal；没有持久化数据需要迁移。

## Open Questions

无。
