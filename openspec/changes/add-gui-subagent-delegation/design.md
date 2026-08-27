## Context

豆泡的 `AgentLoop` 已经支持 host 通过 `extraTools` 注入工具，主循环无需知道工具内部如何完成工作；现有 `AgentToolkit` 和 Accessibility Controller 已覆盖截图、点击、滑动、输入和应用切换。验证通义 GUI 模型时，最小风险路径是把多步 GUI 循环封装成一个 host 注入的长耗时工具，而不是复制或改写主 Agent 的 decide → tool → result 循环。

参考 Operit 的 `run_ui_subagent` / `PhoneAgent` 分层，本设计让主 Agent 同步等待一个独立 GUI 执行循环。不同于直接替换现有工具，豆泡在验证期始终保留现有 PhoneTools，并提供默认关闭、运行时可撤回的 kill switch。

## Goals / Non-Goals

**Goals:**

- 用一个边界清晰的委派工具验证通义 GUI 模型，不改变主 Agent 的 Provider、规划算法或普通工具调用语义。
- 开关关闭时形成硬短路：不注册工具、不增加提示词、不创建客户端、不发出网络请求。
- 开关启用时让主 Agent 同步等待子 Agent，同时保留进度、取消、超时和人工确认。
- 子 Agent 失败时安全回到主 Agent 的现有直接 GUI 工具链，避免重复执行有副作用动作。
- 复用标准 ToolResult、现有 Android 执行能力和任务取消信号，保持可测试、可观测。

**Non-Goals:**

- 不在验证阶段用 GUI 模型替换主对话模型。
- 不实现虚拟屏、多设备并发或多个 GUI 子 Agent 并行执行。
- 不赋予 GUI 子 Agent 浏览器、Shell、技能、记忆或完成门禁等主 Agent 能力。
- 不承诺百炼 GUI 接口与 OpenAI 工具调用协议完全相同；协议差异由适配器封装。
- 不在本变更中移除、重构或隐藏现有 PhoneTools。

## Decisions

1. **使用 host 注入的单一同步工具。** 新工具暂定名为 `delegate_ui_task`，通过现有 `extraTools` 注入。主 Agent 发起调用后等待 handler 完成，再把标准 ToolResult 放入下一轮上下文。相比新增主循环分支，这只要求 host 构造工具，并对长耗时调用增加一个很小的超时策略扩展。

2. **功能开关默认关闭，并在注册与执行两层检查。** `guiSubagentEnabled` 由 settings store 管理：
   - 创建任务时关闭：不构造 registration，模型完全看不到工具，行为等同当前版本。
   - 创建任务时开启：注册委派工具，但 handler 在初始化、每个动作前再次读取 kill switch。
   - 执行中关闭：取消子 Agent，返回 `GUI_SUBAGENT_DISABLED` 和安全的降级信息；主 Agent 可继续使用本轮一直存在的 PhoneTools。
   配置值不放入通用 `AgentOptions`，避免把实验开关扩散到 device-agent core。

3. **现有 PhoneTools 始终保留。** 验证期不根据开关过滤直接 GUI 工具。启用开关只是多一个可选委派工具；关闭或降级后无需重建 AgentLoop。主提示词只通过工具描述得知何时适合委派，不增加全局 GUI 专用提示词。

4. **GUI 子 Agent 是独立有界循环。** `TongyiUiSubagent` 持有独立 provider、system prompt、消息历史、`maxSteps` 和 `AbortSignal`。每一步严格执行：获取最新截图 → 调用 GUI 模型 → 解析一个动作或结束状态 → 风险检查 → 执行动作 → 记录进度。默认最大步数建议 15，硬上限 30；一次只允许一个活动的设备 GUI 执行租约。

5. **复用执行能力，而不复用主 Agent 状态。** 子 Agent 通过窄接口 `GuiActionExecutor` 调用现有 Accessibility Controller/截图能力。它不访问主 Agent 历史、Todo、技能或 ToolRegistry，也不直接调用 `task_complete`。为避免两个循环竞争设备，委派期间主 Agent因同步等待不会派发其他动作，设备租约额外阻止其他入口并发操作。

6. **百炼协议封装在专用适配器。** `TongyiGuiClient` 负责请求格式、截图传输、官方 GUI prompt、`<tool_call>`/动作文本解析和错误归类，对子 Agent 暴露 provider-neutral 的 `nextAction()`。API Key 和 endpoint 通过安全配置读取，日志仅记录模型标识、延迟、步数、状态和错误码。

7. **降级以“是否已经产生副作用”为边界。**
   - 初始化、鉴权、模型不可用或第一次动作前失败：返回 `fallbackAllowed: true`，主 Agent 可直接继续当前工具链。
   - 任一界面动作已经尝试：返回最后观察、动作摘要和 `fallbackAllowed: false`；主 Agent 必须先重新观察/核实，不得自动从任务开头重放。
   - 关闭开关不会在 handler 内递归启动另一个主 Agent，也不会自行重放原任务。

8. **结构化结果遵循现有标准 ToolResult。** 成功 `data` 包含 `status`、`summary`、`stepsExecuted`、可选 `extractedData` 和脱敏后的最终观察引用；失败使用稳定错误码，并在 `details` 中给出 `sideEffectsStarted`、`fallbackAllowed` 和最后安全状态。工具 handler 本身不把模型完整思维链写入结果或日志。

9. **进度不改变主 Agent 协议。** 子 Agent 通过 host 回调更新 execution store/前台服务，展示当前步数、动作类别和状态；这些事件不插入主 Agent 历史。主任务 Stop 复用同一 AbortSignal，能中断网络请求、等待和动作执行。

10. **长任务使用显式执行策略。** 为避免普通工具的短超时终止 GUI 循环，在 AgentLoop/AgentToolkit 的工具元数据中增加最小的长任务超时声明，或等价的专用长任务名单；仅 `delegate_ui_task` 使用可配置的分钟级上限。不得把它误归类为用户确认工具，普通工具的现有超时保持不变。

## Risks / Trade-offs

- [主 Agent 仍可能选择直接工具而不委派] → 验证期这是有意保留的安全行为；通过简短工具描述和遥测评估选择率，不修改主系统提示词强制路由。
- [同步长工具看起来像主 Agent 卡住] → execution store 和前台服务持续展示子步骤，提供停止按钮，并设置墙钟上限。
- [GUI 模型返回格式不稳定] → 专用适配器做严格白名单解析；未知动作不执行，并返回可恢复错误。
- [失败后直接降级造成重复点击或提交] → 记录是否已尝试副作用；一旦为真，禁止自动重放并要求重新观察。
- [运行中切换开关可能处于动作边界] → 动作前检查开关；不可中断的单个原子动作结束后立即停止，并在结果中声明可能的副作用。
- [API Key 泄漏] → 仅从安全配置注入，禁止进入源码、提示词、普通日志和 ToolResult；测试使用假客户端。
- [两个入口争抢手机] → 使用单设备租约；租约冲突返回稳定的忙碌错误，不排队执行未知时效任务。

## Migration Plan

1. 先落地类型、假客户端、功能开关和硬短路测试，默认值保持关闭。
2. 实现独立 GUI 循环与动作适配器，在 fake executor 上验证成功、失败、取消和步数上限。
3. 通过 `extraTools` 接入 host，并只对白名单测试设备手动开启；观察委派率、成功率、耗时、取消率和降级原因。
4. 验证期间出现异常可立即关闭开关；新任务恢复当前链路，活动子任务在下一动作边界取消并交还主 Agent。
5. 只有在指标和安全回归通过后，另开变更讨论默认开启、隐藏直接工具或虚拟屏并发。

## Open Questions

- 百炼 GUI 模型最终采用的模型 ID、区域 endpoint 和单次请求超时，需要在实现前用当前账号再次确认。
- 第一阶段是否只允许白名单应用，还是允许所有非系统应用，由装机验证结果决定；接口预留 `targetApp`，默认不改变现有应用范围。

