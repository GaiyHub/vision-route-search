## Context

The agent loop already treats model completion as a user-gated verdict and accepts either `complete` or a continuation correction. The UI and fallback notification share one resolver, while the host app is brought forward for the primary dialog. Supplemental input needs an intermediate state because selecting it must reject completion semantically without resuming the model before the user submits text.

## Goals / Non-Goals

**Goals:**

- Make the primary completion dialog expose three unambiguous choices.
- Keep the same completion promise pending while supplemental text is edited.
- Validate and inject supplemental context exactly once, then resume the same loop.
- Preserve timeout, stop, notification, and external-app return guarantees.

**Non-Goals:**

- Adding text entry to the Android notification or floating overlay.
- Persisting incomplete supplemental drafts across process death.
- Changing the model-facing completion protocol or `task_complete` schema.

## Decisions

1. Represent completion UI as `decision` and `supplement` phases in the agent store. This keeps one gate resolver alive and avoids treating a UI transition as a completed decision.
2. Resolve 完成 as `complete`; resolve 继续 as a fixed `{ continue }` correction; resolve a submitted 补充信息 as a `{ continue }` correction containing trimmed user text.
3. Pause the automatic completion timeout during supplemental editing. A timeout must not mark a task complete while the user is actively composing missing information. Returning to the three choices starts a fresh timeout window.
4. Require non-empty supplemental text and cap it at 2000 characters. Draft text remains component-local and is not logged or persisted before submission.
5. Keep fallback notifications binary: 完成 or 继续. Text entry requires the host dialog, so the notification's rejection action maps to immediate continuation.

## Risks / Trade-offs

- [A supplemental dialog can remain open indefinitely] → stopping the task still clears and resolves the gate; the user can return to the timed decision phase.
- [User-provided context could be confused with trusted instructions] → inject it as explicitly attributed user context, not system text.
- [Multiple UI surfaces can race to settle the gate] → retain the idempotent single-settlement resolver and invalidate timeout generations on phase changes.
- [Android can retain focused TextInput native state when returning] → dismiss the keyboard first and render each phase behind a distinct, non-collapsible keyed native wrapper so button text nodes cannot be recycled across phases.
