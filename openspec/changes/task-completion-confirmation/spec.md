# 任务完成确认（Task Completion Confirmation）Spec

## Problem Statement

模型判定"任务完成"（调用 `task_complete`）并不准确：任务可能实际未完成（遗漏步骤、被系统弹窗打断、目标没有真正达成），agent 却直接结束任务并收尾（finish 流程、历史记录、完成通知）。用户作为任务的最终执行者，对"任务是否真的完成"拥有裁决权，但目前没有介入的入口——只能事后发现任务没做完，再重新发起指令。

## Solution

- AgentLoop 收到 `task_complete` 调用时**不立即结束**，先进入"完成确认"状态：把 app 自动拉回前台，弹出确认框，展示**当前任务指令**和**最后判定（summary）**，提供「确认完成」和「未完成」两个按钮。
- **纯文本回复路径同样进入确认**：模型无工具调用、直接输出文本时，该文本同样视为"完成判定"先过确认流程（封死用纯文本绕过工具的路径），确认完成后才作为最终答复收尾。
- 用户点「确认完成」→ 走现有完成收尾流程（finish、执行记录、历史会话、完成通知）。
- 用户点「未完成」→ 向当前会话上下文注入一句提示词（含用户判定与模型摘要），任务消耗 1 个 step 继续执行，直到下一次完成判定再次进入确认。
- 确认框 60 秒无响应（用户没看到/忽略）→ 默认按「确认完成」收尾，避免任务悬挂。
- **可选灵活性层**：额外注册 `ask_user` 工具，模型可在任务中途（非完成时）请求用户选择/输入，与确认框共用同一 UI 与反馈注入通道；不作为终止路径。

## User Stories

1. 作为 WatchDog 用户，我想要模型调用 task_complete 时先弹出确认框，以便在任务真正完成前拥有最终裁决权。
2. 作为 WatchDog 用户，我想要确认框展示我发起的原始任务指令，以便核对 agent 执行的是否就是我要求的任务。
3. 作为 WatchDog 用户，我想要确认框展示模型给出的最后判定摘要，以便快速判断它认为完成了什么。
4. 作为 WatchDog 用户，我想要点「确认完成」后任务立即真正结束，以便收尾流程（历史记录、完成通知）只发生在真实完成时。
5. 作为 WatchDog 用户，我想要点「未完成」后任务不结束而是继续执行，以便纠正模型过早结束的误判。
6. 作为 WatchDog 用户，我想要点「未完成」后 agent 的下一轮决策能感知"用户认为未完成"，以便它针对未完成的部分继续操作而不是重头再来。
7. 作为 WatchDog 用户，我想要「未完成」继续执行消耗 1 个 step，以便受 maxSteps 上限约束，不会无限循环。
8. 作为 WatchDog 用户，我想要任务在后台运行判定完成时 app 能自动回到前台显示确认框，以便不需要手动找 app 才能确认。
9. 作为 WatchDog 用户，我想要确认框弹出时任务暂停在完成判定处（不再执行新动作），以便我在确认前不会有额外副作用。
10. 作为 WatchDog 用户，我想要确认框在 60 秒无操作时默认按完成收尾，以便任务不会永远悬挂。
11. 作为 WatchDog 用户，我想要「未完成」继续执行后再次完成时再次进入确认，以便每一轮"完成"判定都要经过我的确认。
12. 作为 WatchDog 用户，我想要「未完成」注入的提示词保留模型的摘要，以便 agent 知道它上次为什么认为完成了、用户为什么不认可。
13. 作为 WatchDog 用户，我想要确认框不遮挡我查看执行过程，以便确认前能回顾整个执行过程面板。
14. 作为 WatchDog 用户，我想要确认框在任务指令较长时完整展示（可滚动/截断但不丢失关键信息），以便准确核对。
15. 作为 WatchDog 用户，我想要确认框的按钮点击有明确反馈，以便确认操作生效。
16. 作为 WatchDog 用户，我想要任务继续执行后执行面板/悬浮窗恢复正常更新，以便继续阶段的每步动作可见。
17. 作为 WatchDog 用户，我想要确认流程不影响 TodoList 的最终归档，以便任务记录与清单保持一致。
18. 作为 WatchDog 用户，我想要停用/未接入确认机制的调用方（如测试、stub 循环）行为保持原样，以便兼容性不被破坏。
19. 作为 WatchDog 用户，我想要确认框在 app 无法拉回前台时至少留下可恢复的入口（如完成通知），以便后台场景不丢失确认机会。
20. 作为 WatchDog 用户，我想要模型以纯文本回复结束任务时同样经过我的确认，以便不会因模型绕过工具机制而跳过验收。
21. 作为 WatchDog 用户，我想要确认完成后纯文本回复作为最终答复正常展示，以便保持现有的"无工具调用=终态答复"语义。
22. 作为 WatchDog 用户，我想要模型在任务中途可以调用 ask_user 工具请求我做选择/提供信息，以便任务需要用户输入时不被卡住。
23. 作为 WatchDog 用户，我想要 ask_user 的交互与完成确认使用同一个弹框入口，以便交互体验一致。
24. 作为 WatchDog 用户，我想要 ask_user 不消耗主循环 step（非终止路径），以便中途询问不影响步骤配额。
25. 作为 WatchDog 用户，我想要模型频繁误用 ask_user 时可以在宿主层关闭该工具，以便不被频繁打断。

## Implementation Decisions

### 1. 核心 seam（AgentLoop 层，唯一的核心测试 seam）

新增 `completionGate` 注入选项与 `completion_pending` 事件类型（核心层只加钩子，UI 完全在宿主层，符合核心层与宿主层分离架构）：

- `completionGate?: (result: string) => Promise<'complete' | { continue: string }>`
- `task_complete` 分支改造为状态机（来自本 spec 的原型）：

```
task_complete 调用
  → yield { type: 'completion_pending', result }
  → decision = await completionGate(result)        // 宿主弹确认框；60s 超时默认 'complete'
  → decision === 'complete'  → yield { type: 'complete', result }; return
  → decision.continue        → _step++; 注入 corrections；continue 主循环
```

- **纯文本回复路径同样过 gate（封死绕过点）**：LLM 无工具调用时，提取的文本视为一次"完成判定"，先 yield `completion_pending` 并等待 gate：确认完成 → 按现有语义 yield `response` 收尾；未完成 → 注入提示词后继续主循环。空输出退化路径（无文本）仍走现有 no-op 观察路径，不过 gate。
- **可选 `ask_user` 工具（灵活性层）**：注册为不消耗 step 的普通工具，handler 在宿主弹同一确认 UI（含「完成」/「继续」之外的自由选择语义），返回值注入下一轮上下文；不作为终止路径，不影响完成确认流程。宿主可配置关闭该工具（防模型误用）。
- 未提供 gate、gate 抛错、gate 返回异常值 → 一律按 `'complete'` 处理（向后兼容，不破坏现有调用方）。
- 注入通道：continue 消息进入下一轮 `buildPrompt` 的 corrections 语义通道（与现有用户修正 getCorrections 同语义，但走独立内部通道，避免与实时修正指令竞争）。
- `task_failed` 不做确认，保持现有行为。

### 2. 宿主 seam（agentBridge）

- 消费 `completion_pending` 事件：触发确认流程（见下），并把 gate 实现接入 AgentLoop 构造选项。
- 确认状态通过现有 agent 状态通道暴露给 UI（新增 pending 完成确认状态字段）。
- 「未完成」构造的提示词固定为：`用户确认任务尚未完成：<模型摘要>。请继续完成剩余步骤。`
- 超时用 `freezeSafeDelay(60s)` 与用户按钮响应做竞速——native alarm 保证 JS 冻结期间超时也能触发。
- 确认 UI 与可选 `ask_user` 工具共用同一 Modal 与同一反馈注入通道；`ask_user` 的返回值（用户选择/输入）按工具结果格式注入下一轮上下文。

### 3. UI seam（ChatScreen）

- 新增完成确认 Modal（复用现有 PreflightModal 的 Modal 模式与样式体系）：标题「任务完成确认」+ 任务指令（可滚动全文）+ 最后判定摘要 + 「确认完成」/「未完成」两个按钮。
- Modal 显示期间任务保持在确认状态（gate await 挂起），无新动作执行。

### 4. Native seam（DeftAgentModule）

- 新增 `bringToFront()`：任务运行期间前台服务（FGS）存在，MIUI 后台拉起前台 Activity 的豁免适用；从后台将 MainActivity 带到前台（NEW_TASK | REORDER_TO_FRONT）。
- 若拉起失败，兜底依赖现有完成通知（可点击进入 app 后再处理确认），确认状态保持等待直至超时默认完成。

## Testing Decisions

- **核心 seam 测试（新增 AgentLoop 行为测试，fake provider 依次返回含 `task_complete` 的响应）**，只断言外部行为（事件流与后续 prompt 内容），不断言内部实现：
  - gate 返回 `'complete'` → 事件序列为 `completion_pending` → `complete`，循环终止
  - gate 返回 `{ continue }` → 事件序列为 `completion_pending`，且下一轮 LLM 调用收到的 prompt 包含注入的提示词；第二次 `task_complete` 后才真正完成
  - continue 消耗 1 个 step（`_step` 递增，受 maxSteps 约束）
  - 未提供 gate → 行为与改造前完全一致（向后兼容）
  - gate 抛错 → 默认按 `'complete'` 收尾，不崩坏循环
  - **纯文本回复路径**：无工具调用输出文本 → 先 `completion_pending`，gate 确认后按 `response` 收尾；gate 返回 continue → 继续主循环且下一轮 prompt 含注入提示词；空输出（无文本）不过 gate，走现有 no-op 路径
  - **ask_user 工具**：调用时 handler 返回用户选择，不产生 `completion_pending`/`complete` 事件，不消耗 step
- 现有测试先例：TodoTool.test.ts（工具 handler 行为测试）、watchdogBridge.test.ts（bridge 层 mock native 模块的测试模式）。
- UI 层（Modal、拉前台、按钮交互）以真机手动验证为主——PreflightModal 无自动化先例，不为此引入 UI 测试框架。

## Out of Scope

- `task_failed` 失败路径的确认（仅覆盖 `task_complete` 完成路径）
- 悬浮窗内确认按钮（已决策为 app 内 Modal + 自动拉前台）
- 定时任务（watchdog）触发场景的完成确认
- 多任务并发时的确认队列管理（当前单任务模型不涉及）
- 确认框的样式定制与主题化

## Further Notes

- 继续执行后模型可能再次调用 `task_complete`，每次都会重新进入确认，最终以用户最后一次「确认完成」的判定为准。
- MIUI 后台拉起前台的豁免依赖任务运行中的 FGS；若后续 FGS 机制调整，拉前台兜底需同步评估（通知点击进入）。
- 「未完成」注入的提示词与现有用户修正指令共用 corrections 语义，未来若增加"用户否决"类信号可复用同一通道。
- 纯文本回复过 gate 后仍保留"无工具调用=终态答复"的展示语义，仅增加确认环节，不改变最终答复的呈现方式。
- `ask_user` 工具为可选层：若真机验证中模型误触发频繁，宿主可默认关闭它，只保留强制 gate。
