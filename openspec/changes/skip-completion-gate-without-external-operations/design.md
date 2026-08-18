## Context

AgentLoop 对纯文本和 `task_complete` 都统一调用 host completion gate，这是防止模型绕过门禁的正确机制；问题在于 host 当前无条件展示 UI。已有任务级状态只跟踪是否需要返回外部 App，不足以完整表达网页和 Shell 等外部执行，因此需要独立的完成门禁轨迹。

## Goals / Non-Goals

**Goals:**

- 门禁资格由已分派的工具调用决定，不能由模型自行声明。
- 无外部操作时完全跳过完成 UI 的所有副作用。
- 外部操作发生后继续使用现有完成、继续、补充信息流程。

**Non-Goals:**

- 不删除 AgentLoop 对纯文本回复调用 completion gate 的统一协议。
- 不改变风险确认或完成确认弹框内容。

## Decisions

1. 新增独立、纯函数式的门禁触发分类器。手机 UI 变更工具、网页交互动作、`shell_execute`、`ask_user` 和 `confirm_action` 需要完成确认；只读观察、等待和其他 host 协议工具不需要。
2. 在 host bridge 中维护单调布尔值：任务开始时为 false，一旦分派外部操作便保持 true 到任务结束。按“已分派”而不是工具结果统计，避免失败的真实代操作被误判为纯问答。
3. `requestCompletionDecision` 在任何通知、store pending、前台切换之前检查该布尔值。false 时直接返回 `complete`；true 时执行原门禁。
4. 扩展工具分派记录传入参数，使 `browser_use` 能按具体 action 区分读取和交互。

## Risks / Trade-offs

- [分类遗漏新工具] → 未知工具默认不触发门禁，新增外部执行或需要完成确认的用户交互工具时必须在策略测试中显式登记。
- [网页动作边界复杂] → navigate/click/type/hover/scroll/execute_js/tab、环境及 Cookie 写入动作视为外部操作，页面读取与等待不视为操作。
- [任务状态串线] → 复用现有任务边界 reset，并增加连续任务测试。

## Migration Plan

无需数据迁移；构建安装后立即生效。回滚分类器和早返回即可恢复原行为。

## Open Questions

无。
