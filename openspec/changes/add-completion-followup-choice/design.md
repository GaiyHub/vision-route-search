## Context

The agent loop already treats model completion as a user-gated verdict and accepts either `complete` or a continuation correction. The UI and fallback notification share one resolver, while the host app is brought forward for the primary dialog. Supplemental input needs an intermediate state because selecting it must reject completion semantically without resuming the model before the user submits text.

## Goals / Non-Goals

**Goals:**

- Make the primary completion dialog expose three unambiguous choices.
- Keep the same completion promise pending while supplemental text is edited.
- Validate and inject supplemental context exactly once, then resume the same loop.
- Preserve timeout, stop, notification, and external-app return guarantees.

**Non-Goals:**

- Adding text entry to the Android notification.
- Persisting incomplete supplemental drafts across process death.
- Changing the model-facing completion protocol or `task_complete` schema.

## Decisions

1. Represent completion UI as `decision` and `supplement` phases in the agent store. This keeps one gate resolver alive and avoids treating a UI transition as a completed decision.
2. Resolve 完成 as `complete`; resolve 继续 as a fixed `{ continue }` correction; resolve a submitted 补充信息 as a `{ continue }` correction containing trimmed user text.
3. Pause the automatic completion timeout during supplemental editing. A timeout must not mark a task complete while the user is actively composing missing information. Returning to the three choices starts a fresh timeout window.
4. Require non-empty supplemental text and cap it at 2000 characters. Draft text remains component-local and is not logged or persisted before submission.
5. Keep fallback notifications binary: 完成 or 继续. Text entry requires the host dialog, so the notification's rejection action maps to immediate continuation.

## 原地输入增量设计

用户在外部 App 中操作时，“补充信息”和 `ask_user` 默认复用同一个 Android
悬浮文本输入门控，不再仅为了输入文字切换到豆泡主界面。输入阶段临时移除
`FLAG_NOT_FOCUSABLE` 并接入输入法；退出输入阶段后立即恢复不可聚焦状态，避免长期
抢占外部 App 焦点。

原地输入只改变交互承载层，不改变消息语义：完成补充仍调用
`submitCompletionSupplement`，`ask_user` 仍调用 `submitUserClarification`，并且两者
都在恢复 AgentLoop 前将已接受文本写成一条用户消息。悬浮窗不可用、无法获取输入
焦点或展示失败时，才降级为拉起豆泡主界面的现有输入流程。

## UI 工具悬浮窗隔离

所有手机 UI 工具在真正进入原生执行阶段前 SHALL 统一暂停豆泡悬浮窗，并在工具返回、
失败或抛出异常后通过同一个 `finally` 路径恢复。隔离范围包括全部 `ui_*` 工具，以及
同样会驱动或等待手机界面的 `open_app`、`wait`；列表查询、Shell、笔记、Todo 等非 UI
工具不受影响。参数校验和风险确认发生在隔离之前，避免尚未执行动作时隐藏用户正在
交互的确认界面。截图工具在悬浮窗隐藏后额外等待一个很短的合成器稳定窗口，避免
MediaProjection 取得仍带有悬浮窗的缓存帧。

## 运行态悬浮窗默认位置

运行态状态悬浮窗首次创建时默认采用 `BOTTOM | CENTER_HORIZONTAL`，纵向位于系统
导航栏或手势区域上方并保留少量安全间距。该默认位置只影响窗口首次显示，不改变现有拖动实现；用户
开始拖动时仍转换为屏幕绝对坐标，拖动结束仅限制在可见屏幕内，不吸附边缘。完成、
风险确认和原地文本输入继续使用全屏遮罩内的居中模态卡片。

## Risks / Trade-offs

- [A supplemental dialog can remain open indefinitely] → stopping the task still clears and resolves the gate; the user can return to the timed decision phase.
- [User-provided context could be confused with trusted instructions] → inject it as explicitly attributed user context, not system text.
- [Multiple UI surfaces can race to settle the gate] → retain the idempotent single-settlement resolver and invalidate timeout generations on phase changes.
- [Android can retain focused TextInput native state when returning] → dismiss the keyboard first and render each phase behind a distinct, non-collapsible keyed native wrapper so button text nodes cannot be recycled across phases.
